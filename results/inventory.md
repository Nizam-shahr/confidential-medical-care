# ConfidentialCare — on-chain inventory

Contract `0x52e7…83aa` on Sepolia · generated 2026-11-01T20:01:38.328Z · read-only

- Admin: 0x7094…11b8 (mine: DEPLOYER_PRIVATE_KEY)
- Doctors: 2 · Consultations: 23 · Contract txs: 49 (0 failed)
- Consultations whose patient is one of my wallets: #1, #2
- revokeDoctorAccess transactions on-chain: none

## Wallets I control
| source | address | onchain_roles |
| --- | --- | --- |
| DEPLOYER_PRIVATE_KEY | 0x7094…11b8 | admin; patient of #1,#2 |
| DOCTOR1_PRIVATE_KEY | 0xb561…6806 | doctor 1 |
| DOCTOR2_PRIVATE_KEY | 0x6C21…9423 | doctor 2 |

## Role overlaps (one address, several roles)
| address | roles | mine |
| --- | --- | --- |
| 0x7094…11b8 | admin + patient of #1,#2 | DEPLOYER_PRIVATE_KEY |

## Doctors
| id | wallet | specialty | active | consultationCount | mine |
| --- | --- | --- | --- | --- | --- |
| 1 | 0xb561…6806 | Psychiatry | true | 12 | DOCTOR1_PRIVATE_KEY |
| 2 | 0x6C21…9423 | Sexual Health | true | 11 | DOCTOR2_PRIVATE_KEY |

## Consultations
| consult_id | patient | patient_is_mine | doctor_id | doctor_is_mine | status | created_at_utc | complaint_chunks | has_response | response_chunks | n_grant | n_revoke | n_response | n_close |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0x7094…11b8 | DEPLOYER_PRIVATE_KEY | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-04-14T13:24:12Z | 19 | false | 0 | 0 | 0 | 0 | 0 |
| 2 | 0x7094…11b8 | DEPLOYER_PRIVATE_KEY | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-04-14T13:30:48Z | 3 | false | 0 | 1 | 0 | 0 | 0 |
| 3 | 0xcCb7…f6Be | no | 1 | DOCTOR1_PRIVATE_KEY | Closed | 2026-04-15T10:58:24Z | 5 | true | 3 | 1 | 0 | 1 | 1 |
| 4 | 0xcCb7…f6Be | no | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-04-17T06:49:24Z | 4 | false | 0 | 0 | 0 | 0 | 0 |
| 5 | 0xcCb7…f6Be | no | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-04-17T06:55:36Z | 4 | false | 0 | 1 | 0 | 0 | 0 |
| 6 | 0xcCb7…f6Be | no | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-04-19T09:51:24Z | 2 | false | 0 | 1 | 0 | 0 | 0 |
| 7 | 0x333d…115a | no | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-04-20T12:45:00Z | 1 | false | 0 | 1 | 0 | 0 | 0 |
| 8 | 0xcCb7…f6Be | no | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-04-20T12:58:36Z | 3 | false | 0 | 1 | 0 | 0 | 0 |
| 9 | 0x333d…115a | no | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-04-20T13:18:36Z | 2 | false | 0 | 1 | 0 | 0 | 0 |
| 10 | 0x333d…115a | no | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-04-20T13:27:12Z | 1 | false | 0 | 0 | 0 | 0 | 0 |
| 11 | 0x333d…115a | no | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-04-20T14:17:48Z | 7 | false | 0 | 0 | 0 | 0 | 0 |
| 12 | 0xcB0b…D5ac | no | 2 | DOCTOR2_PRIVATE_KEY | Open | 2026-04-22T14:28:48Z | 17 | false | 0 | 1 | 0 | 0 | 0 |
| 13 | 0x6b80…ab27 | no | 2 | DOCTOR2_PRIVATE_KEY | Open | 2026-04-23T10:03:12Z | 3 | false | 0 | 1 | 0 | 0 | 0 |
| 14 | 0x6b80…ab27 | no | 2 | DOCTOR2_PRIVATE_KEY | Open | 2026-04-28T13:29:00Z | 8 | false | 0 | 0 | 0 | 0 | 0 |
| 15 | 0x6b80…ab27 | no | 2 | DOCTOR2_PRIVATE_KEY | Open | 2026-04-28T13:33:12Z | 8 | false | 0 | 0 | 0 | 0 | 0 |
| 16 | 0x6b80…ab27 | no | 2 | DOCTOR2_PRIVATE_KEY | Open | 2026-04-28T13:35:00Z | 1 | false | 0 | 1 | 0 | 0 | 0 |
| 17 | 0x6b80…ab27 | no | 2 | DOCTOR2_PRIVATE_KEY | Open | 2026-04-28T14:00:12Z | 10 | false | 0 | 1 | 0 | 0 | 0 |
| 18 | 0x6b80…ab27 | no | 2 | DOCTOR2_PRIVATE_KEY | Open | 2026-04-28T14:10:24Z | 15 | false | 0 | 1 | 0 | 0 | 0 |
| 19 | 0x6b80…ab27 | no | 2 | DOCTOR2_PRIVATE_KEY | DoctorResponded | 2026-04-28T14:23:00Z | 27 | true | 3 | 1 | 0 | 1 | 0 |
| 20 | 0x6b80…ab27 | no | 2 | DOCTOR2_PRIVATE_KEY | Open | 2026-04-28T14:37:00Z | 22 | false | 0 | 1 | 0 | 0 | 0 |
| 21 | 0x6b80…ab27 | no | 2 | DOCTOR2_PRIVATE_KEY | DoctorResponded | 2026-04-28T14:43:00Z | 17 | true | 4 | 1 | 0 | 1 | 0 |
| 22 | 0x6b80…ab27 | no | 2 | DOCTOR2_PRIVATE_KEY | Open | 2026-04-28T15:46:48Z | 20 | false | 0 | 1 | 0 | 0 | 0 |
| 23 | 0xa89B…7132 | no | 1 | DOCTOR1_PRIVATE_KEY | Open | 2026-05-15T08:34:24Z | 3 | false | 0 | 3 | 0 | 0 | 0 |

