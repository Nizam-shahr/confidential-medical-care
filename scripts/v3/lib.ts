import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { short } from "../lib/common";
import { v2Wallets } from "../v2/lib";
import { deriveDoctorWallet, signPatientSeed } from "../../frontend/frontend/libs/patient-wallets";

export const V3_DIR = path.join(__dirname, "..", "..", "results", "v3");
export const V3_DEPLOYMENT = path.join(V3_DIR, "deployment.json");
export const ACL_ADDRESS = "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D";
export const MAX_BASE_FEE_GWEI = 5;
/** EIP-7825 per-transaction gas cap. */
export const TX_GAS_CAP = 16_777_216n;

export type V3Deployment = {
  address: string; block: number; txHash: string; deployer: string; deployedAt: string;
  commit: string; workingTreeDirty: boolean; sourceSha256: string; gasUsed: string; verified?: string;
};

export function readV3Deployment(): V3Deployment {
  if (!fs.existsSync(V3_DEPLOYMENT)) throw new Error("results/v3/deployment.json not found — run scripts/v3/deploy.ts first");
  return JSON.parse(fs.readFileSync(V3_DEPLOYMENT, "utf8"));
}

export const ACL_ABI = [
  "function delegateForUserDecryption(address delegate, address contractAddress, uint64 expirationDate)",
  "function revokeDelegationForUserDecryption(address delegate, address contractAddress)",
  "function allow(bytes32 handle, address account)",
  "function allowForDecryption(bytes32[] handlesList)",
  "function isHandleDelegatedForUserDecryption(address delegator, address delegate, address contractAddress, bytes32 handle) view returns (bool)",
  "function getUserDecryptionDelegationExpirationDate(address delegator, address delegate, address contractAddress) view returns (uint64)",
  "function persistAllowed(bytes32 handle, address account) view returns (bool)",
  "error SenderNotAllowed(address sender)",
];

/**
 * v3 roles: MNEMONIC #0 admin, #1 patient main wallet, #2 doctor 1, #3 doctor 2; walletA/walletB are the patient's
 * per-doctor wallets, derived exactly like the frontend (seed signature by #1 over the v3 contract address).
 */
export async function v3Wallets(provider: ethers.Provider, contract: string) {
  const w = v2Wallets(provider);
  const chainId = Number((await provider.getNetwork()).chainId);
  const seed = await signPatientSeed(w.patient as unknown as ethers.Signer, contract, chainId, true);
  return {
    ...w,
    walletA: deriveDoctorWallet(seed, 1, provider),
    walletB: deriveDoctorWallet(seed, 2, provider),
  };
}

/** Throws if the base fee is above the stop threshold. */
export async function assertFee(provider: ethers.Provider) {
  const block = await provider.getBlock("latest");
  const gwei = Number(ethers.formatUnits(block!.baseFeePerGas ?? 0n, "gwei"));
  if (gwei > MAX_BASE_FEE_GWEI) throw new Error(`STOP: base fee ${gwei} gwei is above ${MAX_BASE_FEE_GWEI} gwei`);
  return gwei;
}

export type PlannedTx = { label: string; signer: ethers.Signer; request: ethers.TransactionRequest };

/**
 * Print every transaction with its gas (explicit gasLimit if set, else the estimate) and worst-case cost, then send
 * them in order. Stops before sending if the base fee is above 5 gwei or an estimate fails (a revert is caught first).
 */
export async function planAndSend(batch: string, txs: PlannedTx[], provider: ethers.Provider) {
  const baseFee = await assertFee(provider);
  const fee = await provider.getFeeData();
  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const rows = [];
  for (const t of txs) {
    const from = await t.signer.getAddress();
    const gas = t.request.gasLimit !== undefined ? BigInt(t.request.gasLimit) : await t.signer.estimateGas({ ...t.request, from });
    if (gas > TX_GAS_CAP) throw new Error(`${t.label}: gas ${gas} exceeds the per-transaction cap`);
    rows.push({ tx: t.label, from: short(from), gas: Number(gas), maxCostETH: ethers.formatEther(gas * price) });
  }
  console.log(`\n── ${batch}: ${txs.length} transaction(s) · base fee ${baseFee} gwei · max fee ${ethers.formatUnits(price, "gwei")} gwei`);
  console.table(rows);
  const receipts: ethers.TransactionReceipt[] = [];
  for (const t of txs) {
    const sent = await t.signer.sendTransaction(t.request);
    const r = await sent.wait();
    if (!r || r.status !== 1) throw new Error(`${t.label} failed (${sent.hash})`);
    console.log(`  ✔ ${t.label}  ${sent.hash.slice(0, 12)}…  block ${r.blockNumber}  gasUsed=${r.gasUsed}`);
    receipts.push(r);
  }
  return receipts;
}

/** Synthetic seed texts (doctor id → complaint). */
export const SEED_TEXT: Record<number, string> = {
  1: "Synthetic test complaint A for v3 eval", // 38 chars, 5 chunks
  2: "Synthetic test complaint B for v3 eval",
};

export function textToUint64Chunks(text: string): bigint[] {
  const bytes = new TextEncoder().encode(text.slice(0, 32 * 8));
  const chunks: bigint[] = [];
  for (let i = 0; i < bytes.length; i += 8) {
    let val = 0n;
    for (let j = 0; j < 8; j++) val = (val << 8n) | BigInt(bytes[i + j] ?? 0);
    chunks.push(val);
  }
  return chunks.length ? chunks : [0n];
}
