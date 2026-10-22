---
id: UT-A-04
type: unit-test-report
story: A-04
branch: 004-property-backbone
commit: 79e21d0
ci_run: "Not a CI run (see docs/evidence/A-04.md § CI runs). Final numbers from local runs on the operator machine on 2026-10-22: oracle-runtime and query-core as recorded after the last fix commit 79e21d0; local-stack re-run with the real-Postgres integration test enabled (Docker up). First-pass numbers at 40fa2e2 (Docker stopped) are kept in the notes below."
created: 2026-10-22
---

# Unit and Integration Test Report: A-04

All numbers were copied from local command output on 2026-10-22, on branch `004-property-backbone` at `40fa2e2`, one command at a time. The runtime and query-core runs are offline Vitest runs (the no-network setup file makes any real fetch fail). The final local-stack run also ran the real-Postgres integration test (throwaway database `a04_test_*`, dropped afterwards), so it exercises migrations, the jsonb writes, GIS assembly and the link rules against a real database. Restate and every source are not exercised by unit tests; the live cases are in `docs/reports/A-04-test-report.md`.

Coverage: neither package configures a coverage block in `vitest.config.ts`. The runs used `npx vitest run --coverage --coverage.reporter=text`, which enables the installed V8 provider (`@vitest/coverage-v8`, present in `pipeline/oracle-runtime`; resolved from the workspace for `pipeline/local-stack`). The coverage report is not written into the repo.

| Item | Value |
| --- | --- |
| Command (runtime) | `cd pipeline/oracle-runtime && npx vitest run --coverage` |
| Command (local stack) | `cd pipeline/local-stack && npx vitest run --coverage` |
| Command (query-core) | `cd packages/query-core && npx vitest run` |
| Command (gates) | `bash scripts/grep-gates.sh` |
| Suites / tests | runtime 78 files / 969 tests · local-stack 118 tests · query-core 17 files / 242 tests |
| Passed / failed / skipped | runtime 967 / 0 / 2 · local-stack 116 / 0 / 2 (real-Postgres integration test enabled) · query-core 237 / 0 / 5 |
| grep-gates | `grep-gates: OK (5 gates ...)`, exit 0 |
| Coverage of new A-04 code | runtime: tcad 93.73% stmts, gis 93.10%, permits 95.99%, backbone 91.30% (see below); socrata-pages.ts 93.68%; local-stack 75.69% statements (tracks 94.97%, workflows 70.28%, loader 75.65%): **below the 80% target** for local-stack (Restate/bootstrap glue, exercised by the live runs) |
| Duration (first pass at 40fa2e2) | runtime 15.10 s · local-stack 2.01 s · query-core 2.61 s |

The 2 skipped runtime tests are the `A-04-TC-020 pilot|full` cases that read a real runner artifact; they run only with `GIS_ARTIFACT` set. With `GIS_ARTIFACT=pipeline/data/raw/gis/us-runner-39684063596/a04-gis-capture` and `--testTimeout=300000` they pass (see the test report); the default 5 s timeout is too short for the 373,683-feature read.

## Coverage on the new A-04 code (V8, statements / branches / functions / lines)

Folder rows (runtime, `pipeline/oracle-runtime`):

| Folder | Stmts | Branch | Funcs | Lines |
| --- | --- | --- | --- | --- |
| travis/tcad | 93.73 | 77.24 | 93.93 | 95.39 |
| travis/gis | 93.10 | 79.33 | 91.35 | 95.28 |
| travis/permits | 95.99 | 87.79 | 98.93 | 97.07 |
| travis/backbone | 91.30 | 83.07 | 79.54 | 93.86 |
| travis/adapters/socrata/socrata-pages.ts | 93.68 | 85.71 | 100 | 95.34 |
| whole runtime | 86.37 | 74.67 | 83.81 | 88.46 |

Local stack (`pipeline/local-stack/services`). Folder rows below are from the first pass at 40fa2e2 (before the real-Postgres test was enabled); the final run raised the whole-package statement figure to 75.69% (tracks 94.97%, workflows 70.28%, loader 75.65%):

| Folder / file | Stmts | Branch | Funcs | Lines |
| --- | --- | --- | --- | --- |
| services (app, configured-db, loader, migrate, report) | 64.61 | 64.11 | 48.57 | 65.95 |
| services/report-sections | 47.66 | 56.48 | 36.84 | 49.48 |
| services/tracks | 88.16 | 70.19 | 92.85 | 88.81 |
| services/workflows (only tcad-backbone.ts, tcad-chunk.ts loaded) | 70.28 | 58.19 | 66.12 | 72.97 |
| whole local-stack (final run, real-Postgres test enabled) | 75.69 | n/a | n/a | n/a |

### Files below 80% statements (honest list)

| File | Stmts | Why it is low |
| --- | --- | --- |
| `travis/tcad/export-source.ts` | 37.5 | Reads the real export file on disk; only the fake paths are unit-tested |
| `travis/backbone/commands/pilot.ts` | 51.72 | Pilot command wiring runs against the real stack |
| `local-stack/services/configured-db.ts` | 6.66 | Opens the real Postgres connection (needs Docker) |
| `local-stack/services/migrate.ts` | 42.3 | Runs migrations on a real database |
| `local-stack/services/report-sections/permits.ts` | 26.08 | Report SQL against the Query DB |
| `local-stack/services/report-sections/gis.ts` | 44.73 | Report SQL against the Query DB |
| `local-stack/services/app.ts` | 65.11 | HTTP bootstrap on :9080 |
| `local-stack/services/report.ts` | 72.00 | Report SQL against the Query DB |
| `local-stack/services/tracks/gis.ts` | 65.33 | Import path with real tables |
| `local-stack/services/workflows/tcad-backbone.ts` | 67.39 | Restate context paths |
| `local-stack/test/fixtures/**` (a.ts, c.ts, fake-backbone.ts) | 50-75 | Test fixtures, not product code |

`local-stack/services/workflows/austin-permits.ts` and `gis-import.ts` do not appear in the coverage table at all (no test imports them), so the local-stack figure above is generous. Runtime files at or above 80% include every file under `travis/tcad` (other than export-source.ts), `travis/gis` (lowest `runner-fetch.ts` 81.01, `assemble-coordinates` 96.81) and `travis/permits`. `travis/backbone/commands/coords.ts` is 80.95.

Reading: the new runtime code meets the 80% target (every folder 91-96% statements). The local-stack service layer is 75.69% in the final run (72.42% in the first pass without the real-Postgres test) and stays below the 80% target; the remaining gap is the Restate and bootstrap glue (`app.ts`, `workflows/tcad-backbone.ts`, `austin-permits.ts`, `gis-import.ts`), which the live runs exercise (see the test report) and unit tests do not.

## Tests written first (TDD)

Not re-verified in this run. The failed-first evidence is in `specs/004-property-backbone/run-log.md` and `tasks.md`; this report does not restate it.

## Failures and flakes

| Test | Cause | Action |
| --- | --- | --- |
| none in the three Vitest runs or the gates script | | |
| `A-04-TC-020 full` with `GIS_ARTIFACT` and the default timeout | 5 s default test timeout is too short to read 373,683 features | Re-ran with `--testTimeout=300000`: passed. Not a product defect; set the timeout in the test (`it(..., 300_000)`) if the case is to run unattended |
