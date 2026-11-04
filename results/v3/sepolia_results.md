# ConfidentialCare v3 on Sepolia: results

Run 2026-11-04, following `results/v3/sepolia_plan.md`.

- **Contract:** `ConfidentialCareV3` at **0x9cF0…427B**, verified on Etherscan (`results/v3/deployment.md`).
- **Raw data:** `results/v3/sepolia_requests.csv` (215 rows), `sepolia_timing.csv`, `sepolia_preflight.csv`.
- **Scripts:** `scripts/v3/{preflight,deploy,seed,sepoliaTests}.ts`, `scripts/v3/lib/rawRelayer.ts`.
- **Data:** synthetic only. Every delegation had an explicit expiry, and nothing was made publicly decryptable.
- **Fees:** the base fee stayed at ≈ 0.000000016 gwei throughout, far below the 5 gwei stop.

## Headline results

| # | Question | Result |
|---|---|---|
| 0 | Can a delegated-decryption request go **directly to Zama's relayer**, without the SDK's pre-checks? | **Yes.** The relayer accepts the hand-built body (POST → `202 queued`) and answers each job. With an active delegation it returns KMS shares (11–12 of 13 signers; plaintext verified in all 44 successful requests). |
| 1 | Does **Zama's server** refuse when there is no delegation, a revoked one, or an expired one? | **Yes, in every case.** `HTTP 400`, label **`not_allowed_on_host_acl`**, message "ACL check failed … check=isHandleDelegatedForUserDecryption". Every refusal was paired with a control request that returned shares within seconds, so none of them is an outage. |
| 1d | Can an attacker **forge a permit** for a delegated doctor? | **No.** An attacker-signed permit claiming to be doctor 1, and doctor 1's genuine permit with the attacker's transport key swapped in, were both answered `HTTP 500 internal_server_error` with **no shares**. Valid controls succeeded right after each. The ACL check passes for both (the delegation was active), so the rejection must come from the server's signature/permit verification. |
| 2 | **How fast does revocation take effect?** | **Immediately, at the relayer.** In 6 cycles (T1b plus 5 × T2) the very first request started after the revoke receipt (≈ 0.1 s later, same block) was refused; there was **no success after any revocation**. Granting is just as fast (first decrypt 0.1–0.2 s after the delegation receipt). |
| 3 | **Expiry** (5-minute delegations, ×2) | Requests succeeded until shortly before the first block with `timestamp ≥ expiry` (last success −4.5 s / −9.3 s) and were refused from the next poll on (first refusal +6.1 s / +4.2 s, 0 blocks later). This matches the on-chain rule `expiry > block.timestamp`, within the ~10 s polling interval. Still refused 10 min after expiry (T1c), with valid controls. |
| 4 | E1/E2 by the delegated doctor (simulation only) | `ACL.allow` and `allowForDecryption` revert with **`SenderNotAllowed`**. An onward delegation would be accepted but is useless (ACL view: `isHandleDelegated(doctor1→doctor2)` = false, `persistAllowed(doctor1)` = false). Control: the patient wallet's own `allow` simulates fine (never sent). |
| 5 | Cross-doctor isolation | Each doctor decrypts only the consultation of the wallet bound to them. All 4 cross combinations (both handles × both delegator claims) were refused by the server, with valid controls; the SDK path agrees. |
| 9 | Response and closing | The patient (walletA) decrypts the reply. **D1 confirmed on Sepolia:** doctor 1 decrypts their own reply through the delegation; doctor 2 is refused. The frontend's `revokeThenClose` ran revoke → close (status Closed, `isDoctorDelegated` = false). Afterwards doctor 1 is refused for both the complaint and their reply (S9b, valid controls). |

**SDK comparison:** the same requests through `@zama-fhe/sdk` 3.7.1 were refused **client-side** (`DelegationNotFoundError`, `DelegationExpiredError`, `DecryptionFailedError`) without contacting the relayer.

## What this settles from Part 1

