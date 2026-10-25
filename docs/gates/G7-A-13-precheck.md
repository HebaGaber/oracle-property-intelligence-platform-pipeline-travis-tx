---
gate: G7
artifact: A-13 (branch 013-explorer-and-pages)
artifact_version: "code dc46a6d (docs-only commits after it); CI run 40185511164 success; merged with feature/oracle-pipeline at 3749547"
run_date: 2026-10-25
tool: Claude
verdict: FAIL
---

# G7 pre-check (run 2, on the full county): A-13 Explorer UI with its hub, legal, catalog and Coming soon pages

Inputs read: `specs/013-explorer-and-pages/tasks.md`; `docs/reports/A-13-unit-test-report.md`, `A-13-test-report.md`; `docs/reviews/CR-A-13.md`; `docs/defects/`; `docs/evidence/A-13.md`; `git log feature/oracle-pipeline..013-explorer-and-pages` (41 commits); `gh run view 40185511164`; `docs/decisions/DEC-A-13-explore-full-county.md`; `stories/A-16-cost-and-admin.md`. The first G7 run (2026-10-22, PASS 10/10 on the 14-property slice) is kept at the end of this file. This run re-checks the branch after the merge with A-04, A-07 and A-11 and the hosted re-test on Run 2.

**Verdict: FAIL, 4 checks (C-03, C-05, C-07, C-08), all bookkeeping and review gaps that can be fixed without new product work. C-04 passes only with the PO exception recorded in `DEC-A-13-explore-full-county.md`.**

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | PASS | `tasks.md`: 54 ticked, 0 open. |
| C-02 | Unit tests | PASS | CI run 40185511164 (code `dc46a6d`): `workspace` (typecheck, lint, unit tests, synth, coverage gates) and `oracle-runtime` success. Local: web 506 passed, e2e harness 92, infra 104, publish 345. New code (`catalogTables` grouping, `bindAllViews`, `publishedTexts`) is covered by the web and harness tests. |
| C-03 | Code review | FAIL | `CR-A-13.md` scores (metagross 77, audino 82, 0 open Critical) date from 2026-10-22 and cover the branch before the merge. These changed afterwards and were never reviewed: `catalogTables` (batched tables), `bindAllViews` in `ExploreSql.engine.ts`, `retry: false` in `ExploreFilters.tsx`, `tabIndex={0}` on `<main>`, API DuckDB limit 2 GB and Lambda timeout 29 s (`infra/src/api-stack.ts`). Fix: one `/code-review medium` on `git diff 3749547^1..HEAD -- apps packages infra` plus both reviewers scoring that delta, appended to `CR-A-13.md`. |
| C-04 | TC executed on hosted URL | PASS with PO exception | All 73 cases ran against the preview with build `dc46a6d`, none on localhost: 44 passed, 0 failed, **29 are parked (skipped with a reason)**: Explore search 21 (A-16 gap 1), SQL first query 6 (gap 2), page speed 2 (gap 3). The parked cases have no passing result on Run 2; the PO accepted this on 2026-10-25 ("go to option 3 and document the gaps in a16"). Demo lines D-8 and D-9 are therefore not proven on live full-county data. |
| C-05 | Defects closed | FAIL | The failing cases are gap-linked (allowed), but the real defects found and fixed on Run 2 have no `ERR` record: Catalog showed no tables for batched runs; the browser SQL engine bound only `v_roofing_permit` (so `v_property` was missing); `<main>` not keyboard-focusable (axe `scrollable-region-focusable`, `/runs/log`); Explore search retried a timed-out call and kept the page loading about 59 s. `docs/defects/` ends at ERR-55. Fix: ERR-56 to ERR-59 with cause, fix commit and re-test (CI run 40185511164). |
| C-06 | No open Critical | PASS | No Critical defect or review finding is open. The Explore search failure is High, accepted as a gap, and tracked in A-16. |
| C-07 | Evidence | FAIL | `docs/evidence/A-13.md` has the URL, build, CI results and parked list for Run 2, but the screenshots (`docs/evidence/img/`, 368 files) and the CloudWatch line and X-Ray trace id (`1-6ad9d23c-…`, an `explore.search` call) are all from the pilot slice. `explore.search` now fails, so that trace is not a Run 2 proof. Fix: capture Run 2 screenshots of Hub, Runs, Coverage, Catalog, Manifest and Verify, and one CloudWatch line plus X-Ray trace id for a call that works on Run 2 (for example `runs.summary`). |
| C-08 | Traceability | FAIL | `docs/traceability.md` G7 row for A-13 still reads "code `2cc58ac`, CI run 39835352646 … merge waits for A-11". `docs/kit-usage.md` rows are complete. Fix: replace the row with this run (code `dc46a6d`, CI run 40185511164, 44 pass, 29 parked, PO exception) after the decision. |
| C-09 | Commits | PASS | All 41 commits since the feature tip start with `A-13:`; gitleaks green on every run. |
| C-10 | Story status | PASS | Front matter `status: Done (G7 approved 2026-10-22; merge … waits for A-11)`. Ready to be updated to Done with the merge once G7 is decided again. |

## Fix list (ordered by impact on the assessment score)

1. **C-07** Run 2 screenshots and a Run 2 trace id: what the evaluator opens first.
2. **C-05** ERR-56 to ERR-59.
3. **C-03** Review of the post-merge delta.
4. **C-08** G7 row, after your decision.

## PO decision (G7, second run)

