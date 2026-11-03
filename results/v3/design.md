# ConfidentialCare v3 — delegation-based access (local, not deployed)

Contract: `contracts/ConfidentialCareV3.sol` · tests: `test/ConfidentialCare.v3.test.ts` · frontend: `frontend/frontend` (per-doctor wallets, delegated decryption, `@zama-fhe/sdk`).

**Latest results and the updated Part 1 answers (FHEVM v0.13): `results/v3/local_results.md`.** Where this file disagrees, that file is current.

## What changes from v2

| | v2 | v3 |
|---|---|---|
| Doctor's access | `FHE.allow(handle, doctor)`, a permanent ACL grant | Patient wallet calls `ACL.delegateForUserDecryption(doctor, contract, expiry)`; the doctor holds **no** ACL permission |
| Doctor can re-share (`ACL.allow`) or make public (`allowForDecryption`) | yes | **no** (reverts: the doctor is not allowed on the handle) |
| Doctor's onward delegation | n/a | has no effect (a delegation only works if the delegator is allowed on the handle) |
| Revocation | impossible (`markAccessWithdrawn` is a signal only) | `ACL.revokeDelegationForUserDecryption(doctor, contract)` |
| Expiry | none | yes; 14-day default (the v0.13 ACL only rejects past expiries; `@zama-fhe/sdk` requires ≥ 1 hour) |
| Closing | sets a flag; access remains | `closeConsultation` reverts with "Revoke doctor delegation first" while a delegation is active; the frontend's "Close" revokes, then closes, as one action |
| Patient address | one per patient | **one per doctor**: `submitConsultation` binds `msg.sender` to the first doctor it consults ("Patient wallet bound to another doctor"); doctors cannot be patients and vice versa |
| `grantDoctorAccess`, `markAccessWithdrawn` | present | removed (access is managed on the ACL by the patient) |
| Input proof required | yes | yes (kept from v2) |

## Why one patient wallet per doctor

A user-decryption delegation is scoped to `(delegator, delegate, contract)`, not to a consultation: the delegate can decrypt **every** handle on which both the delegator and the contract hold ACL permission (`ACL.isHandleDelegatedForUserDecryption`, ACL.sol:463). If one patient address consulted two doctors, delegating to doctor A would also expose the consultation with doctor B. Binding each patient address to exactly one doctor makes a delegation cover only that doctor's consultations.

Consequences:
- Revoking (or letting the delegation expire) ends the doctor's access to **all** of that wallet's consultations with that doctor, not just one. Closing one of several open consultations with the same doctor therefore requires revoking access to all of them; re-delegating restores it.
- A delegation from wallet A to doctor B would still give doctor B access to wallet A's data. The ACL is called by the patient directly, so the contract cannot prevent this; the frontend only ever delegates a per-doctor wallet to the doctor it is bound to (test `LIMITATION: a misdirected delegation …`).

## Per-doctor wallet derivation (frontend)

`frontend/frontend/libs/patient-wallets.ts`:
1. The main wallet signs one EIP-712 message (`PatientWalletSeed`, domain `ConfidentialCare` v3, chain id, contract address). The message itself warns that the signature controls the derived wallets.
2. Per doctor: `privateKey = keccak256(abi.encode("ConfidentialCare.patientWallet.v1", signature, doctorId))`.
3. Nothing is stored. The signature is held in memory for the session and dropped when the account changes; signing again re-derives the same wallets.
4. Recoverability needs deterministic ECDSA (RFC 6979). The frontend signs twice on first unlock in each session and refuses to continue if the two signatures differ (e.g. some smart-contract wallets).

The derived wallets sign locally and broadcast through a public Sepolia RPC (`NEXT_PUBLIC_SEPOLIA_RPC_URL`), because not all browser-wallet transports accept raw transactions.

## Limitations

1. **Gas funding links the wallets.** A per-doctor wallet needs ETH for `submitConsultation`, the delegation, revocation and closing. The frontend tops it up from the patient's main wallet, and that transfer is public: anyone can link the main wallet → per-doctor wallet → doctor (via `ConsultationCreated` and the ACL's `DelegatedForUserDecryption` event). Per-doctor wallets isolate doctors from each other's data; they do **not** hide the patient's main wallet from an on-chain observer.
   *Future work:* remove the link with sponsored gas. Because the ACL delegation must have the patient address as `msg.sender`, the options are an ERC-4337 smart account per doctor with a paymaster, an EIP-7702-delegated EOA with a sponsoring bundler, or a relayer/forwarder that the ACL accepts (it does not support ERC-2771 today). Funding through a privacy pool or an exchange withdrawal is a stopgap.
2. **The seed signature is key material.** A phishing site that obtains the same typed-data signature controls every per-doctor wallet. The EIP-712 domain binds it to the chain and contract and the message says so, but wallets still show such requests in a generic way.
3. **Delegations propagate to Zama's gateway asynchronously.** On Sepolia, a new delegation or revocation takes effect only after it reaches the gateway; the delay has not been measured yet (third-party reports: 1–2 minutes). In the local mock, checks are immediate.
4. **What was already decrypted stays with the doctor.** Revocation and expiry stop future decryption only; a doctor can copy plaintext off-chain while access is active.
5. **The delegated doctor can also read their own response.** The response is ACL-allowed to the patient, and the delegation covers all of the patient wallet's handles. This is the doctor's own text, but v2's "response-blind" property no longer holds while the delegation is active.
6. **Metadata.** As in v1/v2, `ConsultationCreated` links the patient address to the doctor; in v3 the ACL's `DelegatedForUserDecryption` / `RevokedDelegationForUserDecryption` events additionally make delegation and revocation times public.
7. **Mock vs. network.** The local tests use the Hardhat plugin's mock, whose simulated KMS checks `isHandleDelegatedForUserDecryption` on-chain. Refusals of the form "Delegate … is not authorized … on behalf of …" come from that server-side check, not from a client-side pre-check (unlike the v1/v2 "REFUSED" results). This has not yet been confirmed against Sepolia's real relayer and KMS.

## Local test evidence

See `results/v3/local_results.md` §2 (`test/ConfidentialCare.v3.test.ts`).
