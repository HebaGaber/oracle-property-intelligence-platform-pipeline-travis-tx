---
id: ERR-47
type: defect
kind: product defect (layout regression)
feature: FEAT-A03
story: A-03 (regressed by A-13)
test_case: A-03-TC-NF-03 (tests/e2e/responsive.spec.ts, 'permits @ 390: first provenance line inside the first viewport')
ac_reference: AC-2, AC-3, NFR-003
severity: Medium
status: fixed, re-test pending (hosted)
found_by: CI run 39798211562 (hosted job), preview build 0e9be08 / 3efd120
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: (this commit)
---

# ERR-47: Permits at 390 x 844: first provenance line ends at y 860 (limit 844)

## Brief description

`/permits` at 390 x 844: the first `[data-cid]` box is top 812, height 48, bottom 860, 16 px below the fold. The A-03 rule (hard acceptance rule, the test is not weakened) needs the bottom at 844 or less. The provenance text (`span._text`) is 144 px tall (732 to 876) at the bottom of a 740 px card.

## Root cause

A product regression from the A-13 touch-target fixes (smeargle D3, D5). Two atomic 48 px boxes inside one sentence of 16 px text made their lines 48 px high:

- D5 `Provenance.module.css .link`: `display: inline-flex; min-height: var(--space-9)`. The source link (a 2-line URL, 32 px before) became a 48 px box on its own line: +16 px.
- D3 `CidDisplay.module.css .copy`: 48 x 48 with `flex: none`. The CID line is 48 px, not 16 px (the 48 px button existed since A-03 but sat on a line that had room; with the link line growing, the line count and total pushed the CID to y 812).

Lines measured on the preview: 16 (Source:) + 48 (link) + 16 (collected) + 48 (CID) + 16 (run) = 144. Fonts (ERR-46), the icon box (ERR-42) and the Permits `h2` (ERR-31) did not change the card above the provenance line (card top 152 as before).

## Fix

`apps/web/src/components/Provenance.module.css` only:

- `.link`: `display: inline; padding-block: var(--space-4)`. Box is at least 48 px (62 px for the 2-line URL), the line stays 16 px per text line.
- `.text [data-cid]`: `margin-block: calc(var(--space-4) * -1)`. The button still paints and takes taps at 48 x 48 (`CidDisplay .copy` unchanged), the line is 16 px.

Measured on the preview with the CSS injected (plain Chromium, 390 x 844, a functional measurement, not evidence): first `[data-cid]` bottom 860 to 813; provenance text 144 to 81 px. Trade-off: the link and button hit areas overlap the neighbouring text lines by up to 16 px.

## Regression test

`apps/web/test/touch-targets.test.ts` "N4" (red before, green after) and the updated "D5" (the link is an inline box with `padding-block`, not an inline-flex `min-height` box). Hosted re-check: A-03-TC-NF-03 on the next build, plus smeargle D3/D5 (copy button and source link at least 48 px).

## Impact

Layout only; no data affected. The first permit's provenance (source, CID) was below the first viewport at 390 px.