☐ Approved · ☐ Returned · date: ______ (the 2026-10-22 approval below was for the slice and its merge was held for A-11; it does not cover this state)

---

## First G7 run, 2026-10-22 (history)


Inputs read: `specs/013-explorer-and-pages/tasks.md`; `docs/reports/A-13-unit-test-report.md`, `A-13-test-report.md`; `docs/reviews/CR-A-13.md`; `docs/defects/ERR-50` to `ERR-49`; `docs/evidence/A-13.md` and its detail files; `git log`; GitHub Actions run 39835352646. This report finds gaps; it does not approve.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | PASS | `tasks.md`: 54 tasks ticked, 0 open (T001–T048 incl. the Convergence phase T046–T048, TZ01–TZ06, Polish T044–T045), each Phase Z task with its recorded outcome. |
| C-02 | Unit tests | PASS (fixed in this run) | Was FAIL: the report said "no CI run". Now: CI run 39835352646 (commit 2c13e09, code 2cc58ac) success: `workspace` job (typecheck, lint, test, synth) green; local `pnpm test` 1,489 passed / 0 failed / 8 skipped; coverage gates in CI: `packages/contract` 100 %, `packages/query-core` 96.19 % lines / 88.25 % branches (≥ 80 %). New code (`explore.ts`, `places.ts`, web data modules) is covered by the 273 query-core and 449 web tests. |
| C-03 | Code review | PASS | `CR-A-13.md`: `/code-review` medium (8 findings), metagross **77**, audino **82** (both ≥ 75), 0 open Critical; every Major fixed, the rest fixed or recorded with a reason. |
| C-04 | TC executed on the hosted URL | PASS (with the A-11 exception below) | Every one of the 73 TCs has a result against the Amplify preview of `013-explorer-and-pages` with a build sha in `A-13-test-report.md` and `A-13.md`; none counts localhost. Final build: CI run 39835352646 on the runner: A-03 38 passed; A-13 59 passed + 1 skipped (TC-015, waits for A-11); 13 of 13 Verify/performance/vitals passed. Earlier local-link runs: 71 of 73 on `2e14516` (TC-040 failed on a slow link, passes on the runner; PO decision "Record both measurements, keep the 8 s limit"). |
| C-05 | Defects closed | PASS (fixed in this run) | ERR-27 to ERR-49 and ERR-50 to ERR-55 are all Closed with a re-test: ERR-47 and ERR-48 were "re-test pending" and are now closed on CI run 39835352646 (A-03-TC-NF-03 and A-13-TC-008 pass on the runner). TC-015 and the TC branches that wait for A-11 are gap-linked, not defects. |
| C-06 | No open Critical | PASS | No Critical defect or review finding is open. |
| C-07 | Evidence | PASS | `docs/evidence/A-13.md`: preview URL, build sha (2cc58ac, verbatim), per-demo-line results and screenshots (`docs/evidence/img/A-13-TC-*.png`, 274 files), counts (14 properties, 35 reroofs, run id, manifest CID), one CloudWatch `explore.search` log line (correlation id `Fo3JkjODgi0EMbg=`) and X-Ray trace id `1-6ad9d23c-6392799a38f271874f8c0a29`, `smeargle` report, defects table. |
| C-08 | Traceability | PASS | `docs/traceability.md` A-13 and A-18 rows and the G4, G5, G6 gate-log rows are filled; `docs/kit-usage.md` has the A-13 line and the reviewer scores. The G7 gate-log row is added with your decision. |
| C-09 | Commits | PASS | All 25 commits since the feature tip start with `A-13:`; gitleaks job green on every run; author is the PO only. |
| C-10 | Story status | PASS | Front matter is ready to go from `Ready` to `Done`: all `depends_on` are merged except A-11 (see below). |

## Open item for the PO at D-15: A-11

`depends_on` was extended with A-11 at G4 (D-1) with the explicit consequence recorded at D-2: the hosted proofs that need A-11's publication **cannot be given yet**, and the merge waits for them. What the hosted run proved today on the one published run (14 properties, 35 permits): every page, state and string; the search, SQL and Verify paths; the no-sample-data scan; accessibility; performance on the slice (provisional). What waits for A-11:

- AC-1 and D-7: Runs 1–3, Compare of two runs, the `previousManifestCid` chain (TC-002/007/014/015 ran their "today" branch; TC-015 skipped).
- AC-2 and AC-3 at full county, and the denominators (`source_total:*`).
- AC-6 and NFR-001 at full-county scale (TC-040/041 are provisional).
- AC-10 (`tables-export.json`) and AC-12 (run events, ≥ 3 runs).
- Address, tenure, owner area, contractor and BBB data (A-04, A-07): shown as missing-data reasons.

The pre-check criteria above pass; whether to approve G7 now (and merge later) or to approve after A-11 publishes is your decision at D-15.

## Fix list

None open. This run fixed the bookkeeping gaps C-02 and C-05 (unit report and ERR-47/ERR-48).

## PO decision

☑ **Approved** · HebaGaber · 2026-10-22 (D-15, round R6: "Approve G7, merge when A-11 publishes (Recommended)"). The merge into `feature/oracle-pipeline` is **on hold until A-11 has published** and the A-11-dependent cases (TC-002, 007, 014, 015, 016, 017, 019, 040, 041, 053, 054, 057, 058 on their full-data branch) have been re-run on the hosted URL; this is the D-2 decision of 2026-10-21, unchanged. Until then the preview `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com` is the evidence URL.
