// Read-only: minimum gas the v3 deployment needs on Sepolia (eth_call bisection), vs the 2^24 per-tx cap (EIP-7825).
import hre from "hardhat";
async function main() {
  const provider = hre.ethers.provider;
  const [admin] = await hre.ethers.getSigners();
  const tx = await (await hre.ethers.getContractFactory("ConfidentialCareV3")).getDeployTransaction();
  const ok = async (gasLimit: bigint) => { try { await provider.call({ ...tx, from: admin.address, gasLimit }); return true; } catch { return false; } };
  let lo = 1_000_000n, hi = 16_777_216n;
  if (!(await ok(hi))) { console.log("does NOT fit under 16,777,216"); return; }
  while (hi - lo > 10_000n) { const mid = (lo + hi) / 2n; if (await ok(mid)) hi = mid; else lo = mid; }
  console.log(`v3 deploy needs ≈ ${hi} gas (cap 16777216, margin ${16_777_216n - hi}); eth_estimateGas reports ${await provider.estimateGas({ ...tx, from: admin.address })}`);
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
