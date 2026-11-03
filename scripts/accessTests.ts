/**
 * Access-control tests against on-chain data.
 *   npx hardhat run scripts/accessTests.ts --network sepolia                          (v1, read-only)
 *   CC_TARGET=v2 npx hardhat run scripts/accessTests.ts --network sepolia             (v2, read-only)
 *   CC_TARGET=v2 CC_ALLOW_TX=1 npx hardhat run scripts/accessTests.ts --network sepolia  (v2 + real txs)
 *
 * A. user decryption via the Zama relayer SDK (same flow as frontend/frontend/libs/fhe-utils.ts)
 * B. permission checks via staticCall (eth_call, simulated, never mined)
 * E. direct ACL re-sharing by a granted doctor (staticCall only — never sent)
 * C. withdrawal / closing — on v2 with CC_ALLOW_TX=1 the patient really withdraws and closes
 * D. metadata visible in event logs of the chosen consultation's transactions
 *
 * Real transactions (v2 + CC_ALLOW_TX=1 only) run after all read-only tests, in this order:
 * doctor response (A5) → markAccessWithdrawn (C1) → closeConsultation (C2, C3). Each batch is printed
 * with gas estimates before it is sent. Steps already done on-chain are not repeated.
 *
 * Plaintext is never printed or stored; only "decrypted OK" and a character count.
 * Only consultations whose patient is one of the wallets in Hardhat vars are decrypted.
 */
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import {
  buildInventory, CONTRACT_ADDRESS, contractAbi, Inventory, mdTable, ownLabel, RESULTS_DIR, rolesOf, short,
  shortenAddressesIn, TARGET, writeCsv,
} from "./lib/common";
import { planAndSend } from "./v2/lib";

import { disposeAll, encryptUint64, rootMessage, SDK_PACKAGE, SDK_VERSION, sdkFor, userDecrypt } from "./lib/zama";

const CONTRACT = ethers.getAddress(CONTRACT_ADDRESS);
const ALLOW_TX = TARGET === "v2" && process.env.CC_ALLOW_TX === "1";
const WITHDRAW_FN = TARGET === "v2" ? "markAccessWithdrawn" : "revokeDoctorAccess";
const MAX_CHUNKS = 32;
const RESPONSE_TEXT = "Synthetic test response for security evaluation";
const COLUMNS = [
  "test_id", "category", "consult_id", "wallet_role", "action", "expected", "actual", "passed",
  "error_or_revert_reason", "timestamp_utc", "acl_persist_allowed", "notes",
];

type Row = Record<(typeof COLUMNS)[number], string | number>;
const rows: Row[] = [];
const surprises: string[] = [];

function record(r: Partial<Row> & { test_id: string; category: string }): Row {
  const row = Object.fromEntries(COLUMNS.map((c) => [c, ""])) as Row;
  Object.assign(row, r, { timestamp_utc: new Date().toISOString().replace(/\.\d+Z$/, "Z") });
  row.error_or_revert_reason = shortenAddressesIn(String(row.error_or_revert_reason));
  rows.push(row);
  const mark = row.passed === "true" ? "✔" : row.passed === "false" ? "✘" : "•";
  console.log(`${mark} ${row.test_id} [${row.wallet_role}] ${row.action} → ${row.actual}${row.passed === "false" ? "  (expected " + row.expected + ")" : ""}`);
  return row;
}

// Same text decoding as fhe-utils.ts; used only to count characters.
function uint64ChunksToText(chunks: bigint[]): string {
  const bytes: number[] = [];
  for (const chunk of chunks) for (let i = 7; i >= 0; i--) bytes.push(Number((chunk >> BigInt(i * 8)) & 0xffn));
  const trimmed = bytes.filter((b, i) => b !== 0 || bytes.slice(i + 1).some((x) => x !== 0));
  return new TextDecoder().decode(new Uint8Array(trimmed));
}
// Same encoding as frontend/frontend/libs/fhe-utils.ts
function textToUint64Chunks(text: string): bigint[] {
  const bytes = new TextEncoder().encode(text.slice(0, MAX_CHUNKS * 8));
  const chunks: bigint[] = [];
  for (let i = 0; i < bytes.length; i += 8) {
    let val = 0n;
    for (let j = 0; j < 8; j++) val = (val << 8n) | BigInt(bytes[i + j] ?? 0);
    chunks.push(val);
  }
  return chunks.length ? chunks : [0n];
}

function rpcUrl(): string {
  return (hre.network.config as { url: string }).url;
}

async function encryptPadded(signer: ethers.Signer, text: string) {
  const chunks = textToUint64Chunks(text);
  const enc = await encryptUint64(await sdkFor(signer, rpcUrl()), CONTRACT, await signer.getAddress(), chunks);
  return { padded: [...enc.handles, ...Array(MAX_CHUNKS - enc.handles.length).fill(ethers.ZeroHash)], proof: enc.inputProof, count: chunks.length };
}

