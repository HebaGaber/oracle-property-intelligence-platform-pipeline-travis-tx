---
id: ERR-48
type: defect
kind: test defect (race)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-008 (tests/e2e/A-13-explorer.spec.ts)
severity: Low
status: fixed, re-test pending (hosted)
found_by: CI run 39808557005 (hosted job, head c5c21f3)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: (this commit)
---

# ERR-48: TC-008 expected "3 close matches" from a different search than the one on screen

## Brief description

Pflugerville, 5 mi, roof >= 15: `getByText('No properties within 5 mi · 3 close matches just outside', { exact: true })` was not found in 15 s on the runner. It passes locally and on earlier runs.

## Root cause

A race in the test, not a page defect. `nextSearch` returns the first `explore.search` response after the last control change. Earlier changes (place selection, radius) start searches of their own, and on a slow runner one of those answers can arrive after the listener is registered, so `result.close_matches.length` (3) belonged to another request than the one the page shows. The page is consistent: `Results` renders `zeroResults(request.radius_mi, data.close_matches.length)` from the `answered` request and the same `data` as the header. Checked on the preview, twice, with the same request: the page shows 2 close matches and the response holds 2.

## Fix

`tests/e2e/A-13-explorer.spec.ts`: `trackSearches` records every response with the request it answered; TC-008 takes the LAST answer to the final request (radius 5, roof 15, first page) after the header shows the roof filter and the network is idle. No page change, so no new unit test.

## Impact

Test only. No ERR-49: items 1 and 2 had one root cause each (the removed hack; the touch-target growth), item 3 had no second one.
