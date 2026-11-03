import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  assertDelegationTarget, DELEGATION_DAYS, delegateToDoctor, delegationExpiry, revokeThenClose, WILDCARD_CONTRACT,
} from "../frontend/frontend/libs/delegation";

// ConfidentialCareV3 on the FHEVM v0.13 cleartext mock (@fhevm/hardhat-plugin 0.13.0-1, ACL v0.4.0).
// Refusals come from @fhevm/sdk's pre-request ACL checks (checkPersistAllowed / checkDelegation), which read the
// same on-chain ACL state Zama's KMS checks; every refusal is also asserted against that state directly.

const MAX_CHUNKS = 32;
const HOUR = 3600;
const DAY = 24 * HOUR;

const abiDir = path.join(__dirname, "..", "node_modules", "@fhevm", "host-contracts-cleartext", "abi");
const aclAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "CleartextACL.json"), "utf8"));
const inputVerifier = new ethers.Contract(ethers.ZeroAddress,
  JSON.parse(fs.readFileSync(path.join(abiDir, "CleartextInputVerifier.json"), "utf8")));

function textToChunks(text: string): bigint[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: bigint[] = [];
  for (let i = 0; i < bytes.length; i += 8) {
    let val = 0n;
    for (let j = 0; j < 8; j++) val = (val << 8n) | BigInt(bytes[i + j] ?? 0);
    chunks.push(val);
  }
  return chunks;
}

function pad(handles: string[]): string[] {
  return [...handles, ...new Array(MAX_CHUNKS - handles.length).fill(ethers.ZeroHash)];
}

