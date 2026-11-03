export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "0xYourDeployedAddressHere";

// Zama protocol addresses for Sepolia come from @zama-fhe/sdk (`sepolia` chain preset).

export const SEPOLIA_CHAIN_ID = "0xaa36a7"; // 11155111 in hex

// Per-doctor patient wallets sign locally and broadcast through this RPC
// (browser wallet transports do not all accept raw transactions).
export const SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

// How long a doctor's decryption delegation lasts.
export { DELEGATION_DAYS } from "./delegation";

// Top-up sent from the main wallet when a per-doctor wallet cannot cover the next transaction.
export const PATIENT_WALLET_TOPUP_ETH = "0.003";
export const MAX_CHUNKS = 32; // 32 × 8 bytes = 256 chars max text