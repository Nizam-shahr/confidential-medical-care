import type { ethers } from "ethers";

// ── EIP-1193 Provider interface (MetaMask, OKX, etc.) ────────────────────────
export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

// ── FHE SDK instance ──────────────────────────────────────────────────────────
// We can't import the actual SDK type (server-side bundling issues),
// so we define the shape we actually use.
export interface FhevmInstance {
  createEncryptedInput(
    contractAddress: string,
    userAddress: string
  ): {
    add64(value: bigint): void;
    encrypt(): Promise<{
      handles: (Uint8Array | string)[];
      inputProof: Uint8Array | string;
    }>;
  };
  generateKeypair(): {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
  createEIP712(
    publicKey: Uint8Array,
    contractAddresses: string[],
    startTimeStamp: number,
    durationDays: number
  ): {
    domain: Record<string, unknown>;
    types: { UserDecryptRequestVerification: unknown[] };
    message: Record<string, unknown>;
  };
  userDecrypt(
    handleContractPairs: { handle: string; contractAddress: string }[],
    privateKey: Uint8Array,
    publicKey: Uint8Array,
    signature: string,
    contractAddresses: string[],
    userAddress: string,
    startTimeStamp: number,
    durationDays: number
  ): Promise<Record<string, unknown>>;
}

// ── Doctor ────────────────────────────────────────────────────────────────────
export interface Doctor {
  id: number;
  wallet: string;
  name: string;
  specialty: string;
  credentials: string;
  active: boolean;
  consultationCount: number;
}

// ── Consultation ──────────────────────────────────────────────────────────────
export type ConsultStatus = 0 | 1 | 2; // Open | DoctorResponded | Closed

export interface ConsultationMeta {
  id: number;
  patient: string;
  doctorId: number;
  status: ConsultStatus;
  createdAt: number;
  complaintChunkCount: number;
  hasResponse: boolean;
  responseChunkCount: number;
}

// ── Wallet state ──────────────────────────────────────────────────────────────
export interface WalletState {
  account: string;
  contract: ethers.Contract | null;
  fhevmInstance: FhevmInstance | null;
  fhevmReady: boolean;
  walletName: string;
  isAdmin: boolean;
  isDoctorId: number; // 0 = not a doctor
}