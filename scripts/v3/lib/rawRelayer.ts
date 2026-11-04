/**
 * Direct delegated-user-decryption requests to Zama's relayer, WITHOUT the SDK's client-side ACL pre-check.
 *
 * The permit (transport key pair + EIP-712 signature) is produced with the public @fhevm/sdk API. The request body
 * is built exactly as @fhevm/sdk's fetchDelegatedUserDecryptV1 builds it (protocol v0.13, Sepolia), but the
 * checkDelegation/checkPersistAllowed calls that precede it in the SDK are skipped, so the verdict comes from Zama's
 * servers. Every HTTP exchange is recorded.
 */
import { ethers } from "ethers";
/* eslint-disable @typescript-eslint/no-require-imports */
const fhevmEthers = require("@fhevm/sdk/ethers");
const fhevmChains = require("@fhevm/sdk/chains");
/* eslint-enable @typescript-eslint/no-require-imports */

export const RELAYER_URL: string = fhevmChains.sepolia.fhevm.relayerUrl.replace(/\/$/, "");
const DELEGATED_URL = `${RELAYER_URL}/v2/delegated-user-decrypt`;

export type HttpStep = { method: "POST" | "GET"; status: number; ms: number; body: string };
export type RawOutcome = {
  verdict: "DECRYPT" | "REFUSED_SERVER" | "REJECTED_FORMAT" | "ERROR";
  shares: number;
  label: string;
  message: string;
  httpStatuses: string;
  jobId: string;
  startedAt: number; // ms epoch
  endedAt: number;
  steps: HttpStep[];
};

let runtimeReady: Promise<void> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clients = new Map<string, any>();

/** @fhevm/sdk client bound to Sepolia, reading the chain through `provider`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fhevmClient(provider: ethers.Provider): Promise<any> {
  if (!fhevmEthers.hasFhevmRuntimeConfig()) fhevmEthers.setFhevmRuntimeConfig({});
  runtimeReady ??= fhevmEthers.initFhevmRuntime();
  await runtimeReady;
  const key = "sepolia";
  if (!clients.has(key)) clients.set(key, fhevmEthers.createFhevmClient({ chain: fhevmChains.sepolia, provider }));
  return clients.get(key);
}

const remove0x = (s: string) => (s.startsWith("0x") ? s.slice(2) : s);

/** Sign a delegated decryption permit as `delegate` for `delegator`'s data in `contract`. */
export async function signDelegatedPermit(provider: ethers.Provider, delegate: ethers.Wallet, delegator: string, contract: string) {
  const client = await fhevmClient(provider);
  const transportKeyPair = await client.generateTransportKeyPair();
  const signedPermit = await client.signDecryptionPermit({
    contractAddresses: [contract],
    startTimestamp: Math.floor(Date.now() / 1000) - 60,
    durationSeconds: 86_400,
    signerAddress: delegate.address,
    signer: delegate,
    delegatorAddress: delegator,
    transportKeyPair,
  });
  return { signedPermit, transportKeyPair };
}

/** The JSON body @fhevm/sdk sends to v2/delegated-user-decrypt. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildBody(signedPermit: any, handles: string[], contract: string, chainId = 11155111) {
  const m = signedPermit.eip712.message;
  if (signedPermit.eip712.primaryType !== "DelegatedUserDecryptRequestVerification") {
    throw new Error(`expected a delegated V1 permit, got ${signedPermit.eip712.primaryType} (v${signedPermit.version})`);
  }
  return {
    handleContractPairs: handles.map((handle) => ({ handle, contractAddress: ethers.getAddress(contract) })),
    startTimestamp: String(m.startTimestamp),
    durationDays: String(m.durationDays),
    contractsChainId: String(chainId),
    contractAddresses: m.contractAddresses,
    delegatorAddress: m.delegatorAddress,
    delegateAddress: signedPermit.signerAddress,
    signature: remove0x(signedPermit.signature),
    extraData: m.extraData,
    publicKey: remove0x(m.publicKey),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (s: string) => s.replace(/0x[0-9a-fA-F]{64}/g, (h) => `${h.slice(0, 10)}…${h.slice(-4)}`)
  .replace(/0x[0-9a-fA-F]{40}/g, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`);

/** POST the body and poll the job until a terminal state or `timeoutMs`. */
export async function postDelegated(body: object, timeoutMs = 180_000): Promise<RawOutcome> {
  const steps: HttpStep[] = [];
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const out = (o: Partial<RawOutcome>): RawOutcome => ({
    verdict: "ERROR", shares: 0, label: "", message: "", jobId: "", startedAt, endedAt: Date.now(), steps,
    httpStatuses: steps.map((s) => `${s.method}:${s.status}`).join(" "), ...o,
  });
  const call = async (method: "POST" | "GET", url: string) => {
    const t = Date.now();
    const res = await fetch(url, method === "POST"
      ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : { method });
    const text = await res.text();
    steps.push({ method, status: res.status, ms: Date.now() - t, body: short(text.slice(0, 600)) });
    let json: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const retryAfter = Number(res.headers.get("retry-after") ?? "") * 1000 || 2000;
    return { res, json, retryAfter };
  };
  const failed = (status: number, json: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const label = String(json?.error?.label ?? json?.label ?? "");
    const message = short(String(json?.error?.message ?? json?.message ?? "").slice(0, 300));
    // 400 with a validation-type label = our body/signature was rejected; anything else = server verdict/error.
    const format = status === 400 && /valid|malformed|signature|parse|schema|format|request/i.test(`${label} ${message}`)
      && !/acl|allow|delegat|not authorized|permission|entitled/i.test(`${label} ${message}`);
    return { label, message, format };
  };

  try {
    // POST, retrying on 429/503
    let jobId = "";
    for (;;) {
      const { res, json, retryAfter } = await call("POST", DELEGATED_URL);
      if (res.status === 202 && json?.result?.jobId) { jobId = json.result.jobId; await sleep(retryAfter); break; }
      if ((res.status === 429 || res.status === 503) && Date.now() + retryAfter < deadline) { await sleep(retryAfter); continue; }
      const f = failed(res.status, json);
      return out({ verdict: f.format ? "REJECTED_FORMAT" : res.status >= 400 ? "REFUSED_SERVER" : "ERROR", label: f.label, message: f.message || `HTTP ${res.status}` });
    }
    // GET loop
    while (Date.now() < deadline) {
      const { res, json, retryAfter } = await call("GET", `${DELEGATED_URL}/${jobId}`);
      if (res.status === 200 && json?.status === "succeeded") {
        const shares = Array.isArray(json?.result?.result) ? json.result.result.length : 0;
        return out({ verdict: shares > 0 ? "DECRYPT" : "ERROR", shares, jobId, message: shares ? "" : "succeeded without shares" });
      }
      if (res.status === 202 || res.status === 429 || res.status === 503) { await sleep(retryAfter); continue; }
      const f = failed(res.status, json);
      return out({ verdict: f.format ? "REJECTED_FORMAT" : "REFUSED_SERVER", label: f.label, message: f.message || `HTTP ${res.status}`, jobId });
    }
    return out({ message: "timed out waiting for the job", jobId });
  } catch (e) {
    return out({ message: short(String((e as Error)?.message ?? e)) });
  }
}
