# ConfidentialCare v3: local results (not deployed)

Branch `v3-delegation-sdk-migration`, 2026-11-03. Nothing deployed and nothing committed.

- **Contract:** `contracts/ConfidentialCareV3.sol`
- **Tests:** `test/ConfidentialCare.v3.test.ts`
- **Frontend:** `frontend/frontend`
- **Package versions:** `results/versions.md`

**Result:** all 9 required v3 cases pass, plus 14 supporting checks (23/23), including three guards against the permanent-delegation pitfall. The full suite gives **44 passing, 1 pending**. The pending test is the template's Sepolia-only `FHECounterSepolia`. D1 is decided: option A, accepted and documented in §4.

---

## 0. What changed in this round

1. **SDK migration.**
   - `@zama-fhe/relayer-sdk` (unsupported from 6 Nov 2026) was replaced by **`@zama-fhe/sdk` 3.7.1** in the Sepolia scripts (`scripts/lib/zama.ts`) and the frontend (`frontend/frontend/libs/zama.ts`). The frontend no longer loads the CDN bundle.
   - **v2 re-run on Sepolia with the new SDK** (`results/v2/sdk_migration_check.md`, read-only). All four checks match the recorded 2026-11-02 results:

     | Test | Result |
     |---|---|
     | A1 control decryption | DECRYPT |
     | A2 other-doctor refusal | REFUSED |
     | A4 random-wallet refusal | REFUSED |
     | B30 handle reuse | REVERT "Input proof required" |

   - **New check, B30b:** the patient's handles paired with a genuine proof the new SDK obtained for doctor 1's own data. It reverts on Sepolia with `InputVerifier.InvalidInputHandle`, while doctor 1's own handles with that proof are accepted.
2. **FHEVM v0.13 packages.**
   - Installed: `@fhevm/solidity` 0.13.4 and `@fhevm/sdk` 0.13.8. The only v0.13 Hardhat plugin is the prerelease **`@fhevm/hardhat-plugin` 0.13.0-1 (alpha)**.
   - That plugin replaces the old mock (ACL v0.2.0) with the v0.13 cleartext host contracts (ACL v0.4.0). Sepolia runs ACL v0.5.0.
   - All v1/v2 tests pass unchanged. Only the ABI paths changed.
3. **v3 aligned with the spec.**
   - **Expiry:** 14-day default (`libs/delegation.ts`).
   - **Wildcard:** the frontend refuses the all-contracts sentinel everywhere.
   - **Close:** "Close" is now one action that revokes, then closes (`revokeThenClose`).
   - **Text:** the landing, how-it-works, doctors, consultations and inbox pages describe revoking and closing accurately.
   - **Tests:** `ConfidentialCare.v3.test.ts` replaces `ConfidentialCareV3.test.ts`.

---

## 1. Part 1: how Zama's delegation works (answers with evidence)

### Evidence sources

- **ACL source:** paths are `node_modules/@fhevm/host-contracts-cleartext/src/contracts/ACL.sol`. This is the v0.13 source used by the local mock.
- **Live behaviour:** from `eth_call` simulations against the live ACL (`scripts/v3/probeAcl.ts`, read-only).
- **`@zama-fhe/sdk` sources:** taken from the package's source maps.

### Corrections to my earlier Part 1 answers (which were based on ACL v0.2.0)

- **Q3 (expiry):**
  - No 1-hour minimum on the chain any more. Only `@zama-fhe/sdk` keeps the rule, as a client-side check (`DelegationExpirationTooSoonError`).
  - The check is now strict: `expiry > block.timestamp`.
- **Q9 (client-side checks):** the new SDKs *do* check delegations on the client. Server-side refusal can only be observed with a raw relayer request (see Part 4).

### Answers