## Transactions
| tx_hash | function | consult_id | sender | sender_roles | sender_is_mine | gas_used | block | block_time_utc | status | n_logs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0xa23c5463… | unknown |  | 0x7094…11b8 | admin; patient of #1,#2 | DEPLOYER_PRIVATE_KEY | 2169512 | 10658033 | 2026-04-14T12:37:00Z | ok | 0 |
| 0x0c8debf8… | addDoctor |  | 0x7094…11b8 | admin; patient of #1,#2 | DEPLOYER_PRIVATE_KEY | 278704 | 10658058 | 2026-04-14T12:42:00Z | ok | 1 |
| 0x31838190… | submitConsultation | 1 | 0x7094…11b8 | admin; patient of #1,#2 | DEPLOYER_PRIVATE_KEY | 2584049 | 10658264 | 2026-04-14T13:24:12Z | ok | 58 |
| 0x0f95efd0… | submitConsultation | 2 | 0x7094…11b8 | admin; patient of #1,#2 | DEPLOYER_PRIVATE_KEY | 624083 | 10658297 | 2026-04-14T13:30:48Z | ok | 10 |
| 0xbf55aaf9… | grantDoctorAccess | 2 | 0x7094…11b8 | admin; patient of #1,#2 | DEPLOYER_PRIVATE_KEY | 141603 | 10658300 | 2026-04-14T13:31:24Z | ok | 4 |
| 0x13a5758f… | submitConsultation | 3 | 0xcCb7…f6Be | patient of #3,#4,#5,#6,#8 | no | 863505 | 10664341 | 2026-04-15T10:58:24Z | ok | 16 |
| 0x0cb6e142… | grantDoctorAccess | 3 | 0xcCb7…f6Be | patient of #3,#4,#5,#6,#8 | no | 203167 | 10664344 | 2026-04-15T10:59:12Z | ok | 6 |
| 0x012665ca… | submitResponse | 3 | 0xb561…6806 | doctor 1 | DOCTOR1_PRIVATE_KEY | 492542 | 10665195 | 2026-04-15T14:04:24Z | ok | 10 |
| 0xcd537769… | closeConsultation | 3 | 0xcCb7…f6Be | patient of #3,#4,#5,#6,#8 | no | 32110 | 10665389 | 2026-04-15T14:48:36Z | ok | 1 |
| 0xfc0226c2… | submitConsultation | 4 | 0xcCb7…f6Be | patient of #3,#4,#5,#6,#8 | no | 734743 | 10676262 | 2026-04-17T06:49:24Z | ok | 13 |
| 0x48a8472c… | submitConsultation | 5 | 0xcCb7…f6Be | patient of #3,#4,#5,#6,#8 | no | 734719 | 10676292 | 2026-04-17T06:55:36Z | ok | 13 |
| 0xf8d1bf25… | grantDoctorAccess | 5 | 0xcCb7…f6Be | patient of #3,#4,#5,#6,#8 | no | 172385 | 10676294 | 2026-04-17T06:56:00Z | ok | 5 |
| 0x5988fcfd… | submitConsultation | 6 | 0xcCb7…f6Be | patient of #3,#4,#5,#6,#8 | no | 514432 | 10690040 | 2026-04-19T09:51:24Z | ok | 7 |
| 0x68864ec3… | grantDoctorAccess | 6 | 0xcCb7…f6Be | patient of #3,#4,#5,#6,#8 | no | 110821 | 10690042 | 2026-04-19T09:51:48Z | ok | 3 |
| 0xddb7f3be… | submitConsultation | 7 | 0x333d…115a | patient of #7,#9,#10,#11 | no | 422885 | 10697119 | 2026-04-20T12:45:00Z | ok | 4 |
| 0x1c542b8b… | grantDoctorAccess | 7 | 0x333d…115a | patient of #7,#9,#10,#11 | no | 80039 | 10697122 | 2026-04-20T12:45:36Z | ok | 2 |
| 0x4089e56a… | submitConsultation | 8 | 0xcCb7…f6Be | patient of #3,#4,#5,#6,#8 | no | 624083 | 10697180 | 2026-04-20T12:58:36Z | ok | 10 |
| 0x259eac3a… | grantDoctorAccess | 8 | 0xcCb7…f6Be | patient of #3,#4,#5,#6,#8 | no | 141603 | 10697183 | 2026-04-20T12:59:12Z | ok | 4 |
| 0xfc03b603… | submitConsultation | 9 | 0x333d…115a | patient of #7,#9,#10,#11 | no | 514396 | 10697264 | 2026-04-20T13:18:36Z | ok | 7 |
| 0xaeb45599… | grantDoctorAccess | 9 | 0x333d…115a | patient of #7,#9,#10,#11 | no | 110821 | 10697270 | 2026-04-20T13:19:48Z | ok | 3 |
| 0xdb907402… | submitConsultation | 10 | 0x333d…115a | patient of #7,#9,#10,#11 | no | 405761 | 10697305 | 2026-04-20T13:27:12Z | ok | 4 |
| 0x71f1adad… | submitConsultation | 11 | 0x333d…115a | patient of #7,#9,#10,#11 | no | 1072443 | 10697532 | 2026-04-20T14:17:48Z | ok | 22 |
| 0x0dfaa627… | addDoctor |  | 0x7094…11b8 | admin; patient of #1,#2 | DEPLOYER_PRIVATE_KEY | 196501 | 10710442 | 2026-04-22T14:14:00Z | ok | 1 |
| 0x5520915a… | submitConsultation | 12 | 0xcB0b…D5ac | patient of #12 | no | 2316200 | 10710500 | 2026-04-22T14:28:48Z | ok | 52 |
| 0xd6bd7d48… | grantDoctorAccess | 12 | 0xcB0b…D5ac | patient of #12 | no | 572551 | 10710502 | 2026-04-22T14:29:12Z | ok | 18 |
| 0x4cf2c2d7… | submitConsultation | 13 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 641183 | 10715762 | 2026-04-23T10:03:12Z | ok | 10 |
| 0x9c3992d1… | grantDoctorAccess | 13 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 141603 | 10715764 | 2026-04-23T10:03:36Z | ok | 4 |
| 0x88d89327… | submitConsultation | 14 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 1187108 | 10749403 | 2026-04-28T13:29:00Z | ok | 25 |
| 0x3b24a564… | submitConsultation | 15 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 1187444 | 10749420 | 2026-04-28T13:33:12Z | ok | 25 |
| 0x16939577… | submitConsultation | 16 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 405773 | 10749428 | 2026-04-28T13:35:00Z | ok | 4 |
| 0x308889e3… | grantDoctorAccess | 16 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 80039 | 10749431 | 2026-04-28T13:35:48Z | ok | 2 |
| 0x3d8421dc… | submitConsultation | 17 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 1419828 | 10749536 | 2026-04-28T14:00:12Z | ok | 31 |
| 0x8249d054… | grantDoctorAccess | 17 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 357077 | 10749540 | 2026-04-28T14:01:00Z | ok | 11 |
| 0xcf535ad2… | submitConsultation | 18 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 2018517 | 10749582 | 2026-04-28T14:10:24Z | ok | 46 |
| 0xded3a490… | grantDoctorAccess | 18 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 510987 | 10749587 | 2026-04-28T14:11:24Z | ok | 16 |
| 0x84137f31… | submitConsultation | 19 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 3559067 | 10749634 | 2026-04-28T14:23:00Z | ok | 82 |
| 0xc103a3e2… | grantDoctorAccess | 19 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 880371 | 10749636 | 2026-04-28T14:23:24Z | ok | 28 |
| 0xe8f6c66f… | submitResponse | 19 | 0x6C21…9423 | doctor 2 | DOCTOR2_PRIVATE_KEY | 492158 | 10749655 | 2026-04-28T14:27:24Z | ok | 10 |
| 0x3b871177… | submitConsultation | 20 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 2899331 | 10749702 | 2026-04-28T14:37:00Z | ok | 67 |
| 0xa2f868b4… | grantDoctorAccess | 20 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 726461 | 10749705 | 2026-04-28T14:37:48Z | ok | 23 |
| 0x33d6f42b… | submitConsultation | 21 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 2265068 | 10749729 | 2026-04-28T14:43:00Z | ok | 52 |
| 0xd12e2fe7… | grantDoctorAccess | 21 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 572551 | 10749733 | 2026-04-28T14:44:00Z | ok | 18 |
| 0x89e77ff4… | submitResponse | 21 | 0x6C21…9423 | doctor 2 | DOCTOR2_PRIVATE_KEY | 603203 | 10749752 | 2026-04-28T14:48:12Z | ok | 13 |
| 0xae73b0c7… | submitConsultation | 22 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 2642520 | 10750018 | 2026-04-28T15:46:48Z | ok | 61 |
| 0x8fe96531… | grantDoctorAccess | 22 | 0x6b80…ab27 | patient of #13,#14,#15,#16,#17,#18,#19,#20,#21,#22 | no | 664897 | 10750227 | 2026-04-28T16:35:12Z | ok | 21 |
| 0xc6dee698… | submitConsultation | 23 | 0xa89B…7132 | patient of #23 | no | 641183 | 10856267 | 2026-05-15T08:34:24Z | ok | 10 |
| 0xd77af21a… | grantDoctorAccess | 23 | 0xa89B…7132 | patient of #23 | no | 141603 | 10856268 | 2026-05-15T08:34:36Z | ok | 4 |
| 0x6309790c… | grantDoctorAccess | 23 | 0xa89B…7132 | patient of #23 | no | 81903 | 10856271 | 2026-05-15T08:35:12Z | ok | 4 |
| 0x48cfccc9… | grantDoctorAccess | 23 | 0xa89B…7132 | patient of #23 | no | 81903 | 10856474 | 2026-05-15T09:22:24Z | ok | 4 |

## Gas used per function (successful txs)
| function | n | min | median | max |
| --- | --- | --- | --- | --- |
| unknown | 1 | 2169512 | 2169512 | 2169512 |
| addDoctor | 2 | 196501 | 278704 | 278704 |
| submitConsultation | 23 | 405761 | 863505 | 3559067 |
| grantDoctorAccess | 19 | 80039 | 141603 | 880371 |
| submitResponse | 3 | 492158 | 492542 | 603203 |
| closeConsultation | 1 | 32110 | 32110 | 32110 |
