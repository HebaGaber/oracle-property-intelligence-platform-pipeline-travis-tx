---
id: CT-A-01-cli
parent: PLAN-A-01
---

# Contract: operator commands

Run from the repository root. Names are the planned `package.json` scripts in `pipeline/oracle-runtime`; `/speckit-tasks` may refine them.

| Command | Does | Exit code |
| --- | --- | --- |
| `npm --prefix pipeline/oracle-runtime run discover` | Starts the `TravisDiscovery` workflow on the local Restate stack; writes `pipeline/docs/travis-sources.yaml` and receipts | 0 on completion (including `WAITING_HUMAN`); non-zero on crash |
| `npm --prefix pipeline/oracle-runtime run check-catalog` | Runs the A-01 checker rules ([catalog.md](catalog.md#checker-rules-check-catalogts-exit-0--all-pass)) | 0 all rules pass; 1 otherwise, listing each failure |
| `npm --prefix pipeline/oracle-runtime run validate` | Runs the vendored validator with the relative catalog path; saves `docs/evidence/A-01-readiness.json` and the exit code | the validator's own exit code (0 PASS, 1 BLOCKED) |
| `npm --prefix pipeline/oracle-runtime run render-sources` | Regenerates `docs/sources.md` from the catalog | 0; a later re-run with no catalog change gives no diff |
| `python3 pipeline/oracle-runtime/kit/use-oracle/scripts/validate-county-readiness.py --self-test` | Kit regression fixtures | 0 |
| GitHub → Actions → `geo-check` → Run workflow | Only when a saved geo signal exists: one identified request from a US runner | artifact with status, headers, body digest |
