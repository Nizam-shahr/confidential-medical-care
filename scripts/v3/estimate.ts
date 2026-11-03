// Read-only: gas estimates and balances for the v3 Sepolia plan (eth_estimateGas / eth_call only; nothing is sent).
import hre from "hardhat";
import { ethers } from "ethers";
import { short } from "../lib/common";
import { v2Wallets, readV2Deployment } from "../v2/lib";

async function main() {
  const provider = hre.ethers.provider;
  const w = v2Wallets(provider);
  const fee = await provider.getFeeData();
  const block = await provider.getBlock("latest");
  console.log(`block ${block!.number} baseFee ${ethers.formatUnits(block!.baseFeePerGas ?? 0n, "gwei")} gwei · maxFee ${ethers.formatUnits(fee.maxFeePerGas ?? 0n, "gwei")} gwei · priority ${ethers.formatUnits(fee.maxPriorityFeePerGas ?? 0n, "gwei")} gwei`);

  const factory = await hre.ethers.getContractFactory("ConfidentialCareV3");
  const deployTx = await factory.getDeployTransaction();
  const deployGas = await provider.estimateGas({ ...deployTx, from: w.admin.address });
  console.log(`deploy ConfidentialCareV3: ${deployGas} gas`);

  const acl = new ethers.Contract("0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D",
    ["function delegateForUserDecryption(address,address,uint64)"], provider);
  const now = BigInt(block!.timestamp);
  const delegateGas = await provider.estimateGas({ from: w.patient.address, to: await acl.getAddress(),
    data: acl.interface.encodeFunctionData("delegateForUserDecryption", [ethers.Wallet.createRandom().address, readV2Deployment().address, now + 14n * 86400n]) });
  console.log(`ACL delegation, new entry: ${delegateGas} gas`);
  const transferGas = await provider.estimateGas({ from: w.patient.address, to: ethers.Wallet.createRandom().address, value: 1n });
  console.log(`ETH transfer to a fresh address: ${transferGas} gas`);

  for (const [role, wal] of Object.entries(w)) console.log(`${role.padEnd(8)} ${short(wal.address)} ${ethers.formatEther(await provider.getBalance(wal.address))} ETH`);
  const [deployer] = await hre.ethers.getSigners();
  console.log(`deployer ${short(deployer.address)} ${ethers.formatEther(await provider.getBalance(deployer.address))} ETH`);
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