- **Where the delegation check happens.** The relayer checks the **host-chain ACL directly** (`isHandleDelegatedForUserDecryption`, label `not_allowed_on_host_acl`), with no measurable lag. That is consistent with the changelog ("ACL checks … on the host chain through the relayer"). `@zama-fhe/sdk`'s "~10 blocks gateway propagation" was not observed at this gate in either direction.
- **Signatures are verified after the ACL check.** A request with a corrupted signature but *no* delegation is refused by the ACL check first (`sepolia_preflight.md`, P2). With an active delegation, forged or tampered permits get no shares (T1d).
- **Revocation and expiry are enforced by Zama's servers**, not only by the SDK.

## Test detail

| Test | Requests | Outcome |
|---|---|---|
| Preflight P1–P3 (v2, no gas) | 3 | P1, P2 `400 not_allowed_on_host_acl`; P3 SDK `DelegationNotFoundError` |
| T1a no delegation (×2 × 2 cases) | 4 + 4 controls + SDK | all refused / all controls DECRYPT |
| T1b revoked (10 min later, ×2) | 2 + 2 controls + SDK | refused / DECRYPT |
| T1c expired (10 min later, ×2) | 2 + 2 controls + SDK | refused / DECRYPT |
| T1d forged permits (×2) | 2 + 2 controls | `500`, no shares / DECRYPT |
| T2 revocation timing (5 cycles) | 30 | 5 grant→decrypt, 25 post-revoke refusals, 0 post-revoke successes |
| T3 expiry (2 × 5 min) | 120 | 15 DECRYPT before expiry, 105 refused after; every row matched the block-timestamp rule |
| T4 E1/E2/E4 simulations | 5 | as expected |
| T5 isolation | 10 + SDK 6 | 2 own DECRYPT, 4 cross refused, 4 controls DECRYPT |
| S9 / S9b response and close | 9 + SDK | as above |

**Request latency** (hand-built, POST → result): median 2.2 s (2.1–3.0 s) for decryptions, 2.2 s (2.1–5.0 s) for refusals.

**Method issue, corrected:** in the first S9 run, the controls for the two after-close refusals used walletB → doctor 2, which T3 had left expired, so the controls were refused too (`acl_delegated=false`; marked `pass=false` in the CSV). S9b repeated both checks with a renewed control delegation: refused, with the controls returning shares.

## L1: the funding linkage on Sepolia

The seed run funded the per-doctor wallets from the patient's main wallet, exactly as the frontend does:

- patient main 0x1A27…B339 → walletA 0x07bE…5054 (0.002 ETH)
- patient main 0x1A27…B339 → walletB 0x2428…8944 (0.002 ETH)

Combined with `ConsultationCreated(walletA, doctor 1)`, `ConsultationCreated(walletB, doctor 2)` and the ACL's `DelegatedForUserDecryption` events, anyone can link the main wallet to both doctors. This is a documented limitation. The future-work option (EIP-7702 + paymaster) and its trust shift to the sponsor are in `local_results.md` §4.

## Gas actually used

| Transaction | Count | Gas each |
|---|---|---|
| Deploy (gasLimit 16.5M) | 1 | 15,815,726 |
| `addDoctor` | 2 | 1,242,676 / 1,144,720 |
| Funding transfer | 2 | 204,600 |
| `submitConsultation` (5 chunks) | 2 | 3,430,514 / 3,332,606 |
| `submitResponse` (5 chunks) | 1 | 2,326,387 |
| `delegateForUserDecryption` | 11 | 138,087 (new entry) / 40,167 (re-delegation) |
| `revokeDelegationForUserDecryption` | 7 | 39,523 |
| `closeConsultation` | 1 | 61,074 |

**Total ≈ 28.7M gas.** That cost < 0.000000001 ETH at the run's fees; the plan's estimate was 44M gas.

## Not covered by this run

- **§10, the browser checklist:** it needs your MetaMask accounts. Doctor C is not registered yet. Run `V3_BROWSER_DOCTOR=<address> npx hardhat run scripts/v3/seed.ts --network sepolia` to add it.
- **The KMS on its own:** there is no way to send a request that bypasses the relayer, so whether the KMS would refuse on its own if the relayer did not check was not tested.
- **Response latency, not propagation:** timing resolution is ≈ 0.1 s after the receipt, plus the request's own ≈ 2 s round trip. "Immediately" means no request started after the confirmed revocation ever succeeded.
