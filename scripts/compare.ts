/**
 * Build results/v1_vs_v2.md from results/access_tests.csv (v1) and results/v2/access_tests.csv (v2).
 *   npx hardhat run scripts/compare.ts
 * Offline: reads the CSVs and deployment records only.
 */
import * as fs from "fs";
import * as path from "path";
import { mdTable, short, V1_ADDRESS } from "./lib/common";

const RESULTS = path.join(__dirname, "..", "results");

function parseCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, "utf8");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const ORDER = [
  "A1", "A2", "A3", "A3b", "A4", "A5", "A5a", "A5b", "A5c", "A6",
  ...Array.from({ length: 30 }, (_, i) => `B${i + 1}`),
  "C1", "C2", "C3", "E1", "E2", "E3", "D1", "D2", "D3",
];

function outcome(r: Record<string, string> | undefined): string {
  if (!r) return "—";
  const p = r.passed === "true" ? "✔" : r.passed === "false" ? "✘" : r.passed.startsWith("n/a") ? "·" : "?";
  const reason = r.actual === "REVERT" && r.error_or_revert_reason ? ` "${r.error_or_revert_reason}"` : "";
  return `${p} ${r.actual}${reason}`;
}

function main() {
  const v1 = new Map(parseCsv(path.join(RESULTS, "access_tests.csv")).map((r) => [r.test_id, r]));
  const v2 = new Map(parseCsv(path.join(RESULTS, "v2", "access_tests.csv")).map((r) => [r.test_id, r]));
  const dep = JSON.parse(fs.readFileSync(path.join(RESULTS, "v2", "deployment.json"), "utf8"));

  const ids = [...ORDER.filter((id) => v1.has(id) || v2.has(id)), ...[...new Set([...v1.keys(), ...v2.keys()])].filter((id) => !ORDER.includes(id))]
    .filter((id) => !(id === "A5" && v2.has("A5a")));
  const CATEGORY: Record<string, string> = {
    A: "A. decryption", B: "B. permission (staticCall)", C: "C. withdrawal/closing", D: "D. metadata", E: "E. direct ACL (staticCall)",
  };
  const table = ids.map((id) => {
    // v1 recorded the response test as a single skipped "A5"; v2 split it into A5a/b/c.
    const a = v1.get(id) ?? (id.startsWith("A5") ? v1.get("A5") : undefined);
    const b = v2.get(id);
    const ref = b ?? a!;
    const changed = !a || !b ? "new in v2" : a.actual !== b.actual || a.passed !== b.passed ? "**changed**" : "same";
    return {
      test_id: id, category: CATEGORY[id[0]] ?? ref.category, test: ref.action.replace(/\(control\)/, "").slice(0, 90),
      v1: id.startsWith("A5") && !v1.has(id) && a ? `${outcome(a)} (as A5)` : outcome(a), v2: outcome(b), change: changed,
    };
  });

  const count = (m: Map<string, Record<string, string>>, p: string) => [...m.values()].filter((r) => r.passed === p).length;
  const changed = table.filter((r) => r.change === "**changed**");

  const md = [
    `# ConfidentialCare v1 vs v2 — access-control results (Sepolia)`,
    ``,
    `| | v1 | v2 |`,
    `| --- | --- | --- |`,
    `| Contract | \`${short(V1_ADDRESS)}\` | \`${short(dep.address)}\` |`,
    `| Test data | existing consultation #2 (patient = admin, role overlap) | synthetic consultation #1, four separate wallets |`,
    `| Rows | ${v1.size} | ${v2.size} |`,
    `| Passed / failed / skipped-info | ${count(v1, "true")} / ${count(v1, "false")} / ${v1.size - count(v1, "true") - count(v1, "false")} | ${count(v2, "true")} / ${count(v2, "false")} / ${v2.size - count(v2, "true") - count(v2, "false")} |`,
    ``,
    `Legend: ✔ passed · ✘ failed (result differs from the secure expectation) · · skipped or informational. Wallet addresses differ between versions, so compare by test ID.`,
    ``,
    `## Summary`,
    ``,
    `**What the fix changed**`,
    `- **B30 — handle-reuse re-sharing is closed.** v1 accepted a granted doctor resubmitting the patient's ciphertexts (empty proof) as a new consultation to another doctor; v2 rejects it with "Input proof required". Locally, the full attack (resubmit → grant → doctor 2 decrypts) succeeded on v1 and is blocked on v2, and a valid proof cannot be paired with someone else's handles (\`InvalidInputHandle\`).`,
    `- **B28 — all-zero response is closed.** v1 accepted \`submitResponse\` with zero handles and an empty proof (filling the single response slot); v2 rejects it.`,
    `- All other access checks (B1–B27, B29) behave identically: every wrong-role call reverts with the expected reason, and every control succeeds.`,
    ``,
    `**What stayed the same (by design of Zama's ACL, not fixed by v2)**`,
    `- **E1/E2 — direct ACL re-sharing.** A granted doctor can call \`ACL.allow\` to give any address access, or \`ACL.allowForDecryption\` to make the patient's ciphertext publicly decryptable, on both v1 and v2 (simulated only; nothing was shared or made public on-chain). E3 confirms an address without permission cannot do this.`,
    `- **C1 — withdrawal does not revoke.** After the patient's real \`markAccessWithdrawn\` transaction on v2, the doctor still decrypts (handles taken from the original transaction calldata; \`ACL.persistAllowed\` remains true).`,
    `- **C2 — closing does not revoke.** After the real \`closeConsultation\` transaction, the doctor still decrypts. **C3:** closing does block a further response ("Consultation not open").`,
    `- **D1/D2 — metadata.** Patient and doctor addresses are linkable to the consultation on both versions (\`ConsultationCreated\`, transaction senders, and the ACL \`Allowed\` events naming the doctor's wallet).`,
    ``,
    `**New results on v2 (not testable on v1)**`,
    `- **A5** — real response: the patient decrypts it; the other doctor and the responding doctor are refused.`,
    `- **A3** — admin is a separate wallet on v2 and is refused (on v1 the admin was the patient, so the test was skipped).`,
    ``,
    `**Caveats for the paper**`,
    `- "REFUSED" in A/C tests is the relayer SDK's client-side ACL check (\`persistAllowed\`); the request never reaches Zama's KMS. Server-side enforcement is not measured here.`,
    `- **Do not compare gas between v1 and v2.** Sepolia repriced gas between the v1 deployment (April 2026) and v2 (November 2026): creating a new account now costs ~207k gas vs 21k, and v2's deployment used 15.3M gas vs 2.17M for v1, for nearly the same bytecode.`,
    `- v1 tests ran on pre-existing data with an admin = patient overlap; v2 used fresh synthetic data with four separate wallets.`,
    ``,
    `**Changed rows:** ${changed.map((r) => r.test_id).join(", ") || "none"}`,
    ``,
    `## Per-test comparison`,
    ``,
    mdTable(table, ["test_id", "category", "test", "v1", "v2", "change"]),
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(RESULTS, "v1_vs_v2.md"), md);
  console.log(`Wrote results/v1_vs_v2.md (${table.length} rows, ${changed.length} changed: ${changed.map((r) => r.test_id).join(", ")})`);
}

main();
