// ── Doctor delegation rules (v3) ──────────────────────────────────────────────
// Pure helpers with no SDK import, so the Hardhat tests can exercise them directly.

/** Default lifetime of a doctor's decryption delegation. */
export const DELEGATION_DAYS = 14;

/**
 * Zama's "all contracts" delegation sentinel (ACL.WILDCARD_DELEGATION_ADDRESS). A delegation to
 * this contract address would let the doctor decrypt the patient wallet's data in EVERY contract,
 * so the frontend refuses it everywhere.
 */
export const WILDCARD_CONTRACT = "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF";

/** Expiry (unix seconds) for a delegation created at `nowSeconds`. */
export function delegationExpiry(nowSeconds: number, days: number = DELEGATION_DAYS): number {
  return nowSeconds + days * 24 * 60 * 60;
}

/** Throws if the delegation target would be the all-contracts wildcard (or otherwise unusable). */
export function assertDelegationTarget(contractAddress: string, delegate: string): void {
  const c = contractAddress.toLowerCase();
  const d = delegate.toLowerCase();
  if (c === WILDCARD_CONTRACT.toLowerCase() || d === WILDCARD_CONTRACT.toLowerCase()) {
    throw new Error("Refusing to create an all-contracts delegation");
  }
  if (!/^0x[0-9a-f]{40}$/.test(c) || !/^0x[0-9a-f]{40}$/.test(d) || /^0x0{40}$/.test(c)) {
    throw new Error("Invalid delegation target");
  }
}

/** The slice of `ZamaSDK.delegations` used here (structural, so tests can pass a stub). */
export interface DelegationsApi {
  delegateDecryption(args: { contractAddress: `0x${string}`; delegateAddress: `0x${string}`; expirationDate?: Date }): Promise<unknown>;
  revokeDelegation(args: { contractAddress: `0x${string}`; delegateAddress: `0x${string}` }): Promise<unknown>;
}

/**
 * Delegate decryption of the patient wallet's data in `contractAddress` to `doctor`, for `days` days.
 *
 * PITFALL: @zama-fhe/sdk's `delegateDecryption` makes the delegation PERMANENT (uint64.max) when
 * `expirationDate` is omitted. This is the only place the frontend creates a delegation, and it
 * always passes an explicit, finite expiry.
 */
export async function delegateToDoctor(sdk: { delegations: DelegationsApi }, contractAddress: string, doctor: string,
  days: number = DELEGATION_DAYS, nowSeconds: number = Math.floor(Date.now() / 1000)) {
  assertDelegationTarget(contractAddress, doctor);
  if (!Number.isFinite(days) || days <= 0 || days > 365) throw new Error("Delegation must have a finite expiry of 1 to 365 days");
  const expirationDate = new Date(delegationExpiry(nowSeconds, days) * 1000);
  return sdk.delegations.delegateDecryption({
    contractAddress: contractAddress as `0x${string}`,
    delegateAddress: doctor as `0x${string}`,
    expirationDate,
  });
}

export async function revokeDoctor(sdk: { delegations: DelegationsApi }, contractAddress: string, doctor: string) {
  assertDelegationTarget(contractAddress, doctor);
  return sdk.delegations.revokeDelegation({
    contractAddress: contractAddress as `0x${string}`,
    delegateAddress: doctor as `0x${string}`,
  });
}

export type CloseStep = "revoking" | "closing" | "done";

export interface CloseFlowDeps {
  /** ConfidentialCareV3.isDoctorDelegated(consultId) */
  isDoctorDelegated: () => Promise<boolean>;
  /** Patient wallet → ACL.revokeDelegationForUserDecryption(doctor, contract); resolves once mined. */
  revoke: () => Promise<void>;
  /** Patient wallet → ConfidentialCareV3.closeConsultation(consultId); resolves once mined. */
  close: () => Promise<void>;
  onStep?: (step: CloseStep) => void;
}

export interface CloseFlowResult {
  revoked: boolean;
  closed: boolean;
}

/**
 * "Close" as one user action: revoke the doctor's delegation if it is active, then close.
 * The contract refuses to close while a delegation is active, so the order matters.
 * If the revocation is mined but closing fails, the error says so: access has already ended
 * and the patient only needs to retry closing.
 */
export async function revokeThenClose(deps: CloseFlowDeps): Promise<CloseFlowResult> {
  let revoked = false;
  if (await deps.isDoctorDelegated()) {
    deps.onStep?.("revoking");
    await deps.revoke();
    revoked = true;
    if (await deps.isDoctorDelegated()) {
      throw new Error("The doctor's access is still active after revoking; the consultation was not closed.");
    }
  }
  deps.onStep?.("closing");
  try {
    await deps.close();
  } catch (e) {
    if (revoked) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(`The doctor's access was revoked, but closing failed (${reason}). Retry "Close".`);
    }
    throw e;
  }
  deps.onStep?.("done");
  return { revoked, closed: true };
}
