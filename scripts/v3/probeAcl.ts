// Read-only: compares the live Sepolia ACL with the local mock ACL (eth_call simulations only, no transactions).
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ACL = "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D";
const V2 = "0x708de98F102B3E99071b92c851dB1C832e197D59";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function main() {
  const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "node_modules", "@fhevm", "host-contracts-cleartext", "abi", "CleartextACL.json"), "utf8"));
  const iface = new ethers.Interface([...abi, "error ExpirationDateBeforeOneHour()"]);
  const [signer] = await ethers.getSigners();
  const from = await signer.getAddress();
  const acl = new ethers.Contract(ACL, iface, ethers.provider);
  const block = await ethers.provider.getBlock("latest");
  const now = BigInt(block!.timestamp);
  const out: Record<string, string> = {};
  out.block = String(block!.number);
  out.getVersion = await acl.getVersion();
  try { out.WILDCARD_DELEGATION_ADDRESS = await acl.WILDCARD_DELEGATION_ADDRESS(); } catch { out.WILDCARD_DELEGATION_ADDRESS = "absent"; }
  const delegate = ethers.Wallet.createRandom().address;
  const sim = async (label: string, expiry: bigint, contract = V2) => {
    try {
      await ethers.provider.call({ from, to: ACL, data: iface.encodeFunctionData("delegateForUserDecryption", [delegate, contract, expiry]) });
      out[label] = "would succeed";
    } catch (e: any) {
      const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
      let name = "unknown revert";
      try { name = iface.parseError(data)!.name; } catch { /* keep */ }
      out[label] = `reverts: ${name}`;
    }
  };
  await sim("expiry = now - 10s", now - 10n);
  await sim("expiry = now + 120s", now + 120n);
  await sim("expiry = now + 3599s", now + 3599n);
  await sim("expiry = now + 3700s", now + 3700n);
  await sim("expiry = now + 14d", now + 14n * 86400n);
  await sim("wildcard contract, now + 14d", now + 14n * 86400n, out.WILDCARD_DELEGATION_ADDRESS === "absent" ? ethers.ZeroAddress : out.WILDCARD_DELEGATION_ADDRESS);
  console.log(`caller ${short(from)} (deployer), delegate ${short(delegate)} (random), contract v2 ${short(V2)}`);
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
