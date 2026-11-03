/**
 * Thin wrapper around @zama-fhe/sdk (replaces the deprecated @zama-fhe/relayer-sdk) for the Sepolia scripts.
 * One ZamaSDK instance per signer: the SDK binds permits and transport key pairs to its configured signer.
 */
import { ethers } from "ethers";
/* eslint-disable @typescript-eslint/no-require-imports */
const { ZamaSDK, sepolia } = require("@zama-fhe/sdk");
const { node } = require("@zama-fhe/sdk/node");
const { createConfig } = require("@zama-fhe/sdk/ethers");
/* eslint-enable @typescript-eslint/no-require-imports */

export const SDK_PACKAGE = "@zama-fhe/sdk";
export const SDK_VERSION: string = require("@zama-fhe/sdk/package.json").version; // eslint-disable-line @typescript-eslint/no-require-imports
export const ACL_ADDRESS: string = sepolia.aclContractAddress;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sdk = any;
const cache = new Map<string, Sdk>();

/** A ZamaSDK bound to `signer`, reading the chain through `rpcUrl`. */
export async function sdkFor(signer: ethers.Signer, rpcUrl: string): Promise<Sdk> {
  const key = (await signer.getAddress()).toLowerCase();
  let sdk = cache.get(key);
  if (!sdk) {
    const chain = { ...sepolia, network: rpcUrl };
    sdk = new ZamaSDK(createConfig({ chains: [chain], relayers: { [chain.id]: node() }, signer, telemetry: false }));
    cache.set(key, sdk);
  }
  return sdk;
}

export function disposeAll() {
  for (const sdk of cache.values()) sdk.terminate?.();
  cache.clear();
}

/** Encrypt euint64 values for `contract`, bound to `user`. Returns hex handles and proof. */
export async function encryptUint64(sdk: Sdk, contract: string, user: string, values: bigint[]) {
  const res = await sdk.encrypt({ values: values.map((value) => ({ value, type: "euint64" })), contractAddress: contract, userAddress: user });
  return { handles: (res.encryptedValues as string[]).map((h) => ethers.hexlify(h)), inputProof: ethers.hexlify(res.inputProof) };
}

export type DecryptOutcome = { actual: "DECRYPT" | "REFUSED" | "ERROR"; values?: bigint[]; detail: string; errorName?: string };

const REFUSAL = /not authorized|not entitled|not delegated|NotEntitled|DelegationNotFound|DelegationExpired/i;

/** The innermost message of an error chain (the SDK wraps @fhevm/sdk errors). */
export function rootMessage(e: unknown): string {
  let cur = e as { message?: string; cause?: unknown } | undefined;
  let msg = String(cur?.message ?? e);
  for (let i = 0; cur?.cause && i < 5; i++) {
    cur = cur.cause as typeof cur;
    if (cur?.message) msg = cur.message;
  }
  return msg.split("\n")[0];
}

/** User-decrypt `handles` (issued by `contract`) as the SDK's signer. */
export async function userDecrypt(sdk: Sdk, contract: string, handles: string[]): Promise<DecryptOutcome> {
  try {
    const res = await sdk.decryption.decryptValues(handles.map((h) => ({ encryptedValue: h, contractAddress: contract })));
    const values = handles.map((h) => res[h] ?? res[h.toLowerCase()]);
    if (values.some((v) => v === undefined)) return { actual: "ERROR", detail: "SDK returned no value for some handles" };
    return { actual: "DECRYPT", values: values.map((v) => BigInt(v)), detail: "decrypted OK" };
  } catch (e) {
    const name = (e as Error)?.name ?? "Error";
    const msg = rootMessage(e);
    return { actual: REFUSAL.test(`${name} ${msg}`) ? "REFUSED" : "ERROR", detail: msg, errorName: name };
  }
}

/** Delegated user-decrypt as the SDK's signer on behalf of `delegator`. */
export async function delegatedDecrypt(sdk: Sdk, contract: string, handles: string[], delegator: string,
  waitForPropagation = false): Promise<DecryptOutcome> {
  try {
    const res = await sdk.decryption.delegatedDecryptValues(
      handles.map((h) => ({ encryptedValue: h, contractAddress: contract })), delegator, undefined, { waitForPropagation });
    const values = handles.map((h) => res[h] ?? res[h.toLowerCase()]);
    if (values.some((v) => v === undefined)) return { actual: "ERROR", detail: "SDK returned no value for some handles" };
    return { actual: "DECRYPT", values: values.map((v) => BigInt(v)), detail: "decrypted OK" };
  } catch (e) {
    const name = (e as Error)?.name ?? "Error";
    const msg = rootMessage(e);
    return { actual: REFUSAL.test(`${name} ${msg}`) ? "REFUSED" : "ERROR", detail: msg, errorName: name };
  }
}
