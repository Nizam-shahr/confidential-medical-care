# Why `npm run dev` is slow, and what helps

Measured 2026-11-04 (Next 16.2.3, webpack dev, Windows; a cold copy of this frontend; Next's own request log and `.next/dev/trace`).

## Symptom

| Request | Time | Of which Next/webpack compile |
|---|---|---|
| Server start ("Ready") | ≈ 1.5 s | |
| First load of `/` | **≈ 70 s** | 68 s |
| First load of `/doctors` | ≈ 50 s | |
| Revisit `/` a minute later (before the fix) | 29 s (recompiled) | |
| Other pages, warm | 3–9 s | |

Page rendering itself takes only 0.3–3 s.

## Cause

On first visit, webpack builds **≈ 11,500 modules**, once for the server render and once for the browser bundle. Summed build time per package (from the trace):

| Package(s) | Modules | Build time |
|---|---|---|
| viem | 2,974 | 261 s |
| Wallet SDKs pulled in by RainbowKit/wagmi: `@reown/appkit*`, `@walletconnect/*`, `@coinbase/wallet-sdk`, `@base-org/account`, `porto`, `@metamask/*`, `@safe-global/*` | ≈ 4,000 | > 300 s |
| `@fhevm/sdk` (inside `@zama-fhe/sdk`) | 484 | 53 s |
| ethers | 244 | 32 s |
| next | 601 | 68 s |

## What is not the cause

| Experiment | Result |
|---|---|
| Zama SDK stubbed out | `/` still 68 s; `/doctors` 46 → 29 s. The Zama SDK adds ≈ 17 s to the pages that use it, nothing to the rest. |
| `transpilePackages` removed | No change (77 s, within noise). |
| `getDefaultConfig` replaced with an injected-only wagmi config | No change (64 s). RainbowKit and `wagmi/connectors` still import every wallet SDK. |
| Wallet stack loaded with `next/dynamic({ ssr: false })` | No change (59 s). The App Router still compiles those modules for the server bundle. |

## Fix applied

`next.config.ts` → `onDemandEntries: { maxInactiveAge: 1 h, pagesBufferLength: 10 }`.

**Effect:** after the first visit, a page stays compiled, so navigating back is instant (`/` revisit: **29 s → 0.2 s**). The *first* visit to each page in a dev session is still slow.

## Options for the first-visit cost (not applied)

1. **Turbopack** (`next dev` without `--webpack`; Next 16's default). It needs `turbopack.resolveAlias` entries for the stubs in `next.config.ts`.
   - **Not measured:** it could not be measured outside this folder (Windows path-length limits in the test copy), and testing it here requires stopping your running dev server.
   - **Compatibility to check:** the Zama SDK's WASM and encryption worker must load correctly under Turbopack.
2. **Drop RainbowKit's wallet-SDK bundle.** A small "Connect browser wallet" button using wagmi's `injected` connector (imported from `@wagmi/core`, not the `wagmi/connectors` barrel) would remove ≈ 4,000 modules. The cost is losing WalletConnect, Coinbase and the RainbowKit modal.
3. **For demos:** `npm run build && npm start`. The production build compiles once (≈ 1–2 min) and every page then loads in well under a second.