// A refusal must be the SDK's ACL/delegation verdict, not some unrelated failure.
const REFUSAL = /is not delegated by|is not authorized to/;
function expectRefused(result: bigint | Error) {
  expect(result, "expected a refusal but decryption succeeded").to.be.instanceOf(Error);
  const msg = (result as Error).message;
  if (process.env.SHOW_REFUSALS) console.log(`      refusal: ${msg.replace(/0x[0-9a-fA-F]{64}/g, "0x…").replace(/0x[0-9a-fA-F]{40}/g, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`)}`);
  expect(msg).to.match(REFUSAL);
}

describe("ConfidentialCare v3 — delegation-based access", function () {
  let contract: any;
  let contractAddress: string;
  let acl: any;
  let admin: any, doctorA: any, doctorB: any, walletA: any, walletB: any, outsider: any;
  const complaintA = "Synthetic complaint for doctor A";
  const complaintB = "Synthetic complaint for doctor B";
  const chunk0A = textToChunks(complaintA)[0];
  const chunk0B = textToChunks(complaintB)[0];

  async function encrypt(user: any, values: bigint[]) {
    const ib = fhevm.createEncryptedInput(contractAddress, user.address);
    for (const v of values) ib.add64(v);
    const enc = await ib.encrypt();
    return { handles: enc.handles.slice(0, values.length).map((h: any) => ethers.hexlify(h)), proof: ethers.hexlify(enc.inputProof) };
  }

  async function submit(patient: any, doctorId: number, text: string) {
    const chunks = textToChunks(text);
    const enc = await encrypt(patient, chunks);
    return (await contract.connect(patient).submitConsultation(doctorId, pad(enc.handles), enc.proof, chunks.length)).wait();
  }

  async function respond(doctor: any, consultId: number, text: string) {
    const chunks = textToChunks(text);
    const enc = await encrypt(doctor, chunks);
    await (await contract.connect(doctor).submitResponse(consultId, pad(enc.handles), enc.proof, chunks.length)).wait();
    return chunks;
  }

  /** Patient wallet delegates to `doctor` on this contract, as the frontend does (default 14 days). */
  async function delegate(patient: any, doctor: any, seconds = DELEGATION_DAYS * DAY) {
    const expiry = (await time.latest()) + seconds;
    await (await acl.connect(patient).delegateForUserDecryption(doctor.address, contractAddress, expiry)).wait();
    return expiry;
  }

  async function revoke(patient: any, doctor: any) {
    await (await acl.connect(patient).revokeDelegationForUserDecryption(doctor.address, contractAddress)).wait();
  }

  /** Decrypt `handle` as `doctor` on behalf of `delegator` through @fhevm/sdk's delegated path. */
  async function delegatedDecrypt(handle: string, delegator: string, doctor: any): Promise<bigint | Error> {
    try {
      const client: any = fhevm.client;
      const transportKeyPair = await client.generateTransportKeyPair();
      const signedPermit = await client.signDecryptionPermit({
        contractAddresses: [contractAddress],
        startTimestamp: Math.floor(Date.now() / 1000) - 60,
        durationSeconds: DAY,
        signerAddress: doctor.address,
        signer: doctor,
        delegatorAddress: delegator,
        transportKeyPair,
      });
      const [v] = await client.decryptValues({ encryptedValues: [handle], contractAddress, transportKeyPair, signedPermit });
      return BigInt(v.value);
    } catch (e) {
      return e as Error;
    }
  }

  /** Direct (non-delegated) user decryption as `user`. */
  async function userDecrypt(handle: string, user: any): Promise<bigint | Error> {
    try {
      return await fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, user);
    } catch (e) {
      return e as Error;
    }
  }

  /** Ground truth used by the SDK and by Zama's KMS. */
  const delegatedOnAcl = (delegator: string, delegate: string, handle: string): Promise<boolean> =>
    acl.isHandleDelegatedForUserDecryption(delegator, delegate, contractAddress, handle);

  async function complaintHandle(consultId: number): Promise<string> {
    const [handles] = await contract.getComplaintHandles(consultId);
    return handles[0];
  }

  beforeEach(async function () {
    [admin, doctorA, doctorB, walletA, walletB, outsider] = await ethers.getSigners();
    contract = await (await ethers.getContractFactory("ConfidentialCareV3")).deploy();
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();
    acl = new ethers.Contract((await fhevm.getCoprocessorConfig(contractAddress)).ACLAddress, aclAbi, ethers.provider);

    await (await contract.connect(admin).addDoctor(doctorA.address, "Test Doctor A", "Psychiatry", "Test credentials")).wait();
    await (await contract.connect(admin).addDoctor(doctorB.address, "Test Doctor B", "General Practice", "Test credentials")).wait();

    // walletA is the patient's wallet for doctor A (consultation #1), walletB the same patient's wallet for doctor B (#2).
    await submit(walletA, 1, complaintA);
    await submit(walletB, 2, complaintB);
  });

  it("1. the delegated doctor decrypts the complaint (and is refused before the delegation)", async function () {
    const h = await complaintHandle(1);
    expectRefused(await delegatedDecrypt(h, walletA.address, doctorA));
    expect(await contract.isDoctorDelegated(1)).to.be.false;

    const expiry = await delegate(walletA, doctorA);
    expect(expiry - (await time.latest())).to.be.closeTo(14 * DAY, 5);
    expect(await contract.isDoctorDelegated(1)).to.be.true;
    expect(await delegatedOnAcl(walletA.address, doctorA.address, h)).to.be.true;
    expect(await delegatedDecrypt(h, walletA.address, doctorA)).to.equal(chunk0A);
  });

  it("2. the doctor cannot ACL.allow, delegate onward, or allowForDecryption", async function () {
    await delegate(walletA, doctorA);
    const h = await complaintHandle(1);
    expect(await acl.persistAllowed(h, doctorA.address)).to.be.false;

    await expect(acl.connect(doctorA).allow(h, doctorB.address)).to.be.revertedWithCustomError(acl, "SenderNotAllowed");
    await expect(acl.connect(doctorA).allowForDecryption([h])).to.be.revertedWithCustomError(acl, "SenderNotAllowed");
    expect(await acl.isAllowedForDecryption(h)).to.be.false;

    // Onward delegation is accepted by the ACL but gives nothing: doctor A holds no ACL permission on the handle.
    await delegate(doctorA, doctorB);
    expect(await delegatedOnAcl(doctorA.address, doctorB.address, h)).to.be.false;
    expectRefused(await delegatedDecrypt(h, doctorA.address, doctorB));
    expectRefused(await delegatedDecrypt(h, walletA.address, doctorB));
    expectRefused(await userDecrypt(h, doctorA));
  });

  it("3. revocation → the doctor is refused", async function () {
    await delegate(walletA, doctorA);
    const h = await complaintHandle(1);
    expect(await delegatedDecrypt(h, walletA.address, doctorA)).to.equal(chunk0A);

    await revoke(walletA, doctorA);
    expect(await acl.getUserDecryptionDelegationExpirationDate(walletA.address, doctorA.address, contractAddress)).to.equal(0n);
    expect(await delegatedOnAcl(walletA.address, doctorA.address, h)).to.be.false;
    expect(await contract.isDoctorDelegated(1)).to.be.false;
    expectRefused(await delegatedDecrypt(h, walletA.address, doctorA));
  });

  it("4. expiry → the doctor is refused (active strictly before the expiry timestamp)", async function () {
    const h = await complaintHandle(1);
    const expiry = await delegate(walletA, doctorA, HOUR + 60);
    expect(await delegatedDecrypt(h, walletA.address, doctorA)).to.equal(chunk0A);

    await time.setNextBlockTimestamp(expiry - 1);
    await ethers.provider.send("evm_mine", []);
    expect(await delegatedOnAcl(walletA.address, doctorA.address, h)).to.be.true;

    await ethers.provider.send("evm_mine", []); // block.timestamp == expiry
    expect(await time.latest()).to.equal(expiry);
    expect(await delegatedOnAcl(walletA.address, doctorA.address, h)).to.be.false;
    expect(await contract.isDoctorDelegated(1)).to.be.false;
    expectRefused(await delegatedDecrypt(h, walletA.address, doctorA));
  });

  describe("5. closing", function () {
    it("fails while delegated; the frontend's one-click revoke-then-close succeeds and the doctor is refused afterwards", async function () {
      await delegate(walletA, doctorA);
      await expect(contract.connect(walletA).closeConsultation(1)).to.be.revertedWith("Revoke doctor delegation first");

      const steps: string[] = [];
      const result = await revokeThenClose({
        isDoctorDelegated: () => contract.isDoctorDelegated(1),
        revoke: () => revoke(walletA, doctorA),
        close: async () => { await (await contract.connect(walletA).closeConsultation(1)).wait(); },
        onStep: (s) => steps.push(s),
      });
      expect(result).to.deep.equal({ revoked: true, closed: true });
      expect(steps).to.deep.equal(["revoking", "closing", "done"]);
      expect((await contract.getConsultationMeta(1)).status).to.equal(2n);
      expectRefused(await delegatedDecrypt(await complaintHandle(1), walletA.address, doctorA));
    });

    it("succeeds after an explicit revoke, and after expiry; the doctor is refused afterwards", async function () {
      await submit(walletA, 1, "Second synthetic complaint"); // #3, same wallet and doctor
      await delegate(walletA, doctorA);
      await revoke(walletA, doctorA);
      await (await contract.connect(walletA).closeConsultation(1)).wait();
      expectRefused(await delegatedDecrypt(await complaintHandle(1), walletA.address, doctorA));

      await delegate(walletA, doctorA, HOUR + 60);
      await expect(contract.connect(walletA).closeConsultation(3)).to.be.revertedWith("Revoke doctor delegation first");
      await time.increase(2 * HOUR);
      const result = await revokeThenClose({
        isDoctorDelegated: () => contract.isDoctorDelegated(3),
        revoke: () => { throw new Error("must not revoke an expired delegation"); },
        close: async () => { await (await contract.connect(walletA).closeConsultation(3)).wait(); },
      });
      expect(result).to.deep.equal({ revoked: false, closed: true });
      expectRefused(await delegatedDecrypt(await complaintHandle(3), walletA.address, doctorA));
    });

    it("a closed consultation accepts no response", async function () {
      await (await contract.connect(walletA).closeConsultation(1)).wait();
      const enc = await encrypt(doctorA, [1n]);
      await expect(contract.connect(doctorA).submitResponse(1, pad(enc.handles), enc.proof, 1)).to.be.revertedWith("Consultation not open");
    });

    it("an all-contracts (wildcard) delegation by the patient also blocks closing", async function () {
      const expiry = (await time.latest()) + DAY;
      await (await acl.connect(walletA).delegateForUserDecryption(doctorA.address, WILDCARD_CONTRACT, expiry)).wait();
      expect(await contract.isDoctorDelegated(1)).to.be.true;
      await expect(contract.connect(walletA).closeConsultation(1)).to.be.revertedWith("Revoke doctor delegation first");
      // Revoking the per-contract delegation is not enough; the frontend's flow reports that instead of closing.
      await expect(revokeThenClose({
        isDoctorDelegated: () => contract.isDoctorDelegated(1),
        revoke: async () => { /* nothing to revoke per contract */ },
        close: async () => { await (await contract.connect(walletA).closeConsultation(1)).wait(); },
      })).to.be.rejectedWith(/still active after revoking/);
    });
  });

  it("6. the delegation from the doctor-A wallet gives doctor B no access", async function () {
    await delegate(walletA, doctorA);
    await delegate(walletB, doctorB);
    const hA = await complaintHandle(1);
    const hB = await complaintHandle(2);

    expect(await delegatedDecrypt(hA, walletA.address, doctorA)).to.equal(chunk0A);
    expect(await delegatedDecrypt(hB, walletB.address, doctorB)).to.equal(chunk0B);

    // Neither doctor reads the other wallet's consultation, whichever delegator they claim.
    for (const [h, delegator, doctor] of [[hA, walletA, doctorB], [hA, walletB, doctorB], [hB, walletB, doctorA], [hB, walletA, doctorA]] as const) {
      expect(await delegatedOnAcl(delegator.address, doctor.address, h)).to.be.false;
      expectRefused(await delegatedDecrypt(h, delegator.address, doctor));
    }
  });

  it("7. the patient decrypts the response; other doctors cannot", async function () {
    const resp = await respond(doctorA, 1, "Synthetic response");
    const [rh] = await contract.getResponseHandles(1);
    expect(await userDecrypt(rh[0], walletA)).to.equal(resp[0]);

    expect(await acl.persistAllowed(rh[0], doctorA.address)).to.be.false;
    expect(await acl.persistAllowed(rh[0], doctorB.address)).to.be.false;
    expectRefused(await userDecrypt(rh[0], doctorA));
    expectRefused(await userDecrypt(rh[0], doctorB));
    expectRefused(await delegatedDecrypt(rh[0], walletA.address, doctorB));
    await delegate(walletB, doctorB); // doctor B's own delegation (from walletB) does not reach walletA's response
    expectRefused(await delegatedDecrypt(rh[0], walletB.address, doctorB));
  });

  it("LIMITATION (7): while delegated, the assigned doctor can also decrypt their own response", async function () {
    const resp = await respond(doctorA, 1, "Synthetic response");
    const [rh] = await contract.getResponseHandles(1);
    expectRefused(await delegatedDecrypt(rh[0], walletA.address, doctorA));
    await delegate(walletA, doctorA);
    expect(await delegatedDecrypt(rh[0], walletA.address, doctorA)).to.equal(resp[0]);
    await revoke(walletA, doctorA);
    expectRefused(await delegatedDecrypt(rh[0], walletA.address, doctorA));
  });

  describe("8. B30 protections (kept from v2)", function () {
    it("reused handles with an empty proof are rejected (consultation and response)", async function () {
      const [hs] = await contract.getComplaintHandles(1);
      await delegate(walletA, doctorA);
      // The patient wallet itself is ACL-allowed on these handles, so only the proof requirement stops reuse.
      await expect(contract.connect(walletA).submitConsultation(1, pad([...hs]), "0x", hs.length)).to.be.revertedWith("Input proof required");
      await expect(contract.connect(outsider).submitConsultation(2, pad([...hs]), "0x", hs.length)).to.be.revertedWith("Input proof required");
      await expect(contract.connect(doctorA).submitResponse(1, pad([...hs]), "0x", hs.length)).to.be.revertedWith("Input proof required");
    });

    it("a replayed proof (the patient's handles and proof from public calldata) is rejected for any other sender", async function () {
      const chunks = textToChunks("Replay target");
      const enc = await encrypt(walletA, chunks);
      await (await contract.connect(walletA).submitConsultation(1, pad(enc.handles), enc.proof, chunks.length)).wait();
      // The proof's signatures cover the patient wallet's address; from any other sender they do not verify.
      for (const sender of [outsider, walletB]) {
        await expect(contract.connect(sender).submitConsultation(sender === walletB ? 2 : 1, pad(enc.handles), enc.proof, chunks.length))
          .to.be.revertedWithCustomError(inputVerifier, "InvalidSigner");
      }
      await expect(contract.connect(doctorA).submitResponse(1, pad(enc.handles), enc.proof, chunks.length))
        .to.be.revertedWithCustomError(inputVerifier, "InvalidSigner");
    });

    it("a valid proof for other data cannot carry the patient's handles (mismatched proof)", async function () {
      const [hs] = await contract.getComplaintHandles(1);
      const own = await encrypt(outsider, hs.map((_: string, i: number) => BigInt(i + 1)));
      await expect(contract.connect(outsider).submitConsultation(2, pad([...hs]), own.proof, hs.length))
        .to.be.revertedWithCustomError(inputVerifier, "InvalidInputHandle");
      // Control: the same proof with its own handles is accepted.
      await (await contract.connect(outsider).submitConsultation(2, pad(own.handles), own.proof, hs.length)).wait();
    });

    it("an empty proof is rejected even with fresh zero handles", async function () {
      await expect(contract.connect(outsider).submitConsultation(1, pad([]), "0x", 1)).to.be.revertedWith("Input proof required");
      await expect(contract.connect(doctorA).submitResponse(1, pad([]), "0x", 1)).to.be.revertedWith("Input proof required");
    });
  });

  it("9. a second doctor from the same wallet is rejected", async function () {
    const enc = await encrypt(walletA, [1n]);
    await expect(contract.connect(walletA).submitConsultation(2, pad(enc.handles), enc.proof, 1))
      .to.be.revertedWith("Patient wallet bound to another doctor");
    expect(await contract.patientDoctor(walletA.address)).to.equal(1n);
    // Further consultations with the bound doctor are fine.
    await submit(walletA, 1, "Follow-up");
    expect(await contract.getPatientConsultations(walletA.address)).to.deep.equal([1n, 3n]);
  });

  describe("supporting checks", function () {
    it("roles stay separate: doctors cannot be patients, patient wallets cannot become doctors", async function () {
      const enc = await encrypt(doctorA, [1n]);
      await expect(contract.connect(doctorA).submitConsultation(2, pad(enc.handles), enc.proof, 1)).to.be.revertedWith("Doctors cannot be patients");
      await expect(contract.connect(admin).addDoctor(walletA.address, "X", "Y", "Z")).to.be.revertedWith("Wallet is a patient");
    });

    it("LIMITATION: a misdirected delegation (walletA → doctor B) does give doctor B access to walletA's data", async function () {
      // The patient calls the ACL directly, so the contract cannot stop this; the frontend only ever delegates a
      // per-doctor wallet to the doctor it is bound to.
      await delegate(walletA, doctorB);
      expect(await delegatedDecrypt(await complaintHandle(1), walletA.address, doctorB)).to.equal(chunk0A);
    });

    it("frontend delegation helpers: 14-day default, never the all-contracts sentinel", function () {
      expect(DELEGATION_DAYS).to.equal(14);
      expect(delegationExpiry(1_000_000)).to.equal(1_000_000 + 14 * DAY);
      expect(() => assertDelegationTarget(WILDCARD_CONTRACT, doctorA.address)).to.throw(/all-contracts/);
      expect(() => assertDelegationTarget(WILDCARD_CONTRACT.toLowerCase(), doctorA.address)).to.throw(/all-contracts/);
      expect(() => assertDelegationTarget(contractAddress, WILDCARD_CONTRACT)).to.throw(/all-contracts/);
      expect(() => assertDelegationTarget(ethers.ZeroAddress, doctorA.address)).to.throw(/Invalid/);
      expect(() => assertDelegationTarget(contractAddress, doctorA.address)).to.not.throw();
    });

    describe("PITFALL: a delegation without an expiry is permanent", function () {
      it("the frontend's only delegation path always passes an explicit 14-day expiry", async function () {
        const calls: any[] = [];
        const stub = { delegations: { delegateDecryption: async (a: any) => { calls.push(a); }, revokeDelegation: async () => {} } };
        await delegateToDoctor(stub, contractAddress, doctorA.address, undefined, 1_000_000);
        expect(calls).to.have.length(1);
        expect(calls[0].expirationDate, "expirationDate missing: the SDK would make the delegation permanent").to.be.instanceOf(Date);
        expect(calls[0].expirationDate.getTime()).to.equal((1_000_000 + 14 * DAY) * 1000);
        for (const days of [0, -1, Infinity, NaN, 366]) {
          await expect(delegateToDoctor(stub, contractAddress, doctorA.address, days)).to.be.rejectedWith(/finite expiry/);
        }
        expect(calls).to.have.length(1);
      });

      it("every delegation call site in the frontend, scripts and contracts passes an expiry (source scan)", function () {
        const root = path.join(__dirname, "..");
        const files: string[] = [];
        const walk = (dir: string) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (["node_modules", ".next", "artifacts", "cache", "types"].includes(e.name)) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(ts|tsx|sol)$/.test(e.name)) files.push(p);
          }
        };
        for (const d of ["frontend/frontend/app", "frontend/frontend/libs", "scripts", "contracts"]) walk(path.join(root, d));

        // Text of the call starting at `i`, up to its matching closing parenthesis.
        const callAt = (src: string, i: number) => {
          let depth = 0;
          for (let j = src.indexOf("(", i); j < src.length; j++) {
            if (src[j] === "(") depth++;
            if (src[j] === ")" && --depth === 0) return src.slice(i, j + 1);
          }
          return src.slice(i);
        };
        const topLevelArgs = (call: string) => {
          const inner = call.slice(call.indexOf("(") + 1, -1);
          let depth = 0, n = inner.trim() ? 1 : 0;
          for (const ch of inner) {
            if ("([{".includes(ch)) depth++;
            if (")]}".includes(ch)) depth--;
            if (ch === "," && depth === 0) n++;
          }
          return n;
        };

        const scan = (rel: string, raw: string): string[] => {
          const out: string[] = [];
          const src = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
          for (const m of src.matchAll(/\.delegateDecryption\s*\(/g)) {
            if (!/expirationDate\s*[,}:]/.test(callAt(src, m.index!))) out.push(`${rel}: delegateDecryption without expirationDate`);
            if (rel !== "frontend/frontend/libs/delegation.ts") out.push(`${rel}: delegateDecryption outside libs/delegation.ts`);
          }
          for (const m of src.matchAll(/\bdelegateForUserDecryption\s*\(/g)) {
            if (/function\s+$/.test(src.slice(Math.max(0, m.index! - 20), m.index!))) continue;
            if (topLevelArgs(callAt(src, m.index!)) < 3) out.push(`${rel}: delegateForUserDecryption without expiry`);
          }
          if (/\b(delegateUserDecryptionWithoutExpiration|delegateUserDecryptionsWithoutExpiration)\b/.test(src)) out.push(`${rel}: FHE delegation without expiration`);
          return out;
        };

        // The scanner itself must catch each forbidden form.
        expect(scan("frontend/frontend/libs/delegation.ts", "sdk.delegations.delegateDecryption({ contractAddress: c, delegateAddress: d })")).to.have.length(1);
        expect(scan("frontend/frontend/app/x.tsx", "sdk.delegations.delegateDecryption({ contractAddress: c, delegateAddress: d, expirationDate })")).to.have.length(1);
        expect(scan("scripts/x.ts", "await acl.delegateForUserDecryption(doctor, contract)")).to.have.length(1);
        expect(scan("contracts/X.sol", "FHE.delegateUserDecryptionWithoutExpiration(d, c);")).to.have.length(1);
        expect(scan("scripts/x.ts", "await acl.delegateForUserDecryption(doctor, contract, expiry)")).to.have.length(0);

        const problems = files.flatMap((f) => scan(path.relative(root, f).split(path.sep).join("/"), fs.readFileSync(f, "utf8")));
        expect(files.length).to.be.greaterThan(10);
        expect(problems, problems.join("\n")).to.deep.equal([]);
      });

      it("on-chain: an expiry of uint64.max never lapses and blocks closing until revoked", async function () {
        const h = await complaintHandle(1);
        await (await acl.connect(walletA).delegateForUserDecryption(doctorA.address, contractAddress, 2n ** 64n - 1n)).wait();
        await time.increase(10 * 365 * DAY);
        expect(await delegatedOnAcl(walletA.address, doctorA.address, h)).to.be.true;
        await expect(contract.connect(walletA).closeConsultation(1)).to.be.revertedWith("Revoke doctor delegation first");
        await revoke(walletA, doctorA);
        await (await contract.connect(walletA).closeConsultation(1)).wait();
      });
    });

    it("frontend per-doctor wallets: one seed signature, a separate deterministic wallet per doctor, isolated", async function () {
      const { signPatientSeed, deriveDoctorWallet } = await import("../frontend/frontend/libs/patient-wallets");
      const chainId = Number((await ethers.provider.getNetwork()).chainId);
      const [, , , , , , mainWallet, otherMain] = await ethers.getSigners();

      const seed = await signPatientSeed(mainWallet as any, contractAddress, chainId, true);
      const w1 = deriveDoctorWallet(seed, 1, ethers.provider as any);
      const w2 = deriveDoctorWallet(seed, 2, ethers.provider as any);
      expect(deriveDoctorWallet(await signPatientSeed(mainWallet as any, contractAddress, chainId), 1).address).to.equal(w1.address);
      expect(deriveDoctorWallet(await signPatientSeed(otherMain as any, contractAddress, chainId), 1).address).to.not.equal(w1.address);
      expect(w2.address).to.not.equal(w1.address);
      expect(w1.address).to.not.equal(mainWallet.address);

      for (const w of [w1, w2]) await (await mainWallet.sendTransaction({ to: w.address, value: ethers.parseEther("1") })).wait();
      await submit(w1, 1, complaintA);
      await submit(w2, 2, complaintB);
      await delegate(w1, doctorA);
      await delegate(w2, doctorB);
      const h1 = await complaintHandle(3);
      const h2 = await complaintHandle(4);
      expect(await delegatedDecrypt(h1, w1.address, doctorA)).to.equal(chunk0A);
      expect(await delegatedDecrypt(h2, w2.address, doctorB)).to.equal(chunk0B);
      expectRefused(await delegatedDecrypt(h1, w1.address, doctorB));
      expectRefused(await delegatedDecrypt(h1, w2.address, doctorB));
    });
  });
});
