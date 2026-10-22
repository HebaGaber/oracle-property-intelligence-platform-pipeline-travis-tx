---
id: UT-A-04
type: unit-test-report
story: A-04
branch: 004-property-backbone
commit: 40fa2e2
ci_run: "Not a CI run. Numbers are from local runs on the operator machine at 40fa2e2 on 2026-10-22 (Docker stopped; no database, Restate or network used)."
created: 2026-10-22
---

# Unit and Integration Test Report: A-04

All numbers were copied from local command output on 2026-10-22, on branch `004-property-backbone` at `40fa2e2`, one command at a time. These are offline Vitest runs (the no-network setup file makes any real fetch fail). They do not exercise the Query DB, Restate or any source. The DB-dependent cases are in `docs/reports/A-04-test-report.md` (marked PENDING-DB).

Coverage: neither package configures a coverage block in `vitest.config.ts`. The runs used `npx vitest run --coverage --coverage.reporter=text`, which enables the installed V8 provider (`@vitest/coverage-v8`, present in `pipeline/oracle-runtime`; resolved from the workspace for `pipeline/local-stack`). The coverage report is not written into the repo.

| Item | Value |
| --- | --- |
| Command (runtime) | `cd pipeline/oracle-runtime && npx vitest run --coverage` |
| Command (local stack) | `cd pipeline/local-stack && npx vitest run --coverage` |
| Command (query-core) | `cd packages/query-core && npx vitest run` |
| Command (gates) | `bash scripts/grep-gates.sh` |
| Suites / tests | runtime 77 files / 962 tests · local-stack 16 files / 118 tests · query-core 17 files / 242 tests |
| Passed / failed / skipped | runtime 960 / 0 / 2 · local-stack 115 / 0 / 3 · query-core 237 / 0 / 5 |
| grep-gates | `grep-gates: OK (5 gates ...)`, exit 0 |
| Coverage of new A-04 code | runtime: tcad 93.73% stmts, gis 93.10%, permits 95.99%, backbone 91.30% (see below); socrata-pages.ts 93.68%; local-stack services (whole folder) 72.42%: **below the 80% target** for local-stack |
| Duration | runtime 15.10 s · local-stack 2.01 s · query-core 2.61 s |

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

Local stack (`pipeline/local-stack/services`):

| Folder / file | Stmts | Branch | Funcs | Lines |
| --- | --- | --- | --- | --- |
| services (app, configured-db, loader, migrate, report) | 64.61 | 64.11 | 48.57 | 65.95 |
| services/report-sections | 47.66 | 56.48 | 36.84 | 49.48 |
| services/tracks | 88.16 | 70.19 | 92.85 | 88.81 |
| services/workflows (only tcad-backbone.ts, tcad-chunk.ts loaded) | 70.28 | 58.19 | 66.12 | 72.97 |
| whole local-stack | 72.42 | 63.79 | 65.39 | 73.85 |

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

Reading: the new runtime code meets the 80% target (every folder 91-96% statements). The local-stack service layer is 72.42% overall and below target; the gap is almost entirely code that needs a real Postgres or Restate (listed above) and is covered by the PENDING-DB cases, not by unit tests.

## Tests written first (TDD)

Not re-verified in this run. The failed-first evidence is in `specs/004-property-backbone/run-log.md` and `tasks.md`; this report does not restate it.

## Failures and flakes

| Test | Cause | Action |
| --- | --- | --- |
| none in the three Vitest runs or the gates script | | |
| `A-04-TC-020 full` with `GIS_ARTIFACT` and the default timeout | 5 s default test timeout is too short to read 373,683 features | Re-ran with `--testTimeout=300000`: passed. Not a product defect; set the timeout in the test (`it(..., 300_000)`) if the case is to run unattended |
