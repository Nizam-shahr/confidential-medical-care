import type { ZamaSdk } from "./zama";
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

// ── Encrypt text ──────────────────────────────────────────────────────────────
// The input proof is bound to `userAddress` and `contractAddress`.
export async function encryptText(
  text: string,
  contractAddress: string,
  userAddress: string,
  sdk: ZamaSdk
): Promise<{ handles: string[]; inputProof: string; chunkCount: number }> {
  const chunks = textToUint64Chunks(text);
  const { encryptedValues, inputProof } = await sdk.encrypt({
    values: chunks.map((value) => ({ value, type: "euint64" as const })),
    contractAddress: contractAddress as `0x${string}`,
    userAddress: userAddress as `0x${string}`,
  });
  return {
    handles: buildHandlesArray(encryptedValues.slice(0, chunks.length).map(String)),
    inputProof: String(inputProof),
    chunkCount: chunks.length,
  };
}

function validOnly(handles: string[]): string[] {
  return handles.filter((h) => h && h !== "0x" + "0".repeat(64));
}

// ── Decrypt handles ───────────────────────────────────────────────────────────
// `sdk` must be bound to whoever holds the ACL permission: the patient's per-doctor
// wallet for its own complaint and responses.
export async function decryptHandles(handles: string[], contractAddress: string, sdk: ZamaSdk): Promise<string> {
  const valid = validOnly(handles);
  if (valid.length === 0) return "";
  const result = await sdk.decryption.decryptValues(
    valid.map((h) => ({ encryptedValue: h as `0x${string}`, contractAddress: contractAddress as `0x${string}` }))
  );
  return resultToText(valid, result);
}

// ── Decrypt handles as a delegate (doctor) ────────────────────────────────────
// v3: the doctor holds no ACL permission of its own. It decrypts on behalf of the
// patient wallet (`delegator`) that delegated to it on the Zama ACL.
export async function decryptHandlesDelegated(
  handles: string[],
  contractAddress: string,
  delegator: string,
  doctorSdk: ZamaSdk
): Promise<string> {
  const valid = validOnly(handles);
  if (valid.length === 0) return "";
  const result = await doctorSdk.decryption.delegatedDecryptValues(
    valid.map((h) => ({ encryptedValue: h as `0x${string}`, contractAddress: contractAddress as `0x${string}` })),
    delegator as `0x${string}`
  );
  return resultToText(valid, result);
}

function resultToText(validHandles: string[], result: Record<string, unknown>): string {
  const decryptedChunks = validHandles.map((handle) => {
    const val = result[handle] ?? result[handle.toLowerCase()];
    if (val === undefined || val === null) return BigInt(0);
    return BigInt(val as string | number | bigint);
  });
  return uint64ChunksToText(decryptedChunks);
}
