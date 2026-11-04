# Sepolia preflight: direct relayer requests (v2, no gas)

Run 2026-11-04T10:59:10Z · block 12061975 · base fee 1.6e-8 gwei · relayer https://relayer.testnet.zama.org/v2/delegated-user-decrypt

| id | path | case | acl | verdict | http | label | message | shares | seconds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | raw relayer | no delegation (valid permit) | delegated=false delegatorAllowed=true | REFUSED_SERVER | POST:202 GET:400 | not_allowed_on_host_acl | Not allowed on host ACL: ACL check failed for 1 handle(s): handle=0x6e277577…0500 check=isHandleDelegatedForUserDecryption | 0 | 2.2 |
| P2 | raw relayer | same, corrupted signature | delegated=false delegatorAllowed=true | REFUSED_SERVER | POST:202 GET:400 | not_allowed_on_host_acl | Not allowed on host ACL: ACL check failed for 1 handle(s): handle=0x6e277577…0500 check=isHandleDelegatedForUserDecryption | 0 | 2.2 |
| P3 | @zama-fhe/sdk | no delegation | delegated=false delegatorAllowed=true | REFUSED | (none: client-side) | DelegationNotFoundError | No act…7D59 | 0 | 0.3 |

## Raw HTTP exchanges

- P1 POST 202 (85 ms): `{"status":"queued","requestId":"1bb68ca7-0d08-402b-b2b6-92a5e7ec6574","result":{"jobId":"a395d4ae-c390-41e6-98e1-ec319fe7ec4c"}}`
- P1 GET 400 (70 ms): `{"status":"failed","requestId":"690d8f25-2eae-48a1-bb82-eda2d425daac","error":{"label":"not_allowed_on_host_acl","message":"Not allowed on host ACL: ACL check failed for 1 handle(s): handle=0x6e277577…0500 check=isHandleDelegatedForUserDecryption"}}`
- P2 POST 202 (170 ms): `{"status":"queued","requestId":"9d71f2dc-9643-4629-aef1-7df9a7320186","result":{"jobId":"8ab5ef7c-8c7a-4925-b51d-cfd7dea0a861"}}`
- P2 GET 400 (66 ms): `{"status":"failed","requestId":"683e5134-7125-42d0-beaa-9ab54c8b931d","error":{"label":"not_allowed_on_host_acl","message":"Not allowed on host ACL: ACL check failed for 1 handle(s): handle=0x6e277577…0500 check=isHandleDelegatedForUserDecryption"}}`
