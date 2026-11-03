/**
 * Re-runs four v2 access tests on Sepolia with @zama-fhe/sdk (replacing @zama-fhe/relayer-sdk 0.4.1) and compares
 * them with the rows recorded in results/v2/access_tests.csv. Read-only: decryption requests and eth_call only.
 *   npx hardhat run scripts/v2/sdkCheck.ts --network sepolia
 * Tests: A1 control decryption · A2 other-doctor refusal · A4 random-wallet refusal · B30 handle reuse (empty proof),
 * plus B30b (the same reused handles with a fresh valid proof from the new SDK — exercises encryption).
 */
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { mdTable, short, writeCsv } from "../lib/common";
import { disposeAll, encryptUint64, rootMessage, SDK_PACKAGE, SDK_VERSION, sdkFor, userDecrypt } from "../lib/zama";
import { readV2Deployment, v2Wallets } from "./lib";

const OUT = path.join(__dirname, "..", "..", "results", "v2");
const MAX_CHUNKS = 32;

// Zama's InputVerifier reverts with custom errors; decode them instead of printing the raw bytes.
const inputVerifier = new ethers.Interface(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "node_modules", "@fhevm",
  "host-contracts-cleartext", "abi", "CleartextInputVerifier.json"), "utf8")));

function revertReason(e: unknown): string {
  const err = e as { reason?: string; shortMessage?: string; message?: string; data?: string; info?: { error?: { data?: string } } };
  const data = err.data ?? err.info?.error?.data;
  if (typeof data === "string" && data.length >= 10 && !data.startsWith("0x08c379a0")) {
    try {
      const parsed = inputVerifier.parseError(data);
      if (parsed) return `InputVerifier.${parsed.name}`;
    } catch { /* not an InputVerifier error */ }
  }
  return (err.reason ?? err.shortMessage ?? String(err.message).split("\n")[0]).replace(/^execution reverted:\s*/, "");
}

function readCsv(file: string): Record<string, string>[] {
  const [head, ...lines] = fs.readFileSync(file, "utf8").trim().split("\n");
  const split = (l: string) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  const cols = split(head);
  return lines.map((l) => Object.fromEntries(split(l).map((v, i) => [cols[i], v])));
}

