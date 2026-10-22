---
id: QC-RPT-A-04
type: test-execution-report
feature: FEAT-A04
story: A-04
test_cases: testplans/A-04-test-cases.md
runtime_url: "not applicable: pipeline-only story (ui: false); see testplans/A-04-test-cases.md § 3.1"
build: "40fa2e2 (branch 004-property-backbone, clean working tree)"
data_snapshot: "TCAD export SHA-256 6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346; GIS runner run 39684063596 (373,683 features)"
owner: HebaGaber             # QC Lead
status: Draft                # DRAFT: DB-dependent cases pending until Docker is back
gate: G7
created: 2026-10-22
signed_off_date:
---

# QC Test Report: A-04 Load the county backbone (DRAFT)

**DRAFT: DB-dependent cases pending until Docker is back.** This draft records only what could run on 2026-10-22 without Docker, Restate, Postgres or the network (Docker Desktop is stopped on purpose). Cases that need the Query DB are marked PENDING-DB; cases that call Austin, GitHub or an IPFS gateway are marked PENDING-NETWORK. Nothing was started: no ingest, hash or validate job ran.

**Status words.** PASS: every step of the case ran offline and met the expected result. PASS-PARTIAL: the offline steps (a named Vitest test and/or a file-only command) met the expected result; the remaining steps need the Query DB or the network and are still to run. A PASS-PARTIAL case is not counted as validated until those steps run. FAIL: an offline step did not meet the plan.

**How cases ran.** One command at a time. Both Vitest packages ran once with `-t "A-04-TC-" --reporter=json` and each test was mapped to its case by the id in its name (a test whose title names two cases counts for both). TC-020 was re-run with `GIS_ARTIFACT` set to the stored runner artifact. File-only checks (TC-015 step 2, TC-025 step 3, TC-047 step 2, TC-NF-02, TC-NF-03) ran as the plan's exact shell commands from the repo root, step 0 `git rev-parse --abbrev-ref HEAD` printing `004-property-backbone`.

## Summary

| Item | Value |
| --- | --- |
| Environment | local terminal, branch `004-property-backbone`, commit `40fa2e2`, 2026-10-22; no hosted runtime (pipeline-only story, C-05 exception) |
| Total TC in plan | 52 (49 functional + 3 NF) |
| Counts | PASS 17 · PASS-PARTIAL 18 · FAIL 1 · PENDING-DB 14 · PENDING-NETWORK 2 |
| Passed / failed / pending | 35 (of which 18 partial) / 1 / 16 |
| Pass rate (executed offline) | 35 of 36 cases that could run = 97% (not a G7 figure: 18 are partial and 16 have not run) |
| Open Critical defects | 0 (ERR-21 is Low) |
| Unit test report | `docs/reports/A-04-unit-test-report.md` |
| Code review log | `docs/reviews/CR-A-04.md` |
| Playwright run | not applicable (no UI); C-09 maps each case to a named Vitest test or shell command |

## Results

