# v2 on Sepolia — re-run with @zama-fhe/sdk 3.7.1

Contract 0x708d…7D59 · run 2026-11-03T14:28:30Z · read-only (decryption requests and eth_call; no transactions).
Recorded results: `results/v2/access_tests.csv` (2026-11-02, `@zama-fhe/relayer-sdk` 0.4.1).

**All re-run results match the recorded results.**

| test_id | wallet_role | action | expected | recorded_actual | new_actual | match | new_detail |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | assigned doctor 1 0xBebD…B9Eb | userDecrypt complaint | DECRYPT | DECRYPT | DECRYPT | true | decrypted OK (6 chunks) |
| A2 | other doctor 2 0x25c6…612C | userDecrypt complaint | REFUSED | REFUSED | REFUSED | true | NotEntitledError: User 0x25c6…612C is not authorized to decrypt handle 0x6e27…b3d5a3000000000000aa36a70500! |
| A4 | random wallet 0x38A0…fCe0 | userDecrypt complaint | REFUSED | REFUSED | REFUSED | true | NotEntitledError: User 0x38A0…fCe0 is not authorized to decrypt handle 0x6e27…b3d5a3000000000000aa36a70500! |
| B30 | doctor 1 0xBebD…B9Eb as patient | submitConsultation(2, reused handles of #1, 0x) | REVERT | REVERT | REVERT | true | Input proof required |
| B30b | doctor 1 0xBebD…B9Eb as patient | submitConsultation(2, reused handles of #1, fresh valid proof) | REVERT | (not recorded) | REVERT | n/a (new test) | InputVerifier.InvalidInputHandle · control (own handles + own proof) SUCCEEDS |

Notes
- Refusals (A2, A4) are still decided client-side: `@fhevm/sdk` (used by `@zama-fhe/sdk`) reads `ACL.persistAllowed` before contacting the relayer, as the old SDK did. The wording changed; the outcome did not.
- B30/B30b are `eth_call` simulations from doctor 1's address. B30b uses a genuine input proof that the relayer/coprocessors issued to doctor 1 for their own data; it is rejected because the patient's handles are not in that proof (InputVerifier custom error `InvalidInputHandle`, decoded with the v0.13 InputVerifier ABI).
- The random wallet is generated fresh for this run and discarded.
