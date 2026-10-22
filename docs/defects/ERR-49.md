---
id: ERR-49
type: defect
kind: test defect (race, only loses on a loaded machine)
feature: FEAT-A13
story: A-13
test_case: apps/web/test/catalog.test.tsx "valid definition lists" (unit test, CI workspace job)
ac_reference: AC-10, FR-010
severity: Low
status: Closed (fixed, 12 of 12 repeated runs and the full turbo pipeline pass locally; CI re-check on the commit that records it)
found_by: CI run 39819086782 (workspace job: typecheck, lint, test, synth failed after 81 s on 9fbf5ff / 28fe75e)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: (this commit)
retest_date: 2026-10-22
---

# ERR-49: Catalog unit test read a footer-derived row count before the footer arrived

## Brief description

The CI `workspace` job failed at "Typecheck, lint, test, synth (Turborepo)" and the hosted job was skipped. Reproduced locally with the CI environment under the parallel turbo run: `catalog.test.tsx > valid definition lists`, `expected undefined to be '20'`.

## Root cause

Since ERR-41 (progressive Catalog render) `data-state="ready"` means the table list is painted; a row's count arrives with its own Parquet footer. The test waited for `ready` and then read `data-rows` at once, so it passed when the machine was idle and failed under load.

## Fix

The test waits for the value (`vi.waitFor`). The page is unchanged (it correctly shows the pending note until the footer arrives).

## Impact

Test-only. It cost one CI cycle (the hosted job was skipped for that run).
