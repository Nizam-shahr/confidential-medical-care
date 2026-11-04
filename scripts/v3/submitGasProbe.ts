// Read-only: gas a submitConsultation needs on Sepolia for 6, 16 and 32 chunks (v2 contract, same loop as v3),
// using genuine input proofs from the relayer and eth_call bisection. Nothing is sent.
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { disposeAll, encryptUint64, sdkFor } from "../lib/zama";
import { readV2Deployment, v2Wallets } from "../v2/lib";

async function main() {
  const provider = hre.ethers.provider;
  const w = v2Wallets(provider);
  const dep = readV2Deployment();
  const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "results", "v2", "ConfidentialCare.abi.json"), "utf8"));
  const c = new ethers.Contract(dep.address, abi, provider);
  const sdk = await sdkFor(w.patient, (hre.network.config as { url: string }).url);
  for (const n of [6, 16, 32]) {
    const t0 = Date.now();
    console.log(`${n} chunks: encrypting…`);
    const enc = await Promise.race([
      encryptUint64(sdk, dep.address, w.patient.address, Array.from({ length: n }, (_, i) => BigInt(i + 1))),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`encryption of ${n} values timed out after 5 min`)), 300_000)),
    ]).catch((e) => { console.log(`${n} chunks: ${e.message ?? e}`); return null; });
    if (!enc) continue;
    console.log(`${n} chunks: encrypted in ${Math.round((Date.now() - t0) / 1000)} s; bisecting gas…`);
    const data = c.interface.encodeFunctionData("submitConsultation", [1, [...enc.handles, ...Array(32 - n).fill(ethers.ZeroHash)], enc.inputProof, n]);
    const ok = async (gasLimit: bigint) => { try { await provider.call({ from: w.patient.address, to: dep.address, data, gasLimit }); return true; } catch { return false; } };
    let lo = 100_000n, hi = 16_777_216n;
    if (!(await ok(hi))) { console.log(`${n} chunks: does NOT fit under 16,777,216`); continue; }
    while (hi - lo > 20_000n) { const mid = (lo + hi) / 2n; if (await ok(mid)) hi = mid; else lo = mid; }
    console.log(`${n} chunks: needs ≈ ${hi} gas (proof ${(enc.inputProof.length - 2) / 2} bytes)`);
  }
}
main().then(() => { disposeAll(); process.exit(0); }).catch((e) => { console.error(e.message ?? e); process.exit(1); });
