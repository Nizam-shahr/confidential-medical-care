# ConfidentialCare v3: Sepolia test plan (not run)

Status: **plan only.** Nothing in this file has been executed except the read-only measurements marked *(measured)*.

- **Prerequisites:** branch `v3-delegation-sdk-migration`, commit `6baf771`; local results in `results/v3/local_results.md`.
- **Approval:** each batch below needs your approval before it runs.

## Rules for the run

- **Synthetic data only.** Every consultation text starts with "Synthetic test …". No v1/v2 consultation of anyone else is touched.
- **Planned transactions.** Before each transaction batch the script prints what it will send and the estimated gas, as for v2, then proceeds.
- **Approvals.** Batches are approved one section at a time.
- **Abort on fees.** Stop if the Sepolia base fee is above 5 gwei; it was ≈ 0.00000003 gwei on 2026-11-03.
- **Credentials.** Hardhat vars only (`MNEMONIC`, `DEPLOYER_PRIVATE_KEY`, `ALCHEMY_API_KEY`, `ETHERSCAN_API_KEY`). Keys and the mnemonic are never printed, and addresses are shortened in every output.
- **No public decryption.** Nothing is ever made publicly decryptable. E1/E2 are `eth_call` only.
- **Explicit expiry.** Every delegation in the scripts passes an explicit expiry. The source-scan test in `test/ConfidentialCare.v3.test.ts` covers `scripts/`, so the new scripts must pass it before running.
- **Stop on surprises.** If anything behaves unexpectedly, the run stops and I report before continuing.

---

## 0. How the per-doctor wallets get gas (read before §3)

**In the current frontend, the patient's main wallet funds every per-doctor wallet.**

- **The top-up:** before each patient action, `fundIfNeeded` asks the main wallet to send ETH (at least 0.003 ETH) to the per-doctor wallet. This is a normal, public transfer.
- **What it reveals:** together with `ConsultationCreated` and the ACL's `DelegatedForUserDecryption` events, anyone can link the main wallet → per-doctor wallet → doctor, and the per-doctor wallets to each other.
- **What it does not undo:** the data isolation between doctors still holds; only the unlinkability of the wallets is lost.
- **Options to remove the link** (none built): EIP-7702 plus a sponsoring paymaster (best fit, because the patient stays an EOA), an ERC-4337 smart account plus paymaster (KMS acceptance of ERC-1271 permits not confirmed), an app-run gas station, ERC-2771 meta-transactions (partial: the ACL calls still need gas), or unlinkable funding. Details: `local_results.md` §4.

**This plan funds the derived wallets from the patient main wallet on purpose**, exactly as the frontend does. Test L1 (§9) records that link as evidence.

---

## 1. Accounts

| Role | Wallet | Notes |
|---|---|---|
| Admin and deployer | MNEMONIC #0 (0xe1E1…B349) | Deploys v3, registers doctors (as for v2) |
| Patient main wallet | MNEMONIC #1 (0x1A27…B339) | Signs the seed and funds the derived wallets |
| walletA = patient's wallet for doctor 1 | Derived with `libs/patient-wallets.ts` from #1's seed signature | Exactly the frontend's derivation (domain = v3 address, chain 11155111) |
| walletB = patient's wallet for doctor 2 | Derived the same way | |
| Doctor 1 | MNEMONIC #2 (0xBebD…B9Eb) | |
| Doctor 2 | MNEMONIC #3 (0x25c6…612C) | |
| Browser patient | One of your MetaMask accounts (not a MNEMONIC account) | §10 |
| Browser doctor ("Test Doctor C") | Another of your MetaMask accounts | Registered by the admin script from an address you give me (`V3_BROWSER_DOCTOR`) |
| Top-up source | DEPLOYER_PRIVATE_KEY (0x7094…11b8, 0.040 ETH) | Only if a role wallet runs short |

**Balances on 2026-11-03** *(measured)*: MNEMONIC #0–#3 hold 0.0100 ETH each, and the deployer holds 0.0403 ETH.

---

## 2. Step 0: zero-gas preflight against v2 (run first)

