# Package versions per contract version

Branch `v3-delegation-sdk-migration` (from `main` @ f3bbdcd), 2026-11-03. Versions are the installed versions from `npm ls`. For v1 they come from `package-lock.json` at commits `dc818ba`/`f3bbdcd`.

## Summary

| | v1 | v2 | v3 (local only) |
|---|---|---|---|
| Contract | `ConfidentialCare` (original source, superseded by v2 in the working tree) | `ConfidentialCare` with the input-proof fix | `ConfidentialCareV3` |
| Sepolia address | 0x52e7…83aa (verified) | 0x708d…7D59 (verified) | not deployed |
| `@fhevm/solidity` used to compile the deployed bytecode | 0.11.1 | 0.11.1 | 0.13.4 (local) |
| `@fhevm/hardhat-plugin` (local mock) | 0.4.2 | 0.4.2 for the 2026-11-02 runs; 0.13.0-1 for the 2026-11-03 re-runs | 0.13.0-1 (alpha) |
| Mock host contracts | `@fhevm/host-contracts` 0.10.0 (ACL v0.2.0) | v0.10.0 then v0.13 cleartext (see row above) | `@fhevm/host-contracts-cleartext` 0.13.0-1 (ACL v0.4.0) |
| Client SDK for the Sepolia scripts | `@zama-fhe/relayer-sdk` 0.4.1 | `@zama-fhe/relayer-sdk` 0.4.1 (2026-11-02); `@zama-fhe/sdk` 3.7.1 (2026-11-03 re-run) | `@zama-fhe/sdk` 3.7.1 |
| SDK in the local mock | `@zama-fhe/relayer-sdk` 0.4.1 (through `@fhevm/mock-utils` 0.4.2) | same, then `@fhevm/sdk` 0.13.8 | `@fhevm/sdk` 0.13.8 |
| Frontend SDK | `relayer-sdk-js` 0.4.2 from Zama's CDN | same | `@zama-fhe/sdk` 3.7.1 (bundled; nested `@fhevm/sdk` 0.13.2) |
| Solidity compiler | 0.8.27, EVM cancun | 0.8.27, EVM cancun | 0.8.27, EVM cancun |

## Common tooling

- **v3 branch:** hardhat 2.28.4, ethers 6.17.0 (6.16.0 before the upgrade), `@nomicfoundation/hardhat-ethers` 3.1.3, hardhat-deploy 0.11.45, TypeScript 5.9.3, Node 22.18.0.
- **Frontend:** Next 16.2.3, ethers 6.16.0, viem 2.48.1, wagmi 2.19.5.

## The Sepolia network these versions talk to (read on 2026-11-03)

| Contract | Address | Reported version / setting |
|---|---|---|
| ACL | 0xf0Ff…433D | `getVersion()` = "ACL v0.5.0"; wildcard delegation present; no 1-hour minimum expiry (an expiry 120 s ahead simulates successfully; only a past expiry reverts with `ExpirationDateInThePast`) |
| KMSVerifier | 0xbE0E…311A | v0.4.0, 13 signers, threshold 7 |
| InputVerifier | 0xBBC1…4DA0 | 5 coprocessor signers, threshold 3 |
| Relayer | relayer.testnet.zama.org | URL from the `@zama-fhe/sdk` 3.7.1 `sepolia` preset |

The Sepolia ACL, KMSVerifier and coprocessor addresses in `@fhevm/solidity` 0.13.4 `ZamaConfig.sol` match the live addresses above. A v3 deployment compiled with 0.13.4 would therefore use the same ACL as v1 and v2.

## ⚠ Caveat: v3's local results rely on an alpha Hardhat plugin

**`@fhevm/hardhat-plugin` 0.13.0-1 is a prerelease** (npm dist-tag `alpha`, published 2026-09-25). The latest stable release is 0.4.2. All v3 local results, and the 2026-11-03 re-runs of the v1/v2 tests, ran on it.

**What this means for the results:**
- **No guarantee:** Zama publishes no stability guarantee for it. The API, the bundled cleartext host contracts (`@fhevm/host-contracts-cleartext` 0.13.0-1) and the behaviour may change before a stable 0.13 release.
- **Legacy helpers are gone:** the old helpers (`generateKeypair`, `createEIP712`, `delegatedUserDecrypt`, …) throw. Tests use `fhevm.client` (`@fhevm/sdk`) directly.
- **No relayer, KMS or gateway:** in cleartext mode the plugin runs none of them. Local refusals are `@fhevm/sdk`'s client-side ACL checks, not a simulation of Zama's servers.
- **Exact pin:** `package.json` pins it exactly (`0.13.0-1`). Re-run the whole suite before changing it.
- **Why it was chosen anyway:** the stable 0.4.2 mock runs ACL v0.2.0, which does not match Sepolia (1-hour minimum, no wildcard). Results under the alpha plugin describe Sepolia's ACL more accurately.
- **Confirmation still needed:** results that matter for the paper are confirmed on Sepolia (`results/v3/sepolia_plan.md`).

## How closely the local mock matches Sepolia

- **ACL version:** the local ACL (v0.4.0) is one minor version behind Sepolia (v0.5.0); no newer cleartext host-contracts package is published. They behave the same in every respect tested:
  - delegation and revocation, the wildcard, `ExpirationDateInThePast`, no 1-hour minimum;
  - the strict `expiry > block.timestamp` check;
  - `allow`/`allowForDecryption` requiring `isAllowed`.
- **Old mock:** the ACL v0.2.0 in the old 0.4.2 mock did not match Sepolia. It had a 1-hour minimum and no wildcard.
- **Alpha plugin:** `@fhevm/hardhat-plugin` 0.13.0-1 is a prerelease (npm tag `alpha`); the latest stable release, 0.4.2, still ships the old mock. It was chosen because it is the only plugin that runs the v0.13 host contracts. All v1/v2 tests pass on it unchanged; only the ABI paths changed.
- **No relayer or KMS in the local mock:**
  - **New mock:** in its cleartext mode, decryption reads values from `CleartextDB`. Local refusals therefore come from `@fhevm/sdk`'s client-side checks (`checkPersistAllowed` / `checkDelegation`), which read the same on-chain ACL state that Zama's servers check.
  - **Old mock:** the 0.4.2 mock simulated the server-side check in-process.

## Why the SDK changed

Zama's changelog states that `@zama-fhe/relayer-sdk` is deprecated and unsupported from 6 November 2026, and recommends `@zama-fhe/sdk`. 3.7.1 is the latest stable release, published 2026-10-22.

**Re-run of v2 on Sepolia with the new SDK:** A1 control decryption, A2 other-doctor refusal, A4 random-wallet refusal and B30 handle reuse all match the recorded results. See `results/v2/sdk_migration_check.md`.
