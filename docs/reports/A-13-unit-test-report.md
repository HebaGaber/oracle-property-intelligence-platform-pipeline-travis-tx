---
id: UT-A-13
type: unit-test-report
story: A-13
branch: 013-explorer-and-pages
commit: 70561ec
ci_run: "None yet. Numbers are from local runs on the operator machine at 70561ec. No GitHub Actions run exists for this branch tip."
created: 2026-10-22
---

# Unit and Integration Test Report: A-13

All numbers come from local command output on 2026-10-22 (about 00:54 to 01:00 EEST, UTC+3) on branch `013-explorer-and-pages` at commit `70561ec`. The only modified file in the tree during the runs was `specs/013-explorer-and-pages/run-log.md`. These are **local unit tests only**. They do not prove the hosted runtime. The 73 hosted Playwright specs are written but **have not been run on any hosted URL** (see "Not measured").

Environment for every command (no credentials read):

```sh
export CDK_DEFAULT_REGION=eu-north-1 CDK_DEFAULT_ACCOUNT=000000000000 OPERATOR_EMAIL=ops@example.invalid
```

| Item | Value |
| --- | --- |
| Command | `pnpm test` (`vitest run --passWithNoTests`, all workspace projects) |
| Files / tests | 93 files / 1,326 tests |
| Passed / failed / skipped | 1,319 / 0 / 7 (92 files passed, 1 file skipped) |
| Duration | 15.86 s |
| Coverage, `packages/query-core` | src: lines 98.58 % · branches 90.39 % · functions 100 % · statements 96.43 %. gazetteer: lines 88.12 % · branches 81.16 % · functions 86.96 % · statements 85.83 %. **PASS** against 80 % on all four metrics in both parts |
| Coverage, `packages/contract` | 100 % lines, branches, functions, statements. **PASS** against 80 % |
| Coverage, whole workspace include set | lines 92.43 % · branches 81.58 % · functions 91.39 % · statements 90.06 % |
| `pnpm typecheck` | clean (no output, exit 0) |
| `pnpm lint` | clean (no output, exit 0) |
| Bundle size | initial JS 217.2 KB gz (222,431 B) against 300 KB limit, DuckDB chunks excluded: **PASS**. Hub graph 123.8 KB gz (126,732 B) against 150 KB: **PASS**. The Hub graph lists no DuckDB chunk |

## Coverage method and a caveat

The `@vitest/coverage-v8` provider is configured in the root `vitest.config.ts`. I ran `pnpm vitest run --coverage --coverage.reportOnFailure=true --coverage.reporter=json-summary` once over the whole workspace and summed covered and total counts per package from `coverage-summary.json` (the include set is in the root config). I did not use the `--filter` form: the project is one root Vitest workspace, so one run covers both packages.

**The coverage run is not fully green.** With `--coverage` on, 2 tests fail (1,322 passed, 2 failed, 7 skipped, 1,331 tests, run twice with the same result). Both are in `apps/web/test/app-shell.test.tsx`, ERR-12: `.toggle` and `.tab` report an empty CSS rule body (`.toggle {}`, `.tab {}`), so the "declares font: inherit" check fails. The same two tests pass in the plain `pnpm test` run. I did not investigate the cause: it looks like the coverage run reads the CSS Module differently, but that is a guess, not a finding. It does not touch the `packages/query-core` or `packages/contract` numbers above. Open item: find out why, or run coverage so the two runs agree, before G7.

## Per project (plain `pnpm test`, 93 files)

Coverage columns are from the coverage run (lines / branches). `n/a` means the project is not in the coverage include set.

| Project | Files | Passed | Skipped | Failed | Lines / branches |
| --- | --- | --- | --- | --- | --- |
| packages/query-core | 19 | 271 | 6 | 0 | src 98.58 / 90.39 · gazetteer 88.12 / 81.16 |
| packages/contract | 3 | 58 | 0 | 0 | 100 / 100 |
| packages/shared | 3 | 40 | 0 | 0 | 100 / 92.00 |
| packages/api-client | 1 | 4 | 0 | 0 | 83.33 / 71.43 |
| packages/eslint-config | 1 | 18 | 0 | 0 | n/a |
| apps/api | 8 | 164 | 0 | 0 | 93.68 / 80.87 |
| apps/web | 30 | 326 | 0 | 0 | 90.66 / 81.15 |
| infra | 7 | 93 | 1 | 0 | n/a |
| scripts | 3 | 73 | 0 | 0 | n/a |
| profiles/travis-austin@1.0.0 | 6 | 79 | 0 | 0 | 90.83 / 85.54 |
| pipeline/publish | 12 | 193 | 0 | 0 | 91.42 / 77.73 |
| **Total** | **93 (incl. 1 skipped file)** | **1,319** | **7** | **0** | 92.43 / 81.58 |