**Purpose:** confirm that a hand-built relayer request works, before any v3 gas is spent.

### Is a direct relayer request possible?

**Yes, in principle. Not yet confirmed against the live relayer.**

- **The route:** for protocol v0.13 (Sepolia), `@fhevm/sdk` sends delegated decryption as `POST {relayer}/v2/delegated-user-decrypt` with a JSON body, then polls `GET …/{jobId}` (`core/modules/relayer/module/fetchDelegatedUserDecryptV1.ts`, `RelayerAsyncRequest.ts`). The body is: `handleContractPairs`, `contractsChainId`, `contractAddresses`, `delegatorAddress`, `delegateAddress`, `startTimestamp`, `durationDays`, `signature`, `publicKey`, `extraData`.
- **The SDK's pre-checks** (`checkDelegation` / `checkPersistAllowed`) run *before* that call and are not part of the request.
- **Planned tool:** `scripts/v3/lib/rawRelayer.ts`.
  1. Use the public `@fhevm/sdk/ethers` API to create the transport key pair and sign the delegated decryption permit (`createFhevmClient` → `generateTransportKeyPair` → `signDecryptionPermit({ delegatorAddress })`).
  2. Build the JSON body exactly as `fetchDelegatedUserDecryptV1` does.
  3. POST it and poll it ourselves, with no ACL pre-check.
  4. Record per request: start and end time, block at start, HTTP status of each POST and GET, the relayer's `status` / `label` / `message`, the job ID, and the number of returned KMS shares.

### Preflight requests (v2 contract 0x708d…7D59, consultation #1; no transactions)

| # | Delegator / delegate | Expected | What it tells us |
|---|---|---|---|
| P1 | patient #1 → doctor 2 (no delegation exists on v2) | refused by the server | The relayer accepts our hand-built body and how it reports a missing delegation |
| P2 | same as P1, but the signature byte-flipped | rejected, invalid signature | What a *format/signature* rejection looks like, so it is not confused with an ACL refusal |
| P3 | same as P1 through `@zama-fhe/sdk` | client-side `DelegationNotFoundError` | Contrasts the SDK pre-check with the server verdict |

### If P1 cannot be classified

There are two possible failures: a refusal that is indistinguishable from an outage, or the relayer rejecting our body format.

- **Fallback:** I'll call `@fhevm/sdk`'s internal `fetchDelegatedUserDecrypt` through a deep `require` of its `_cjs` file. It sends the identical request without the pre-checks.
- **If that also fails:** I'll report that a direct relayer request is **not possible**, and T1 falls back to SDK-path evidence only.

### Known ambiguity

`@zama-fhe/sdk` itself treats an **HTTP 500** on a delegated request as "probably not propagated yet", and says the same status can mean an internal error (`DelegationNotPropagatedError`). For that reason:

- every refused request in T1–T5 is paired with a **positive control** sent within 60 s, using the same doctor and an active delegation;
- a refusal only counts as `REFUSED_SERVER` if the paired control returns shares;
- otherwise the result is `INCONCLUSIVE`.

---

## 3. Step 1: deploy, verify and seed v3

