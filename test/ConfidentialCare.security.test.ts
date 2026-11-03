import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

const MAX_CHUNKS = 32;

// Zama's InputVerifier reverts with its own custom errors; load its ABI so the matcher can decode them.
const inputVerifier = new ethers.Contract(
  ethers.ZeroAddress,
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "node_modules", "@fhevm", "host-contracts", "artifacts",
    "contracts", "InputVerifier.sol", "InputVerifier.json"), "utf8")).abi,
);

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

function pad(handles: string[]): string[] {
  return [...handles, ...new Array(MAX_CHUNKS - handles.length).fill(ethers.ZeroHash)];
}

describe("ConfidentialCare — security", function () {
  let contract: any;
  let contractAddress: string;
  let admin: any, doctor1: any, doctor2: any, patient1: any;
  const complaint = "Private symptom text";
  let chunks: bigint[];
  let patientProof: string;
  let acl: any;

  beforeEach(async function () {
    [admin, doctor1, doctor2, patient1] = await ethers.getSigners();
    contract = await (await ethers.getContractFactory("ConfidentialCare")).deploy();
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();

    await (await contract.connect(admin).addDoctor(doctor1.address, "Dr. A", "GP", "MD")).wait();
    await (await contract.connect(admin).addDoctor(doctor2.address, "Dr. B", "GP", "MD")).wait();

    // Patient consults doctor 1 and grants access.
    chunks = textToChunks(complaint);
    const ib = fhevm.createEncryptedInput(contractAddress, patient1.address);
    for (const c of chunks) ib.add64(c);
    const enc = await ib.encrypt();
    patientProof = ethers.hexlify(enc.inputProof);
    await (await contract.connect(patient1).submitConsultation(1, pad(enc.handles.slice(0, chunks.length)), enc.inputProof, chunks.length)).wait();
    const grant = await (await contract.connect(patient1).grantDoctorAccess(1)).wait();

    // The ACL is the emitter of the Allowed logs produced by the grant.
    const aclAddress = grant.logs.find((l: any) => l.address !== contractAddress).address;
    acl = new ethers.Contract(aclAddress, [
      "function allow(bytes32 handle, address account)",
      "function allowForDecryption(bytes32[] handlesList)",
      "function persistAllowed(bytes32 handle, address account) view returns (bool)",
      "function isAllowedForDecryption(bytes32 handle) view returns (bool)",
    ], ethers.provider);
  });

  // ── Known limitations of the FHE.allow design (asserted so the paper has evidence) ──

  it("LIMITATION: granted doctor can re-share directly via ACL.allow", async function () {
    const [handles] = await contract.getComplaintHandles(1);
    await (await acl.connect(doctor1).allow(handles[0], doctor2.address)).wait();
    expect(await acl.persistAllowed(handles[0], doctor2.address)).to.be.true;
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, handles[0], contractAddress, doctor2)).to.equal(chunks[0]);
  });

  it("LIMITATION: granted doctor can make the complaint publicly decryptable", async function () {
    const [handles] = await contract.getComplaintHandles(1);
    expect(await acl.isAllowedForDecryption(handles[0])).to.be.false;
    await (await acl.connect(doctor1).allowForDecryption([handles[0]])).wait();
    expect(await acl.isAllowedForDecryption(handles[0])).to.be.true;
  });

  it("LIMITATION: markAccessWithdrawn does not remove the doctor's access", async function () {
    const [handles] = await contract.getComplaintHandles(1);
    await (await contract.connect(patient1).markAccessWithdrawn(1)).wait();
    expect(await acl.persistAllowed(handles[0], doctor1.address)).to.be.true;
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, handles[0], contractAddress, doctor1)).to.equal(chunks[0]);
  });

  it("LIMITATION: closing does not remove access, but blocks a later response", async function () {
    const [handles] = await contract.getComplaintHandles(1);
    await (await contract.connect(patient1).closeConsultation(1)).wait();
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, handles[0], contractAddress, doctor1)).to.equal(chunks[0]);

    const rb = fhevm.createEncryptedInput(contractAddress, doctor1.address);
    rb.add64(1n);
    const re = await rb.encrypt();
    await expect(
      contract.connect(doctor1).submitResponse(1, pad([ethers.hexlify(re.handles[0])]), re.inputProof, 1),
    ).to.be.revertedWith("Consultation not open");
  });

  it("an address without ACL permission cannot re-share", async function () {
    const [handles] = await contract.getComplaintHandles(1);
    await expect(acl.connect(doctor2).allow(handles[0], doctor2.address)).to.be.reverted;
  });

  it("granted doctor cannot re-share the patient's ciphertexts with another doctor", async function () {
    // Sanity: doctor 2 has no access to consultation #1.
    const [handles] = await contract.getComplaintHandles(1);
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint64, handles[0], contractAddress, doctor2),
    ).to.be.rejected;

    // Attack: doctor 1 resubmits the patient's handles (empty proof) as a new consultation to doctor 2.
    let accepted = true;
    try {
      await (await contract.connect(doctor1).submitConsultation(2, pad([...handles]), "0x", handles.length)).wait();
    } catch (e) {
      accepted = false;
      expect(String(e)).to.contain("Input proof required");
    }

    if (accepted) {
      await (await contract.connect(doctor1).grantDoctorAccess(2)).wait();
      const leaked = await fhevm.userDecryptEuint(FhevmType.euint64, handles[0], contractAddress, doctor2);
      expect.fail(
        `LEAK: doctor 2 decrypted patient's complaint chunk 0 (match with original: ${leaked === chunks[0]})`,
      );
    }
  });

  it("granted doctor cannot replay the patient's public input proof", async function () {
    // The patient's proof is visible in the submitConsultation calldata; it is bound to the patient's address.
    const [handles] = await contract.getComplaintHandles(1);
    await expect(
      contract.connect(doctor1).submitConsultation(2, pad([...handles]), patientProof, handles.length),
    ).to.be.reverted;
  });

  it("granted doctor cannot pair the patient's handles with a valid proof for their own data", async function () {
    const [handles] = await contract.getComplaintHandles(1);

    // Doctor 1 encrypts their own data with the SAME number of chunks, so the proof is valid and the
    // handle indices are in range — the only thing that can fail is the handle-to-proof binding.
    const ib = fhevm.createEncryptedInput(contractAddress, doctor1.address);
    for (let i = 0; i < handles.length; i++) ib.add64(BigInt(i + 1));
    const own = await ib.encrypt();

    await expect(
      contract.connect(doctor1).submitConsultation(2, pad([...handles]), own.inputProof, handles.length),
    ).to.be.revertedWithCustomError(inputVerifier, "InvalidInputHandle");

    // Control: the same proof with the handles it was issued for is accepted.
    await (await contract.connect(doctor1).submitConsultation(2, pad(own.handles.map((h) => ethers.hexlify(h))), own.inputProof, handles.length)).wait();
    expect(await contract.consultationCount()).to.equal(2n);
  });

  it("assigned doctor cannot submit a response without an input proof", async function () {
    await expect(
      contract.connect(doctor1).submitResponse(1, new Array(MAX_CHUNKS).fill(ethers.ZeroHash), "0x", 1),
    ).to.be.revertedWith("Input proof required");
  });

  it("assigned doctor can still respond with a valid proof", async function () {
    const resp = textToChunks("Rest and fluids");
    const rb = fhevm.createEncryptedInput(contractAddress, doctor1.address);
    for (const c of resp) rb.add64(c);
    const re = await rb.encrypt();
    await (await contract.connect(doctor1).submitResponse(1, pad(re.handles.slice(0, resp.length)), re.inputProof, resp.length)).wait();

    const [rh] = await contract.getResponseHandles(1);
    expect(await fhevm.userDecryptEuint(FhevmType.euint64, rh[0], contractAddress, patient1)).to.equal(resp[0]);
  });
});
