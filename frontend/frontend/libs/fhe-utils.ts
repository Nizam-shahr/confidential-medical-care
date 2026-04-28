import { ethers } from "ethers";
import type { FhevmInstance } from "./types";
import { MAX_CHUNKS } from "./config";

// ── Text encoding ─────────────────────────────────────────────────────────────
export function textToUint64Chunks(text: string): bigint[] {
  const truncated = text.slice(0, MAX_CHUNKS * 8);
  const bytes = new TextEncoder().encode(truncated);
  const chunks: bigint[] = [];

  for (let i = 0; i < bytes.length; i += 8) {
    let val = BigInt(0);
    for (let j = 0; j < 8; j++) {
      val = (val << BigInt(8)) | BigInt(bytes[i + j] ?? 0);
    }
    chunks.push(val);
  }

  if (chunks.length === 0) chunks.push(BigInt(0));
  return chunks;
}

// ── Text decoding ─────────────────────────────────────────────────────────────
export function uint64ChunksToText(chunks: bigint[]): string {
  const bytes: number[] = [];
  for (const chunk of chunks) {
    for (let i = 7; i >= 0; i--) {
      bytes.push(Number((chunk >> BigInt(i * 8)) & BigInt(0xff)));
    }
  }
  const trimmed = bytes.filter((b, i) => {
    if (b !== 0) return true;
    return bytes.slice(i + 1).some((x) => x !== 0);
  });
  return new TextDecoder().decode(new Uint8Array(trimmed));
}

// ── Build handles array ───────────────────────────────────────────────────────
export function buildHandlesArray(handles: string[]): string[] {
  const result = new Array<string>(MAX_CHUNKS).fill(
    handles[0] ?? "0x" + "0".repeat(64)
  );
  for (let i = 0; i < handles.length && i < MAX_CHUNKS; i++) {
    result[i] = handles[i];
  }
  return result;
}

// ── Uint8Array → 0x hex ───────────────────────────────────────────────────────
function toHex(value: Uint8Array | string): string {
  if (typeof value === "string") {
    return value.startsWith("0x") ? value : "0x" + value;
  }
  return "0x" + Array.from(value)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Encrypt text ──────────────────────────────────────────────────────────────
export async function encryptText(
  text: string,
  contractAddress: string,
  userAddress: string,
  fhevmInstance: FhevmInstance
): Promise<{ handles: string[]; inputProof: string; chunkCount: number }> {
  const chunks = textToUint64Chunks(text);
  const chunkCount = chunks.length;

  const inputBuilder = fhevmInstance.createEncryptedInput(contractAddress, userAddress);
  for (const chunk of chunks) {
    inputBuilder.add64(chunk);
  }
  const encrypted = await inputBuilder.encrypt();

  const handles = buildHandlesArray(
    encrypted.handles.slice(0, chunkCount).map((h) => toHex(h))
  );

  return {
    handles,
    inputProof: toHex(encrypted.inputProof),
    chunkCount,
  };
}

// ── Decrypt handles ───────────────────────────────────────────────────────────
export async function decryptHandles(
  handles: string[],
  contractAddress: string,
  userAddress: string,
  fhevmInstance: FhevmInstance,
  provider: ethers.BrowserProvider
): Promise<string> {
  const signer = await provider.getSigner();

  const validHandles = handles.filter(
    (h) => h && h !== "0x" + "0".repeat(64)
  );
  if (validHandles.length === 0) return "";

  // Step 1 — keypair
  const keypair = fhevmInstance.generateKeypair();

  // Step 2 — handle-contract pairs
  const handleContractPairs = validHandles.map((handle) => ({
    handle,
    contractAddress,
  }));

  // Step 3 — EIP-712 signature
  const startTimeStamp = Math.floor(Date.now() / 1000);
  const durationDays = 10;
  const contractAddresses = [contractAddress];

  const eip712 = fhevmInstance.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimeStamp,
    durationDays
  );

  const signature = await signer.signTypedData(
    eip712.domain as ethers.TypedDataDomain,
    { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification as ethers.TypedDataField[] },
    eip712.message
  );

  // Step 4 — userDecrypt
  const result = await fhevmInstance.userDecrypt(
    handleContractPairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    signer.address,
    startTimeStamp,
    durationDays
  );

  // Step 5 — reconstruct text
  const decryptedChunks = validHandles.map((handle) => {
    const val = result[handle];
    if (val === undefined || val === null) return BigInt(0);
    return BigInt(val as string | number | bigint);
  });

  return uint64ChunksToText(decryptedChunks);
}