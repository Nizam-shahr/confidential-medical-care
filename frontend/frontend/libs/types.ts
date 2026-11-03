import type { ethers } from "ethers";
import type { ZamaSdk } from "./zama";

// ── EIP-1193 Provider interface (MetaMask, OKX, etc.) ────────────────────────
export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
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
  /** @zama-fhe/sdk bound to the connected main wallet (the doctor decrypts and responds with it). */
  zama: ZamaSdk | null;
  fhevmReady: boolean;
  walletName: string;
  isAdmin: boolean;
  isDoctorId: number; // 0 = not a doctor
}