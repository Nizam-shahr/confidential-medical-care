/**
 * Seed synthetic test data on v2 (never on v1).
 *   npx hardhat run scripts/v2/seed.ts --network sepolia
 * - admin registers two clearly fictional test doctors
 * - patient submits two synthetic consultations to doctor 1 and grants access on the first
 * Steps already done on-chain are skipped, so the script can be re-run safely.
 */
import hre from "hardhat";
import { ethers } from "ethers";
import { short } from "../lib/common";
import { planAndSend, readV2Deployment, v2Wallets } from "./lib";

import { ACL_ADDRESS, disposeAll, encryptUint64, sdkFor } from "../lib/zama";

const MAX_CHUNKS = 32;
const CREDENTIALS = "Test credentials – not a real practitioner";
const MESSAGES = [
  "Synthetic test message for security evaluation",
  "Synthetic test message 2 for security evaluation",
];

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

async function main() {
  if (hre.network.name !== "sepolia") throw new Error("Run with --network sepolia");
  const provider = hre.ethers.provider;
  const dep = readV2Deployment();
  const w = v2Wallets(provider);
  const c = await hre.ethers.getContractAt("ConfidentialCare", dep.address);
  if ((await c.admin()) !== w.admin.address) throw new Error("v2 admin is not MNEMONIC #0");

  // 1. Doctors
  if ((await c.doctorCount()) === 0n) {
    await planAndSend("Register test doctors", [
      { label: `addDoctor Test Doctor A (Psychiatry) ${short(w.doctor1.address)}`, signer: w.admin,
        request: await c.addDoctor.populateTransaction(w.doctor1.address, "Test Doctor A", "Psychiatry", CREDENTIALS) },
      { label: `addDoctor Test Doctor B (General Practice) ${short(w.doctor2.address)}`, signer: w.admin,
        request: await c.addDoctor.populateTransaction(w.doctor2.address, "Test Doctor B", "General Practice", CREDENTIALS) },
    ], provider);
  } else {
    console.log(`skip doctors: doctorCount = ${await c.doctorCount()}`);
  }

  // 2. Consultations (encrypted client-side by the patient, like the frontend)
  const existing = Number(await c.consultationCount());
  if (existing < MESSAGES.length) {
    console.log("Initialising Zama relayer SDK and encrypting synthetic messages…");
    const sdk = await sdkFor(w.patient, (hre.network.config as { url: string }).url);
    const txs = [];
    for (const [i, msg] of MESSAGES.entries()) {
      if (i < existing) continue;
      const chunks = textToUint64Chunks(msg);
      const enc = await encryptUint64(sdk, dep.address, w.patient.address, chunks);
      const handles = enc.handles;
      const padded = [...handles, ...Array(MAX_CHUNKS - handles.length).fill(ethers.ZeroHash)];
      txs.push({
        label: `submitConsultation #${i + 1} → doctor 1 (${chunks.length} chunks, synthetic)`, signer: w.patient,
        request: await c.submitConsultation.populateTransaction(1, padded, ethers.hexlify(enc.inputProof), chunks.length),
      });
    }
    await planAndSend("Submit synthetic consultations", txs, provider);
  } else {
    console.log(`skip consultations: consultationCount = ${existing}`);
  }

  // 3. Grant access on consultation #1 only
  // Checked via the ACL (Alchemy's free tier limits eth_getLogs to 10-block ranges).
  const acl = new ethers.Contract(ACL_ADDRESS,
    ["function persistAllowed(bytes32 handle, address account) view returns (bool)"], provider);
  const [h1] = await c.getComplaintHandles(1);
  const granted: boolean = await acl.persistAllowed(h1[0], w.doctor1.address);
  if (!granted) {
    await planAndSend("Grant doctor 1 access to consultation #1", [
      { label: "grantDoctorAccess(1)", signer: w.patient, request: await c.grantDoctorAccess.populateTransaction(1) },
    ], provider);
  } else {
    console.log("skip grant: consultation #1 already granted");
  }

  for (let i = 1; i <= Number(await c.consultationCount()); i++) {
    const m = await c.getConsultationMeta(i);
    console.log(`#${i}: patient ${short(m.patient)} · doctor ${m.doctorId} · status ${m.status} · ${m.complaintChunkCount} chunks`);
  }
  process.exit(0);
}

main().then(() => disposeAll()).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
