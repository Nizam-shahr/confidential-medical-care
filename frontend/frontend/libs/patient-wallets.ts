import { ethers } from "ethers";

// ── Per-doctor patient wallets ────────────────────────────────────────────────
// ConfidentialCareV3 binds a patient address to exactly one doctor, because an ACL
// user-decryption delegation covers every handle that address holds in the contract.
// The patient keeps one main wallet; for each doctor we derive a separate wallet from a
// single EIP-712 signature by the main wallet. Nothing is stored: signing the same
// message again re-derives the same keys.
//
// Security notes
// - The signature IS the key material for every per-doctor wallet. It is kept in memory
//   only. Anyone who obtains it (e.g. a phishing site asking for the same typed data)
//   controls those wallets — the message says so explicitly.
// - Re-derivation requires deterministic ECDSA signatures (RFC 6979). Standard EOAs
//   (MetaMask, most hardware wallets) sign deterministically; smart-contract wallets
//   may not. `verifyDeterministic` signs twice once to check.

const SEED_TYPES = {
  PatientWalletSeed: [
    { name: "purpose", type: "string" },
    { name: "warning", type: "string" },
  ],
};

const SEED_MESSAGE = {
  purpose: "Derive my private ConfidentialCare patient wallets (one per doctor).",
  warning: "Only sign this on the official ConfidentialCare site. Anyone with this signature controls those wallets.",
};

function seedDomain(contractAddress: string, chainId: number): ethers.TypedDataDomain {
  return { name: "ConfidentialCare", version: "3", chainId, verifyingContract: contractAddress };
}

/** Ask the main wallet for the seed signature (one wallet prompt per session). */
export async function signPatientSeed(
  mainSigner: ethers.Signer,
  contractAddress: string,
  chainId: number,
  verifyDeterministic = false,
): Promise<string> {
  const domain = seedDomain(contractAddress, chainId);
  const sig = await mainSigner.signTypedData(domain, SEED_TYPES, SEED_MESSAGE);
  if (verifyDeterministic) {
    const again = await mainSigner.signTypedData(domain, SEED_TYPES, SEED_MESSAGE);
    if (again !== sig) {
      throw new Error("This wallet does not sign deterministically, so per-doctor wallets could not be recovered later. Use a standard EOA wallet.");
    }
  }
  return sig;
}

// Gas budgets used to decide whether a per-doctor wallet needs a top-up before an action.
export const GAS_BUDGET = {
  submitAndDelegate: BigInt(5_500_000),
  delegate: BigInt(400_000),
  revoke: BigInt(150_000),
  close: BigInt(150_000),
} as const;

/**
 * Top up a per-doctor wallet from the main wallet if it cannot pay for `gasBudget`.
 * LIMITATION: this transfer is public and links the main wallet to the per-doctor wallet
 * (and so to the doctor). A relayer or paymaster that pays gas would remove the link.
 * Returns the funding tx hash, or null if no top-up was needed.
 */
export async function fundIfNeeded(
  patientWallet: ethers.Wallet,
  mainSigner: ethers.Signer,
  gasBudget: bigint,
  minTopUpWei: bigint,
): Promise<string | null> {
  const provider = patientWallet.provider!;
  const fee = await provider.getFeeData();
  const needed = gasBudget * (fee.maxFeePerGas ?? fee.gasPrice ?? BigInt(0)) * BigInt(2);
  const balance = await provider.getBalance(patientWallet.address);
  if (balance >= needed) return null;
  const value = needed - balance > minTopUpWei ? needed - balance : minTopUpWei;
  const tx = await mainSigner.sendTransaction({ to: patientWallet.address, value });
  await tx.wait();
  return tx.hash;
}

/** Derive the patient wallet bound to `doctorId` from the seed signature. */
export function deriveDoctorWallet(seedSignature: string, doctorId: number, provider?: ethers.Provider): ethers.Wallet {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  let key = ethers.keccak256(coder.encode(["string", "bytes", "uint256"], ["ConfidentialCare.patientWallet.v1", seedSignature, doctorId]));
  // A keccak output is a valid secp256k1 key with overwhelming probability; re-hash in the negligible other case.
  for (;;) {
    try {
      return new ethers.Wallet(key, provider);
    } catch {
      key = ethers.keccak256(key);
    }
  }
}