| Step | Detail |
|---|---|
| Deploy | `scripts/v3/deploy.ts` (new; same pattern as `scripts/v2/deploy.ts`, resumable). Deploys `ConfidentialCareV3` from MNEMONIC #0 with **an explicit `gasLimit` of 16,500,000**, because:<br>- *(measured)* the creation needs ≈ **15.82M gas** (eth_call bisection);<br>- `eth_estimateGas` reports **19.13M**, which is above the 16,777,216 per-transaction cap (EIP-7825), so an estimate-based deploy would be rejected;<br>- the margin under the cap is only ≈ 0.95M. |
| Verify | `npx hardhat verify --network sepolia <address>` (Etherscan V2 key). Compiler 0.8.27, cancun, `@fhevm/solidity` 0.13.4. |
| Record | `results/v3/deployment.json` and `.md`: address, block, transaction, commit, the source sha256 of `ConfidentialCareV3.sol`, the Etherscan link. |
| Frontend | Set `NEXT_PUBLIC_CONTRACT_ADDRESS` in `frontend/frontend/.env.local` to the v3 address. Only that key changes; the old value is printed shortened. Optionally add `NEXT_PUBLIC_SEPOLIA_RPC_URL` (otherwise the public node is used). |
| Seed | `scripts/v3/seed.ts` (new, resumable):<br>1. `addDoctor` for doctor 1, doctor 2 and browser doctor C (3 transactions, synthetic names "Test Doctor A/B/C – not a real practitioner").<br>2. Derive walletA and walletB from #1's seed signature.<br>3. **Fund each from #1** (2 transfers; the intended linkage).<br>4. walletA → `submitConsultation(1, …)` and walletB → `submitConsultation(2, …)`, 6-chunk synthetic texts.<br>No delegations yet. |
| Sanity checks (read-only) | `getConsultationMeta`; `patientDoctor(walletA)` = 1 and `patientDoctor(walletB)` = 2; `persistAllowed(h, doctor)` = false for both doctors; `isDoctorDelegated` = false. |

---

## 4. T1: does Zama's server refuse? (raw relayer requests)

For each case, the record holds the ACL view at the time of the request (`isHandleDelegatedForUserDecryption`, `getUserDecryptionDelegationExpirationDate`), plus the same request made through `@zama-fhe/sdk` for contrast (expected: refused client-side).

| Case | Setup | Requests |
|---|---|---|
| T1a no delegation | walletA's consultation #1. Doctor 2 claims delegator walletA (never delegated), and doctor 1 asks before any delegation. | 2 raw requests (×2 repetitions), each paired with a control. Before any delegation exists, the control is P1-style plus the positive control from T1b. |
| T1b revoked | walletA → doctor 1, 14 days. Raw request = **DECRYPT** (positive control; also proves the hand-built path can succeed). Revoke; wait 10 min (well beyond any propagation); raw request. | Expected `REFUSED_SERVER` (×2) |
| T1c expired | walletB → doctor 2 with a **5-minute** expiry, through a raw ACL call: the SDK refuses expiries under 1 h, the chain does not *(measured: `now+120 s` simulates OK)*. Raw request before expiry = DECRYPT; wait until expiry + 10 min; raw request. | Expected `REFUSED_SERVER` (×2) |

**Pass criterion:** each refusal is a non-2xx or failed job from the relayer, with no shares returned, while its paired control returns shares.

---

## 5. T2: revocation timing (5 repetitions, more if they vary)

Each cycle uses walletA → doctor 1:

1. `delegateForUserDecryption(doctor1, v3, now + 14 d + i)`. The expiry differs per cycle, because re-setting the same value reverts.
2. Poll raw requests until the first **DECRYPT**. This also gives the *grant* propagation time.
3. Send `revokeDelegationForUserDecryption`. Record the receipt's block number B_r, the block timestamp t_r, and the local time the confirmation was received.
4. Poll raw requests back-to-back. Two pollers are staggered by half the request latency to improve resolution. Each records its start time and the block number at its start.
5. Stop 3 requests after the **first refusal**, to detect flapping.

**Reported per cycle:**
- **Upper bound:** first refusal start − t_r, in seconds and in blocks (block at start − B_r).
- **Lower bound:** last success start − t_r. The true latency lies between the two.
- **Also:** grant propagation time, request latency, and any `DelegationNotPropagated`-style 500s.

**Summary:** min, median and max over the cycles. The result is compared with `@zama-fhe/sdk`'s claim ("usually within ~10 blocks") and the changelog's "host chain" claim.

**Safety and rate limits:** the pollers honour `Retry-After` and back off on 429. There are at most ~2 requests in flight, and the run is capped at 15 minutes per cycle.

---

## 6. T3: short expiry (5 minutes, ×2)

1. walletB → doctor 2 with `expiry = latest block timestamp + 300 s` (raw ACL call; the expiry is explicit).
2. Raw requests at +30 s and +120 s, expected DECRYPT.
3. From expiry − 60 s to expiry + 10 min, poll as in T2.