| # | Question | Answer | Evidence |
|---|---|---|---|
| Q1 | Functions | **Delegator** (called by the patient wallet): `delegateForUserDecryption(delegate, contract, uint64 expiry)`, `revokeDelegationForUserDecryption(delegate, contract)`.<br><br>**Views:** `isHandleDelegatedForUserDecryption(delegator, delegate, contract, handle)` and `getUserDecryptionDelegationExpirationDate(delegator, delegate, contract)`.<br><br>**Contract-side wrappers:** `FHE.isDelegatedForUserDecryption`, `FHE.delegateUserDecryption`, `FHE.revokeUserDecryptionDelegation`. | ACL.sol: 278, 336, 467, 390. FHE.sol (0.13.4): 8028, 8075, 8130. Live ACL: same names; `getVersion()` = "ACL v0.5.0". |
| Q2 | Scope | **Per (delegator, delegate, contract), covering every handle of the delegator in that contract.** A delegation cannot be limited to selected handles.<br><br>**Wildcard:** delegating with the contract address `0xFFfF…FfFF` covers *all* contracts. It exists on the live network. | ACL.sol:165, 467–478 (the check accepts the per-contract or the wildcard entry). Live: `WILDCARD_DELEGATION_ADDRESS()` returns the sentinel, and a wildcard delegation simulates successfully. |
| Q3 | Expiry | **Setting it:** `uint64` unix seconds. The ACL rejects only past values (`ExpirationDateInThePast`); there is no minimum and no maximum. `@zama-fhe/sdk` refuses less than 1 hour and **defaults to permanent (`uint64.max`)** if no expiry is passed. v3 always passes 14 days.<br><br>**When it lapses:** active while `expiry > block.timestamp`; inactive at the expiry second (test 4).<br><br>**Who enforces it:** the ACL view above, which both the SDK and, per Zama's docs, the KMS evaluate. | ACL.sol:305, 588. Live: `now+120 s` simulates successfully; `now−10 s` reverts `ExpirationDateInThePast`. `@zama-fhe/sdk` `Delegations.delegateDecryption` typings. |
| Q4 | Revocation | **Who and how:** the patient wallet can revoke at any time. Revoking sets the expiry to 0.<br><br>**Errors:** reverts with `NotDelegatedYet` if there is nothing to revoke, and with `AlreadyDelegatedOrRevokedInSameBlock` for a second change in the same block.<br><br>**Timing:** immediate on the host chain. Not confirmed for Zama's servers, which read a synced copy (see Q7). | ACL.sol:343, 351, 355. Test 3. |
| Q5 | Can the doctor re-share? | **No.** `allow` and `allowForDecryption` revert with `SenderNotAllowed`, because `isAllowed` = transient or persistent ACL permission and a delegation is neither.<br><br>**Onward delegation:** the ACL accepts it, but it gives nothing, because the delegation check requires the *delegator* to hold persistent permission on the handle.<br><br>**Re-use via a contract:** the doctor also cannot use the handle in a contract: `fromExternal` with an empty proof needs `isAllowed`, and the proof requirement blocks the rest (case 8). | ACL.sol:206, 233, 441–442, 474. Test 2. |
| Q6 | Can the contract see the delegation? | **Yes.** `FHE.isDelegatedForUserDecryption` reads the ACL view. On v0.13 the view **includes wildcard delegations**, so v3's `closeConsultation` also refuses while a wildcard delegation is active. | Test "an all-contracts (wildcard) delegation by the patient also blocks closing". |
| Q7 | Decryption flow | 1. The doctor creates a **transport key pair** and signs a **decryption permit** (EIP-712) naming the delegator. The new SDK uses ML-KEM transport keys; 0.4.1 used NaCl.<br>2. `@fhevm/sdk` checks the delegation itself.<br>3. The request goes to the relayer (`fetchUserDecrypt`, unified V2 route).<br>4. The KMS nodes return shares encrypted to the transport key, and the client decrypts them locally.<br><br>**Gateway propagation:** `@zama-fhe/sdk`'s documentation says the **gateway (on Arbitrum) checks its own synced copy of the ACL**, which "usually" updates "within ~10 blocks". The SDK retries for about 30 s, and reports an HTTP 500 during that window as `DelegationNotPropagatedError`.<br><br>**Conflict:** Zama's changelog (v0.11/v0.12: checks "on the host chain", MultichainACL removed) says otherwise. **Not confirmed which is right; it decides revocation latency.** | `@fhevm/sdk` `core/kms/fetchKmsSigncryptedSharesV2-p.ts`:113, 130, 154. `@zama-fhe/sdk` `src/errors/delegation.ts` (`DelegationNotPropagatedError`), `src/namespaces/delegations.ts`. |
| Q8 | Key custody | **On-chain:** the Sepolia KMSVerifier lists 13 signers with threshold 7.<br><br>**Docs:** 13 MPC nodes run by different organisations in AWS Nitro Enclaves, threshold "e.g. 9 of 13".<br><br>**Not confirmed:** who operates the testnet nodes. | Read on 2026-11-03; Zama KMS overview page. |
| Q9 | Does the SDK pre-check? | **Yes, both new SDKs:**<br>- `@zama-fhe/sdk` `delegatedDecryptValues` fails fast on a missing or expired delegation (`assertDelegationActive`).<br>- `@fhevm/sdk` runs `checkDelegation` before the relayer request.<br><br>So a refusal seen through the SDK is client-side. **Testing Zama's servers needs a raw relayer request.** | `@zama-fhe/sdk` `src/services/delegation-service.ts` (`assertDelegationActive`). `@fhevm/sdk` `core/host-contracts/checkDelegation.ts`:123. |