async function main() {
  if (hre.network.name !== "sepolia") throw new Error("Run with --network sepolia");
  const provider = hre.ethers.provider;
  const rpc = (hre.network.config as { url: string }).url;
  const dep = readV2Deployment();
  const w = v2Wallets(provider);
  const abi = JSON.parse(fs.readFileSync(path.join(OUT, "ConfidentialCare.abi.json"), "utf8"));
  const c = new ethers.Contract(dep.address, abi, provider);
  const recorded = Object.fromEntries(readCsv(path.join(OUT, "access_tests.csv")).map((r) => [r.test_id, r]));

  const [handlesR] = await c.getComplaintHandles(1);
  const handles: string[] = [...handlesR];
  const random = ethers.Wallet.createRandom().connect(provider);
  console.log(`v2 ${short(dep.address)} · consultation #1 (${handles.length} chunks) · ${SDK_PACKAGE} ${SDK_VERSION}`);

  type Row = { test_id: string; wallet_role: string; action: string; expected: string; recorded_actual: string;
    new_actual: string; match: string; new_detail: string; recorded_detail: string };
  const rows: Row[] = [];
  const add = (id: string, who: string, action: string, expected: string, actual: string, detail: string) => {
    const rec = recorded[id];
    rows.push({ test_id: id, wallet_role: who, action, expected, recorded_actual: rec?.actual ?? "(not recorded)", new_actual: actual,
      match: rec ? String(rec.actual === actual) : "n/a (new test)", new_detail: detail.replace(/0x[0-9a-fA-F]{40}/g, (a) => short(a)).replace(/0x[0-9a-fA-F]{64}/g, (h) => `${h.slice(0, 10)}…${h.slice(-4)}`),
      recorded_detail: rec?.error_or_revert_reason ?? "" });
    console.log(`${id.padEnd(5)} ${who.padEnd(32)} expected ${expected.padEnd(8)} got ${actual.padEnd(8)} ${rows[rows.length - 1].new_detail.slice(0, 90)}`);
  };

  const dec = async (id: string, signer: ethers.Signer, who: string, expected: string) => {
    const r = await userDecrypt(await sdkFor(signer, rpc), dep.address, handles);
    add(id, who, "userDecrypt complaint", expected, r.actual, r.actual === "DECRYPT" ? `decrypted OK (${r.values!.length} chunks)` : `${r.errorName}: ${r.detail}`);
  };
  await dec("A1", w.doctor1, `assigned doctor 1 ${short(w.doctor1.address)}`, "DECRYPT");
  await dec("A2", w.doctor2, `other doctor 2 ${short(w.doctor2.address)}`, "REFUSED");
  await dec("A4", random, `random wallet ${short(random.address)}`, "REFUSED");

  const reused = [...handles, ...Array(MAX_CHUNKS - handles.length).fill(ethers.ZeroHash)];
  const sim = async (proof: string) => {
    try {
      await c.submitConsultation.staticCall(2, reused, proof, handles.length, { from: w.doctor1.address });
      return { actual: "SUCCEEDS", detail: "" };
    } catch (e) {
      return { actual: "REVERT", detail: revertReason(e) };
    }
  };
  const b30 = await sim("0x");
  add("B30", `doctor 1 ${short(w.doctor1.address)} as patient`, "submitConsultation(2, reused handles of #1, 0x)", "REVERT", b30.actual, b30.detail);

  // B30b: doctor 1 obtains a genuine proof for their own fresh data from the new SDK, then pairs it with the patient's handles.
  let b30b = { actual: "ERROR", detail: "" };
  try {
    const own = await encryptUint64(await sdkFor(w.doctor1, rpc), dep.address, w.doctor1.address, handles.map((_, i) => BigInt(i + 1)));
    const control = await (async () => {
      try {
        await c.submitConsultation.staticCall(2, [...own.handles, ...Array(MAX_CHUNKS - own.handles.length).fill(ethers.ZeroHash)], own.inputProof, handles.length, { from: w.doctor1.address });
        return "control (own handles + own proof) SUCCEEDS";
      } catch (e) {
        return `control (own handles + own proof) REVERT: ${revertReason(e)}`;
      }
    })();
    const r = await sim(own.inputProof);
    b30b = { actual: r.actual, detail: `${r.detail || "(no reason: custom error)"} · ${control}` };
  } catch (e) {
    b30b = { actual: "ERROR", detail: rootMessage(e) };
  }
  add("B30b", `doctor 1 ${short(w.doctor1.address)} as patient`, "submitConsultation(2, reused handles of #1, fresh valid proof)", "REVERT", b30b.actual, b30b.detail);

  const cols = ["test_id", "wallet_role", "action", "expected", "recorded_actual", "new_actual", "match", "new_detail", "recorded_detail"];
  writeCsv(path.join(OUT, "sdk_migration_check.csv"), rows, cols);
  const allMatch = rows.filter((r) => r.match !== "n/a (new test)").every((r) => r.match === "true");
  fs.writeFileSync(path.join(OUT, "sdk_migration_check.md"), [
    `# v2 on Sepolia — re-run with ${SDK_PACKAGE} ${SDK_VERSION}`,
    ``,
    `Contract ${short(dep.address)} · run ${new Date().toISOString().slice(0, 19)}Z · read-only (decryption requests and eth_call; no transactions).`,
    `Recorded results: \`results/v2/access_tests.csv\` (2026-11-02, \`@zama-fhe/relayer-sdk\` 0.4.1).`,
    ``,
    `**${allMatch ? "All re-run results match the recorded results." : "MISMATCH — see table."}**`,
    ``,
    mdTable(rows, ["test_id", "wallet_role", "action", "expected", "recorded_actual", "new_actual", "match", "new_detail"]),
    ``,
    `Notes`,
    `- Refusals (A2, A4) are still decided client-side: \`@fhevm/sdk\` (used by \`@zama-fhe/sdk\`) reads \`ACL.persistAllowed\` before contacting the relayer, as the old SDK did. The wording changed; the outcome did not.`,
    `- B30/B30b are \`eth_call\` simulations from doctor 1's address. B30b uses a genuine input proof that the relayer/coprocessors issued to doctor 1 for their own data; it is rejected because the patient's handles are not in that proof (InputVerifier custom error \`InvalidInputHandle\`, decoded with the v0.13 InputVerifier ABI).`,
    `- The random wallet is generated fresh for this run and discarded.`,
  ].join("\n") + "\n");
  console.log(`\n${allMatch ? "All recorded tests match." : "MISMATCH"} → results/v2/sdk_migration_check.{csv,md}`);
}

main()
  .then(() => {
    disposeAll();
    process.exit(process.exitCode ?? 0);
  })
  .catch((e) => {
    console.error(rootMessage(e));
    process.exit(1);
  });
