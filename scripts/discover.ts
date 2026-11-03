/**
 * Read-only inventory of the deployed ConfidentialCare contract.
 *   npx hardhat run scripts/discover.ts --network sepolia
 * Set CC_TARGET=v2 to inventory v2 (writes to results/v2/). Writes results/inventory.csv (consultations), results/inventory_txs.csv and results/inventory.md.
 * Sends no transactions and decrypts nothing.
 */
import hre from "hardhat";
import * as path from "path";
import * as fs from "fs";
import { buildInventory, CONTRACT_ADDRESS, mdTable, ownLabel, RESULTS_DIR, rolesOf, short, TARGET, writeCsv } from "./lib/common";

async function main() {
  if (hre.network.name !== "sepolia") throw new Error("Run with --network sepolia");
  const inv = await buildInventory(hre);
  const ownAddrs = new Set(inv.own.map((o) => o.address));

  // ── Wallets we control ──
  const ownRows = inv.own.map((o) => ({
    source: o.source, address: short(o.address), onchain_roles: rolesOf(o.address, inv).join("; ") || "(none)",
  }));
  const mismatches: string[] = [];
  // DOCTOR1/2 keys are the v1 doctors; on v2 the roles come from MNEMONIC.
  for (const [varName, id] of (TARGET === "v1" ? [["DOCTOR1_PRIVATE_KEY", 1], ["DOCTOR2_PRIVATE_KEY", 2]] as const : [])) {
    const o = inv.own.find((w) => w.source === varName);
    const d = inv.doctors.find((x) => x.id === id);
    if (o && d && o.address !== d.wallet) {
      mismatches.push(`${varName} derives ${short(o.address)}, but doctor ${id} is ${short(d.wallet)} (on-chain role: ${rolesOf(o.address, inv).join("; ") || "none"})`);
    }
  }

  // ── Role overlaps across ALL on-chain addresses ──
  const everyone = new Set([inv.admin, ...inv.doctors.map((d) => d.wallet), ...inv.consultations.map((c) => c.patient)]);
  const overlaps = [...everyone]
    .map((a) => ({ address: short(a), roles: rolesOf(a, inv), mine: ownLabel(a, inv) }))
    .filter((r) => r.roles.length > 1)
    .map((r) => ({ ...r, roles: r.roles.join(" + ") }));

  // ── Doctors (names deliberately omitted) ──
  const doctorRows = inv.doctors.map((d) => ({
    id: d.id, wallet: short(d.wallet), specialty: d.specialty, active: d.active,
    consultationCount: d.consultationCount, mine: ownLabel(d.wallet, inv) || "no",
  }));

  // ── Consultations ──
  const txsFor = (id: number) => inv.txs.filter((t) => t.consultId === id && !t.failed);
  const consultRows = inv.consultations.map((c) => {
    const ts = txsFor(c.id);
    const has = (fn: string) => ts.filter((t) => t.fn === fn).length;
    return {
      consult_id: c.id, patient: short(c.patient), patient_is_mine: ownAddrs.has(c.patient) ? ownLabel(c.patient, inv) : "no",
      doctor_id: c.doctorId, doctor_is_mine: ownLabel(inv.doctors.find((d) => d.id === c.doctorId)?.wallet ?? "", inv) || "no",
      status: c.status, created_at_utc: c.createdAt, complaint_chunks: c.complaintChunkCount,
      has_response: c.hasResponse, response_chunks: c.responseChunkCount,
      n_grant: has("grantDoctorAccess"), n_revoke: has("revokeDoctorAccess") + has("markAccessWithdrawn"),
      n_response: has("submitResponse"), n_close: has("closeConsultation"),
    };
  });

  // ── Transactions ──
  const txRows = inv.txs.map((t) => ({
    tx_hash: t.hash, function: t.fn, consult_id: t.consultId ?? "", sender: short(t.from),
    sender_roles: rolesOf(t.from, inv).join("; "), sender_is_mine: ownLabel(t.from, inv) || "no",
    gas_used: t.gasUsed, block: t.block, block_time_utc: t.blockTime, status: t.failed ? "FAILED" : "ok",
    n_logs: t.logs.length,
  }));

  const consultCols = Object.keys(consultRows[0] ?? { consult_id: "" });
  const txCols = Object.keys(txRows[0] ?? { tx_hash: "" });
  writeCsv(path.join(RESULTS_DIR, "inventory.csv"), consultRows, consultCols);
  writeCsv(path.join(RESULTS_DIR, "inventory_txs.csv"), txRows, txCols);

  // Gas summary per function (successful txs only).
  const byFn = new Map<string, number[]>();
  for (const t of inv.txs.filter((x) => !x.failed)) byFn.set(t.fn, [...(byFn.get(t.fn) ?? []), t.gasUsed]);
  const gasRows = [...byFn].map(([fn, g]) => ({
    function: fn, n: g.length, min: Math.min(...g), median: g.sort((a, b) => a - b)[Math.floor(g.length / 2)], max: Math.max(...g),
  }));

  const revokes = inv.txs.filter((t) => ["revokeDoctorAccess", "markAccessWithdrawn"].includes(t.fn) && !t.failed);
  const md = [
    `# ConfidentialCare — on-chain inventory`,
    ``,
    `Contract \`${short(CONTRACT_ADDRESS)}\` on Sepolia · generated ${new Date().toISOString()} · read-only`,
    ``,
    `- Admin: ${short(inv.admin)}${ownLabel(inv.admin, inv) ? ` (mine: ${ownLabel(inv.admin, inv)})` : ""}`,
    `- Doctors: ${inv.doctors.length} · Consultations: ${inv.consultations.length} · Contract txs: ${inv.txs.length} (${inv.txs.filter((t) => t.failed).length} failed)`,
    `- Consultations whose patient is one of my wallets: ${consultRows.filter((r) => r.patient_is_mine !== "no").map((r) => `#${r.consult_id}`).join(", ") || "none"}`,
    `- revokeDoctorAccess / markAccessWithdrawn transactions on-chain: ${revokes.length ? revokes.map((t) => `#${t.consultId}`).join(", ") : "none"}`,
    ``,
    `## Wallets I control`,
    mdTable(ownRows, ["source", "address", "onchain_roles"]),
    ...(mismatches.length ? [``, `**⚠ Key/role mismatch:**`, ...mismatches.map((m) => `- ${m}`)] : []),
    ``,
    `## Role overlaps (one address, several roles)`,
    overlaps.length ? mdTable(overlaps, ["address", "roles", "mine"]) : `None.`,
    ``,
    `## Doctors`,
    mdTable(doctorRows, Object.keys(doctorRows[0] ?? {})),
    ``,
    `## Consultations`,
    mdTable(consultRows, consultCols),
    ``,
    `## Transactions`,
    mdTable(txRows.map((r) => ({ ...r, tx_hash: `${r.tx_hash.slice(0, 10)}…` })), txCols),
    ``,
    `## Gas used per function (successful txs)`,
    mdTable(gasRows, ["function", "n", "min", "median", "max"]),
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "inventory.md"), md);

  console.log(`Admin ${short(inv.admin)} · ${inv.doctors.length} doctors · ${inv.consultations.length} consultations · ${inv.txs.length} txs`);
  console.table(ownRows);
  if (mismatches.length) console.log("⚠ Key/role mismatch:\n  " + mismatches.join("\n  "));
  if (overlaps.length) { console.log("Role overlaps:"); console.table(overlaps); }
  console.log(`revoke/withdraw txs: ${revokes.length ? revokes.map((t) => `#${t.consultId}`).join(", ") : "none"}`);
  console.log(`Wrote inventory.csv, inventory_txs.csv, inventory.md to ${path.relative(process.cwd(), RESULTS_DIR)}`);
}


main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