| TC ID | AC | Type | Status | Evidence pointer |
| --- | --- | --- | --- | --- |
| A-04-TC-001 | AC-1 | Happy path | PENDING-DB | Needs `pilot` run + Query DB (`qdb_ro`). Not run. |
| A-04-TC-002 | AC-1 | Happy path | PASS-PARTIAL | `tcad-backbone.test.ts` -t TC-002: 3 passed (step 3). Steps 1-2 need the pilot output and `elephant-cli validate` (IPFS fetch): PENDING-NETWORK. |
| A-04-TC-003 | AC-1 | Negative | PENDING-DB | Query DB counts for geoID 0208011301. Not run. |
| A-04-TC-004 | AC-1 | Happy path | PASS-PARTIAL | `join-proof.test.ts` -t TC-004: 3 passed. Steps 1-3 (qdb_ro, `--join-proof` on full job) PENDING-DB. |
| A-04-TC-005 | AC-2 | Scale | PENDING-DB | Full-county ingest + `qdb_ro` + report. Not run. |
| A-04-TC-006 | AC-2 | Scale | PENDING-DB | `restate sql` + `qdb_ro`. Not run. |
| A-04-TC-007 | AC-2/FR-018 | Edge | PASS-PARTIAL | `tcad-backbone.test.ts` -t TC-007: 1 passed (step 1). Step 2 PENDING-DB. |
| A-04-TC-008 | FR-019 | Edge | PASS-PARTIAL | `tcad-backbone.test.ts` -t TC-008: 1 passed. Step 2 PENDING-DB. |
| A-04-TC-009 | FR-019 | Edge | PASS-PARTIAL | `tcad-backbone.test.ts` -t TC-009: 1 passed. Step 2 PENDING-DB. |
| A-04-TC-010 | AC-3 | Happy path | PASS-PARTIAL | `owner-area.test.ts` -t TC-010: 2 passed. Steps 2-3 PENDING-DB. |
| A-04-TC-011 | AC-3 | Negative / missing data | PASS-PARTIAL | `owner-area.test.ts` -t TC-011: 4 passed. Step 2 PENDING-DB. |
| A-04-TC-012 | AC-4 | Missing data | PASS-PARTIAL | `tenure.test.ts` -t TC-012: 2 passed. Query DB step PENDING-DB. |
| A-04-TC-013 | AC-4 | Missing data | PASS-PARTIAL | `tenure.test.ts` -t TC-013: 4 passed. Query DB step PENDING-DB. |
| A-04-TC-014 | AC-5 | Security | PASS | `confidential.test.ts` -t TC-014: 2 passed (step order, redaction, limitations). |
| A-04-TC-015 | AC-5 | Security / negative | PASS-PARTIAL | Step 2: sentinel grep over temp dir (from TC-014 `.path`), `pipeline/data/artifacts`, `pipeline/data/runs`, `docs` printed `0`. Step 3 (`qdb_ro`) PENDING-DB. |
| A-04-TC-016 | AC-6 | Negative / error | PASS | `probes/tcad.test.ts` + `workflow.blocked-a04.test.ts` -t TC-016: 6 passed. |
| A-04-TC-017 | AC-6 | Security | PASS | `workflow.blocked-a04.test.ts` -t TC-017: 5 passed. |
| A-04-TC-018 | FR-025 | Negative / harness | PASS-PARTIAL | `cli.test.ts` + local-stack `loader.test.ts` -t TC-018: 7 passed. `qdb_ro` check PENDING-DB. |
| A-04-TC-020 | AC-7/8 | Scale | PASS-PARTIAL | Step 1 workflow tests: 5 passed. Steps 4 and 6 run offline on the stored runner artifact `pipeline/data/raw/gis/us-runner-39684063596/a04-gis-capture` (mode full, 373,683 features, 187 pages, 2,000/page, concurrency 2, loc=US): 9 passed with `--testTimeout=300000` (the default 5 s times out on the 373k-feature read). Push and `gh run` steps (2, 3, 5) not re-run (network); runner run recorded in run-log.md. |
| A-04-TC-021 | AC-7 | Negative | PENDING-DB | `qdb_ro` + report. Not run. |
| A-04-TC-022 | AC-7 | Happy path | PENDING-DB | `coords` + `qdb_ro`. Not run. |
| A-04-TC-023 | AC-8 | Scale / missing data | PENDING-DB | `qdb_ro` + table export + `coords --coverage`. Not run (note: run-log records coverage SQL both ways PASS at 15fb323). |
| A-04-TC-024 | AC-9 | Happy path | PASS-PARTIAL | `coordinates.test.ts` -t TC-024: 1 passed. `qdb_ro` step PENDING-DB. |
| A-04-TC-025 | AC-10 | Missing data / negative | PASS-PARTIAL | `coordinates.test.ts` -t TC-025: 1 passed (step 1). Step 3 geocoder grep over `pipeline/oracle-runtime/travis` printed `0`. Step 2 (`qdb_ro`) PENDING-DB. |
| A-04-TC-026 | AC-11 | Error / negative | PASS | `gis-adapter.test.ts`, `gis-artifact.test.ts`, local-stack `tracks/gis.test.ts` -t TC-026: 5 passed. |
| A-04-TC-027 | AC-11 | Error | PASS | `gis-adapter.test.ts` -t TC-027: 2 passed. |
| A-04-TC-028 | AC-11 | Performance | PASS | `gis-adapter.test.ts` -t TC-028: 2 passed. |
| A-04-TC-029 | FR-020 | Edge | PASS-PARTIAL | `coordinates.test.ts` -t TC-029: 2 passed. Report step PENDING-DB. |
| A-04-TC-030 | FR-020 | Edge | PASS-PARTIAL | `coordinates.test.ts` -t TC-030: 1 passed. `qdb_ro` step PENDING-DB. |
| A-04-TC-031 | FR-020 | Edge | PASS | `coordinates.test.ts` -t TC-031: 3 passed. |
| A-04-TC-032 | AC-7 | Negative | PENDING-DB | `qdb_ro` + report. Not run. |
| A-04-TC-033 | AC-8 | Edge | PASS-PARTIAL | `coordinates.test.ts` -t TC-033: 1 passed. `qdb_ro` + report PENDING-DB. |
| A-04-TC-040 | AC-12 | Scale | PENDING-NETWORK | Real Austin backfill (calls Austin). Offline `permits-backfill.test.ts` -t TC-040: 3 passed (not the case itself). |
| A-04-TC-041 | AC-12/17 | Pipeline | PASS | `permits-backfill.test.ts` -t TC-041: 2 passed. |
| A-04-TC-042 | AC-13 | Scale | PENDING-DB | `qdb_ro` link rate. Not run. |
| A-04-TC-043 | AC-13 | Pipeline / missing data | PENDING-DB | `qdb_ro`. Not run. Offline analogue local-stack `tracks/permits.test.ts` -t TC-043: 1 passed (geoID link, `no_tcad_geoid` kept). |
| A-04-TC-044 | AC-13 | Pipeline | PASS | `permit-link.test.ts` -t TC-044: 12 passed. |
| A-04-TC-045 | AC-14 | Pipeline | PENDING-DB | Report + `qdb_ro` vs 2026-10-19 baseline. Not run. Offline analogue `profile-edge.test.ts` -t TC-045: 1 passed. |
| A-04-TC-046 | AC-14/16 | Pipeline | PENDING-DB | `qdb_ro`. Not run. Offline analogues `open-days.test.ts` and local-stack `tracks/permits.test.ts` -t TC-046: 2 passed (open_days 16,191 for 1982-06-23). |
| A-04-TC-047 | AC-14 | Edge | PASS | `profile-edge.test.ts` -t TC-047: 6 passed (step 1). Step 2 grep for REROOF/RE-ROOF in permits code + socrata-pages.ts printed `0`. |
| A-04-TC-048 | AC-15 | Pipeline | PENDING-DB | Report. Not run. Offline analogues `jurisdictions.test.ts` and local-stack `tracks/permits.test.ts` -t TC-048: 5 passed. |
| A-04-TC-049 | AC-15/FR-022 | Edge | PENDING-DB | `qdb_ro` + report. Not run. Offline analogue `permit-link.test.ts` + local-stack: 3 passed. |
| A-04-TC-050 | AC-16 | Missing data | PASS-PARTIAL | `open-days.test.ts` -t TC-050: 5 passed. `qdb_ro` step PENDING-DB. |
| A-04-TC-051 | AC-16 | Error / edge | PASS | `permits-incremental.test.ts` -t TC-051: 6 passed. |
| A-04-TC-052 | AC-16 | Pipeline | PENDING-NETWORK | Real incremental run (calls Austin) + `qdb_ro`. Not run. |
| A-04-TC-053 | AC-17 | Error / negative | PASS | `permits-backfill.test.ts` -t TC-053: 4 passed. |
| A-04-TC-054 | AC-17 | Error | PASS | `permits-backfill.test.ts` -t TC-054: 1 passed. |
| A-04-TC-055 | FR-021 | Edge | PASS | `permits-incremental.test.ts` + local-stack `tracks/permits.test.ts` -t TC-055: 3 passed. |
| A-04-TC-056 | FR-021 | Edge | PASS | `permits-incremental.test.ts` + local-stack `tracks/permits.test.ts` -t TC-056: 3 passed. |
| A-04-TC-NF-01 | AC-8/12 | Performance | PASS | `source-limits.test.ts` -t TC-NF-01: 3 passed. |
| A-04-TC-NF-02 | FR-024 | Security | PASS | Steps 1-3 each printed `0`; step 4 `bash scripts/grep-gates.sh` printed `grep-gates: OK (5 gates ...)`, exit 0. |
| A-04-TC-NF-03 | FR-007 | Security / harness | FAIL | Step 1 `0` PASS. Step 2 printed `colo=MSP` and `loc=US` (plan expects exactly `loc=US`). Step 3 printed `1` (plan expects `0`): `travis/lib/source-client.ts:83` holds a per-host concurrency-policy entry, not a request. See ERR-21 (test-plan imprecision, no GIS request left the laptop). |

