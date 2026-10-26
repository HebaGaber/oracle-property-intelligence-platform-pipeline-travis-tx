---
id: ERR-79
story: A-16
severity: High
status: Open
found: 2026-10-26 08:40 EEST
found_by: Run 3.1 session message + A-16 main session
---

# ERR-79: Run 3.1 became the latest run without an Explore index, and contract v1.2 makes every index stale

## What happened

The Run 3.1 session published `travis-full-run3-1-20261025` (manifest `bafkreidbqsav3rsbxqy5fx3li73uskfth254nz5zw34xwac5w3fd4tmbai`) and merged it into `feature/oracle-pipeline` (`fa6771a`). `runs/index.json` now lists Run 3.1 as the latest run. No index was built for it, so the deployed API answers `index_not_built` for Explore, the agent and MCP on the latest run.

The same merge brings contract v1.2 (`packages/query-core/views.sql`: three new `v_property` columns). The reader compares `viewsSha256` with its own views, so after the next API deploy the existing indexes for Runs 1–3 would answer `index_stale`. Indexes are never overwritten (`If-None-Match`), so they cannot be rebuilt in place.

Same class as ERR-76: publishing a run and building its index are two separate operator steps.

## Fix

1. Index read prefix per views version: `private/explore-index/v1.2/` (`infra/src/config.ts`, `af2c2e5`); the read grant stays on `private/explore-index/*`, so only CountyLensApi changes.
2. Build, verify (`EXCEPT ALL` parity 0) and upload the v1.2 indexes for Runs 3.1, 3, 2 and 1 under the new prefix.
3. One CountyLensApi deploy (PO approval) so the Lambdas read v1.2.
4. Re-test: `explore.search` on Run 3.1 and Run 3, A-16-TC-034/035/036 on the preview.

Follow-up to stop a repeat: the publish runbook gets an "index built" step before `runs/index.json` is updated (release sweep).

## Re-test

Pending.
