---
gate: G7
artifact: stories/A-04-property-backbone.md
artifact_version: "run 1; branch 004-property-backbone @ 277ed13 (pushed; origin/004-property-backbone = 277ed13); test report build e48ec93"
run_date: 2026-10-22
tool: Claude
verdict: FAIL
---

# G7 pre-check (run 1): A-04 Load the county backbone (TCAD properties and owners, coordinates, permits from every jurisdiction)

This is an AI completeness pre-check. It reports gaps only and does not approve. **Decision: pending, for the PO.**

## Recorded exceptions (walkthrough section 1; recorded once here)

- **Pipeline-only story (`ui: false`, deploys nothing).** G4 C-04 and G7 C-04/C-07: proof is in the PR (monitoring/run report, reconciliation, coverage SQL both ways and gap report, per-jurisdiction counts, receipts, test output); it shows live once A-11 publishes and A-13 reads it. G6 C-05/C-09: cases start from a terminal at the repo root, with Vitest and run commands instead of Playwright. Phase Z TZ02-TZ04 are N/A.
- **PO-approved, in `docs/decisions/`:** `DEC-A-04-permit-match-rate` (AC-13/NFR-005 97% became a measured 88.36%, every unmatched permit reasoned) and `DEC-A-04-coverage-exception` (AC-8/NFR-003 99% of all R became 99% of ordinary land parcels, measured 99.63%, condo-coded reported separately). Also `DEC-A-04-gis-runner`.
- **Not an exception:** G7 C-02 (CI green on the pushed branch).

**Inputs read:** `specs/004-property-backbone/{tasks.md,run-log.md}`, `docs/reports/A-04-unit-test-report.md`, `docs/reports/A-04-test-report.md`, `docs/reviews/CR-A-04.md`, `docs/defects/ERR-21.md` to `ERR-23.md`, `docs/evidence/A-04.md`, `docs/traceability.md`, `docs/kit-usage.md`, `stories/A-04-property-backbone.md`, `git log feature/oracle-pipeline..HEAD` (54 commits), `gitleaks git` over that range, and `gh api` on run 39783309484 of the fork.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | PASS (exception) | `tasks.md` has 4 unticked boxes: T088 (`[ ] T088 [lead] Merge ... then /developmentsupport-g7-precheck A-04`, which is this run) and TZ02, TZ03, TZ04 (each written "N/A: pipeline-only story, deploys nothing"). TZ02-TZ04 are the recorded exception. Every other task is ticked, including converge T089-T092. Tick T088 once this report is written, and TZ02-TZ04 as "N/A (accepted)" so the file shows 0 open. |
| C-02 | Unit tests | **FAIL** | **CI is green:** run [39783309484](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39783309484) on `277ed13` (head_sha verified = branch HEAD) is `completed / success`; workspace, oracle-runtime, gitleaks and e2e-hosted are all `success`, including the "Playwright on the hosted URL" step, so the relaxed A-03 TC-061 (commit 121878e) now passes. **Coverage fails:** the unit report shows oracle-runtime new code at 91-96% (tcad 93.73, gis 93.10, permits 95.99, backbone 91.30), but `pipeline/local-stack` is **75.69% statements** (workflows 70.28, loader 75.65, `app.ts` 65.11; `austin-permits.ts` and `gis-import.ts` are not imported by any test, so the true figure is lower). It says "stays below the 80% target" and is not a PO exception. Non-blocking: the report's `ci_run` still says "Not a CI run" and its `commit` is `79e21d0`. |
| C-03 | Code review | PASS | CR-A-04: oracle **80/100** and donphan **80/100** (both `agents.reviewers`, both at least 75), `/code-review` medium run (10 findings). The 5 oracle Majors (OR-M1 to OR-M5) and the donphan Majors are Fixed in `84672ce`. "Open Critical findings: 0". Non-blocking: reviewers scored `4a4910c`, and no delta re-score exists after the fixes. |
| C-04 | TC executed on hosted URL | PASS (exception) | Pipeline-only exception: no hosted runtime. `A-04-test-report.md` is `status: Final`: 52 cases, **PASS 43, PASS-WITH-NOTE 9, FAIL 0**, run from a terminal on the local stack at `e48ec93`. The 9 notes are stated per row. It shows live once A-11/A-13 publish and read. Non-blocking: the build is `e48ec93`, HEAD is `277ed13` (later commits are docs, evidence and tasks, plus fixes covered by the unit report). |
| C-05 | Defects closed | **FAIL** | ERR-21 (Low), ERR-22 (High) and ERR-23 (Medium) are `status: Re-tested (2026-10-22: ... passes ...)`, not `Closed`. The re-tests pass (TC-NF-03, TC-052, TC-004). Fix: set `status: Closed`, add `closed_date: 2026-10-22` and tick "Closed" in each file. A-03's run 1 failed on exactly this. |
| C-06 | No open Critical | PASS | No Critical defect (Low, High, Medium, all re-tested PASS); CR-A-04 has 0 open Critical findings. |
| C-07 | Evidence | **FAIL** | `docs/evidence/A-04.md` exists with the run report, reconciliation (493,246 loaded), coverage both ways (99.63% ordinary parcels, 88.26% all R), per-jurisdiction counts, receipts, the 88.36% permit match with reasons, and the CI table. The screenshot is an accepted exception (no UI). **Gaps:** (1) line 317 `TODO-AFTER-PUSH(final CI run id and result)` is **resolvable now**: the branch is pushed and the answer is run 39783309484 on `277ed13`, 4/4 jobs success. Replace it, and change the line 16 banner "pending the push and the merge" to "pending the merge". (2) Line 10 `merge_commit: "TODO-AFTER-MERGE(...)"` is legitimately post-merge (see below). |
| C-08 | Traceability | PASS | `docs/traceability.md` rows for AC-3, AC-4, AC-5, AC-6, AC-10 and the BN-A rows (lines 96-98) cite spec FRs, TC ids and evidence. `docs/kit-usage.md` A-04 row names the oracle builder (4 task groups, 7 fixer passes), skills, and the review scores (oracle 80, donphan 80). The gate log has G4, G5 and G6 rows; the G7 row (line 125) says "pending ... not yet run" and must be updated with this report and the PO decision. |
| C-09 | Commits | PASS | All 54 commits in `feature/oracle-pipeline..HEAD` start with `A-04`. Secrets: CI `gitleaks` job is green on `277ed13`. A local `gitleaks git` over the range reports 6 `generic-api-key` hits (commits `f00d9cd`, `666e0c4`: the public dataset id `austin-3syk-w9eu`, a SHA-256 constant, `SYNTH_API_TOKEN: "tok_synthetic_..."`, test fixtures) with no matching fingerprint in `.gitleaksignore` (its A-04 entries use pre-rewrite shas). These are false positives, not secrets. Optional: add the 6 fingerprints with `# reason:` lines. |
| C-10 | Story status | PASS | `status: Ready`, `gate: G4`, `qc_testability_signoff: false`. Ready to set after the PO approves: `status: Done`, `gate: G7`, and `qc_testability_signoff: true` (G6 is approved in the gate log; A-03 had `true`). Not set yet, correctly. |

