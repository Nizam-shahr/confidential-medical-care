import * as fs from "fs";
import * as path from "path";
import { vars } from "hardhat/config";
import { ethers } from "ethers";
import { short } from "../lib/common";

export const V2_DIR = path.join(__dirname, "..", "..", "results", "v2");
export const V2_DEPLOYMENT = path.join(V2_DIR, "deployment.json");

export type V2Deployment = {
  address: string; block: number; txHash: string; deployer: string; deployedAt: string;
  commit: string; workingTreeDirty: boolean; sourceSha256: string; verified?: string;
};

// Roles for v2 come from the generated MNEMONIC: 0 admin, 1 patient, 2 doctor 1, 3 doctor 2.
export function v2Wallets(provider: ethers.Provider) {
  const phrase = vars.get("MNEMONIC").trim();
  const at = (i: number) => ethers.HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
  return { admin: at(0), patient: at(1), doctor1: at(2), doctor2: at(3) };
}

export function keyWallet(name: string, provider: ethers.Provider): ethers.Wallet {
  const raw = vars.get(name).trim();
  return new ethers.Wallet(raw.startsWith("0x") ? raw : `0x${raw}`, provider);
}

export function readV2Deployment(): V2Deployment {
  if (!fs.existsSync(V2_DEPLOYMENT)) throw new Error("results/v2/deployment.json not found — run scripts/v2/deploy.ts first");
  return JSON.parse(fs.readFileSync(V2_DEPLOYMENT, "utf8"));
}

export type PlannedTx = {
  label: string;
  signer: ethers.Signer;
  request: ethers.TransactionRequest;
};

/**
 * Print every transaction in the batch with its gas estimate and worst-case cost, then send them in order.
 * Throws (sending nothing) if any estimate fails, so a revert is caught before gas is spent.
 */
export async function planAndSend(batch: string, txs: PlannedTx[], provider: ethers.Provider) {
  const fee = await provider.getFeeData();
  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const rows = [];
  for (const t of txs) {
    const from = await t.signer.getAddress();
    const gas = await t.signer.estimateGas({ ...t.request, from });
    rows.push({ tx: t.label, from: short(from), estGas: Number(gas), maxCostETH: ethers.formatEther(gas * price) });
  }
  console.log(`\n── ${batch}: ${txs.length} transaction(s) · max fee ${ethers.formatUnits(price, "gwei")} gwei`);
  console.table(rows);

  const receipts: ethers.TransactionReceipt[] = [];
  for (const t of txs) {
    const sent = await t.signer.sendTransaction(t.request);
    const r = await sent.wait();
    if (!r || r.status !== 1) throw new Error(`${t.label} failed (${sent.hash})`);
    console.log(`  ✔ ${t.label}  ${sent.hash}  gasUsed=${r.gasUsed}`);
    receipts.push(r);
  }
  return receipts;
}
