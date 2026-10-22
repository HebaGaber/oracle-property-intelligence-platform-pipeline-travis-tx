---
gate: G7
artifact: specs/007-enrich-reconcile
artifact_version: "450c8ef04422e1a7f3514bac57f47837e2b79f48"
run_date: 2026-10-23
tool: Claude
verdict: FAIL
---

# G7 pre-check: A-07 Enrich and reconcile (merged: Tracks A and D built; Tracks B and C documented gaps)

This is an AI completeness pre-check. It reports gaps only and does not approve. The decision belongs to the PO (HebaGaber).

**Branch:** `007-enrich-reconcile` at HEAD `450c8ef`. Build start `a8bb7b3`. 21 story commits.

## Recorded exceptions (not scored as FAIL)

- **C-04 (TC on hosted URL):** accepted. A-07 is `ui: false` and pipeline-only. Nothing is deployed, so every case ran from a terminal against the local stack (`docs/reports/A-07-test-report.md` header note).
- **C-07 (URL, screenshot, trace id):** accepted. `docs/evidence/A-07.md` states `runtime_url: n/a (pipeline-only story)`. No screenshot or trace id is expected.
- **C-01 (tasks unchecked):** accepted for Tracks B and C only. Unchecked: T005, T006 (migrations 0403 and 0404), T023 to T034 (Track B), T035 to T045 (Track C). These are the PO cost-mode scope decision of 2026-10-22. Every Track A and Track D task is checked.

**Inputs read:** `specs/007-enrich-reconcile/tasks.md`, `docs/reports/A-07-unit-test-report.md`, `docs/reports/A-07-test-report.md`, `docs/reviews/CR-A-07.md`, `docs/evidence/A-07.md`, `docs/defects/` (all 23 ERR files; none reference A-07), `stories/A-07-enrich-reconcile.md`, `docs/traceability.md`, `docs/kit-usage.md`, `git log a8bb7b3..HEAD`, `origin/007-enrich-reconcile` (= HEAD), `gh run list` and `gh run view 39864028535`. Precedent: `docs/gates/G7-A-04-precheck.md`.

## Checks

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | PASS (accepted exception) | Every Track A and Track D task is ticked, including all Phase Z tasks (TZ01 to TZ06, TZ02 to TZ04 as N/A). Unticked tasks are T005, T006, T023 to T034, T035 to T045, all Track B or C. Accepted under the PO's 2026-10-22 scope decision. |
| C-02 | Unit tests | FAIL | Three gaps. (a) CI on HEAD is not finished. Run `39864028535` (`450c8ef`) shows `oracle-runtime`, `workspace` and `gitleaks` green, but `e2e-hosted` is still `in_progress`. The unit report line 5 says "Not yet pushed to origin (D-24, Stage 6)", which is stale: the branch is pushed and CI has run. No CI run ID is recorded in the report. (b) Coverage of new code is below 80% on several files. The whole-tree figures pass (runtime 86.37%, local-stack 83.37%, query-core 92.27%). Per file, the unit report shows `pipeline/local-stack/services/report-sections/identity.ts` at 35.71% statements, `travis/roof-age/run.ts` at 68.42%, `travis/runs/a07-verify.ts` at 72.83%, and `travis/identity/sampler.ts` at 80.85% statements but 54.54% functions. The report accepts these as "minor gaps" without a per-file justification in the criterion's terms. (c) Test counts conflict. The unit report gives runtime 1008 tests and 1006 passed (line 21 to 22). `docs/evidence/A-07.md` line 83 gives 1009 and 1007. |
| C-03 | Code review | FAIL | `docs/reviews/CR-A-07.md` has two scores, 90 and 92. Neither names its agent: the header says "read-only reviewer (Track A)", and the other is a "cross-track arithmetic reviewer". `stories/A-07-enrich-reconcile.md` names reviewers `oracle`, `donphan`, `porygon`. (a) `oracle` has no score. (b) `donphan` has no score. Its decline is recorded only in `docs/kit-usage.md` and the run-log, not in the CR log. (c) The 90 and 92 scores are attributed to general-purpose subagents in `docs/kit-usage.md` (lines 67 and 68), so the named agents did not score the branch. (d) The CR log has no `/code-review` findings section. The evidence says `/code-review low` ran (4 findings, all fixed). TZ01 says `/code-review medium` and is ticked. The downgrade is recorded only in the run-log (00:17, cost-mode C6). Zero open Critical findings: PASS. Scores are 90 and 92, both at least 75. |
| C-04 | TC executed on hosted URL | PASS (accepted exception) | All 24 executed cases carry a result and a build sha (`3bc43a6`). Every case ran from a terminal, which is the recorded exception. Non-blocking findings: (a) the recorded sha `3bc43a6` is 7 commits behind HEAD `450c8ef`. Since then 26 files changed, including behavioural edits to `identity:resolve.ts`, `reconcile:merge.ts`, `roof-age:backfill.ts`, `identity:load-registry.ts`, `a07-coverage.ts` and `a07-verify.ts`. Most of the diff is Prettier formatting, but the results do not state that they were re-run at HEAD. (b) The summary table says "Passed / failed / blocked 23 / 0 / 1 (TC-002)", but the row for TC-002 says PASS (fixture branch). |
| C-05 | Defects closed | PASS | No ERR file references A-07. All 23 `docs/defects/ERR-*.md` belong to A-01 to A-04. The test report records 0 failed cases. The previous draft's ERR-01 to ERR-07 were withdrawn and never filed. |
| C-06 | No open Critical | PASS | No Critical defect is open. The review's only findings are non-blocking. |
| C-07 | Evidence | PASS (accepted exception) | `docs/evidence/A-07.md` exists and carries observed counts for every track, a job-report path for each number, and the full-roll and audit figures. URL, screenshot and trace id are the accepted exception. Non-blocking: the "## CI runs" section still says "Pending: the branch is pushed ... after which this section records the GitHub Actions run ID". The "CI" header row says "pending D-24 push". The header branch range ends at `3bc43a6`. Both `TODO-AFTER-MERGE` tokens are expected until approval. |
| C-08 | Traceability | PASS | Rows exist for AC-7, AC-8, AC-9, AC-11, AC-12 and AC-13 in `docs/traceability.md`, and BN-A rows exist for FEAT-A07 to FEAT-A10. Kit-usage rows exist (reviewer substitution, donphan scope). Non-blocking stale text: the BN-A rows cite `@ 3bc43a6` and "G7 pending merge", and the G7 gate-log row (line 133) reads "in progress ... review round and Stage 6 not yet run", which is no longer true. Update both when the PO decides. |
| C-09 | Commits | PASS | All 21 commits in `a8bb7b3..HEAD` start with `A-07: `. Diff secret scan (AWS key, `sk-` key, DB URL with password, private key, password assignment) found no match. `.gitleaksignore` gained one fingerprint for `COMPTROLLER_SOURCE_KEY` in `tracks/comptroller.ts`. The value is the Socrata dataset id `tx-comptroller-9cir-efmm`, not a credential, and the entry has a reason line. Gitleaks passed on run `39860024821`. |
| C-10 | Story status | PASS | `stories/A-07-enrich-reconcile.md` front matter: `status: Ready`, `gate: G4`, `qc_testability_signoff: true`. This is correct before approval. On approval set `Done` and `G7`. Record the Track B and C scope exception in the approval note, because the story's ACs for B and C are not delivered. |

