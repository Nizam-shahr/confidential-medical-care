/**
 * Deploy ConfidentialCare v2 from MNEMONIC #0 (admin), verify on Etherscan, record the deployment,
 * and point the frontend at it. v1 is never touched.
 *   npx hardhat run scripts/v2/deploy.ts --network sepolia
 */
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { ethers } from "ethers";
import { V1_ADDRESS, short } from "../lib/common";
import { planAndSend, V2_DEPLOYMENT, V2_DIR, V2Deployment, v2Wallets } from "./lib";

const ROOT = path.join(__dirname, "..", "..");
const FRONTEND_ENV = path.join(ROOT, "frontend", "frontend", ".env.local");

async function main() {
  if (hre.network.name !== "sepolia") throw new Error("Run with --network sepolia");
  const provider = hre.ethers.provider;
  const { admin } = v2Wallets(provider);

  let dep: V2Deployment;
  if (fs.existsSync(V2_DEPLOYMENT)) {
    // Resume after an interrupted run: never deploy a second time.
    dep = JSON.parse(fs.readFileSync(V2_DEPLOYMENT, "utf8"));
    console.log(`Resuming: v2 already deployed at ${dep.address} (block ${dep.block})`);
  } else {
    const factory = await hre.ethers.getContractFactory("ConfidentialCare");
    const deployTx = await factory.getDeployTransaction();
    const [receipt] = await planAndSend("Deploy ConfidentialCare v2", [
      { label: `deploy v2 from admin ${short(admin.address)}`, signer: admin, request: deployTx },
    ], provider);
    const source = fs.readFileSync(path.join(ROOT, "contracts", "ConfidentialCare.sol"));
    dep = {
      address: receipt.contractAddress!, block: receipt.blockNumber, txHash: receipt.hash, deployer: admin.address,
      deployedAt: new Date().toISOString(),
      commit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
      workingTreeDirty: execSync("git status --porcelain -- contracts", { cwd: ROOT }).toString().trim().length > 0,
      sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
    };
    fs.mkdirSync(V2_DIR, { recursive: true });
    fs.writeFileSync(V2_DEPLOYMENT, JSON.stringify(dep, null, 2));
    console.log(`\nv2 deployed at ${dep.address} (block ${dep.block})`);
  }
  const address = dep.address;
  if (address.toLowerCase() === V1_ADDRESS.toLowerCase()) throw new Error("unexpected: v2 address equals v1");

  // Etherscan needs a few blocks before the bytecode is indexed.
  while ((await provider.getBlockNumber()) < dep.block + 5) await new Promise((r) => setTimeout(r, 6000));
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await hre.run("verify:verify", { address, constructorArguments: [] });
      dep.verified = `https://sepolia.etherscan.io/address/${address}#code`;
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already verified/i.test(msg)) { dep.verified = `https://sepolia.etherscan.io/address/${address}#code`; break; }
      console.log(`verify attempt ${attempt} failed: ${msg.split("\n")[0]}`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  fs.writeFileSync(V2_DEPLOYMENT, JSON.stringify(dep, null, 2));

  // Point the frontend at v2 (only the contract address line changes).
  const env = fs.readFileSync(FRONTEND_ENV, "utf8");
  fs.writeFileSync(FRONTEND_ENV, env.replace(/^NEXT_PUBLIC_CONTRACT_ADDRESS=.*$/m, `NEXT_PUBLIC_CONTRACT_ADDRESS=${ethers.getAddress(address)}`));

  const md = [
    `# ConfidentialCare deployments (Sepolia)`,
    ``,
    `| | v1 | v2 |`,
    `| --- | --- | --- |`,
    `| Address | \`${short(V1_ADDRESS)}\` | \`${short(address)}\` |`,
    `| Etherscan | [code](https://sepolia.etherscan.io/address/${V1_ADDRESS}#code) | ${dep.verified ? `[code](${dep.verified})` : "**not verified**"} |`,
    `| Deployment tx | \`0xa23c546310d6d1c7321f7b01ee5350232d30acfba9f5ae25259672f7fb35ae79\` | \`${dep.txHash}\` |`,
    `| Block | 10658033 | ${dep.block} |`,
    `| Deployer / admin | \`0x7094…11b8\` | \`${short(admin.address)}\` (MNEMONIC #0) |`,
    `| Source | commit \`dc818ba\`/\`f3bbdcd\` (as deployed April 2026) | commit \`${dep.commit.slice(0, 7)}\`${dep.workingTreeDirty ? " **+ uncommitted changes**" : ""}, \`ConfidentialCare.sol\` sha256 \`${dep.sourceSha256}\` |`,
    ``,
    `## v2 changes`,
    `- \`submitConsultation\` and \`submitResponse\` require a non-empty \`inputProof\` (closes the handle-reuse re-sharing path, v1 test B30).`,
    `- \`revokeDoctorAccess\` → \`markAccessWithdrawn\`, event \`DoctorAccessRevoked\` → \`AccessWithdrawalMarked\`; documented as a signal that does not remove ACL access.`,
    ``,
    `## v2 roles (generated MNEMONIC, no overlaps)`,
    `| Index | Role | Address |`,
    `| --- | --- | --- |`,
    ...Object.entries(v2Wallets(provider)).map(([role, w], i) => `| ${i} | ${role} | \`${short(w.address)}\` |`),
    ``,
    `Deployed ${dep.deployedAt}. The frontend's \`NEXT_PUBLIC_CONTRACT_ADDRESS\` now points at v2.`,
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(V2_DIR, "deployment.md"), md);
  console.log(dep.verified ? `Verified: ${dep.verified}` : "⚠ Etherscan verification did not succeed — see log above");
  console.log("Wrote results/v2/deployment.json and results/v2/deployment.md; frontend .env.local updated");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
