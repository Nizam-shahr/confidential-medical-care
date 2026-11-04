/**
 * Deploy ConfidentialCareV3 from MNEMONIC #0 (admin), verify on Etherscan, record the deployment and point the
 * frontend at it. Resumable: never deploys twice.
 *   npx hardhat run scripts/v3/deploy.ts --network sepolia
 * The creation needs ~15.8M gas but eth_estimateGas reports ~19.1M (above the 16,777,216 per-tx cap), so the
 * deployment uses an explicit gasLimit.
 */
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { ethers } from "ethers";
import { short } from "../lib/common";
import { v2Wallets, readV2Deployment } from "../v2/lib";
import { planAndSend, V3_DEPLOYMENT, V3_DIR, V3Deployment } from "./lib";

const ROOT = path.join(__dirname, "..", "..");
const FRONTEND_ENV = path.join(ROOT, "frontend", "frontend", ".env.local");
const DEPLOY_GAS_LIMIT = 16_500_000n;

async function main() {
  if (hre.network.name !== "sepolia") throw new Error("Run with --network sepolia");
  const provider = hre.ethers.provider;
  const { admin } = v2Wallets(provider);

  let dep: V3Deployment;
  if (fs.existsSync(V3_DEPLOYMENT)) {
    dep = JSON.parse(fs.readFileSync(V3_DEPLOYMENT, "utf8"));
    console.log(`Resuming: v3 already deployed at ${short(dep.address)} (block ${dep.block})`);
  } else {
    const deployTx = await (await hre.ethers.getContractFactory("ConfidentialCareV3")).getDeployTransaction();
    const [receipt] = await planAndSend("Deploy ConfidentialCareV3", [
      { label: `deploy v3 from admin ${short(admin.address)}`, signer: admin, request: { ...deployTx, gasLimit: DEPLOY_GAS_LIMIT } },
    ], provider);
    const source = fs.readFileSync(path.join(ROOT, "contracts", "ConfidentialCareV3.sol"));
    dep = {
      address: receipt.contractAddress!, block: receipt.blockNumber, txHash: receipt.hash, deployer: admin.address,
      deployedAt: new Date().toISOString(),
      commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
      workingTreeDirty: execSync("git status --porcelain -- contracts", { cwd: ROOT }).toString().trim().length > 0,
      sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
      gasUsed: receipt.gasUsed.toString(),
    };
    fs.mkdirSync(V3_DIR, { recursive: true });
    fs.writeFileSync(V3_DEPLOYMENT, JSON.stringify(dep, null, 2));
    console.log(`\nv3 deployed at ${short(dep.address)} (block ${dep.block}, gasUsed ${dep.gasUsed})`);
  }
  if (dep.address.toLowerCase() === readV2Deployment().address.toLowerCase()) throw new Error("unexpected: v3 address equals v2");

  while ((await provider.getBlockNumber()) < dep.block + 5) await new Promise((r) => setTimeout(r, 6000));
  for (let attempt = 1; attempt <= 5 && !dep.verified; attempt++) {
    try {
      await hre.run("verify:verify", { address: dep.address, constructorArguments: [], contract: "contracts/ConfidentialCareV3.sol:ConfidentialCareV3" });
      dep.verified = `https://sepolia.etherscan.io/address/${dep.address}#code`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already verified/i.test(msg)) { dep.verified = `https://sepolia.etherscan.io/address/${dep.address}#code`; break; }
      console.log(`verify attempt ${attempt} failed: ${msg.split("\n")[0]}`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  fs.writeFileSync(V3_DEPLOYMENT, JSON.stringify(dep, null, 2));

  // Point the frontend at v3 (only the contract-address line changes).
  const env = fs.readFileSync(FRONTEND_ENV, "utf8");
  const before = (env.match(/^NEXT_PUBLIC_CONTRACT_ADDRESS=(.*)$/m) ?? [])[1] ?? "";
  fs.writeFileSync(FRONTEND_ENV, env.replace(/^NEXT_PUBLIC_CONTRACT_ADDRESS=.*$/m, `NEXT_PUBLIC_CONTRACT_ADDRESS=${ethers.getAddress(dep.address)}`));
  console.log(`frontend .env.local: NEXT_PUBLIC_CONTRACT_ADDRESS ${before ? short(before.trim()) : "(unset)"} → ${short(dep.address)}`);

  fs.writeFileSync(path.join(V3_DIR, "deployment.md"), [
    `# ConfidentialCareV3 deployment (Sepolia)`,
    ``,
    `| | |`,
    `| --- | --- |`,
    `| Address | \`${dep.address}\` |`,
    `| Etherscan | ${dep.verified ? `[verified code](${dep.verified})` : "**not verified**"} |`,
    `| Deployment tx | \`${dep.txHash}\` |`,
    `| Block | ${dep.block} |`,
    `| Gas used | ${dep.gasUsed} (gasLimit ${DEPLOY_GAS_LIMIT}; eth_estimateGas over-reports above the 16,777,216 per-tx cap) |`,
    `| Deployer / admin | \`${short(dep.deployer)}\` (MNEMONIC #0) |`,
    `| Source | commit \`${dep.commit.slice(0, 7)}\`${dep.workingTreeDirty ? " **+ uncommitted contract changes**" : ""}, \`ConfidentialCareV3.sol\` sha256 \`${dep.sourceSha256}\` |`,
    `| Compiler | solc 0.8.27, EVM cancun, @fhevm/solidity 0.13.4 |`,
    ``,
    `Deployed ${dep.deployedAt}. The frontend's \`NEXT_PUBLIC_CONTRACT_ADDRESS\` points at v3.`,
    ``,
  ].join("\n"));
  console.log(dep.verified ? `Verified: ${dep.verified}` : "⚠ Etherscan verification did not succeed");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
