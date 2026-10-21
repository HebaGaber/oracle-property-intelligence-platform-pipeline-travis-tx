# A-04 run log

Story A-04 (merged A-04 TCAD · A-05 coordinates · A-06 permits). Folder REPO-p, parallel run with A-13 (§ P). Times local (CEST, UTC+3 shown by the shell as Z-3h).

| Time | Step | Result |
| --- | --- | --- |
| 21:53 | Start | User: "run this" (walkthrough pasted). Started detached at feature/oracle-pipeline 22668fa = REPO tip. |
| 21:53 | A1 deps | A-01 6c1383a, A-02 e98c12e, A-03 8ae1870 merged; all `status: Done`. |
| 21:53 | A1 env | Tree clean (pipeline/data, pipeline/local-stack/data show untracked only because they are symlinks and .gitignore uses a trailing slash). Data links resolve. Docker postgres + restate Up 4 days; Restate admin 200. Disk 24 GiB free (95% used). node v22.23.3, npm 12.2.0, pnpm 10.34.7, duckdb v1.5.6; gh HebaGaber; elephant-cli-main present; kit at ~/.claude/plugins/cache/soofi-xyz/soofi-xyz-team-kit. Next defect ERR-21. |
| 21:54 | A1 § P step 3 | Services process (pid 85296) ran from REPO/pipeline/local-stack; no invocation running (2 completed TravisDiscovery). Stopped it, started `npm start` in REPO-p/pipeline/local-stack (pid 93139), re-registered dp_151HIGJkrASgnimhFW2Ymg9 (force). |
| 21:54 | A1 SHA-256 | Export ZIP 6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346 = A-01 receipt (travis-sources.yaml:44). |
| 21:54 | A1 Austin | 2026-10-21T18:54:53Z: 2,381,226 rows; 63,021 no tcad_id; per-jurisdiction split recorded (AUSTIN FULL PURPOSE 2,118,592 · 2 MILE ETJ 127,659 · LTD 68,567 · null 25,721 · LAKEWAY FP 6,827 · BEE CAVE FP 4,822 · PFLUGERVILLE FP 1,117 / ETJ 592 …). HTTP 200, project UA. |
| 21:55 | A1 R7 (prior) | A-03 code (travis/pilot/capture-tcad-subset.ts) matches Austin tcad_id on propertyIdentification[].geoID → pID. Field-level export read running in background. |
| 21:56 | A2/A4 | Subagents launched: export read (bg), G4 pre-check + wording fixes, oracle design (read-only, bg), test-case draft (bg). |
| 21:59 | A2 G4 pre-check | FAIL: C-06 (AC-8 denominator; AC-2 vs AC-5 confidential), C-08 (NFR-002 no number), C-11 (size_days 2.5 > 1.5, from the PO merge). C-04 exception recorded. 7 wording fixes applied + lat→latitude in the coverage SQL (frozen name). Meaning-changing items → Round 1. Subagent: duration_ms 158283, subagent_tokens 94960, tool_uses 21. |
| 22:00 | A3 branch | `create-new-feature-branch.sh` with GIT_BRANCH_NAME → 004-property-backbone at 22668fa. |
| 22:06 | A3 spec + clarify | spec.md: 26 FR + 6 NFR, FR-001..017 ↔ AC-1..17; 3 markers (FR-002 confidential, FR-008 denominator, NFR-002 numbers); 5 clarify Q/A from sources; D-4 candidates: GIS venue (=D-2), shared geoID linking, main-improvement rule. Checklist 15/16. |
