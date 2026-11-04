/**
 * Seed v3 with synthetic data (resumable).
 *   npx hardhat run scripts/v3/seed.ts --network sepolia
 * 1. admin registers Test Doctor A (MNEMONIC #2) and B (#3); C (your browser account) if V3_BROWSER_DOCTOR is set
 * 2. the patient main wallet (#1) funds walletA and walletB (derived like the frontend) — the documented linkage
 * 3. walletA consults doctor 1, walletB consults doctor 2 (synthetic 6-chunk texts); no delegations yet
 */
import hre from "hardhat";
import { ethers } from "ethers";
import { short } from "../lib/common";
import { disposeAll, encryptUint64, sdkFor } from "../lib/zama";
import { ACL_ABI, ACL_ADDRESS, planAndSend, PlannedTx, readV3Deployment, SEED_TEXT, textToUint64Chunks, v3Wallets } from "./lib";

const MAX_CHUNKS = 32;
const CREDENTIALS = "Test credentials – not a real practitioner";
const FUND_ETH = "0.002";

async function main() {
  if (hre.network.name !== "sepolia") throw new Error("Run with --network sepolia");
  const provider = hre.ethers.provider;
  const rpc = (hre.network.config as { url: string }).url;
  const dep = readV3Deployment();
  const w = await v3Wallets(provider, dep.address);
  const c = new ethers.Contract(dep.address, (await hre.artifacts.readArtifact("ConfidentialCareV3")).abi, provider);
  console.log(`v3 ${short(dep.address)} · walletA ${short(w.walletA.address)} (doctor 1) · walletB ${short(w.walletB.address)} (doctor 2)`);

  // 1. doctors
  const wanted: [string, string, string][] = [
    [w.doctor1.address, "Test Doctor A", "General Practice"],
    [w.doctor2.address, "Test Doctor B", "Mental Health"],
  ];
  if (process.env.V3_BROWSER_DOCTOR) wanted.push([ethers.getAddress(process.env.V3_BROWSER_DOCTOR), "Test Doctor C (browser)", "General Practice"]);
  const addTxs: PlannedTx[] = [];
  for (const [addr, name, spec] of wanted) {
    if (await c.isDoctor(addr)) { console.log(`skip: ${name} already registered`); continue; }
    addTxs.push({ label: `addDoctor ${name} ${short(addr)}`, signer: w.admin, request: await c.addDoctor.populateTransaction(addr, name, spec, CREDENTIALS) });
  }
  if (addTxs.length) await planAndSend("Register test doctors", addTxs, provider);

  // 2. funding (public transfer main → derived wallet)
  const fundTxs: PlannedTx[] = [];
  for (const [name, dw] of [["walletA", w.walletA], ["walletB", w.walletB]] as const) {
    if ((await provider.getBalance(dw.address)) >= ethers.parseEther(FUND_ETH) / 2n) { console.log(`skip: ${name} already funded`); continue; }
    fundTxs.push({ label: `fund ${name} ${short(dw.address)} with ${FUND_ETH} ETH from patient main ${short(w.patient.address)}`, signer: w.patient, request: { to: dw.address, value: ethers.parseEther(FUND_ETH) } });
  }
  if (fundTxs.length) await planAndSend("Fund per-doctor wallets from the patient main wallet", fundTxs, provider);

  // 3. consultations
  for (const [doctorId, dw] of [[1, w.walletA], [2, w.walletB]] as const) {
    if ((await c.getPatientConsultations(dw.address)).length > 0) { console.log(`skip: wallet for doctor ${doctorId} already consulted`); continue; }
    const chunks = textToUint64Chunks(SEED_TEXT[doctorId]);
    const enc = await encryptUint64(await sdkFor(dw, rpc), dep.address, dw.address, chunks);
    const padded = [...enc.handles, ...Array(MAX_CHUNKS - enc.handles.length).fill(ethers.ZeroHash)];
    await planAndSend(`Submit synthetic consultation to doctor ${doctorId}`, [{
      label: `submitConsultation(${doctorId}, ${chunks.length} chunks) from ${short(dw.address)}`, signer: dw,
      request: await c.submitConsultation.populateTransaction(doctorId, padded, enc.inputProof, chunks.length),
    }], provider);
  }

  // Sanity (read-only)
  const acl = new ethers.Contract(ACL_ADDRESS, ACL_ABI, provider);
  for (let id = 1; id <= Number(await c.consultationCount()); id++) {
    const m = await c.getConsultationMeta(id);
    const [hs] = await c.getComplaintHandles(id);
    console.log(`#${id}: patient ${short(m.patient)} · doctor ${m.doctorId} · status ${m.status} · ${m.complaintChunkCount} chunks · ` +
      `patientDoctor=${await c.patientDoctor(m.patient)} · isDoctorDelegated=${await c.isDoctorDelegated(id)} · ` +
      `persistAllowed(doctor1)=${await acl.persistAllowed(hs[0], w.doctor1.address)} persistAllowed(doctor2)=${await acl.persistAllowed(hs[0], w.doctor2.address)} persistAllowed(patient)=${await acl.persistAllowed(hs[0], m.patient)}`);
  }
}

if (require.main === module) main().then(() => { disposeAll(); process.exit(0); }).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