---

## 2. v3 local test results (`test/ConfidentialCare.v3.test.ts`)

### Environment

- **Mock:** FHEVM v0.13 cleartext mock, ACL v0.4.0.
- **Delegated decryption:** goes through `@fhevm/sdk`'s client: transport key pair, then a signed permit with `delegatorAddress`, then `decryptValues`.
- **How refusals are checked:** every refusal is asserted as the SDK's ACL verdict (`is not delegated by` / `is not authorized to`). Every refusal is also checked against the on-chain state (`isHandleDelegatedForUserDecryption`, `persistAllowed`).
- **Caveat:** these refusals come from the SDK's client-side check of on-chain state, not from Zama's servers. No relayer or KMS runs locally.

| # | Required case | Result | Notes |
|---|---|---|---|
| 1 | The delegated doctor decrypts | ✅ pass | Refused before the delegation. After it: `isDoctorDelegated` = true, expiry = now + 14 days ± 5 s, chunk 0 decrypts. |
| 2 | The doctor cannot `ACL.allow`, delegate onward, or `allowForDecryption` | ✅ pass | `allow` and `allowForDecryption` revert with `SenderNotAllowed`; `isAllowedForDecryption` stays false. The onward delegation is mined, but the ACL view stays false and doctor B is refused (both delegator claims). The doctor is also refused direct decryption. |
| 3 | Revocation → refused | ✅ pass | After revoking: expiry = 0, ACL view false, `isDoctorDelegated` false, and the doctor is refused. |
| 4 | Expiry → refused | ✅ pass | Delegation of 1 h 1 min. Active at `expiry − 1`; inactive at the block whose timestamp equals `expiry` (strict check), and the doctor is refused. |
| 5 | Close fails while delegated, succeeds after revoke or expiry; the doctor is refused afterwards | ✅ pass (4 tests) | (a) A direct close reverts with "Revoke doctor delegation first"; the frontend's `revokeThenClose` runs revoking → closing → done, and the doctor is then refused.<br>(b) An explicit revoke followed by close works, and an expired delegation lets the flow close without a revoke; the doctor is refused in both.<br>(c) A closed consultation accepts no response.<br>(d) A wildcard delegation also blocks closing, and the flow reports it instead of closing. |
| 6 | The doctor-A wallet's delegation gives doctor B no access | ✅ pass | Each doctor decrypts their own consultation. All four cross pairs (both handles × both delegator claims) are false on the ACL and refused. |
| 7 | The patient decrypts the response; other doctors can't | ✅ pass | The patient decrypts. Doctors A and B have no `persistAllowed` and are refused direct decryption. Doctor B is refused when claiming walletA, and also when using its own walletB delegation. **See D1.** |
| 8 | B30 protections | ✅ pass (4 tests) | **Reused handles + empty proof:** "Input proof required", including from the patient wallet itself, which *is* ACL-allowed.<br>**Replayed proof** (the patient's handles and proof taken from calldata, sent by another wallet or by the doctor): `InputVerifier.InvalidSigner`.<br>**Mismatched proof:** `InvalidInputHandle`; the same proof with its own handles is accepted.<br>**Empty proof with zero handles:** "Input proof required". |
| 9 | A second doctor from the same wallet is rejected | ✅ pass | "Patient wallet bound to another doctor". A follow-up with the bound doctor is accepted. |

### Supporting checks

| Check | Result |
|---|---|
| LIMITATION (7): while delegated, the assigned doctor can decrypt their own response; refused before the delegation and after revoking | ✅ pass (documents the behaviour) |
| Roles stay separate: a doctor cannot be a patient; a patient wallet cannot become a doctor | ✅ pass |
| LIMITATION: a misdirected delegation (walletA → doctor B) gives doctor B access | ✅ pass (documents the behaviour) |
| Frontend helpers: `DELEGATION_DAYS` = 14; `delegationExpiry` = now + 14 days; the wildcard is refused as contract or delegate (any case); the zero address is refused | ✅ pass |
| Frontend per-doctor wallets: one seed signature, a different deterministic wallet per doctor and per main wallet, re-derivable; isolated on-chain | ✅ pass |
| PITFALL: `delegateToDoctor` (the frontend's only delegation path) always passes `expirationDate` = now + 14 days to the SDK, and refuses 0, negative, non-finite and >365-day values. Uses a stub SDK that records the call. | ✅ pass |
| PITFALL: a source scan of `frontend/frontend/{app,libs}`, `scripts/` and `contracts/` finds no delegation without an expiry. Every `delegateDecryption(` has `expirationDate` and sits only in `libs/delegation.ts`; every `delegateForUserDecryption(` has 3 arguments; no `FHE.delegateUserDecryption*WithoutExpiration`. The test first checks that the scanner flags each forbidden form. | ✅ pass |
| PITFALL (on-chain): a delegation with expiry `uint64.max` (what the SDK creates when none is passed) is still active 10 years later and blocks closing until revoked | ✅ pass (documents the behaviour) |

**Mutation check:** deleting `expirationDate` from `delegateToDoctor` makes both pitfall tests fail ("expirationDate missing: the SDK would make the delegation permanent"). The file was restored afterwards.

**Re-run of v1/v2 tests on the upgraded stack:** `ConfidentialCare.test.ts` 11/11 and `ConfidentialCare.security.test.ts` 10/10 pass. The suite includes the v1 limitations (E1/E2 re-sharing, withdraw/close leave access) and the v2 B30 fixes.

### Confirming the frontend never uses the wildcard

- The sentinel appears only in `libs/delegation.ts`, inside the guard.
- Both delegation call sites (`app/doctors/page.tsx`, `app/consultations/page.tsx`) go through `delegateToDoctor(sdk, CONTRACT_ADDRESS, doctor.wallet)`. That function calls `assertDelegationTarget` before `sdk.delegations.delegateDecryption`.
- In both, the SDK is bound to the wallet derived for that consultation's doctor (`getPatientSdk(doctorId)`).

### Confirming one deterministic wallet per doctor

- **One signature:** a single EIP-712 seed signature per session, unchanged.
- **One key per doctor:** `privateKey = keccak256(abi.encode("ConfidentialCare.patientWallet.v1", signature, doctorId))`.
- **Tested:** determinism, per-doctor and per-main-wallet separation (see the supporting checks).

---

## 3. v1 / v2 / v3 comparison

| Property | v1 (0x52e7…83aa) | v2 (0x708d…7D59) | v3 (local) |
|---|---|---|---|
| **Re-sharing through the contract** (handle reuse, B30) | ✘ Possible. An empty proof was accepted (Sepolia `eth_call`: SUCCEEDS); locally, the full chain (resubmit, grant, doctor 2 decrypts) succeeded. | ✔ Blocked: "Input proof required" (Sepolia, re-confirmed with the new SDK). A valid proof cannot carry foreign handles (B30b: `InvalidInputHandle`). | ✔ Blocked: the same proof requirement, plus a replayed proof fails with `InvalidSigner` and a mismatched proof with `InvalidInputHandle` (case 8). |
| **Direct ACL re-sharing** (E1 `allow`, E2 `allowForDecryption`) | ✘ Possible for a granted doctor (Sepolia `eth_call`: E1/E2 SUCCEED). | ✘ Possible for a granted doctor (Sepolia `eth_call`: E1/E2 SUCCEED). Inherent in a persistent `FHE.allow` grant. | ✔ Impossible: the doctor holds no ACL permission (`SenderNotAllowed`); onward delegation is ineffective (case 2). |
| **Revocation** | ✘ `revokeDoctorAccess` set a flag only; the ACL grant remains. | ✘ `markAccessWithdrawn` emits a signal only; on Sepolia the doctor still decrypted afterwards (C1 = DECRYPT). | ✔ The patient revokes on the ACL; refused on the host chain immediately (case 3). Server-side latency not measured. Delegations also **expire** (14-day default, case 4). |
| **Closing** | ✘ Status flag only; access remains. | ✘ Status flag only; on Sepolia the doctor still decrypted after closing (C2 = DECRYPT). It does block a later response (C3). | ✔ Closing is impossible while a delegation (incl. wildcard) is active; the frontend revokes, then closes, in one action. A closed consultation implies the doctor can no longer decrypt (case 5), as far as the host-chain ACL is concerned. |
| **Cross-consultation access** | Per consultation: each grant names that consultation's handles. Another doctor sees nothing unless granted (or re-shared, see above). | Same as v1. | Per doctor: a delegation covers **all** consultations of that per-doctor wallet with that doctor (coarser than v1/v2 within one doctor). Other doctors see nothing (case 6). Revoking or closing ends access to all of them. |
| **Response** | ACL to the patient only; other doctors refused. | ACL to the patient only; other doctors refused (Sepolia A5b). | ACL to the patient only; other doctors refused (case 7). **The assigned doctor can read it while delegated (D1, accepted).** |
| **One doctor per patient address** | No | No | Yes ("Patient wallet bound to another doctor", case 9) |

---

## 4. Decisions and developer notes

### D1 (decided: option A): the assigned doctor can decrypt their own response while delegated

**Decision (2026-11-03): accepted and documented.**

**Why it happens.** A delegation covers every handle that both the patient wallet and the contract are ACL-allowed on (Q2). The response has to be ACL-allowed to the patient, so the patient can decrypt it, and to the contract, so the KMS accepts the request. So while the patient's delegation to doctor A is active, **doctor A can decrypt the reply they wrote**.

**Who can and cannot read the response:**

| Reader | Can decrypt? |
|---|---|
| Doctor A, while delegated | Yes |
| Doctor A, before the delegation or after a revoke or expiry | No |
| Any other doctor, under any delegator claim (doctor B is also refused through its own delegation from walletB) | No |
| The patient | Yes |

Tests: case 7 and "LIMITATION (7)".

**Why this is acceptable:**
- The only extra reader is the response's author.
- No ACL permission is ever given to the doctor, so the doctor cannot re-share the response.
- Revoking or closing ends the access.

**Wording now in the code and UI** ("response-blind" is no longer claimed anywhere):
- **Contract comment:** "ACL-allowed to the contract and the patient only … an active delegation from the patient also covers it."
- **Patient, Doctor Access box:** "The doctor can decrypt your consultations with them, including their own reply, until …".
- **How it works, step 06:** "No other doctor can read it … While your delegation to them is active they can still decrypt their own reply through it."
- **Landing page:** "No other doctor can read it; the replying doctor can re-read their own reply only while your access is active."
- **Doctor inbox:** "Your Response (encrypted for the patient; no other doctor can read it)", and "Your own reply is readable to you under the same delegation."

**Alternatives not taken** (kept for the paper):
- **B. A second contract holds the responses.** Delegations are per contract, so a v3 delegation would not cover them. Its KMS behaviour is unverified.
- **C. Allow the response to the main wallet.** This links the main wallet to the doctor in ACL events.

### Developer pitfall: `@zama-fhe/sdk` creates a **permanent** delegation if no expiry is passed

**The problem:**
- `sdk.delegations.delegateDecryption({ contractAddress, delegateAddress, expirationDate? })` defaults to `uint64.max` when `expirationDate` is omitted (SDK typings: "defaults to permanent delegation via `uint64.max`").
- The call succeeds silently.
- In v3 such a delegation never lapses, and `closeConsultation` stays blocked until the patient revokes it explicitly (shown on-chain by the PITFALL test in §2).

**The guards:**
- **Frontend:** the only place a delegation is created is `frontend/frontend/libs/delegation.ts` → `delegateToDoctor`. It always passes `expirationDate = now + DELEGATION_DAYS (14) days` and rejects non-finite, zero, negative or >365-day lifetimes. Both call sites use it: `app/doctors/page.tsx` after submitting, and `app/consultations/page.tsx` for "Grant Doctor Access".
- **Scripts:** none create delegations yet. `scripts/v3/probeAcl.ts` only *simulates* `delegateForUserDecryption` (`eth_call`), always with an explicit expiry. The planned Sepolia scripts (`results/v3/sepolia_plan.md`) call the ACL directly with an explicit expiry, and the source-scan test covers `scripts/`.
- **Tests:** three PITFALL tests (§2) fail if a delegation path drops the expiry. They were mutation-checked.
- **Contract:** v3 never delegates. The scan also forbids `FHE.delegateUserDecryption*WithoutExpiration` in `contracts/`.

### How per-doctor wallets get gas in the current frontend

**The patient's main wallet pays, and that links the wallets on-chain.**

**How the top-up works:**
- `libs/patient-wallets.ts` → `fundIfNeeded(patientWallet, mainSigner, gasBudget, 0.003 ETH)` runs before each patient action. It checks the derived wallet's balance against `gasBudget × maxFeePerGas × 2`. If that is short, it asks the **main wallet** (a normal wallet prompt) to send the larger of the shortfall and 0.003 ETH.
- Budgets (`GAS_BUDGET`):

  | Action | Gas budget |
  |---|---|
  | submit + delegate | 5.5M |
  | delegate | 400k |
  | revoke | 150k |
  | close | 150k |
  | revoke-then-close | 300k |

- The derived wallet then signs its own transactions locally and broadcasts them through `NEXT_PUBLIC_SEPOLIA_RPC_URL`.
- **Doctors** pay their own gas from their own wallet.

**What this reveals.** The top-up is an ordinary ETH transfer from the main wallet to the per-doctor wallet. Together with `ConsultationCreated(patient = per-doctor wallet, doctorId)` and the ACL's `DelegatedForUserDecryption(per-doctor wallet → doctor)`, anyone can link **main wallet → per-doctor wallet → doctor**, and with two top-ups, both per-doctor wallets to each other. The per-doctor wallets isolate *data* between doctors; they do **not** hide that one person consulted several doctors.

**Options to remove the link** (not built):

| Option | How | Fit with v3 |
|---|---|---|
| EIP-7702 + sponsoring bundler/paymaster | The derived EOA delegates its code to a smart-account implementation; a sponsor pays gas through ERC-4337 | Best fit: the patient address stays an EOA, so the EIP-712 decryption permits and `msg.sender` on the ACL are unchanged. Needs a 7702-capable bundler and paymaster on Sepolia. |
| ERC-4337 smart account per doctor + paymaster | A counterfactual smart account is the patient address | `msg.sender` on the ACL works. **Not confirmed:** whether Zama's KMS accepts decryption permits signed by a smart account (ERC-1271). |
| App-run gas station | A platform hot wallet funds derived wallets on request | Removes the on-chain link to the main wallet, but the platform learns it (request origin) and needs abuse limits. |
| Meta-transactions (ERC-2771) | A forwarder relays `submitConsultation`/`closeConsultation` | Partial only: the ACL's `delegateForUserDecryption`/`revoke…` need `msg.sender` = patient and the ACL has no ERC-2771, so those still need gas. |
| Unlinkable funding (exchange withdrawal, privacy pool) | Fund each derived wallet from an unrelated source | Stopgap, operational burden, and policy/legal questions for privacy pools. |

---

## 5. Limitations

1. **Gas funding links the wallets.** See §4. A relayer or paymaster is future work.
2. **The doctor can copy plaintext.** Revocation, expiry and closing stop *future* decryption only.
3. **The doctor can read their own reply while delegated** (D1, accepted).
4. **Revocation and expiry on Zama's servers are not yet confirmed.** All local refusals are client-side checks of on-chain state. The gateway's synced ACL copy (Q7) may lag by about 10 blocks, according to `@zama-fhe/sdk`'s own docs, or by an unknown time. Until the Sepolia plan is run, "closed ⇒ no access" holds for the host-chain ACL only.
5. **Delegation is per doctor, not per consultation.** Revoking for one consultation ends access to all of that wallet's consultations with that doctor, and re-delegating restores all of them.
6. **A misdirected delegation leaks.** If a patient wallet delegates to the wrong doctor, that doctor reads its data. The contract cannot prevent this; only the frontend guards against it.
7. **Seed signature = key material.** A phishing site that obtains the same EIP-712 signature controls every per-doctor wallet.
8. **Metadata.** Delegation and revocation events and their times are public on the ACL.
9. **Local mock ≠ Sepolia.**
   - The ACL is v0.4.0 locally and v0.5.0 on Sepolia; they behave the same in everything tested.
   - The Hardhat plugin is an **alpha** (see `results/versions.md`).
   - Locally there is no relayer, KMS or gateway.
10. **Frontend not run in a browser yet.** It typechecks, lints (one existing warning) and `next build` succeeds. A manual checklist is in `sepolia_plan.md`.

### Not confirmed

- Whether Zama's servers check delegations on the host chain or on a gateway copy, and the propagation delay (docs conflict, Q7).
- That Zama's servers refuse a missing, revoked or expired delegation. Only the SDK's client-side refusal is observed so far.
- Who operates the testnet KMS nodes, and whether mainnet uses the same threshold (on-chain threshold 7 vs. the docs' example "9 of 13").
- Whether the KMS accepts ERC-1271 (smart-account) signatures on decryption permits (relevant to the paymaster options).

---

## 6. Next step

The Sepolia test plan is in `results/v3/sepolia_plan.md`. Nothing will be deployed until you approve it.