**Recorded:** the first refusal relative to the first block with `timestamp ≥ expiry`, in seconds and blocks, and the last success. On-chain the delegation is active while `expiry > block.timestamp`, so a success up to `expiry − 1` is expected.

---

## 7. T4: E1/E2 by the delegated doctor (simulation only)

These run while walletA → doctor 1 is active. All are `eth_call` / `staticCall` from doctor 1; **nothing is sent**.

| # | Call | Expected |
|---|---|---|
| E1 | `ACL.allow(hA, doctor2)` | revert `SenderNotAllowed` |
| E2 | `ACL.allowForDecryption([hA])` | revert `SenderNotAllowed` |
| E4 | `ACL.delegateForUserDecryption(doctor2, v3, now+1 d)` (onward delegation) | simulates OK, but it would be useless: `isHandleDelegatedForUserDecryption(doctor1, doctor2, v3, hA)` reads false, and `persistAllowed(hA, doctor1)` = false |
| E1c | Control: `ACL.allow(hA, doctor2)` simulated **from walletA** | simulates OK. This shows the check is not vacuous; **never sent.** |

---

## 8. T5: cross-doctor isolation on Sepolia

With walletA → doctor 1 and walletB → doctor 2 both active:

| Handle | Claimed delegator | Requester | Expected |
|---|---|---|---|
| hA (#1) | walletA | doctor 1 | DECRYPT |
| hB (#2) | walletB | doctor 2 | DECRYPT |
| hA | walletA | doctor 2 | REFUSED_SERVER |
| hA | walletB | doctor 2 | REFUSED_SERVER |
| hB | walletB | doctor 1 | REFUSED_SERVER |
| hB | walletA | doctor 1 | REFUSED_SERVER |

- Each row is sent as a raw request and through the SDK.
- For DECRYPT rows, the plaintext is also checked through the SDK path (`delegatedDecryptValues`) against the synthetic text.
- **Plus:** doctor 2 asks for walletA's response handle after doctor 1 responds (§9) → refused.

---

## 9. Closing and the response on Sepolia (script)

1. Doctor 1 responds to #1 (synthetic text, 1 transaction).
2. walletA decrypts the response (DECRYPT).
3. Doctor 1 decrypts their own response through the delegation: DECRYPT. This is the D1 behaviour, recorded as evidence.
4. Close with the frontend's `revokeThenClose` (revoke, then close).
5. Check: `isDoctorDelegated` = false and status = Closed.
6. Raw requests for the complaint and the response by doctor 1 are refused.

**L1 (linkage evidence):** list the funding transfers #1 → walletA and #1 → walletB, and the ACL events, with Etherscan links. These are the public links the gas model creates.

---

## 10. Manual browser checklist (for you)

### Setup

- Use Chrome with MetaMask, on the Sepolia network, with **two MetaMask accounts you control**:
  - **P** = patient main wallet, with at least 0.02 Sepolia ETH;
  - **C** = the doctor registered as "Test Doctor C" in §3, with at least 0.01 ETH.
- Run `cd frontend/frontend && npm run dev`, then open `http://localhost:3000`.
- Keep DevTools open (Console and Network tabs).

### Screenshot rules

- Save screenshots as `results/v3/browser/S<step>-<short-name>.png`.
- Crop or blur anything you don't want in the paper.
- **The seed-signature prompt must never be screenshotted with its signature output; the prompt alone is fine.**

### Steps

| # | Action | Expected | Screenshot(s) |
|---|---|---|---|
| 1 | Open the home page and the how-it-works page | v3 wording: 14-day access, "revoke or close", "including their own reply", the funding-link note | **S1a** home, **S1b** how-it-works steps 04–07 |
| 2 | Connect **P** | The "Activating FHE Encryption" overlay disappears, with no console errors. The Network tab shows the SDK's WASM and worker files loading (no CDN `relayer-sdk-js`). | **S2a** connected header, **S2b** Console, **S2c** Network filtered on `.wasm` / `worker` |
| 3 | Doctors → "Test Doctor C" → type "Synthetic browser test" → Submit | MetaMask asks for the **seed signature twice**: EIP-712, domain "ConfidentialCare" version 3, with the warning text. Then a **funding transfer** from P to a new address. Then the steps Encrypt → Submit → Grant Access → Done, with **no further prompts** (the derived wallet signs locally). | **S3a** seed prompt (domain and message visible), **S3b** funding transfer prompt (shows P → derived address), **S3c** success with the consultation number |
| 4 | Etherscan: open the funding transaction and the derived wallet's address page | The derived wallet received ETH from P, then sent `submitConsultation` and an ACL `delegateForUserDecryption`. In the ACL transaction's Logs, `DelegatedForUserDecryption` shows `newExpirationDate` ≈ now + 14 days and the contract = **v3 address (not 0xFFFF…FFFF)**. | **S4a** funding transaction, **S4b** derived wallet transaction list, **S4c** ACL log with the expiry and contract address |
| 5 | My Consultations → Unlock (no prompt if it is the same session) → open the consultation | The Doctor Access box reads "can decrypt … including their own reply, until <date ≈ +14 days>". Buttons: "Revoke Doctor Access", "Revoke Access & Close". | **S5** consultation modal |
| 6 | Switch MetaMask to **C**. Inbox → open the case → Decrypt | **No page reload is needed.** Account switch check: the inbox must decrypt as C, not P. A permit-signature prompt (EIP-712 decryption permit), then the plaintext "Synthetic browser test". | **S6a** permit prompt, **S6b** decrypted complaint |
| 7 | As **C**: write "Synthetic browser reply" → Send | One transaction from C. The status reads "Responded". | **S7** success state |
| 8 | Switch to **P**. My Consultations → open → Decrypt Response | Decrypts "Synthetic browser reply" (the per-doctor wallet signs locally; no MetaMask prompt). | **S8** decrypted response |
| 9 | As **P**: "Revoke Access & Close" | The overlay says "Revoking the doctor's access first, then closing (two transactions…)". Possibly a top-up prompt from P. Then the status is Closed and Doctor Access reads "cannot decrypt". | **S9a** overlay, **S9b** closed state |
| 10 | Etherscan: the derived wallet's latest transactions | `revokeDelegationForUserDecryption`, then `closeConsultation`, in that order (consecutive blocks or the same block) | **S10** transaction list |
| 11 | Switch to **C** → Inbox → open the closed case → Decrypt | Refused: "The patient has not delegated access to you, or has revoked it…". The console shows `DelegationNotFoundError` or `DelegationExpiredError`. **This is the SDK's client-side check**; the server-side verdict comes from T1. | **S11a** UI message, **S11b** console error |
| 12 | Reload the page as **P** → My Consultations → Unlock | Seed prompt again; the **same** consultation reappears (deterministic re-derivation; nothing was stored) | **S12** list after unlock |
| 13 | Optional: in the Console, run `localStorage` / IndexedDB inspection (Application tab) | Only the SDK's permit/transport-key storage; no seed signature or private key stored | **S13** Application → Storage |

**Report back:** the screenshots and any console errors. I'll add them to `results/v3/browser.md`.

---

## 11. Outputs

| File | Content |
|---|---|
| `results/v3/deployment.json` / `.md` | Deployment, verification, source hash |
| `results/v3/sepolia_preflight.csv` / `.md` | P1–P3 |
| `results/v3/sepolia_requests.csv` | One row per relayer or SDK request (all tests): test ID, path (raw/SDK), delegator, delegate, handle (shortened), ACL view, block at start, start and end time, HTTP statuses, relayer label/message, shares returned, verdict |
| `results/v3/sepolia_timing.csv` / `.md` | T2/T3 per cycle and summary |
| `results/v3/sepolia_results.md` | Summary tables, v1/v2/v3 comparison updated with Sepolia evidence, open questions |
| `results/v3/browser.md` | Your checklist results |

---

## 12. Gas and ETH estimate

*(measured on Sepolia on 2026-11-03 unless marked; gas use on Sepolia is far above mainnet-style numbers, e.g. v2's deploy used 15.33M)*

| Item | Count | Gas each | Gas total |
|---|---|---|---|
| Deploy v3 | 1 | ≈15.82M (limit 16.5M) *(measured)* | 16.5M (budgeted at the limit) |
| `addDoctor` | 3 | ≈1.24M (v2 actual) | 3.7M |
| Funding transfer to a new address | 2 (script) + ~2 (browser) | ≈0.25M *(measured)* | 1.0M |
| `submitConsultation`, 6 chunks | 2 (script) + 1 (browser) | ≈3.3M *(measured: 3.29M; v2 actual 3.68M incl. first-use storage)* | 11.0M (at 3.7M) |
| `submitResponse` | 1 (script) + 1 (browser) | ≈3.7M (assumed ≈ submit) | 7.4M |
| `delegateForUserDecryption` | T1 3×2 + T2 5 + T3 2 + T5 2 + browser 1 ≈ 16 | ≈0.17M *(measured, new entry)* | 2.7M |
| `revokeDelegationForUserDecryption` | T1 2 + T2 5 + §9 1 + browser 1 ≈ 9 | ≈0.15M (assumed) | 1.4M |
| `closeConsultation` | 2 | ≈0.15M (assumed) | 0.3M |
| **Total** | | | **≈ 44M gas** |
| **With a 50% margin** | | | **≈ 66M gas** |

**ETH by base fee:**

| Base fee | ETH for 66M gas | Note |
|---|---|---|
| 0.0000001 gwei (today ≈ 0.00000003) | ≈ 0.000000007 ETH | |
| 1 gwei | 0.066 ETH | |
| 5 gwei (abort threshold) | 0.33 ETH | |

**Funding:**
- **Recommendation:** have **≈ 0.07 ETH** available across the role wallets in case fees rise to 1 gwei. At today's fees the existing balances (≈ 0.08 ETH total) are ample.
- **Where it goes:** the deploy alone needs about 16.5M × fee from MNEMONIC #0, which holds 0.01 ETH, enough up to ≈ 0.6 gwei. Above that, #0 is topped up from the deployer key (one transfer).
- **Browser run:** your MetaMask accounts P and C need ≈ 0.02 and 0.01 ETH at 1 gwei; much less at today's fees.

**Relayer requests:** none cost gas. Expect ≈ 150–300 raw requests in total, mostly T2 polling.

**Submission gas vs. message length** *(measured 2026-11-04 on the v2 contract, which runs the same loop; genuine relayer proofs; `eth_call` bisection; `scripts/v3/submitGasProbe.ts`)*:

| Chunks | Characters (max) | Gas needed | Input proof size |
|---|---|---|---|
| 6 | 48 | 3.29M | 390 bytes |
| 16 | 128 | 7.15M | 710 bytes |
| 32 | 256 (the frontend maximum) | 13.52M | 1222 bytes |

- **Rate:** ≈ 0.39M gas per chunk.
- **Fits under the cap:** the longest message stays under the 16,777,216 per-transaction cap, with ≈ 3.2M to spare (v3 adds one storage write for the doctor binding).
- **Frontend fix (2026-11-04):** the old flat top-up budget of 5.5M gas for submit + delegate under-funded any message over ≈ 12 chunks. `libs/patient-wallets.ts` now uses `submitAndDelegateGas(chunks)` = 1M + 0.42M × chunks + 0.4M, which gives 3.92M for 6 chunks, 8.12M for 16 and 14.84M for 32.

---

## 13. Risks and stop conditions

- **Relayer refusal indistinguishable from an outage:** handled by the paired controls (`INCONCLUSIVE` instead of a false REFUSED).
- **Relayer rate limits:** back off; if the relayer rejects the hand-built body, use the fallback in §2.
- **Deploy over the gas cap:** prevented by the explicit `gasLimit`. If the deploy still fails, stop.
- **Nonce or fee spikes:** the scripts are resumable, as in v2.
- **Alpha plugin:** irrelevant on Sepolia (it only affects local tests).
- **Zama testnet maintenance windows:** check before starting. If the relayer is down, P1 fails and nothing that costs gas runs.
