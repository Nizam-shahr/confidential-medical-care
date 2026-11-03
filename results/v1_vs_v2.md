# ConfidentialCare v1 vs v2 — access-control results (Sepolia)

| | v1 | v2 |
| --- | --- | --- |
| Contract | `0x52e7…83aa` | `0x708d…7D59` |
| Test data | existing consultation #2 (patient = admin, role overlap) | synthetic consultation #1, four separate wallets |
| Rows | 46 | 48 |
| Passed / failed / skipped-info | 35 / 3 / 8 | 41 / 4 / 3 |

Legend: ✔ passed · ✘ failed (result differs from the secure expectation) · · skipped or informational. Wallet addresses differ between versions, so compare by test ID.

## Summary

**What the fix changed**
- **B30 — handle-reuse re-sharing is closed.** v1 accepted a granted doctor resubmitting the patient's ciphertexts (empty proof) as a new consultation to another doctor; v2 rejects it with "Input proof required". Locally, the full attack (resubmit → grant → doctor 2 decrypts) succeeded on v1 and is blocked on v2, and a valid proof cannot be paired with someone else's handles (`InvalidInputHandle`).
- **B28 — all-zero response is closed.** v1 accepted `submitResponse` with zero handles and an empty proof (filling the single response slot); v2 rejects it.
- All other access checks (B1–B27, B29) behave identically: every wrong-role call reverts with the expected reason, and every control succeeds.

