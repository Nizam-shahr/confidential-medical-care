/**
 * Step 0 of results/v3/sepolia_plan.md: zero-gas preflight of DIRECT relayer requests, against v2.
 *   npx hardhat run scripts/v3/preflight.ts --network sepolia
 * P1 doctor 2 asks for patient #1's v2 complaint as a delegate (no delegation exists) — raw relayer request
 * P2 the same request with a corrupted signature — what a format/signature rejection looks like
 * P3 the same request through @zama-fhe/sdk — the client-side pre-check
 * Read-only: no transactions.
 */
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { mdTable, short, writeCsv } from "../lib/common";
import { delegatedDecrypt, disposeAll, sdkFor } from "../lib/zama";
import { readV2Deployment, v2Wallets } from "../v2/lib";
import { buildBody, postDelegated, RELAYER_URL, signDelegatedPermit } from "./lib/rawRelayer";

const OUT = path.join(__dirname, "..", "..", "results", "v3");
const MAX_BASE_FEE_GWEI = 5;

async function main() {
  if (hre.network.name !== "sepolia") throw new Error("Run with --network sepolia");
  const provider = hre.ethers.provider;
  const block = await provider.getBlock("latest");
  const baseFee = Number(ethers.formatUnits(block!.baseFeePerGas ?? 0n, "gwei"));
  console.log(`block ${block!.number}, base fee ${baseFee} gwei (stop above ${MAX_BASE_FEE_GWEI})`);
  if (baseFee > MAX_BASE_FEE_GWEI) throw new Error("STOP: base fee above 5 gwei");

  const dep = readV2Deployment();
  const w = v2Wallets(provider);
  const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "results", "v2", "ConfidentialCare.abi.json"), "utf8"));
  const c = new ethers.Contract(dep.address, abi, provider);
  const [hs] = await c.getComplaintHandles(1);
  const handle: string = hs[0];
  const acl = new ethers.Contract("0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D", [
    "function isHandleDelegatedForUserDecryption(address,address,address,bytes32) view returns (bool)",
    "function persistAllowed(bytes32,address) view returns (bool)",
  ], provider);
  const aclView = `delegated=${await acl.isHandleDelegatedForUserDecryption(w.patient.address, w.doctor2.address, dep.address, handle)} delegatorAllowed=${await acl.persistAllowed(handle, w.patient.address)}`;
  console.log(`v2 ${short(dep.address)} #1 chunk 0 · delegator patient ${short(w.patient.address)} · delegate doctor 2 ${short(w.doctor2.address)} · ACL ${aclView}`);
  console.log(`relayer ${RELAYER_URL}`);

  const rows: Record<string, unknown>[] = [];
  const { signedPermit } = await signDelegatedPermit(provider, w.doctor2 as unknown as ethers.Wallet, w.patient.address, dep.address);
  console.log(`permit v${signedPermit.version} ${signedPermit.eip712.primaryType}`);
  const body = buildBody(signedPermit, [handle], dep.address);

  const p1 = await postDelegated(body);
  rows.push({ id: "P1", path: "raw relayer", case: "no delegation (valid permit)", acl: aclView, verdict: p1.verdict, http: p1.httpStatuses, label: p1.label, message: p1.message, shares: p1.shares, seconds: ((p1.endedAt - p1.startedAt) / 1000).toFixed(1) });

  // Flip one hex digit inside r: still well-formed, but no longer a valid signature by doctor 2.
  const bad = { ...body, signature: body.signature.slice(0, 10) + (body.signature[10] === "0" ? "1" : "0") + body.signature.slice(11) };
  const p2 = await postDelegated(bad);
  rows.push({ id: "P2", path: "raw relayer", case: "same, corrupted signature", acl: aclView, verdict: p2.verdict, http: p2.httpStatuses, label: p2.label, message: p2.message, shares: p2.shares, seconds: ((p2.endedAt - p2.startedAt) / 1000).toFixed(1) });

  const t3 = Date.now();
  const p3 = await delegatedDecrypt(await sdkFor(w.doctor2, (hre.network.config as { url: string }).url), dep.address, [handle], w.patient.address);
  rows.push({ id: "P3", path: "@zama-fhe/sdk", case: "no delegation", acl: aclView, verdict: p3.actual, http: "(none: client-side)", label: p3.errorName ?? "", message: short(p3.detail).slice(0, 300), shares: 0, seconds: ((Date.now() - t3) / 1000).toFixed(1) });

  for (const r of rows) console.log(`${r.id} ${String(r.verdict).padEnd(16)} ${String(r.http).padEnd(22)} ${r.label} ${String(r.message).slice(0, 160)}`);
  for (const [id, o] of [["P1", p1], ["P2", p2]] as const) for (const s of o.steps) console.log(`  ${id} ${s.method} ${s.status} ${s.ms}ms ${s.body.slice(0, 300)}`);

  const cols = ["id", "path", "case", "acl", "verdict", "http", "label", "message", "shares", "seconds"];
  writeCsv(path.join(OUT, "sepolia_preflight.csv"), rows, cols);
  fs.writeFileSync(path.join(OUT, "sepolia_preflight.md"), [
    `# Sepolia preflight: direct relayer requests (v2, no gas)`,
    ``,
    `Run ${new Date().toISOString().slice(0, 19)}Z · block ${block!.number} · base fee ${baseFee} gwei · relayer ${RELAYER_URL}/v2/delegated-user-decrypt`,
    ``,
    mdTable(rows, cols),
    ``,
    `## Raw HTTP exchanges`,
    ``,
    ...[["P1", p1], ["P2", p2]].flatMap(([id, o]) => (o as typeof p1).steps.map((s) => `- ${id} ${s.method} ${s.status} (${s.ms} ms): \`${s.body.replace(/`/g, "'").slice(0, 400)}\``)),
  ].join("\n") + "\n");
  console.log("→ results/v3/sepolia_preflight.{csv,md}");
}

main().then(() => { disposeAll(); process.exit(0); }).catch((e) => { console.error(e.message ?? e); process.exit(1); });