**FAIL count: 2** (C-02, C-03).

## Fix list (ordered by impact on the assessment score)

1. **C-03, reviewer scores.** Append to `docs/reviews/CR-A-07.md`:
   - a score from the named `oracle` reviewer, or a recorded decline with its reason;
   - the `donphan` decline reason, copied from `docs/kit-usage.md` line 58;
   - the agent identity behind the 90 and 92 scores;
   - a `/code-review low` section listing the 4 findings and their dispositions, with the cost-mode C6 downgrade from `medium` noted.

   Re-run this pre-check after the edit.

2. **C-02, CI and coverage.**
   - Wait for run `39864028535` (`e2e-hosted`) to finish. If it is green, record the run ID and conclusion in `docs/reports/A-07-unit-test-report.md` (replace the line "Not yet pushed to origin") and in `docs/evidence/A-07.md`'s CI section. If it fails, open an ERR.
   - Add tests, or a per-file justification, for `report-sections/identity.ts` (35.71%), `roof-age/run.ts` (68.42%), `runs/a07-verify.ts` (72.83%) and `sampler.ts` function coverage (54.54%).
   - Reconcile the test counts: the report says 1008 and 1006 passed, and the evidence says 1009 and 1007.

3. **C-04, re-state at HEAD.** Re-run `npx vitest run` in the three trees and `node pipeline/oracle-runtime/travis/runs/a07-verify.ts`, then update the build sha in `docs/reports/A-07-test-report.md` from `3bc43a6` to HEAD. Fix the TC-002 "blocked" versus PASS contradiction in the summary table.

4. **C-07 and C-08, stale text.** Update the evidence "## CI runs" section, the header commit range, and the BN-A rows (`@ 3bc43a6`). Update the G7 gate-log row (line 133). Do this as part of the PO decision, not before.

5. **Non-blocking, record as known limitation.** The `&`/`AND` normalization gap in `normalizeContractorName` (CR Track A finding) is already recorded in `docs/evidence/A-07.md` ("Missing data or limitations"). It needs no ERR, because it can only under-resolve. Mention it in the approval note.

## Verdict

**FAIL** (2 FAILs: C-02, C-03). The exceptions C-01 (B/C), C-04 and C-07 are recorded above and are not scored as FAIL. No approval is recorded here. The PO decides.
