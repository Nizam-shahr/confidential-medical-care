# ConfidentialCare — access-control test results

Contract v1 `0x52e7…83AA` (Sepolia) · run 2026-11-02T09:04:40.622Z · no transactions sent

Chosen consultation: **#2** · patient 0x7094…11b8 · assigned doctor 1 (0xb561…6806) · status Open · 3 complaint chunks

## Summary
- Tests: 46 · passed 35 · failed 3 · inconclusive 0 · skipped/info 8
- Failures: B30 (submitConsultation(2, [3 reused handles of #2], 0x, 3): got SUCCEEDS (simulated)); E1 (ACL.allow(#2 complaint chunk 0, doctor 2 0x6C21…9423): got SUCCEEDS (simulated)); E2 (ACL.allowForDecryption([#2 complaint chunk 0]) — make publicly decryptable: got SUCCEEDS (simulated))
- Role overlaps: admin == patient of #2 (0x7094…11b8)
- Surprises: ⚠ B30: submitConsultation from doctor 1 0xb561…6806 acting as patient was accepted — handle reuse: granted doctor re-submits patient's ciphertexts to doctor 2; if accepted, a later grantDoctorAccess from the doctor would give doctor 2 ACL on patient 0x7094…11b8's complaint without patient consent (ACL re-delegation); E1: ACL.allow(#2 complaint chunk 0, doctor 2 0x6C21…9423) from assigned doctor 1 0xb561…6806 → SUCCEEDS (simulated); E2: ACL.allowForDecryption([#2 complaint chunk 0]) — make publicly decryptable from assigned doctor 1 0xb561…6806 → SUCCEEDS (simulated)

### Method notes
- Decryption uses `@zama-fhe/relayer-sdk/node` v0.4.1 `userDecrypt` with an EIP-712 signature, exactly as the frontend does.
- **REFUSED is a client-side result.** The SDK calls `ACL.persistAllowed(handle, user)` before contacting the relayer and throws "not authorized" if false; the request never reaches the KMS. The `acl_persist_allowed` column is that on-chain ACL state read independently. Server-side (KMS) enforcement is not tested here.
- B tests are `eth_call` simulations (`staticCall` with an overridden `from`); no signature or gas is needed and nothing is mined. "(control)" rows show the correct role passes the same check, so the negative results are not vacuous.
- `revokeDoctorAccess` only emits `DoctorAccessRevoked`; it changes no contract state and does not modify the Zama ACL (ACL grants are permanent).
- E tests are `eth_call` simulations against Zama's ACL contract; nothing was shared or made public on-chain.
- C tests decrypt with handles decoded from the original `submitConsultation` calldata, not from the contract getter.

## Results
| test_id | category | consult_id | wallet_role | action | expected | actual | passed | error_or_revert_reason | acl_persist_allowed | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | A. decryption | 2 | assigned doctor 1 0xb561…6806 | userDecrypt complaint (CONTROL) | DECRYPT | DECRYPT | true | decrypted OK (19 chars) | all |  |
| A2 | A. decryption | 2 | other doctor 2 0x6C21…9423 | userDecrypt complaint | REFUSED | REFUSED | true | User address 0x6C21…9423 is not authorized to user decrypt handle 0x2742a1cd…0500! | none |  |
| A3 | A. decryption | 2 | admin 0x7094…11b8 | userDecrypt complaint | REFUSED | SKIPPED | n/a (role overlap) |  | all | admin is the patient of #2, so it holds a legitimate ACL grant; an admin-refusal test is meaningless here |
| A3b | A. decryption | 2 | patient 0x7094…11b8 | userDecrypt own complaint | DECRYPT | DECRYPT | true | decrypted OK (19 chars) | all | positive control: submitConsultation grants the patient ACL on its own complaint |
| A4 | A. decryption | 2 | random wallet 0x0195…D30B | userDecrypt complaint | REFUSED | REFUSED | true | User address 0x0195…D30B is not authorized to user decrypt handle 0x2742a1cd…0500! | none |  |
| A6 | A. decryption | 1 | assigned doctor 1 0xb561…6806 | userDecrypt complaint BEFORE grantDoctorAccess | REFUSED | REFUSED | true | User address 0xb561…6806 is not authorized to user decrypt handle 0x3de9c0aa…0500! | none | no grantDoctorAccess tx exists for this consultation |
| B1 | B. permission (staticCall) |  | doctor 1 0xb561…6806 | addDoctor(0x5e70…35d6, x, y, z) | REVERT "Not admin" | REVERT | true | Not admin |  | fresh wallet argument, so only the access check can fail |
| B2 | B. permission (staticCall) |  | doctor 1 0xb561…6806 | deactivateDoctor(1) | REVERT "Not admin" | REVERT | true | Not admin |  |  |
| B3 | B. permission (staticCall) |  | doctor 1 0xb561…6806 | transferAdmin(0xb561…6806) | REVERT "Not admin" | REVERT | true | Not admin |  |  |
| B4 | B. permission (staticCall) |  | doctor 2 0x6C21…9423 | addDoctor(0x5e70…35d6, x, y, z) | REVERT "Not admin" | REVERT | true | Not admin |  | fresh wallet argument, so only the access check can fail |
| B5 | B. permission (staticCall) |  | doctor 2 0x6C21…9423 | deactivateDoctor(1) | REVERT "Not admin" | REVERT | true | Not admin |  |  |
| B6 | B. permission (staticCall) |  | doctor 2 0x6C21…9423 | transferAdmin(0x6C21…9423) | REVERT "Not admin" | REVERT | true | Not admin |  |  |
| B7 | B. permission (staticCall) |  | random 0x0195…D30B | addDoctor(0x5e70…35d6, x, y, z) | REVERT "Not admin" | REVERT | true | Not admin |  | fresh wallet argument, so only the access check can fail |
| B8 | B. permission (staticCall) |  | random 0x0195…D30B | deactivateDoctor(1) | REVERT "Not admin" | REVERT | true | Not admin |  |  |
| B9 | B. permission (staticCall) |  | random 0x0195…D30B | transferAdmin(0x0195…D30B) | REVERT "Not admin" | REVERT | true | Not admin |  |  |
| B10 | B. permission (staticCall) | 2 | doctor 1 0xb561…6806 | grantDoctorAccess(2) | REVERT "Not the patient" | REVERT | true | Not the patient |  |  |
| B11 | B. permission (staticCall) | 2 | doctor 2 0x6C21…9423 | grantDoctorAccess(2) | REVERT "Not the patient" | REVERT | true | Not the patient |  |  |
| B12 | B. permission (staticCall) | 2 | random 0x0195…D30B | grantDoctorAccess(2) | REVERT "Not the patient" | REVERT | true | Not the patient |  |  |
| B13 | B. permission (staticCall) | 2 | doctor 1 0xb561…6806 | revokeDoctorAccess(2) | REVERT "Not the patient" | REVERT | true | Not the patient |  |  |
| B14 | B. permission (staticCall) | 2 | doctor 2 0x6C21…9423 | revokeDoctorAccess(2) | REVERT "Not the patient" | REVERT | true | Not the patient |  |  |
| B15 | B. permission (staticCall) | 2 | random 0x0195…D30B | revokeDoctorAccess(2) | REVERT "Not the patient" | REVERT | true | Not the patient |  |  |
| B16 | B. permission (staticCall) | 2 | doctor 1 0xb561…6806 | closeConsultation(2) | REVERT "Not the patient" | REVERT | true | Not the patient |  |  |
| B17 | B. permission (staticCall) | 2 | doctor 2 0x6C21…9423 | closeConsultation(2) | REVERT "Not the patient" | REVERT | true | Not the patient |  |  |
| B18 | B. permission (staticCall) | 2 | random 0x0195…D30B | closeConsultation(2) | REVERT "Not the patient" | REVERT | true | Not the patient |  |  |
| B19 | B. permission (staticCall) | 2 | doctor 2 0x6C21…9423 (not assigned) | submitResponse(2, [32 zero handles], 0x, 1) | REVERT "Not assigned to this consultation" | REVERT | true | Not assigned to this consultation |  | access modifiers run before FHE.fromExternal, so dummy handles + empty proof are enough |
| B20 | B. permission (staticCall) | 2 | random 0x0195…D30B | submitResponse(2, [32 zero handles], 0x, 1) | REVERT "Not a registered doctor" | REVERT | true | Not a registered doctor |  |  |
| B21 | B. permission (staticCall) | 2 | admin 0x7094…11b8 | submitResponse(2, [32 zero handles], 0x, 1) | REVERT "Not a registered doctor" | REVERT | true | Not a registered doctor |  | admin is also the patient — still not a doctor |
| B22 | B. permission (staticCall) |  | admin 0x7094…11b8 (control) | addDoctor(0x5e70…35d6, x, y, z) | SUCCEEDS (simulated) | SUCCEEDS (simulated) | true |  |  |  |
| B23 | B. permission (staticCall) |  | admin 0x7094…11b8 (control) | deactivateDoctor(1) | SUCCEEDS (simulated) | SUCCEEDS (simulated) | true |  |  |  |
| B24 | B. permission (staticCall) |  | admin 0x7094…11b8 (control) | transferAdmin(0x7094…11b8) | SUCCEEDS (simulated) | SUCCEEDS (simulated) | true |  |  |  |
| B25 | B. permission (staticCall) | 2 | patient 0x7094…11b8 (control) | grantDoctorAccess(2) | SUCCEEDS (simulated) | SUCCEEDS (simulated) | true |  |  |  |
| B26 | B. permission (staticCall) | 2 | patient 0x7094…11b8 (control) | revokeDoctorAccess(2) | SUCCEEDS (simulated) | SUCCEEDS (simulated) | true |  |  |  |
| B27 | B. permission (staticCall) | 2 | patient 0x7094…11b8 (control) | closeConsultation(2) | SUCCEEDS (simulated) | SUCCEEDS (simulated) | true |  |  |  |
| B28 | B. permission (staticCall) | 2 | assigned doctor 1 0xb561…6806 (control) | submitResponse(2, [32 zero handles], 0x, 1) | passes access checks | SUCCEEDS (simulated) | true |  |  | access control holds. Note: with an empty proof FHE.fromExternal maps a zero handle to an encrypted 0, so the call is fully accepted — the assigned doctor can submit an all-zero response that permanently fills the single response slot |
| B29 | B. permission (staticCall) | 2 | random 0x0195…D30B | getComplaintHandles(2) | SUCCEEDS (simulated) | SUCCEEDS (simulated) | true |  |  | informational: encrypted handles are public to anyone; access control applies only at decryption |
| B30 | B. permission (staticCall) |  | doctor 1 0xb561…6806 acting as patient | submitConsultation(2, [3 reused handles of #2], 0x, 3) | REVERT (should be rejected) | SUCCEEDS (simulated) | false |  |  | handle reuse: granted doctor re-submits patient's ciphertexts to doctor 2; if accepted, a later grantDoctorAccess from the doctor would give doctor 2 ACL on patient 0x7094…11b8's complaint without patient consent (ACL re-delegation) |
| E1 | E. direct ACL (staticCall) | 2 | assigned doctor 1 0xb561…6806 | ACL.allow(#2 complaint chunk 0, doctor 2 0x6C21…9423) | REVERT (should be rejected) | SUCCEEDS (simulated) | false |  | all | LIMITATION (Zama ACL design): ACL.allow only requires the caller to be allowed on the handle, so a granted doctor can re-share directly, bypassing the contract |
| E2 | E. direct ACL (staticCall) | 2 | assigned doctor 1 0xb561…6806 | ACL.allowForDecryption([#2 complaint chunk 0]) — make publicly decryptable | REVERT (should be rejected) | SUCCEEDS (simulated) | false |  | all | LIMITATION (Zama ACL design): a granted doctor can make the patient's ciphertext publicly decryptable. Simulation only — never sent |
| E3 | E. direct ACL (staticCall) | 2 | other doctor 2 0x6C21…9423 | ACL.allow(#2 complaint chunk 0, self) by a doctor WITHOUT permission (control) | REVERT (should be rejected) | REVERT | true | execution reverted | none | control: an address with no ACL permission cannot grant itself access |
| A5 | A. decryption |  | patient / other doctor | userDecrypt response | DECRYPT / REFUSED | SKIPPED | n/a |  |  | none of my patient consultations (#1, #2) has a response; responses exist only on consultations of other patients, which are not decrypted |
| C1 | C. revocation |  | - | decrypt after revokeDoctorAccess | REFUSED | SKIPPED | n/a |  |  | no revokeDoctorAccess tx exists on-chain for my consultations and none was sent. Source analysis: the function only emits an event; it does not touch the Zama ACL, so a previously granted doctor would still decrypt. |
| C2 | C. withdrawal/closing |  | - | decrypt after closeConsultation | REFUSED | SKIPPED | n/a |  |  | v1: no transactions sent |
| C3 | C. withdrawal/closing |  | - | respond to closed consultation | REVERT "Consultation not open" | SKIPPED | n/a |  |  | v1: no transactions sent |
| D1 | D. metadata | 2 | public observer | patient address 0x7094…11b8 linkable to #2 | INFO | VISIBLE | n/a |  |  | submitConsultation tx.from; submitConsultation → FHEVMExecutor.VerifyInput; submitConsultation → ACL.Allowed; submitConsultation → ConfidentialCare.ConsultationCreated; grantDoctorAccess tx.from |
| D2 | D. metadata | 2 | public observer | assigned doctor 0xb561…6806 linkable to #2 | INFO | VISIBLE | n/a |  |  | submitConsultation → ConsultationCreated (doctorId 1 indexed; resolves via public doctors() to 0xb561…6806); grantDoctorAccess → ACL.Allowed; grantDoctorAccess → DoctorAccessGranted (doctorId 1 indexed; resolves via public doctors() to 0xb561…6806) |
| D3 | D. metadata | 2 | public observer | log volume per emitter/event | INFO | 14 logs in 2 txs | n/a |  |  | FHEVMExecutor 0x92C9…c127 VerifyInput ×3; ACL 0xf0Ff…433D Allowed ×9; ConfidentialCare 0x52e7…83AA ConsultationCreated ×1; ConfidentialCare 0x52e7…83AA DoctorAccessGranted ×1 |

## D. Event logs of consultation #2's transactions
| tx | function | log_index | emitter | event | args | addresses |
| --- | --- | --- | --- | --- | --- | --- |
| 0x0f95efd0… | submitConsultation | 0 | FHEVMExecutor 0x92C9…c127 | VerifyInput | caller=0x52e7…83AA; inputHandle=0x2742a1cd…0500; userAddress=0x7094…11b8; inputProof=0x03012742…36a70500a82acfdbe433c7c06f8a3a8e542eeb4775b19e8a92010000000000aa36a70500548e9d26533664c624b73a8e2aa4604b563cf92de0020000000000aa36a7050061a6134e7e41f389978393b6e9f24564e86ae497ff6af3a97b1d72ec8801a56339117904a724fa1663f576b95570822a84187d8d3d2917a887204a8b930f95081c00; inputType=5; result=0x2742a1cd…0500 | 0x52e7…83AA (this contract); 0x7094…11b8 (admin + patient of #1,#2) |
| 0x0f95efd0… | submitConsultation | 1 | ACL 0xf0Ff…433D | Allowed | caller=0x52e7…83AA; account=0x52e7…83AA; handle=0x2742a1cd…0500 | 0x52e7…83AA (this contract); 0x52e7…83AA (this contract) |
| 0x0f95efd0… | submitConsultation | 2 | ACL 0xf0Ff…433D | Allowed | caller=0x52e7…83AA; account=0x7094…11b8; handle=0x2742a1cd…0500 | 0x52e7…83AA (this contract); 0x7094…11b8 (admin + patient of #1,#2) |
| 0x0f95efd0… | submitConsultation | 3 | FHEVMExecutor 0x92C9…c127 | VerifyInput | caller=0x52e7…83AA; inputHandle=0xa82acfdb…0500; userAddress=0x7094…11b8; inputProof=0x03012742…36a70500a82acfdbe433c7c06f8a3a8e542eeb4775b19e8a92010000000000aa36a70500548e9d26533664c624b73a8e2aa4604b563cf92de0020000000000aa36a7050061a6134e7e41f389978393b6e9f24564e86ae497ff6af3a97b1d72ec8801a56339117904a724fa1663f576b95570822a84187d8d3d2917a887204a8b930f95081c00; inputType=5; result=0xa82acfdb…0500 | 0x52e7…83AA (this contract); 0x7094…11b8 (admin + patient of #1,#2) |
| 0x0f95efd0… | submitConsultation | 4 | ACL 0xf0Ff…433D | Allowed | caller=0x52e7…83AA; account=0x52e7…83AA; handle=0xa82acfdb…0500 | 0x52e7…83AA (this contract); 0x52e7…83AA (this contract) |
| 0x0f95efd0… | submitConsultation | 5 | ACL 0xf0Ff…433D | Allowed | caller=0x52e7…83AA; account=0x7094…11b8; handle=0xa82acfdb…0500 | 0x52e7…83AA (this contract); 0x7094…11b8 (admin + patient of #1,#2) |
| 0x0f95efd0… | submitConsultation | 6 | FHEVMExecutor 0x92C9…c127 | VerifyInput | caller=0x52e7…83AA; inputHandle=0x548e9d26…0500; userAddress=0x7094…11b8; inputProof=0x03012742…36a70500a82acfdbe433c7c06f8a3a8e542eeb4775b19e8a92010000000000aa36a70500548e9d26533664c624b73a8e2aa4604b563cf92de0020000000000aa36a7050061a6134e7e41f389978393b6e9f24564e86ae497ff6af3a97b1d72ec8801a56339117904a724fa1663f576b95570822a84187d8d3d2917a887204a8b930f95081c00; inputType=5; result=0x548e9d26…0500 | 0x52e7…83AA (this contract); 0x7094…11b8 (admin + patient of #1,#2) |
| 0x0f95efd0… | submitConsultation | 7 | ACL 0xf0Ff…433D | Allowed | caller=0x52e7…83AA; account=0x52e7…83AA; handle=0x548e9d26…0500 | 0x52e7…83AA (this contract); 0x52e7…83AA (this contract) |
| 0x0f95efd0… | submitConsultation | 8 | ACL 0xf0Ff…433D | Allowed | caller=0x52e7…83AA; account=0x7094…11b8; handle=0x548e9d26…0500 | 0x52e7…83AA (this contract); 0x7094…11b8 (admin + patient of #1,#2) |
| 0x0f95efd0… | submitConsultation | 9 | ConfidentialCare 0x52e7…83AA | ConsultationCreated | consultationId=2; patient=0x7094…11b8; doctorId=1; createdAt=1776173448 | 0x7094…11b8 (admin + patient of #1,#2) |
| 0xbf55aaf9… | grantDoctorAccess | 0 | ACL 0xf0Ff…433D | Allowed | caller=0x52e7…83AA; account=0xb561…6806; handle=0x2742a1cd…0500 | 0x52e7…83AA (this contract); 0xb561…6806 (doctor 1) |
| 0xbf55aaf9… | grantDoctorAccess | 1 | ACL 0xf0Ff…433D | Allowed | caller=0x52e7…83AA; account=0xb561…6806; handle=0xa82acfdb…0500 | 0x52e7…83AA (this contract); 0xb561…6806 (doctor 1) |
| 0xbf55aaf9… | grantDoctorAccess | 2 | ACL 0xf0Ff…433D | Allowed | caller=0x52e7…83AA; account=0xb561…6806; handle=0x548e9d26…0500 | 0x52e7…83AA (this contract); 0xb561…6806 (doctor 1) |
| 0xbf55aaf9… | grantDoctorAccess | 3 | ConfidentialCare 0x52e7…83AA | DoctorAccessGranted | consultationId=2; doctorId=1 |  |
