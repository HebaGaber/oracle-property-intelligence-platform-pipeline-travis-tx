# CR-A-11: consolidated code review (A-11 publish and runs)

Branch `011-publish-and-runs`. This file collects every A-11 review: the reviewer-agent scores (pass bar 75), the `/code-review medium` findings on the 2026-10-24 correction work, and where each finding was fixed or carried.

## 1. Reviewer-agent scores

### Original A-11 build (2026-10-23)

| Reviewer | File | First score | Re-review |
| --- | --- | --- | --- |
| donphan | [CR-A-11-donphan.md](CR-A-11-donphan.md) | 68/100 | 88/100 (after `4254044`) |
| porygon | [CR-A-11-porygon.md](CR-A-11-porygon.md) | 48/100 | 86/100 (after `4254044`) |

### Run 2 correction (2026-10-24)

| Reviewer | Scope | File | Score |
| --- | --- | --- | --- |
| oracle | County vs permits shared-files identity fix, stop check | [CR-A-11-oracle-identity-fix.md](CR-A-11-oracle-identity-fix.md) | 82/100 |
| machamp | Backfill, re-export, batch resume, publish driver | [CR-A-11-machamp-fix.md](CR-A-11-machamp-fix.md) | 80/100 |
| porygon | Run 2 counts and coverage | [CR-A-11-porygon-fix.md](CR-A-11-porygon-fix.md) | 80/100 |
| donphan | Run 2 published data vs Run 1 | [CR-A-11-donphan-fix.md](CR-A-11-donphan-fix.md) | 92/100 |

Reviewer findings already closed in A-11:

| Finding | Fixed in |
| --- | --- |
| oracle M1: permits path accepted a pre-fix stored copy | `1fc994a` |
| oracle M2: batch split reused by file names only | `1fc994a` |
| oracle M3: fingerprint missed output-shaping files | `1fc994a` |
| oracle L1: gate `NOT IN` NULL hole, no count required, local parts unhashed | `1fc994a` |
| porygon: Run 2 manifest carried Run 1's "(17387 rows)" | `03a6f29` (publish stopped before the manifest; rebuilt) |
| machamp M1: no index rollback on failed verification | `e42000e` |
| machamp M2: receipts/index not written atomically | `e42000e` |
| machamp M3: Release attached CARs without a hash check | `e42000e` |
| machamp M4 + lows: batch-script resume test, run locks, backfill summary label | `5c34ec5` |
| A-16 #6: permit-link reconciliation check (made required for real runs) | `5c34ec5`, `6dea9be` |

Reviewer findings carried to `stories/A-16-cost-and-admin.md` item #8 (Runs-page "superseded" cue, a code check for `permits_trade_sub_permit`, fingerprint from real imports, stray-folder removal, gateway-confirmation receipts).

## 2. `/code-review medium` on `421e888^..1ff21aa`

Scope: code only. `runs/`, logs, receipts and fixture JSON were excluded; the logs were grepped for credentials (none found). No verify pass was run on these findings.

| # | Severity | File:line | Finding | Status |
| --- | --- | --- | --- | --- |
| 1 | High | `pipeline/publish/src/gateway-readback.ts:136` | `gatewaysAgree` passes when one gateway confirms and the other is only "inconclusive" (403/429). Pinata blocks automated clients, so "both gateways" (AM-01) can pass on Filebase's own gateway alone, and the CLIs still print "both gateways served it back". | Open: needs a PO call on the verification policy (count Pinata 403/429 as unverified, or record "single-gateway" honestly). Ties to A-16 #4 |
| 2 | High | `pipeline/publish/src/manifest.ts:469` | `assertPermitLinkReconciliation` returns silently when any of the five exclusion keys is missing, or when the Austin source isn't found, so `requireLinkedPermits`' "always runs" can be bypassed. | Open: fail instead of skipping for a real run |
| 3 | Medium | `pipeline/local-stack/scripts/run-lock.ts:39` (same in `batch-hash-validate-export.sh` `acquire_lock`) | Stale-lock takeover is check-then-delete: two contenders can both take the lock and corrupt the hashed group directory. | Open: take over atomically (rename/link) |
| 4 | Medium | `pipeline/oracle-runtime/travis/permits/write-group.ts:133` | The permits path always passes the assembled coordinate. The County writer passes it only when coordinates are assembled (`tcad-backbone.ts:228`), and keeps an export point whose kind is null. Before GIS assembly the two groups' geometry would differ again. | Open: latent today (Run 2's DB is fully assembled; the identity gate passed). Mirror the County's `assembled` rule |
| 5 | Medium | `pipeline/publish/src/run-manifest.ts:187` | Stale-coverage detection fires only when `permits_emitted` changes. A correction with the same row count carries every other base coverage key unchanged. | Open → A-16 (Run 3+) |
| 6 | Medium | `pipeline/local-stack/scripts/reexport-permits.ts:332` | Folders for pIDs not in the current `--pids` list are never removed from the hashed group directory. | Carried: A-16 #8 (stray-folder removal). Run 2's group dir was checked by hand: 10,792 folders, no strays |
| 7 | Medium | `pipeline/local-stack/scripts/reexport-permits.ts:76` | The reuse fingerprint is a hand list of files plus `content_sha256`/`captured_at`; unlisted helpers or other `property_improvements` columns can change without invalidating a folder. | Carried: A-16 #8 (fingerprint from real imports) |
| 8 | Low | `pipeline/publish/src/gateway-readback.ts:39` | `readbackWhole` buffers whole CARs (~230 MB) per gateway under a fixed 300 s timeout. | Carried: A-16 #8 (gateway-confirmation receipts; stream the hash) |
| 9 | Low | `apps/web/src/engine/load-permits.ts:158` | The prefetch now waits for the duckdb-wasm chunk just to call `permitsPartNames`, putting that download before the parts fetch that ERR-17 ran in parallel. | Open: take `boundPartNames`/`PERMITS_VIEWS` from `@countylens/query-core`; matters for the 8 s first-load target |
| 10 | Low | `pipeline/publish/src/publish-run.ts:899` | When every CAR is reused from `--release-reuse-tag` and the run's own release doesn't exist, `release.json` still records the run's tag. | Not hit by Run 2 (5 new CARs, release created). Open → A-16 |

## 3. Summary

All six reviewer-agent scores pass the bar (latest: 88, 86, 82, 80, 80, 92). The `/code-review medium` pass found no defect in the published Run 2 data: the identity gate passed before upload and again from the CID copy. Findings #1 and #2 weaken checks that are meant to be hard guarantees, and #9 affects the first-load target. Each needs a fix in A-11 or an explicit carry decision before G7.
