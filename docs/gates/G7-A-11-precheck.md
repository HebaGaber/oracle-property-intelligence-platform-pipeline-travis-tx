---
gate: G7
artifact: stories/A-11-publish-and-runs.md (branch 011-publish-and-runs)
artifact_version: e42000e (HEAD at scan time; 16 commits ahead of origin)
run_date: 2026-10-24
tool: Claude
verdict: FAIL
scan: early gap scan, run while the Run 2 publish, the load-time fix (1h) and the docs drafting are in progress
---

# G7 pre-check: A-11 (early gap scan)

Items pending by design at scan time are marked **pending — expected**: the Run 2 publish and its live proof on the hosted URL, CI on the final push, and the evidence/report/traceability/kit-usage docs being drafted. They are not counted as defects here, but the verdict cannot be PASS until they land.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Tasks done | FAIL | `specs/011-publish-and-runs/tasks.md` has 2 unchecked tasks: TZ03 (`verify-manifest` on Run 1; immutability check "after Run 3") and TZ05 (the story's two independent tests: "ALL ARTIFACTS VERIFIED" after Run 1; immutability after Run 3). Both say "carried forward to A-16" (items 2 and 4). A documented carry-forward, not hidden — but unchecked. |
| C-02 | Unit tests | FAIL (part pending) | CI green on the final push: pending — expected. Not pending: no recorded coverage figure for today's new code (`pipeline/local-stack/scripts/backfill-payload-redacted*`, `reexport-permits.ts`, `pipeline/publish/src/{publish-run,run-manifest,identity-gate,car-files,manifest-upload,gateway-readback}.ts`, the oracle-runtime fix). The ≥ 80 % new-code criterion has no evidence. |
| C-03 | Code review | FAIL | All four `agents.reviewers` scored today's changes ≥ 75: oracle 82 (`CR-A-11-oracle-identity-fix.md`), machamp 80 (`CR-A-11-machamp-fix.md`), porygon 80 (`CR-A-11-porygon-fix.md`), donphan 92 (`CR-A-11-donphan-fix.md`); no open Critical. Missing: the CR log `docs/reviews/CR-A-11.md` that TZ01 cites does not exist, and no `/code-review` findings are recorded for today's diff (only reviewer-agent reviews). |
| C-04 | TC executed on hosted URL | pending — expected | Needs the post-publish hosted Playwright run with the build sha. Note: TC-032/033/034 are now `test.fixme` (A-16 #7) — see C-05. |
| C-05 | Defects closed | FAIL | `docs/defects/` (last ERR-23) has no record for today's defects: (1) Run 1 permits' property CIDs never matched county → hosted TC-020–TC-031, TC-012/013, TC-NF-01/02/03 failed (Permits page 0 of 17,387); (2) 2,362 D-4b trade sub-permits published (count mismatch 15,025 vs 17,387); (3) `rawCid()` cannot verify parts > 256 KiB → TC-032/033/034 fixme, gap-linked to A-16 #7 but with no ERR file. |
| C-06 | No open Critical | pending — expected | No Critical ERR is open, but defect (1) above is Critical in effect (demo path broken) and has no record; it can be Closed only after the hosted re-test. |
| C-07 | Evidence | pending — expected | `docs/evidence/A-11.md` exists; the Run 2 section (URL, observed counts, screenshot, trace id) is being drafted and needs the live proof. |
| C-08 | Traceability | pending — expected | `docs/traceability.md` / `docs/kit-usage.md` rows for the Run 2 correction are being drafted. |
| C-09 | Commits | FAIL | 77 of 78 commits on the branch start with `A-11`; `0907627 A-16: mark Atlas registration as an external, non-blocking dependency` does not (it edits A-16's story file from the A-11 branch). It is not pushed yet. Secret scan of the branch diff: clean (matches were placeholders such as `PINATA_JWT=...` in usage comments and run-log prose). |
| C-10 | Story status | PASS | Front matter `status: Ready`, `gate: G4`, all agent/skill fields present; ready to set to Done once G7 is approved (with C-01's carry-forward accepted). |

## Fix list (by impact on the assessment score)

1. **C-05 / C-06**: add ERR records for defects (1) and (2) (Critical/High), Closed only with the hosted re-test after Run 2 is live; add one for (3), Open, linked to A-16 #7 as the documented gap for TC-032/033/034.
2. **C-03**: run `/code-review medium` on the branch diff and write `docs/reviews/CR-A-11.md` consolidating its findings with the four reviewer scores (82/80/80/92) and the earlier ones (donphan 88, porygon 86).
3. **C-01**: have the user accept TZ03/TZ05 as a G7 carry-forward to A-16 (items 2 and 4), recorded in the gate decision; or tick them with an explicit "moved to A-16" note.
4. **C-02**: run the three packages' tests with coverage and record new-code coverage in `docs/reports/A-11-unit-test-report.md`.
5. **C-09**: reword `0907627` to start with `A-11` before pushing (local history rewrite — user's call), or record it as a justified exception.
6. Then close the pending items: live proof (C-04, C-07), final CI (C-02), docs (C-08), and re-run this pre-check.