**What stayed the same (by design of Zama's ACL, not fixed by v2)**
- **E1/E2 — direct ACL re-sharing.** A granted doctor can call `ACL.allow` to give any address access, or `ACL.allowForDecryption` to make the patient's ciphertext publicly decryptable, on both v1 and v2 (simulated only; nothing was shared or made public on-chain). E3 confirms an address without permission cannot do this.
- **C1 — withdrawal does not revoke.** After the patient's real `markAccessWithdrawn` transaction on v2, the doctor still decrypts (handles taken from the original transaction calldata; `ACL.persistAllowed` remains true).
- **C2 — closing does not revoke.** After the real `closeConsultation` transaction, the doctor still decrypts. **C3:** closing does block a further response ("Consultation not open").
- **D1/D2 — metadata.** Patient and doctor addresses are linkable to the consultation on both versions (`ConsultationCreated`, transaction senders, and the ACL `Allowed` events naming the doctor's wallet).

**New results on v2 (not testable on v1)**
- **A5** — real response: the patient decrypts it; the other doctor and the responding doctor are refused.
- **A3** — admin is a separate wallet on v2 and is refused (on v1 the admin was the patient, so the test was skipped).

**Caveats for the paper**
- "REFUSED" in A/C tests is the relayer SDK's client-side ACL check (`persistAllowed`); the request never reaches Zama's KMS. Server-side enforcement is not measured here.
- **Do not compare gas between v1 and v2.** Sepolia repriced gas between the v1 deployment (April 2026) and v2 (November 2026): creating a new account now costs ~207k gas vs 21k, and v2's deployment used 15.3M gas vs 2.17M for v1, for nearly the same bytecode.
- v1 tests ran on pre-existing data with an admin = patient overlap; v2 used fresh synthetic data with four separate wallets.

**Changed rows:** A3, A5a, A5b, A5c, B28, B30, C1, C2, C3, D3

## Per-test comparison

| test_id | category | test | v1 | v2 | change |
| --- | --- | --- | --- | --- | --- |
| A1 | A. decryption | userDecrypt complaint (CONTROL) | ✔ DECRYPT | ✔ DECRYPT | same |
| A2 | A. decryption | userDecrypt complaint | ✔ REFUSED | ✔ REFUSED | same |
| A3 | A. decryption | userDecrypt complaint | · SKIPPED | ✔ REFUSED | **changed** |
| A3b | A. decryption | userDecrypt own complaint | ✔ DECRYPT | ✔ DECRYPT | same |
| A4 | A. decryption | userDecrypt complaint | ✔ REFUSED | ✔ REFUSED | same |
| A5a | A. decryption | userDecrypt response | · SKIPPED (as A5) | ✔ DECRYPT | **changed** |
| A5b | A. decryption | userDecrypt response | · SKIPPED (as A5) | ✔ REFUSED | **changed** |
| A5c | A. decryption | userDecrypt own response | · SKIPPED (as A5) | ✔ REFUSED | **changed** |
| A6 | A. decryption | userDecrypt complaint BEFORE grantDoctorAccess | ✔ REFUSED | ✔ REFUSED | same |
| B1 | B. permission (staticCall) | addDoctor(0x07f2…8057, x, y, z) | ✔ REVERT "Not admin" | ✔ REVERT "Not admin" | same |
| B2 | B. permission (staticCall) | deactivateDoctor(1) | ✔ REVERT "Not admin" | ✔ REVERT "Not admin" | same |
| B3 | B. permission (staticCall) | transferAdmin(0xBebD…B9Eb) | ✔ REVERT "Not admin" | ✔ REVERT "Not admin" | same |
| B4 | B. permission (staticCall) | addDoctor(0x07f2…8057, x, y, z) | ✔ REVERT "Not admin" | ✔ REVERT "Not admin" | same |
| B5 | B. permission (staticCall) | deactivateDoctor(1) | ✔ REVERT "Not admin" | ✔ REVERT "Not admin" | same |
| B6 | B. permission (staticCall) | transferAdmin(0x25c6…612C) | ✔ REVERT "Not admin" | ✔ REVERT "Not admin" | same |
| B7 | B. permission (staticCall) | addDoctor(0x07f2…8057, x, y, z) | ✔ REVERT "Not admin" | ✔ REVERT "Not admin" | same |
| B8 | B. permission (staticCall) | deactivateDoctor(1) | ✔ REVERT "Not admin" | ✔ REVERT "Not admin" | same |
| B9 | B. permission (staticCall) | transferAdmin(0x1362…201F) | ✔ REVERT "Not admin" | ✔ REVERT "Not admin" | same |
| B10 | B. permission (staticCall) | grantDoctorAccess(1) | ✔ REVERT "Not the patient" | ✔ REVERT "Not the patient" | same |
| B11 | B. permission (staticCall) | grantDoctorAccess(1) | ✔ REVERT "Not the patient" | ✔ REVERT "Not the patient" | same |
| B12 | B. permission (staticCall) | grantDoctorAccess(1) | ✔ REVERT "Not the patient" | ✔ REVERT "Not the patient" | same |
| B13 | B. permission (staticCall) | markAccessWithdrawn(1) | ✔ REVERT "Not the patient" | ✔ REVERT "Not the patient" | same |
| B14 | B. permission (staticCall) | markAccessWithdrawn(1) | ✔ REVERT "Not the patient" | ✔ REVERT "Not the patient" | same |
| B15 | B. permission (staticCall) | markAccessWithdrawn(1) | ✔ REVERT "Not the patient" | ✔ REVERT "Not the patient" | same |
| B16 | B. permission (staticCall) | closeConsultation(1) | ✔ REVERT "Not the patient" | ✔ REVERT "Not the patient" | same |
| B17 | B. permission (staticCall) | closeConsultation(1) | ✔ REVERT "Not the patient" | ✔ REVERT "Not the patient" | same |
| B18 | B. permission (staticCall) | closeConsultation(1) | ✔ REVERT "Not the patient" | ✔ REVERT "Not the patient" | same |
| B19 | B. permission (staticCall) | submitResponse(1, [32 zero handles], 0x, 1) | ✔ REVERT "Not assigned to this consultation" | ✔ REVERT "Not assigned to this consultation" | same |
| B20 | B. permission (staticCall) | submitResponse(1, [32 zero handles], 0x, 1) | ✔ REVERT "Not a registered doctor" | ✔ REVERT "Not a registered doctor" | same |
| B21 | B. permission (staticCall) | submitResponse(1, [32 zero handles], 0x, 1) | ✔ REVERT "Not a registered doctor" | ✔ REVERT "Not a registered doctor" | same |
| B22 | B. permission (staticCall) | addDoctor(0x07f2…8057, x, y, z) | ✔ SUCCEEDS (simulated) | ✔ SUCCEEDS (simulated) | same |
| B23 | B. permission (staticCall) | deactivateDoctor(1) | ✔ SUCCEEDS (simulated) | ✔ SUCCEEDS (simulated) | same |
| B24 | B. permission (staticCall) | transferAdmin(0xe1E1…B349) | ✔ SUCCEEDS (simulated) | ✔ SUCCEEDS (simulated) | same |
| B25 | B. permission (staticCall) | grantDoctorAccess(1) | ✔ SUCCEEDS (simulated) | ✔ SUCCEEDS (simulated) | same |
| B26 | B. permission (staticCall) | markAccessWithdrawn(1) | ✔ SUCCEEDS (simulated) | ✔ SUCCEEDS (simulated) | same |
| B27 | B. permission (staticCall) | closeConsultation(1) | ✔ SUCCEEDS (simulated) | ✔ SUCCEEDS (simulated) | same |
| B28 | B. permission (staticCall) | submitResponse(1, [32 zero handles], 0x, 1) | ✔ SUCCEEDS (simulated) | ✔ REVERT "Input proof required" | **changed** |
| B29 | B. permission (staticCall) | getComplaintHandles(1) | ✔ SUCCEEDS (simulated) | ✔ SUCCEEDS (simulated) | same |
| B30 | B. permission (staticCall) | submitConsultation(2, [6 reused handles of #1], 0x, 6) | ✘ SUCCEEDS (simulated) | ✔ REVERT "Input proof required" | **changed** |
| C1 | C. withdrawal/closing | userDecrypt complaint after markAccessWithdrawn | · SKIPPED | ✘ DECRYPT | **changed** |
| C2 | C. withdrawal/closing | userDecrypt complaint after closeConsultation | · SKIPPED | ✘ DECRYPT | **changed** |
| C3 | C. withdrawal/closing | submitResponse on closed #1 (valid fresh proof) | · SKIPPED | ✔ REVERT "Consultation not open" | **changed** |
| E1 | E. direct ACL (staticCall) | ACL.allow(#1 complaint chunk 0, doctor 2 0x25c6…612C) | ✘ SUCCEEDS (simulated) | ✘ SUCCEEDS (simulated) | same |
| E2 | E. direct ACL (staticCall) | ACL.allowForDecryption([#1 complaint chunk 0]) — make publicly decryptable | ✘ SUCCEEDS (simulated) | ✘ SUCCEEDS (simulated) | same |
| E3 | E. direct ACL (staticCall) | ACL.allow(#1 complaint chunk 0, self) by a doctor WITHOUT permission  | ✔ REVERT "execution reverted" | ✔ REVERT "execution reverted" | same |
| D1 | D. metadata | patient address 0x1A27…B339 linkable to #1 | · VISIBLE | · VISIBLE | same |
| D2 | D. metadata | assigned doctor 0xBebD…B9Eb linkable to #1 | · VISIBLE | · VISIBLE | same |
| D3 | D. metadata | log volume per emitter/event | · 14 logs in 2 txs | · 47 logs in 5 txs | **changed** |
