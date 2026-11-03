// ── Zama SDK (@zama-fhe/sdk) ──────────────────────────────────────────────────
// Replaces the deprecated @zama-fhe/relayer-sdk CDN bundle. Browser-only: import this
// module dynamically from client code (it loads WASM and a Web Worker).
//
// One ZamaSDK per signer: the SDK binds decryption permits and its transport key pair to
// the signer it was created with. The doctor uses one for their main wallet; the patient
// uses one per derived per-doctor wallet.
import type { ethers } from "ethers";
import { ZamaSDK, sepolia } from "@zama-fhe/sdk";
import { web } from "@zama-fhe/sdk/web";
import { createConfig } from "@zama-fhe/sdk/ethers";
import { SEPOLIA_RPC_URL } from "./config";

export type ZamaSdk = ZamaSDK;

export function createZamaSdk(signer: ethers.Signer): ZamaSdk {
  const chain = { ...sepolia, network: SEPOLIA_RPC_URL } as const;
  return new ZamaSDK(createConfig({ chains: [chain], relayers: { [chain.id]: web() }, signer }));
}

// Delegations are created only through libs/delegation.ts (always with an explicit expiry).
export { delegateToDoctor, revokeDoctor } from "./delegation";

/** Unix seconds until which `doctor` may decrypt for `patientWallet`; 0 if no active delegation. */
export async function delegationExpiresAt(sdk: ZamaSdk, contractAddress: string, patientWallet: string, doctor: string): Promise<number> {
  const status = await sdk.delegations.getStatus({
    contractAddress: contractAddress as `0x${string}`,
    delegatorAddress: patientWallet as `0x${string}`,
    delegateAddress: doctor as `0x${string}`,
  });
  return status.isActive ? Number(status.expiryTimestamp) : 0;
}
