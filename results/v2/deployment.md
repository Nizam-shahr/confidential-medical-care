# ConfidentialCare deployments (Sepolia)

| | v1 | v2 |
| --- | --- | --- |
| Address | `0x52e7…83aa` | `0x708d…7D59` |
| Etherscan | [code](https://sepolia.etherscan.io/address/0x52e7a7c4414921d7a68b00d5abae51e2861e83aa#code) | [code](https://sepolia.etherscan.io/address/0x708de98F102B3E99071b92c851dB1C832e197D59#code) |
| Deployment tx | `0xa23c546310d6d1c7321f7b01ee5350232d30acfba9f5ae25259672f7fb35ae79` | `0x2f5dba04e33aa3ee733e2d5fda883a84ed93291ad2cfcf22cb65c36a957a5baf` |
| Block | 10658033 | 12047093 |
| Deployer / admin | `0x7094…11b8` | `0xe1E1…B349` (MNEMONIC #0) |
| Source | commit `dc818ba`/`f3bbdcd` (as deployed April 2026) | commit `f3bbdcd` **+ uncommitted changes**, `ConfidentialCare.sol` sha256 `dcd4827238bdbef8154d91f78752a6a21f15bd90fb569e5e3332e5d3197451c7` |

## v2 changes
- `submitConsultation` and `submitResponse` require a non-empty `inputProof` (closes the handle-reuse re-sharing path, v1 test B30).
- `revokeDoctorAccess` → `markAccessWithdrawn`, event `DoctorAccessRevoked` → `AccessWithdrawalMarked`; documented as a signal that does not remove ACL access.

## v2 roles (generated MNEMONIC, no overlaps)
| Index | Role | Address |
| --- | --- | --- |
| 0 | admin | `0xe1E1…B349` |
| 1 | patient | `0x1A27…B339` |
| 2 | doctor1 | `0xBebD…B9Eb` |
| 3 | doctor2 | `0x25c6…612C` |

Deployed 2026-11-02T08:53:25.397Z. The frontend's `NEXT_PUBLIC_CONTRACT_ADDRESS` now points at v2.
