/**
 * Fund the four v2 role wallets (MNEMONIC #0-3) from the existing funded keys.
 *   npx hardhat run scripts/v2/fund.ts --network sepolia
 * Wallets already holding >= MIN are skipped.
 */
import hre from "hardhat";
import { ethers } from "ethers";
import { short } from "../lib/common";
import { keyWallet, planAndSend, PlannedTx, v2Wallets } from "./lib";

const AMOUNT = ethers.parseEther("0.01");
const MIN = ethers.parseEther("0.008");

async function main() {
  if (hre.network.name !== "sepolia") throw new Error("Run with --network sepolia");
  const provider = hre.ethers.provider;
  const w = v2Wallets(provider);
  const plan: [string, ethers.Wallet, ethers.HDNodeWallet][] = [
    ["admin", keyWallet("DEPLOYER_PRIVATE_KEY", provider), w.admin],
    ["patient", keyWallet("DEPLOYER_PRIVATE_KEY", provider), w.patient],
    ["doctor 1", keyWallet("DOCTOR1_PRIVATE_KEY", provider), w.doctor1],
    ["doctor 2", keyWallet("DOCTOR2_PRIVATE_KEY", provider), w.doctor2],
  ];
  const txs: PlannedTx[] = [];
  for (const [role, from, to] of plan) {
    const bal = await provider.getBalance(to.address);
    if (bal >= MIN) {
      console.log(`skip ${role} ${short(to.address)}: already has ${ethers.formatEther(bal)} ETH`);
      continue;
    }
    txs.push({ label: `fund ${role} ${short(to.address)} with ${ethers.formatEther(AMOUNT)} ETH`, signer: from, request: { to: to.address, value: AMOUNT } });
  }
  if (txs.length) await planAndSend("Funding", txs, provider);
  for (const [role, , to] of plan) console.log(`${role.padEnd(9)} ${short(to.address)} ${ethers.formatEther(await provider.getBalance(to.address))} ETH`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