function revertReason(e: unknown): string {
  const err = e as { reason?: string; shortMessage?: string; message?: string };
  // Alchemy returns the reason as "execution reverted: <reason>" without revert data.
  return (err.reason ?? err.shortMessage ?? String(err.message).split("\n")[0]).replace(/^execution reverted:\s*/, "");
}

async function tryDecrypt(signer: ethers.Signer, handles: string[]) {
  try {
    const r = await userDecrypt(await sdkFor(signer, rpcUrl()), CONTRACT, handles);
    if (r.actual !== "DECRYPT") return { actual: r.actual, detail: r.detail };
    const chars = [...uint64ChunksToText(r.values!)].length;
    return { actual: "DECRYPT", detail: `decrypted OK (${chars} chars)` };
  } catch (e) {
    return { actual: "ERROR", detail: rootMessage(e) };
  }
}

async function main() {
  if (hre.network.name !== "sepolia") throw new Error("Run with --network sepolia");
  const provider = hre.ethers.provider;
  let inv: Inventory = await buildInventory(hre);
  const c = new ethers.Contract(CONTRACT, contractAbi(), provider);
  const acl = new ethers.Contract(inv.aclAddress, [
    "function persistAllowed(bytes32 handle, address account) view returns (bool)",
    "function allow(bytes32 handle, address account)",
    "function allowForDecryption(bytes32[] handlesList)",
  ], provider);
  const own = new Map(inv.own.map((o) => [o.address, o.wallet]));
  const isMine = (a: string) => own.has(a);
  const doctorWallet = (id: number) => inv.doctors.find((d) => d.id === id)!.wallet;
  const role = (a: string) => [rolesOf(a, inv).join(" + ") || "no role", ownLabel(a, inv) ? "" : "(not mine)"].join(" ").trim();

  const aclOracle = async (handles: string[], who: string) => {
    const ok = await Promise.all(handles.map((h) => acl.persistAllowed(h, who) as Promise<boolean>));
    const n = ok.filter(Boolean).length;
    return n === handles.length ? "all" : n === 0 ? "none" : `${n}/${handles.length}`;
  };

  // ── Step 3: choose the consultation ──────────────────────────────────────────
  const mineAsPatient = inv.consultations.filter((x) => isMine(x.patient));
  if (!mineAsPatient.length) throw new Error("STOP: no consultation has one of my wallets as patient.");
  let chosen: (typeof mineAsPatient)[number] | undefined;
  let chosenHandles: string[] = [];
  for (const cand of mineAsPatient) {
    const doc = doctorWallet(cand.doctorId);
    if (!isMine(doc)) continue;
    const [handles] = await c.getComplaintHandles(cand.id);
    if ((await aclOracle(handles, doc)) === "all") { chosen = cand; chosenHandles = [...handles]; break; }
  }
  if (!chosen) {
    throw new Error("STOP: none of my patient consultations (" + mineAsPatient.map((x) => `#${x.id}`).join(", ") +
      ") has an assigned doctor whose key I hold AND who was granted access.");
  }
  const assigned = doctorWallet(chosen.doctorId);
  const otherDoctors = inv.doctors.filter((d) => d.id !== chosen!.doctorId && isMine(d.wallet));
  if (!otherDoctors.length) throw new Error(`STOP: no key for a doctor other than doctor ${chosen.doctorId}.`);
  const otherDoc = otherDoctors[0];
  const patient = chosen.patient;
  const random = ethers.Wallet.createRandom();
  const cid = chosen.id;

  const overlaps: string[] = [];
  if (inv.admin === patient) overlaps.push(`admin == patient of #${cid} (${short(patient)})`);
  if (inv.admin === assigned) overlaps.push(`admin == assigned doctor (${short(assigned)})`);
  if (inv.doctors.some((d) => d.wallet === patient)) overlaps.push(`patient ${short(patient)} is also a registered doctor`);
  for (const d of inv.doctors) {
    const p = inv.consultations.filter((x) => x.patient === d.wallet).map((x) => `#${x.id}`);
    if (p.length) overlaps.push(`doctor ${d.id} (${short(d.wallet)}) is also patient of ${p.join(", ")}`);
  }

  console.log(`\nChosen consultation #${cid}: patient ${short(patient)} · assigned doctor ${chosen.doctorId} (${short(assigned)}) · other doctor ${otherDoc.id} (${short(otherDoc.wallet)})`);
  console.log(`Role overlaps: ${overlaps.length ? overlaps.join("; ") : "none"}\n`);

  // ── A. Decryption ────────────────────────────────────────────────────────────
  console.log(`Using ${SDK_PACKAGE} ${SDK_VERSION}…`);

  const decryptTest = async (id: string, consultId: number, handles: string[], signer: ethers.Signer, who: string,
    action: string, expected: "DECRYPT" | "REFUSED", notes = "") => {
    const addr = await signer.getAddress();
    const oracle = await aclOracle(handles, addr);
    const r = await tryDecrypt(signer, handles);
    const passed = r.actual === "ERROR" ? "inconclusive" : String(r.actual === expected);
    if (passed === "false") surprises.push(`${id}: ${who} → ${r.actual}, expected ${expected}`);
    return record({
      test_id: id, category: id.startsWith("C") ? "C. withdrawal/closing" : "A. decryption", consult_id: consultId, wallet_role: who, action, expected,
      actual: r.actual, passed, error_or_revert_reason: r.detail,
      acl_persist_allowed: oracle, notes,
    });
  };

  const control = await decryptTest("A1", cid, chosenHandles, own.get(assigned)!, `assigned doctor ${chosen.doctorId} ${short(assigned)}`,
    "userDecrypt complaint (CONTROL)", "DECRYPT");
  if (control.actual !== "DECRYPT") {
    finish(inv, cid, overlaps, `CONTROL FAILED: the assigned doctor could not decrypt (${control.error_or_revert_reason}). Setup is wrong; remaining tests not run.`);
    return;
  }
  await decryptTest("A2", cid, chosenHandles, own.get(otherDoc.wallet)!, `other doctor ${otherDoc.id} ${short(otherDoc.wallet)}`,
    "userDecrypt complaint", "REFUSED");

  if (inv.admin === patient || inv.admin === assigned) {
    record({
      test_id: "A3", category: "A. decryption", consult_id: cid, wallet_role: `admin ${short(inv.admin)}`,
      action: "userDecrypt complaint", expected: "REFUSED", actual: "SKIPPED", passed: "n/a (role overlap)",
      acl_persist_allowed: await aclOracle(chosenHandles, inv.admin),
      notes: `admin is the ${inv.admin === patient ? "patient" : "assigned doctor"} of #${cid}, so it holds a legitimate ACL grant; an admin-refusal test is meaningless here`,
    });
  } else if (isMine(inv.admin)) {
    await decryptTest("A3", cid, chosenHandles, own.get(inv.admin)!, `admin ${short(inv.admin)}`, "userDecrypt complaint", "REFUSED");
  }
  await decryptTest("A3b", cid, chosenHandles, own.get(patient)!, `patient ${short(patient)}`, "userDecrypt own complaint", "DECRYPT",
    "positive control: submitConsultation grants the patient ACL on its own complaint");
  await decryptTest("A4", cid, chosenHandles, random, `random wallet ${short(random.address)}`, "userDecrypt complaint", "REFUSED");

  // (A5 runs after the read-only tests, because on v2 it may first send a real response.)

  // A6: assigned doctor on one of my consultations that was never granted
  for (const ng of mineAsPatient.filter((x) => x.id !== cid && isMine(doctorWallet(x.doctorId)))) {
    const granted = inv.txs.some((t) => t.consultId === ng.id && t.fn === "grantDoctorAccess" && !t.failed);
    if (granted) continue;
    const [h] = await c.getComplaintHandles(ng.id);
    const dw = doctorWallet(ng.doctorId);
    await decryptTest("A6", ng.id, [...h], own.get(dw)!, `assigned doctor ${ng.doctorId} ${short(dw)}`,
      "userDecrypt complaint BEFORE grantDoctorAccess", "REFUSED", "no grantDoctorAccess tx exists for this consultation");
    break;
  }

  // ── B. Permission checks (staticCall, nothing is sent) ───────────────────────
  const zeroHandles = Array(32).fill(ethers.ZeroHash);
  const fresh = ethers.Wallet.createRandom().address;
  const ACCESS_REASONS = ["Not admin", "Not the patient", "Not a registered doctor", "Not assigned to this consultation"];
  let bn = 0;
  const staticTest = async (fn: string, args: unknown[], from: string, who: string, expectedReason: string | null, notes = "") => {
    const id = `B${++bn}`;
    let actual: string;
    let reason = "";
    try {
      await (c.getFunction(fn).staticCall as (...a: unknown[]) => Promise<unknown>)(...args, { from });
      actual = "SUCCEEDS (simulated)";
    } catch (e) {
      reason = revertReason(e);
      actual = "REVERT";
    }
    let expected: string;
    let passed: string;
    if (expectedReason === null) {
      expected = "SUCCEEDS (simulated)";
      passed = String(actual === expected);
    } else if (expectedReason === "*non-access*") {
      expected = "passes access checks";
      passed = String(actual === "SUCCEEDS (simulated)" || !ACCESS_REASONS.includes(reason));
    } else if (expectedReason === "*any-revert*") {
      expected = "REVERT (should be rejected)";
      passed = String(actual === "REVERT");
      if (actual !== "REVERT") surprises.push(`⚠ ${id}: ${fn} from ${who} was accepted — ${notes}`);
    } else {
      expected = `REVERT "${expectedReason}"`;
      passed = String(actual === "REVERT" && reason === expectedReason);
      if (actual !== "REVERT") {
        surprises.push(`🚨 SECURITY BUG: ${fn} from ${who} did NOT revert`);
        notes = `🚨 SECURITY BUG: call from wrong wallet succeeded. ${notes}`;
      } else if (reason !== expectedReason) {
        surprises.push(`${id}: ${fn} from ${who} reverted with "${reason}" instead of "${expectedReason}"`);
      }
    }
    record({
      test_id: id, category: "B. permission (staticCall)", consult_id: ["grantDoctorAccess", "revokeDoctorAccess", "markAccessWithdrawn", "closeConsultation", "submitResponse", "getComplaintHandles"].includes(fn) ? cid : "",
      wallet_role: who, action: `${fn}(${args.map((a) => (Array.isArray(a)
        ? (a.every((h) => h === ethers.ZeroHash) ? "[32 zero handles]" : `[${a.filter((h) => h !== ethers.ZeroHash).length} reused handles of #${cid}]`)
        : typeof a === "string" && a.startsWith("0x") && a.length === 42 ? short(a) : String(a))).join(", ")})`,
      expected, actual, passed, error_or_revert_reason: reason, notes,
    });
  };

  const nonAdmins: [string, string][] = [
    [assigned, `doctor ${chosen.doctorId} ${short(assigned)}`],
    [otherDoc.wallet, `doctor ${otherDoc.id} ${short(otherDoc.wallet)}`],
    [random.address, `random ${short(random.address)}`],
  ];
  for (const [from, who] of nonAdmins) {
    await staticTest("addDoctor", [fresh, "x", "y", "z"], from, who, "Not admin", "fresh wallet argument, so only the access check can fail");
    await staticTest("deactivateDoctor", [1], from, who, "Not admin");
    await staticTest("transferAdmin", [from], from, who, "Not admin");
  }
  const nonPatients = nonAdmins.filter(([a]) => a !== patient);
  for (const fn of ["grantDoctorAccess", "revokeDoctorAccess", "closeConsultation"]) {
    for (const [from, who] of nonPatients) await staticTest(fn === "revokeDoctorAccess" ? WITHDRAW_FN : fn, [cid], from, who, "Not the patient");
  }
  await staticTest("submitResponse", [cid, zeroHandles, "0x", 1], otherDoc.wallet, `doctor ${otherDoc.id} ${short(otherDoc.wallet)} (not assigned)`,
    "Not assigned to this consultation", "access modifiers run before FHE.fromExternal, so dummy handles + empty proof are enough");
  await staticTest("submitResponse", [cid, zeroHandles, "0x", 1], random.address, `random ${short(random.address)}`, "Not a registered doctor");
  await staticTest("submitResponse", [cid, zeroHandles, "0x", 1], inv.admin, `admin ${short(inv.admin)}`, "Not a registered doctor",
    inv.admin === patient ? "admin is also the patient — still not a doctor" : "");

  // Positive controls: the correct role passes the access check (simulated only; no state changes).
  await staticTest("addDoctor", [fresh, "x", "y", "z"], inv.admin, `admin ${short(inv.admin)} (control)`, null);
  await staticTest("deactivateDoctor", [1], inv.admin, `admin ${short(inv.admin)} (control)`, null);
  await staticTest("transferAdmin", [inv.admin], inv.admin, `admin ${short(inv.admin)} (control)`, null);
  for (const fn of ["grantDoctorAccess", "revokeDoctorAccess", "closeConsultation"]) {
    await staticTest(fn === "revokeDoctorAccess" ? WITHDRAW_FN : fn, [cid], patient, `patient ${short(patient)} (control)`, null);
  }
  await staticTest("submitResponse", [cid, zeroHandles, "0x", 1], assigned, `assigned doctor ${chosen.doctorId} ${short(assigned)} (control)`,
    "*non-access*", TARGET === "v2"
      ? "access control holds; v2 then rejects the empty proof (\"Input proof required\"), so an all-zero response is no longer possible"
      : "access control holds. Note: with an empty proof FHE.fromExternal maps a zero handle to an encrypted 0, so the call is fully accepted — the assigned doctor can submit an all-zero response that permanently fills the single response slot");
  await staticTest("getComplaintHandles", [cid], random.address, `random ${short(random.address)}`, null,
    "informational: encrypted handles are public to anyone; access control applies only at decryption");

  // Handle reuse: a granted doctor submits the patient's complaint handles (empty proof) as a NEW consultation to
  // another doctor. FHE.fromExternal accepts any handle the sender is ACL-allowed on; a follow-up grantDoctorAccess
  // would then FHE.allow the other doctor on the original patient's ciphertexts. Only step 1 can be simulated.
  const reused = [...chosenHandles, ...Array(32 - chosenHandles.length).fill(ethers.ZeroHash)];
  await staticTest("submitConsultation", [otherDoc.id, reused, "0x", chosenHandles.length], assigned,
    `doctor ${chosen.doctorId} ${short(assigned)} acting as patient`, "*any-revert*",
    `handle reuse: granted doctor re-submits patient's ciphertexts to doctor ${otherDoc.id}; if accepted, a later grantDoctorAccess from the doctor would give doctor ${otherDoc.id} ACL on patient ${short(patient)}'s complaint without patient consent (ACL re-delegation)`);

  // ── E. Direct ACL re-sharing by the granted doctor (simulation only — NEVER sent) ──
  const aclSim = async (id: string, label: string, from: string, who: string, call: () => Promise<unknown>, expectRevert: boolean, notes: string) => {
    let actual = "SUCCEEDS (simulated)";
    let reason = "";
    try { await call(); } catch (e) { actual = "REVERT"; reason = revertReason(e); }
    const passed = String(expectRevert ? actual === "REVERT" : actual !== "REVERT");
    if (passed === "false") surprises.push(`${id}: ${label} from ${who} → ${actual}`);
    record({
      test_id: id, category: "E. direct ACL (staticCall)", consult_id: cid, wallet_role: who, action: label,
      expected: expectRevert ? "REVERT (should be rejected)" : "SUCCEEDS (simulated)", actual, passed,
      error_or_revert_reason: reason || (actual === "REVERT" ? "custom error" : ""),
      acl_persist_allowed: await aclOracle(chosenHandles, from), notes,
    });
  };
  await aclSim("E1", `ACL.allow(#${cid} complaint chunk 0, doctor ${otherDoc.id} ${short(otherDoc.wallet)})`, assigned,
    `assigned doctor ${chosen.doctorId} ${short(assigned)}`,
    () => acl.allow.staticCall(chosenHandles[0], otherDoc.wallet, { from: assigned }), true,
    "LIMITATION (Zama ACL design): ACL.allow only requires the caller to be allowed on the handle, so a granted doctor can re-share directly, bypassing the contract");
  await aclSim("E2", `ACL.allowForDecryption([#${cid} complaint chunk 0]) — make publicly decryptable`, assigned,
    `assigned doctor ${chosen.doctorId} ${short(assigned)}`,
    () => acl.allowForDecryption.staticCall([chosenHandles[0]], { from: assigned }), true,
    "LIMITATION (Zama ACL design): a granted doctor can make the patient's ciphertext publicly decryptable. Simulation only — never sent");
  await aclSim("E3", `ACL.allow(#${cid} complaint chunk 0, self) by a doctor WITHOUT permission (control)`, otherDoc.wallet,
    `other doctor ${otherDoc.id} ${short(otherDoc.wallet)}`,
    () => acl.allow.staticCall(chosenHandles[0], otherDoc.wallet, { from: otherDoc.wallet }), true,
    "control: an address with no ACL permission cannot grant itself access");

  // Handles taken from the original submitConsultation calldata (not the getter) for the C tests.
  const handlesFromTx = async (consultId: number) => {
    const t = inv.txs.find((x) => x.consultId === consultId && x.fn === "submitConsultation" && !x.failed)!;
    const tx = await provider.getTransaction(t.hash);
    const parsed = c.interface.parseTransaction({ data: tx!.data })!;
    const fromTx = (parsed.args.encryptedChunks as string[]).slice(0, Number(parsed.args.chunkCount)).map(String);
    const [fromGetter] = await c.getComplaintHandles(consultId);
    const same = fromTx.length === fromGetter.length && fromTx.every((h, i) => h === fromGetter[i]);
    return { handles: fromTx, note: `handles decoded from submitConsultation calldata ${t.hash.slice(0, 10)}… (${same ? "identical to" : "DIFFERENT from"} getter)` };
  };

  const sent: string[] = [];
  const signerFor = (a: string) => own.get(a)! as unknown as ethers.Signer;

  // ── A5. Response (v2: doctor sends a real response first if none exists) ─────
  let meta = await c.getConsultationMeta(cid);
  if (ALLOW_TX && !meta.hasResponse) {
    const r = await encryptPadded(signerFor(assigned), RESPONSE_TEXT);
    const receipts = await planAndSend(`A5: doctor ${chosen.doctorId} responds to #${cid} (synthetic text)`, [
      { label: `submitResponse(${cid}, ${r.count} chunks)`, signer: signerFor(assigned),
        request: await c.submitResponse.populateTransaction(cid, r.padded, r.proof, r.count) },
    ], provider);
    sent.push(...receipts.map((x) => x.hash));
    meta = await c.getConsultationMeta(cid);
  }
  const withResponse = meta.hasResponse ? chosen : mineAsPatient.find((x) => x.hasResponse);
  if (withResponse) {
    const [rh] = await c.getResponseHandles(withResponse.id);
    await decryptTest("A5a", withResponse.id, [...rh], own.get(withResponse.patient)!, `patient ${short(withResponse.patient)}`, "userDecrypt response", "DECRYPT");
    const od = inv.doctors.find((d) => d.id !== withResponse.doctorId && isMine(d.wallet));
    if (od) await decryptTest("A5b", withResponse.id, [...rh], own.get(od.wallet)!, `other doctor ${od.id} ${short(od.wallet)}`, "userDecrypt response", "REFUSED");
    const ad = doctorWallet(withResponse.doctorId);
    if (isMine(ad)) await decryptTest("A5c", withResponse.id, [...rh], own.get(ad)!, `responding doctor ${withResponse.doctorId} ${short(ad)}`,
      "userDecrypt own response", "REFUSED", "contract comment: doctor is 'response-blind'");
  } else {
    record({
      test_id: "A5", category: "A. decryption", consult_id: "", wallet_role: "patient / other doctor", action: "userDecrypt response",
      expected: "DECRYPT / REFUSED", actual: "SKIPPED", passed: "n/a",
      notes: `none of my patient consultations (${mineAsPatient.map((x) => `#${x.id}`).join(", ")}) has a response; responses exist only on consultations of other patients, which are not decrypted`,
    });
  }

  // ── C. Withdrawal and closing ────────────────────────────────────────────────
  const assignedSigner = own.get(assigned)!;
  const assignedWho = `assigned doctor ${chosen.doctorId} ${short(assigned)}`;
  if (ALLOW_TX) {
    // C1: patient marks access withdrawn, then the doctor tries again with handles from the tx data.
    if (!inv.txs.some((t) => t.consultId === cid && t.fn === WITHDRAW_FN && !t.failed)) {
      const receipts = await planAndSend(`C1: patient calls ${WITHDRAW_FN}(${cid})`, [
        { label: `${WITHDRAW_FN}(${cid})`, signer: signerFor(patient), request: await c.getFunction(WITHDRAW_FN).populateTransaction(cid) },
      ], provider);
      sent.push(...receipts.map((x) => x.hash));
    }
    const { handles: txHandles, note: txNote } = await handlesFromTx(cid);
    await decryptTest("C1", cid, txHandles, assignedSigner, assignedWho, `userDecrypt complaint after ${WITHDRAW_FN}`, "REFUSED",
      `KNOWN LIMITATION if DECRYPT: ${WITHDRAW_FN} is a signal only; ACL grants are permanent. ${txNote}`);

    // C2: patient closes the consultation, doctor tries again.
    if ((await c.getConsultationMeta(cid)).status !== 2n) {
      const receipts = await planAndSend(`C2: patient closes #${cid}`, [
        { label: `closeConsultation(${cid})`, signer: signerFor(patient), request: await c.closeConsultation.populateTransaction(cid) },
      ], provider);
      sent.push(...receipts.map((x) => x.hash));
    }
    await decryptTest("C2", cid, txHandles, assignedSigner, assignedWho, "userDecrypt complaint after closeConsultation", "REFUSED",
      `KNOWN LIMITATION if DECRYPT: closing sets a status flag only and does not touch the ACL. ${txNote}`);

    // C3: doctor tries to respond to the closed consultation (simulated with a valid fresh proof; a reverting tx is not sent).
    const r = await encryptPadded(signerFor(assigned), RESPONSE_TEXT);
    let actual = "SUCCEEDS (simulated)";
    let reason = "";
    try { await c.submitResponse.staticCall(cid, r.padded, r.proof, r.count, { from: assigned }); } catch (e) { actual = "REVERT"; reason = revertReason(e); }
    const passed = String(actual === "REVERT" && reason === "Consultation not open");
    if (passed === "false") surprises.push(`C3: submitResponse on closed #${cid} → ${actual} ${reason}`);
    record({
      test_id: "C3", category: "C. withdrawal/closing", consult_id: cid, wallet_role: assignedWho,
      action: `submitResponse on closed #${cid} (valid fresh proof)`, expected: `REVERT "Consultation not open"`, actual, passed,
      error_or_revert_reason: reason, notes: "simulated via staticCall with a genuine proof, so only the status check can fail; no reverting tx was sent",
    });
  } else {
    const withdrawals = inv.txs.filter((t) => t.fn === WITHDRAW_FN && !t.failed && isMine(inv.consultations.find((x) => x.id === t.consultId)!.patient));
    if (withdrawals.length) {
      const t = withdrawals[0];
      const con = inv.consultations.find((x) => x.id === t.consultId)!;
      const dw = doctorWallet(con.doctorId);
      if (isMine(dw)) {
        const { handles, note } = await handlesFromTx(con.id);
        await decryptTest("C1", con.id, handles, own.get(dw)!, `doctor ${con.doctorId} ${short(dw)}`, `userDecrypt after ${WITHDRAW_FN} (${t.blockTime})`, "REFUSED", note);
      }
    } else {
      record({
        test_id: "C1", category: "C. revocation", consult_id: "", wallet_role: "-", action: `decrypt after ${WITHDRAW_FN}`,
        expected: "REFUSED", actual: "SKIPPED", passed: "n/a",
        notes: `no ${WITHDRAW_FN} tx exists on-chain for my consultations and none was sent. Source analysis: the function only emits an event; it does not touch the Zama ACL, so a previously granted doctor would still decrypt.`,
      });
    }
    for (const id of ["C2", "C3"]) {
      record({
        test_id: id, category: "C. withdrawal/closing", consult_id: "", wallet_role: "-",
        action: id === "C2" ? "decrypt after closeConsultation" : "respond to closed consultation",
        expected: id === "C2" ? "REFUSED" : `REVERT "Consultation not open"`, actual: "SKIPPED", passed: "n/a",
        notes: TARGET === "v1" ? "v1: no transactions sent" : "run with CC_ALLOW_TX=1 to execute",
      });
    }
  }

  // Refresh the inventory so D covers the transactions sent above (Etherscan indexes them with a short delay).
  if (sent.length) {
    for (let attempt = 0; attempt < 20; attempt++) {
      inv = await buildInventory(hre);
      if (sent.every((h) => inv.txs.some((t) => t.hash.toLowerCase() === h.toLowerCase()))) break;
      console.log(`waiting for Etherscan to index ${sent.length} new tx(s)…`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  finish(inv, cid, overlaps);
}

// ── D. Metadata in logs + write outputs ────────────────────────────────────────
function finish(inv: Inventory, cid: number, overlaps: string[], stopReason?: string) {
  const con = inv.consultations.find((x) => x.id === cid)!;
  const patient = con.patient;
  const doctor = inv.doctors.find((d) => d.id === con.doctorId)!.wallet;
  const txs = inv.txs.filter((t) => t.consultId === cid);
  const logRows: Record<string, string | number>[] = [];
  const seen = { patient: new Set<string>(), doctor: new Set<string>() };

  for (const t of txs) {
    if (t.from === patient) seen.patient.add(`${t.fn} tx.from`);
    if (t.from === doctor) seen.doctor.add(`${t.fn} tx.from`);
    for (const l of t.logs) {
      const tags = l.addresses.map((a) => {
        const r = a === CONTRACT ? "this contract" : rolesOf(a, inv).join(" + ");
        return `${short(a)}${r ? ` (${r})` : ""}`;
      });
      if (l.addresses.includes(patient)) seen.patient.add(`${t.fn} → ${l.emitterName}.${l.event}`);
      if (l.addresses.includes(doctor)) seen.doctor.add(`${t.fn} → ${l.emitterName}.${l.event}`);
      if (l.event === "ConsultationCreated" || l.event === "DoctorAccessGranted") seen.doctor.add(`${t.fn} → ${l.event} (doctorId ${con.doctorId} indexed; resolves via public doctors() to ${short(doctor)})`);
      logRows.push({
        tx: `${t.hash.slice(0, 10)}…`, function: t.fn, log_index: l.index, emitter: `${l.emitterName} ${short(l.emitter)}`,
        event: l.event, args: shortenAddressesIn(Object.entries(l.args).map(([k, v]) => `${k}=${v}`).join("; ")),
        addresses: tags.join("; "),
      });
    }
  }
  const logCols = ["tx", "function", "log_index", "emitter", "event", "args", "addresses"];
  writeCsv(path.join(RESULTS_DIR, "metadata_logs.csv"), logRows, logCols);

  if (!stopReason) {
    const d = (id: string, what: string, set: Set<string>) => record({
      test_id: id, category: "D. metadata", consult_id: cid, wallet_role: "public observer", action: what,
      expected: "INFO", actual: set.size ? "VISIBLE" : "not visible", passed: "n/a", notes: [...set].join("; "),
    });
    d("D1", `patient address ${short(patient)} linkable to #${cid}`, seen.patient);
    d("D2", `assigned doctor ${short(doctor)} linkable to #${cid}`, seen.doctor);
    const counts = new Map<string, number>();
    for (const r of logRows) counts.set(`${r.emitter} ${r.event}`, (counts.get(`${r.emitter} ${r.event}`) ?? 0) + 1);
    record({
      test_id: "D3", category: "D. metadata", consult_id: cid, wallet_role: "public observer", action: "log volume per emitter/event",
      expected: "INFO", actual: `${logRows.length} logs in ${txs.length} txs`, passed: "n/a",
      notes: [...counts].map(([k, n]) => `${k} ×${n}`).join("; "),
    });
  }

  writeCsv(path.join(RESULTS_DIR, "access_tests.csv"), rows, COLUMNS);

  const failed = rows.filter((r) => r.passed === "false");
  const inconclusive = rows.filter((r) => r.passed === "inconclusive");
  const md = [
    `# ConfidentialCare — access-control test results`,
    ``,
    `Contract ${TARGET} \`${short(CONTRACT)}\` (Sepolia) · run ${new Date().toISOString()} · ${ALLOW_TX ? "real transactions sent for A5 / C1 / C2 (synthetic data)" : "no transactions sent"}`,
    ``,
    `Chosen consultation: **#${cid}** · patient ${short(patient)} · assigned doctor ${con.doctorId} (${short(doctor)}) · status ${con.status} · ${con.complaintChunkCount} complaint chunks`,
    ``,
    ...(stopReason ? [`> **STOPPED:** ${stopReason}`, ``] : []),
    `## Summary`,
    `- Tests: ${rows.length} · passed ${rows.filter((r) => r.passed === "true").length} · failed ${failed.length} · inconclusive ${inconclusive.length} · skipped/info ${rows.filter((r) => String(r.passed).startsWith("n/a")).length}`,
    `- Failures: ${failed.length ? failed.map((r) => `${r.test_id} (${r.action}: got ${r.actual})`).join("; ") : "none"}`,
    `- Role overlaps: ${overlaps.length ? overlaps.join("; ") : "none"}`,
    `- Surprises: ${surprises.length ? surprises.join("; ") : "none"}`,
    ``,
    `### Method notes`,
    `- Decryption uses \`${SDK_PACKAGE}\` ${SDK_VERSION} (\`sdk.decryption.decryptValues\`, signed decryption permit), as the frontend does. Results recorded before 2026-11-03 used the deprecated \`@zama-fhe/relayer-sdk\` 0.4.1.`,
    `- **REFUSED is a client-side result.** The SDK (both the old relayer-sdk and \`@fhevm/sdk\` under \`@zama-fhe/sdk\`) checks \`ACL.persistAllowed(handle, user)\` before contacting the relayer and throws "not authorized" if false; the request never reaches the KMS. The \`acl_persist_allowed\` column is that on-chain ACL state read independently. Server-side (KMS) enforcement is not tested here.`,
    `- B tests are \`eth_call\` simulations (\`staticCall\` with an overridden \`from\`); no signature or gas is needed and nothing is mined. "(control)" rows show the correct role passes the same check, so the negative results are not vacuous.`,
    TARGET === "v2"
      ? `- v2: \`markAccessWithdrawn\` only emits \`AccessWithdrawalMarked\`; \`closeConsultation\` only sets a status flag. Neither modifies the Zama ACL (ACL grants are permanent).`
      : `- \`revokeDoctorAccess\` only emits \`DoctorAccessRevoked\`; it changes no contract state and does not modify the Zama ACL (ACL grants are permanent).`,
    `- E tests are \`eth_call\` simulations against Zama's ACL contract; nothing was shared or made public on-chain.`,
    `- C tests decrypt with handles decoded from the original \`submitConsultation\` calldata, not from the contract getter.`,
    ``,
    `## Results`,
    mdTable(rows, COLUMNS.filter((c) => c !== "timestamp_utc")),
    ``,
    `## D. Event logs of consultation #${cid}'s transactions`,
    mdTable(logRows, logCols),
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "access_tests.md"), md);

  console.log(`\n${stopReason ? "STOPPED: " + stopReason + "\n" : ""}Failures: ${failed.length} · inconclusive: ${inconclusive.length}`);
  if (surprises.length) console.log("Surprises:\n  " + surprises.join("\n  "));
  console.log(`Wrote access_tests.csv, access_tests.md, metadata_logs.csv to ${path.relative(process.cwd(), RESULTS_DIR)}`);
}

main()
  .then(() => {
    disposeAll();
    process.exit(process.exitCode ?? 0);
  })
  .catch((e) => {
    console.error(e instanceof Error ? shortenAddressesIn(e.message) : e);
    process.exit(1);
  });