**Verdict: FAIL** (3 FAILs: C-02, C-05, C-07). All three are small: one needs a PO decision or tests, two are file edits.

## Fix list (ordered by impact on the assessment score)

1. **C-02 coverage:** either (a) add tests for `local-stack/services/workflows/austin-permits.ts`, `gis-import.ts`, `app.ts` and the loader error paths until `pipeline/local-stack` is at least 80%, then update the unit report; or (b) the PO records a DEC (for example `DEC-A-04-local-stack-coverage`: Restate/bootstrap glue stays at 75.69%, exercised live by the test report) and the unit report cites it. Also set the report's `ci_run` to 39783309484 and `commit` to the HEAD sha.
2. **C-05:** set ERR-21, ERR-22 and ERR-23 to `status: Closed` with `closed_date: 2026-10-22`.
3. **C-07:** replace `TODO-AFTER-PUSH(final CI run id and result)` (evidence line 317) with run 39783309484 on `277ed13` (workspace, oracle-runtime, gitleaks, e2e-hosted all success). Fix the line 16 banner.
4. Tick T088 and TZ02-TZ04 (N/A) in `tasks.md`; update the G7 row in `docs/traceability.md` (line 125).
5. Optional: add the 6 gitleaks fingerprints with reasons; note in CR-A-04 that the Majors were fixed after `4a4910c`.

## Open items that are not defects

- **PO approval** of G7 (this check never approves).
- **`TODO-AFTER-MERGE(merge commit sha after G7 merge --no-ff)`** in the evidence front matter: fill in after `git merge --no-ff`.
- On approval: set the story to `Done` / `G7`, tick the G7 checklist, record decision and date, add the gate log row, merge `--no-ff`, run `bash scripts/progress.sh`. Re-run this pre-check after fixes 1 to 3; if it passes, the only open items are the PO approval and the post-merge sha.

**Decision:** ☐ Approved ☐ Returned · pending (PO)
