import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

// Helper: encode text to uint64 chunks (8 bytes each)
function textToChunks(text: string): bigint[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: bigint[] = [];
  for (let i = 0; i < bytes.length; i += 8) {
    let val = 0n;
    for (let j = 0; j < 8; j++) {
      val = (val << 8n) | BigInt(bytes[i + j] ?? 0);
    }
    chunks.push(val);
  }
  return chunks;
}

describe("ConfidentialCare", function () {
  let contract: any;
  let contractAddress: string;
  let admin: any, doctor1: any, doctor2: any, patient1: any, patient2: any;

  beforeEach(async function () {
    [admin, doctor1, doctor2, patient1, patient2] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("ConfidentialCare");
    contract = await Factory.deploy();
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();
  });

  // ─────────────────────────────────────────────
  //  Doctor Registry
  // ─────────────────────────────────────────────

  describe("Doctor Registry", function () {
    it("admin can add a doctor", async function () {
      await (await contract.connect(admin).addDoctor(
        doctor1.address, "Dr. Amina Hassan", "HIV/AIDS Specialist", "MD, LUTH"
      )).wait();

      expect(await contract.doctorCount()).to.equal(1n);
      const doc = await contract.doctors(1);
      expect(doc.name).to.equal("Dr. Amina Hassan");
      expect(doc.specialty).to.equal("HIV/AIDS Specialist");
      expect(doc.active).to.be.true;
      expect(doc.wallet).to.equal(doctor1.address);
    });

    it("non-admin cannot add a doctor", async function () {
      await expect(
        contract.connect(patient1).addDoctor(doctor1.address, "Fake", "GP", "None")
      ).to.be.revertedWith("Not admin");
    });

    it("admin can deactivate a doctor", async function () {
      await (await contract.connect(admin).addDoctor(doctor1.address, "Dr. X", "GP", "MD")).wait();
      await (await contract.connect(admin).deactivateDoctor(1)).wait();
      const doc = await contract.doctors(1);
      expect(doc.active).to.be.false;
    });

    it("cannot add same doctor wallet twice", async function () {
      await (await contract.connect(admin).addDoctor(doctor1.address, "Dr. A", "GP", "MD")).wait();
      await expect(
        contract.connect(admin).addDoctor(doctor1.address, "Dr. A2", "GP", "MD")
      ).to.be.revertedWith("Already registered");
    });
  });

  // ─────────────────────────────────────────────
  //  Consultation Submission
  // ─────────────────────────────────────────────

  describe("Consultation", function () {
    beforeEach(async function () {
      await (await contract.connect(admin).addDoctor(
        doctor1.address, "Dr. Amina Hassan", "HIV/AIDS", "MD"
      )).wait();
    });

    it("patient can submit encrypted consultation", async function () {
      const symptomText = "I have fever and cough";
      const chunks = textToChunks(symptomText);
      const chunkCount = chunks.length;

      // Build encrypted input with all chunks
      const inputBuilder = fhevm.createEncryptedInput(contractAddress, patient1.address);
      for (const chunk of chunks) {
        inputBuilder.add64(chunk);
      }
      const encrypted = await inputBuilder.encrypt();

      // Build the calldata array (padded to MAX_CHUNKS = 32)
      const MAX_CHUNKS = 32;
      const handles = new Array(MAX_CHUNKS).fill(encrypted.handles[0]);
      for (let i = 0; i < chunkCount; i++) {
        handles[i] = encrypted.handles[i];
      }

      const tx = await contract.connect(patient1).submitConsultation(
        1, handles, encrypted.inputProof, chunkCount
      );
      await tx.wait();

      expect(await contract.consultationCount()).to.equal(1n);

      const meta = await contract.getConsultationMeta(1);
      expect(meta.patient).to.equal(patient1.address);
      expect(meta.doctorId).to.equal(1n);
      expect(Number(meta.complaintChunkCount)).to.equal(chunkCount);
      expect(meta.hasResponse).to.be.false;
    });

    it("patient can grant access and mark it withdrawn", async function () {
      // Submit consultation first
      const chunks = textToChunks("Headache for 3 days");
      const inputBuilder = fhevm.createEncryptedInput(contractAddress, patient1.address);
      for (const c of chunks) inputBuilder.add64(c);
      const enc = await inputBuilder.encrypt();
      const MAX_CHUNKS = 32;
      const handles = new Array(MAX_CHUNKS).fill(enc.handles[0]);
      for (let i = 0; i < chunks.length; i++) handles[i] = enc.handles[i];

      await (await contract.connect(patient1).submitConsultation(1, handles, enc.inputProof, chunks.length)).wait();

      // Grant access
      const grantTx = await contract.connect(patient1).grantDoctorAccess(1);
      const receipt = await grantTx.wait();
      const grantEvent = receipt.logs.find((l: any) => l.fragment?.name === "DoctorAccessGranted");
      expect(grantEvent).to.not.be.undefined;

      // Mark access withdrawn (signal only)
      const revokeTx = await contract.connect(patient1).markAccessWithdrawn(1);
      const revokeReceipt = await revokeTx.wait();
      const revokeEvent = revokeReceipt.logs.find((l: any) => l.fragment?.name === "AccessWithdrawalMarked");
      expect(revokeEvent).to.not.be.undefined;
    });

    it("non-patient cannot grant doctor access", async function () {
      const chunks = textToChunks("test");
      const inputBuilder = fhevm.createEncryptedInput(contractAddress, patient1.address);
      for (const c of chunks) inputBuilder.add64(c);
      const enc = await inputBuilder.encrypt();
      const handles = new Array(32).fill(enc.handles[0]);
      for (let i = 0; i < chunks.length; i++) handles[i] = enc.handles[i];
      await (await contract.connect(patient1).submitConsultation(1, handles, enc.inputProof, chunks.length)).wait();

      await expect(
        contract.connect(patient2).grantDoctorAccess(1)
      ).to.be.revertedWith("Not the patient");
    });

    it("doctor can submit encrypted response", async function () {
      // Patient submits
      const chunks = textToChunks("Sore throat for 5 days");
      const inputBuilder = fhevm.createEncryptedInput(contractAddress, patient1.address);
      for (const c of chunks) inputBuilder.add64(c);
      const enc = await inputBuilder.encrypt();
      const handles = new Array(32).fill(enc.handles[0]);
      for (let i = 0; i < chunks.length; i++) handles[i] = enc.handles[i];
      await (await contract.connect(patient1).submitConsultation(1, handles, enc.inputProof, chunks.length)).wait();
      await (await contract.connect(patient1).grantDoctorAccess(1)).wait();

      // Doctor responds
      const responseChunks = textToChunks("Take rest and drink warm water");
      const respBuilder = fhevm.createEncryptedInput(contractAddress, doctor1.address);
      for (const c of responseChunks) respBuilder.add64(c);
      const respEnc = await respBuilder.encrypt();
      const respHandles = new Array(32).fill(respEnc.handles[0]);
      for (let i = 0; i < responseChunks.length; i++) respHandles[i] = respEnc.handles[i];

      await (await contract.connect(doctor1).submitResponse(
        1, respHandles, respEnc.inputProof, responseChunks.length
      )).wait();

      const meta = await contract.getConsultationMeta(1);
      expect(meta.hasResponse).to.be.true;
      expect(Number(meta.responseChunkCount)).to.equal(responseChunks.length);
    });

    it("wrong doctor cannot respond", async function () {
      await (await contract.connect(admin).addDoctor(doctor2.address, "Dr. B", "GP", "MD")).wait();

      const chunks = textToChunks("test");
      const inputBuilder = fhevm.createEncryptedInput(contractAddress, patient1.address);
      for (const c of chunks) inputBuilder.add64(c);
      const enc = await inputBuilder.encrypt();
      const handles = new Array(32).fill(enc.handles[0]);
      for (let i = 0; i < chunks.length; i++) handles[i] = enc.handles[i];
      await (await contract.connect(patient1).submitConsultation(1, handles, enc.inputProof, chunks.length)).wait();

      const respChunks = textToChunks("I am wrong doctor");
      const rb = fhevm.createEncryptedInput(contractAddress, doctor2.address);
      for (const c of respChunks) rb.add64(c);
      const re = await rb.encrypt();
      const rh = new Array(32).fill(re.handles[0]);
      for (let i = 0; i < respChunks.length; i++) rh[i] = re.handles[i];

      await expect(
        contract.connect(doctor2).submitResponse(1, rh, re.inputProof, respChunks.length)
      ).to.be.revertedWith("Not assigned to this consultation");
    });

    it("patient can close consultation", async function () {
      const chunks = textToChunks("test");
      const ib = fhevm.createEncryptedInput(contractAddress, patient1.address);
      for (const c of chunks) ib.add64(c);
      const enc = await ib.encrypt();
      const handles = new Array(32).fill(enc.handles[0]);
      for (let i = 0; i < chunks.length; i++) handles[i] = enc.handles[i];
      await (await contract.connect(patient1).submitConsultation(1, handles, enc.inputProof, chunks.length)).wait();
      await (await contract.connect(patient1).closeConsultation(1)).wait();

      const meta = await contract.getConsultationMeta(1);
      expect(meta.status).to.equal(2n); // ConsultStatus.Closed
    });

    it("inactive doctor cannot receive consultations", async function () {
      await (await contract.connect(admin).deactivateDoctor(1)).wait();
      const chunks = textToChunks("test");
      const ib = fhevm.createEncryptedInput(contractAddress, patient1.address);
      for (const c of chunks) ib.add64(c);
      const enc = await ib.encrypt();
      const handles = new Array(32).fill(enc.handles[0]);
      for (let i = 0; i < chunks.length; i++) handles[i] = enc.handles[i];
      await expect(
        contract.connect(patient1).submitConsultation(1, handles, enc.inputProof, chunks.length)
      ).to.be.revertedWith("Doctor not active");
    });
  });
});
