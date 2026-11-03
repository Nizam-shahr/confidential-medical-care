# ConfidentialCare v2 — ACL grant audit

**Scope:** every `FHE.allow` / `FHE.allowThis` / ACL-granting path in `contracts/ConfidentialCare.sol` (v2: input proof required, `revokeDoctorAccess` renamed `markAccessWithdrawn`), plus the Zama ACL functions any permission holder can call directly.
**Question:** in v2, can any caller other than the patient cause the patient's ciphertext to be shared with a new address?
**Answer:** **Through the contract, no. Through Zama's ACL contract directly, yes — once the patient has granted a doctor access, that doctor can share the ciphertext with anyone or make it publicly decryptable.** The requirement is therefore **not met** by v2.

## 1. Grants made by the contract

| # | Function | ACL call | Handles | Recipient | Who can trigger | Conditions |
|---|---|---|---|---|---|---|
| 1 | `submitConsultation` | `FHE.fromExternal` → transient allow to contract | caller's fresh input | this contract (transient) | anyone (caller becomes the patient) | **v2:** non-empty proof; InputVerifier binds every handle to `msg.sender` + this contract |
| 2 | `submitConsultation` | `FHE.allowThis(chunk)` | same fresh complaint handles | this contract (persistent) | as above | — |
| 3 | `submitConsultation` | `FHE.allow(chunk, msg.sender)` | same fresh complaint handles | the patient | as above | — |
| 4 | `grantDoctorAccess` | `FHE.allow(complaintChunks[i], doctors[c.doctorId].wallet)` | the consultation's stored complaint handles | wallet of the doctor the patient chose at submission | **patient only** (`onlyPatient`) | status `Open` |
| 5 | `submitResponse` | `FHE.fromExternal` → transient allow to contract | doctor's fresh input | this contract (transient) | **assigned doctor only** (`onlyAssignedDoctor`) | `Open`, no prior response; **v2:** non-empty proof |
| 6 | `submitResponse` | `FHE.allowThis(chunk)` | doctor's fresh response handles | this contract | assigned doctor | — |
| 7 | `submitResponse` | `FHE.allow(chunk, patientWallet)` | doctor's fresh response handles | the patient | assigned doctor | — |

No other function calls `FHE.allow`, `FHE.allowThis`, `FHE.allowTransient` or `FHE.makePubliclyDecryptable`. `markAccessWithdrawn` and `closeConsultation` only emit events or set status; they grant nothing and remove nothing.

### Findings at contract level

- **Only #4 shares a patient's ciphertext with another address, and only the patient can call it.** The recipient is fixed: `doctorId` is set by the patient at submission and a doctor's wallet cannot be changed after `addDoctor`.
- **#5–#7 only ever grant the patient access to the doctor's own fresh data**, never to patient data.
- **v1 hole closed (B30):** in v1, rows 1 and 5 accepted an empty proof, letting any address already allowed on a handle (e.g. a granted doctor) feed the patient's handles into a new consultation and trigger #4 for a doctor of its choice. v2's `require(inputProof.length > 0)` closes this; tests: `granted doctor cannot re-share…`, `…replay the patient's public input proof`, `…pair the patient's handles with a valid proof for their own data` (`InvalidInputHandle`).
- **Trust in the admin:** the admin chooses which wallet stands behind each `doctorId`. A malicious admin could register a wallet it controls; the patient's grant would then reach that wallet. This is a registry trust assumption, not a bypass of `onlyPatient`.
- **Minor:** `grantDoctorAccess` does not check `doctors[id].active`, so a patient can still grant access to a doctor deactivated after the consultation was submitted.

## 2. Grants anyone holding a permission can make directly on Zama's ACL

`ACL.allow` (`@fhevm/host-contracts/contracts/ACL.sol:191`) checks only that the caller is not deny-listed and `isAllowed(handle, msg.sender)`. The caller does **not** have to be a contract. After #4, the doctor is persistently allowed on the complaint handles and can call, as an ordinary wallet:

| ACL function | Effect | v1 Sepolia (simulation, consult #2) | v2 local test |
|---|---|---|---|
| `allow(handle, anyAddress)` | permanent decrypt right for any address | succeeds | `LIMITATION: granted doctor can re-share directly via ACL.allow` — doctor 2 decrypts |
| `allowForDecryption([handle])` | handle becomes **publicly decryptable** | succeeds | `LIMITATION: granted doctor can make the complaint publicly decryptable` |
| `delegateForUserDecryption(delegate, contract, expiry)` | delegate can user-decrypt every handle where the doctor **and** the contract are allowed | not tested | not tested (follows from `isHandleDelegatedForUserDecryption`, ACL.sol:463) |
| `allow` from an address with no permission (control) | — | reverts | `an address without ACL permission cannot re-share` |

The Sepolia simulations were `eth_call` only; no patient handle was made public or shared on-chain.

## 3. Revocation and closing

- **`markAccessWithdrawn`** only emits `AccessWithdrawalMarked`. Zama ACL permissions cannot be removed, so the doctor can still decrypt (test: `LIMITATION: markAccessWithdrawn does not remove the doctor's access`).
- **`closeConsultation`** sets status `Closed`, which blocks `grantDoctorAccess` and `submitResponse`, but does not remove existing ACL permissions (test: `LIMITATION: closing does not remove access, but blocks a later response`).

## Conclusion

v2 guarantees that **no one but the patient can cause the contract to share patient ciphertext**, and fixes the v1 handle-reuse path. It **cannot** guarantee that patient ciphertext isn't shared further: any `FHE.allow` grant to an external wallet hands that wallet the same re-sharing power as the patient, including making the data public. That is a property of persistent ACL grants, not of this contract's code. v3 replaces the doctor's persistent grant with patient-issued user-decryption delegation, under which the doctor holds no ACL permission of its own.