## Non-functional results

| TC ID | NFR | Tool | Result | Actual | Threshold |
| --- | --- | --- | --- | --- | --- |
| A-04-TC-NF-01 | Throughput recording (NFR-006) | Vitest `source-limits.test.ts` | PASS | 3 passed | page count, duration, throughput recorded |
| A-04-TC-NF-02 | Security (P0-1, P0-2) | grep + `scripts/grep-gates.sh` | PASS | 0 / 0 / 0, gates OK | all 0, exit 0 |
| A-04-TC-NF-03 | Harness rule (ARD § 8) | grep over receipts and code | FAIL (plan imprecision) | step 1 = 0; step 2 = `colo=MSP` + `loc=US`; step 3 = 1 | 0; exactly `loc=US`; 0 |
| TC-020 runner artifact | NFR-004 / AC-8 | Vitest on stored artifact | PASS | 187 pages, 373,683 features, 2,000 per page, concurrency 2, loc=US | pages = ceil(count/2,000); concurrency <= 2 |

## Defects

| ERR | TC | Severity | Status | Fix commit |
| --- | --- | --- | --- | --- |
| ERR-21 | A-04-TC-NF-03 | Low | Open (test-plan wording; no code defect found) | |

## Still to run when Docker and the network are back

- PENDING-DB (14): TC-001, 003, 005, 006, 021, 022, 023, 032, 042, 043, 045, 046, 048, 049.
- PENDING-NETWORK (2): TC-040 (full Austin backfill), TC-052 (real incremental run).
- DB or network steps of the PASS-PARTIAL cases: the `qdb_ro` steps of TC-004, 007, 008, 009, 010, 011, 012, 013, 015, 018, 024, 025, 029, 030, 033, 050; `elephant-cli validate` of TC-002; the `git push` and `gh run` steps of TC-020.

## Sign-off

**Decision:** pending. Not a G7 report until the PENDING cases and the partial steps have run, and ERR-21 is dispositioned.