Per-project file counts add to 93 (the one all-skipped file is counted in its package). The 80 % requirement (NFR-09) covers only `packages/query-core` and `packages/contract`, and both pass. Below 80 % on one metric, not a story gate: `packages/api-client` (branches 71.43, functions 75.00) and `pipeline/publish` (branches 77.73). `pipeline/oracle-runtime` is its own npm project and was **not run** for this report.

## Skipped tests (7), each an explicit skip with a stated reason

| Test | Why it is skipped |
| --- | --- |
| `packages/query-core/test/explore.test.ts` › exploreSearchSql over the published run | `PUBLISHED_TABLES_DIR is not set`. It needs a local copy of the latest run's `tables/` fetched by CID. This is the only A-13 skip; it was not run in this report |
| `packages/query-core/test/carrier-emission.test.ts` › A-02-TC-004 | `PILOT_DIR is not set` |
| `packages/query-core/test/carriers.test.ts` › each carrier's pilot row exists | needs `PILOT_DIR` |
| `packages/query-core/test/sample.test.ts` › contract/v1 sample row-for-row | `PILOT_DIR is not set` |
| `packages/query-core/test/views.pilot.test.ts` › views over the pilot export (T058) | `PILOT_DIR is not set` |
| `packages/query-core/test/acceptance/a02.acceptance.test.ts` › A-02 pilot cases | `PILOT_DIR is not set` |
| `infra/test/api.test.ts` › `COUNTYLENS_BUNDLE=1` real asset holds the linux-arm64 DuckDB binary and httpfs | runs only with `COUNTYLENS_BUNDLE=1`; not run here |

## New and changed A-13 test files (git diff of `74d7235^..HEAD`)

Grouping by task group is by file name and content; the authoritative task-to-test map is `specs/013-explorer-and-pages/tasks.md` and `testplans/A-13-test-cases.md`.

**G1 data and query layer (new):** `packages/query-core/test/explore.test.ts`, `packages/query-core/test/places.test.ts`, `apps/api/test/explore.test.ts`, `apps/web/test/data-modules.test.ts`, `packages/shared/test/a13-labels.test.ts`. Changed: `infra/test/web.test.ts`, `infra/test/amplify-build.test.ts`; new `infra/test/web-stack.test.ts`.

**G2 Explorer (new, `apps/web/test/`):** `explore-filters.test.tsx`, `explore-owner.test.tsx`, `explore-permits.test.tsx`, `explore-sql.test.tsx`, `property.test.tsx`, `compare.test.tsx`, `county-select.test.tsx`, `error-banner.test.tsx`. Changed: `app-shell.test.tsx`.

**G3 content pages (new, `apps/web/test/`):** `hub.test.tsx`, `catalog.test.tsx`, `coverage.test.tsx`, `manifest.test.tsx`, `verify.test.tsx`, `runs-log.test.tsx`, `help-mcp.test.tsx`, `legal.test.tsx`, `coming-soon.test.tsx`, `coming-soon-entries.test.tsx`. Changed: `runs.test.tsx`.

**G4 e2e support (Vitest, local) and hosted specs:**
- Vitest unit tests for the e2e helpers (they run in `pnpm test`): `tests/e2e/lib/a13.test.ts`, `a13-routes.test.ts`, `a13-ui.test.ts`, `a13-vitals.test.ts`, `evidence-target.test.ts`; also `scripts/test/bundle-graph.test.ts`.
- Hosted Playwright specs, **written, not run on a hosted URL**: `tests/e2e/A-13-explorer.spec.ts`, `A-13-pages.spec.ts`, `A-13-perf.spec.ts`, `A-13-scan.spec.ts`, `A-13-verify.spec.ts`, `A-13-vitals.spec.ts` (73 specs per the task brief; I did not independently re-count them because `playwright test --list` needs the hosted-URL config). Changed: `tests/e2e/runs.spec.ts`.
- Test cases: `testplans/A-13-test-cases.md`.

## Tests written first (TDD)

Not re-verified for this report. The red-then-green order is recorded in the commits (`64733c9` wave 1, `0ac0d03` wave 2, `70561ec` wave 3) and `specs/013-explorer-and-pages/run-log.md`; I did not replay a failing-first run per task.

## Failures and flakes

| Test | Cause | Action |
| --- | --- | --- |
| `app-shell.test.tsx` ERR-12 `.toggle` and `.tab` (coverage run only) | CSS Module rule body reads empty under `--coverage`; passes without it. Cause not investigated | open, see caveat above |

## Not measured

- Hosted Playwright specs (73): not run; they need a deployed URL.
- `exploreSearchSql` over the published run in Vitest: skipped (`PUBLISHED_TABLES_DIR` unset). A separate measurement over the published run is in the demo-area note, not in this test run.
- `pipeline/oracle-runtime` tests, CDK bundled-asset test (`COUNTYLENS_BUNDLE=1`), pilot-export tests (`PILOT_DIR`).
- The bundle check read the existing `apps/web/dist` (built 2026-10-22 00:53, one minute before the test run); I did not rebuild it.
- Smeargle/Lighthouse, Web Vitals, a11y scans: Stage 6 on the hosted URL.
