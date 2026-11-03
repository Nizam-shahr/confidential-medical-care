# ConfidentialCare — on-chain inventory

Contract `0x708d…7D59` on Sepolia · generated 2026-11-02T08:59:31.839Z · read-only

- Admin: 0xe1E1…B349 (mine: MNEMONIC#0)
- Doctors: 2 · Consultations: 2 · Contract txs: 6 (0 failed)
- Consultations whose patient is one of my wallets: #1, #2
- revokeDoctorAccess / markAccessWithdrawn transactions on-chain: none

## Wallets I control
| source | address | onchain_roles |
| --- | --- | --- |
| DEPLOYER_PRIVATE_KEY | 0x7094…11b8 | (none) |
| DOCTOR1_PRIVATE_KEY | 0xb561…6806 | (none) |
| DOCTOR2_PRIVATE_KEY | 0x6C21…9423 | (none) |
| MNEMONIC#0 | 0xe1E1…B349 | admin |
| MNEMONIC#1 | 0x1A27…B339 | patient of #1,#2 |
| MNEMONIC#2 | 0xBebD…B9Eb | doctor 1 |
| MNEMONIC#3 | 0x25c6…612C | doctor 2 |
| MNEMONIC#4 | 0x5168…c4e6 | (none) |
| MNEMONIC#5 | 0x9094…6686 | (none) |
| MNEMONIC#6 | 0x40f6…f8b9 | (none) |
| MNEMONIC#7 | 0x75a2…df3b | (none) |
| MNEMONIC#8 | 0x352A…5A6E | (none) |
| MNEMONIC#9 | 0xa723…9F70 | (none) |

**⚠ Key/role mismatch:**
- DOCTOR1_PRIVATE_KEY derives 0xb561…6806, but doctor 1 is 0xBebD…B9Eb (on-chain role: none)
- DOCTOR2_PRIVATE_KEY derives 0x6C21…9423, but doctor 2 is 0x25c6…612C (on-chain role: none)

## Role overlaps (one address, several roles)
None.

## Doctors
| id | wallet | specialty | active | consultationCount | mine |
| --- | --- | --- | --- | --- | --- |
| 1 | 0xBebD…B9Eb | Psychiatry | true | 2 | MNEMONIC#2 |
| 2 | 0x25c6…612C | General Practice | true | 0 | MNEMONIC#3 |

## Consultations
| consult_id | patient | patient_is_mine | doctor_id | doctor_is_mine | status | created_at_utc | complaint_chunks | has_response | response_chunks | n_grant | n_revoke | n_response | n_close |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0x1A27…B339 | MNEMONIC#1 | 1 | MNEMONIC#2 | Open | 2026-11-02T08:57:12Z | 6 | false | 0 | 1 | 0 | 0 | 0 |
| 2 | 0x1A27…B339 | MNEMONIC#1 | 1 | MNEMONIC#2 | Open | 2026-11-02T08:57:24Z | 6 | false | 0 | 0 | 0 | 0 | 0 |

## Transactions
| tx_hash | function | consult_id | sender | sender_roles | sender_is_mine | gas_used | block | block_time_utc | status | n_logs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0x2f5dba04… | deploy (constructor) |  | 0xe1E1…B349 | admin | MNEMONIC#0 | 15332240 | 12047093 | 2026-11-02T08:53:24Z | ok | 0 |
| 0x5e779a09… | addDoctor |  | 0xe1E1…B349 | admin | MNEMONIC#0 | 1240376 | 12047105 | 2026-11-02T08:55:48Z | ok | 1 |
| 0x9c73e529… | addDoctor |  | 0xe1E1…B349 | admin | MNEMONIC#0 | 1142528 | 12047107 | 2026-11-02T08:56:12Z | ok | 1 |
| 0x44d99e7e… | submitConsultation | 1 | 0x1A27…B339 | patient of #1,#2 | MNEMONIC#1 | 3680864 | 12047112 | 2026-11-02T08:57:12Z | ok | 19 |
| 0x4ff4fa85… | submitConsultation | 2 | 0x1A27…B339 | patient of #1,#2 | MNEMONIC#1 | 3289172 | 12047113 | 2026-11-02T08:57:24Z | ok | 19 |
| 0x27cb3a9a… | grantDoctorAccess | 1 | 0x1A27…B339 | patient of #1,#2 | MNEMONIC#1 | 757808 | 12047116 | 2026-11-02T08:58:00Z | ok | 7 |

## Gas used per function (successful txs)
| function | n | min | median | max |
| --- | --- | --- | --- | --- |
| deploy (constructor) | 1 | 15332240 | 15332240 | 15332240 |
| addDoctor | 2 | 1142528 | 1240376 | 1240376 |
| submitConsultation | 2 | 3289172 | 3680864 | 3680864 |
| grantDoctorAccess | 1 | 757808 | 757808 | 757808 |
