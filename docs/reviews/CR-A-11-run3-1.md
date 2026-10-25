# CR-A-11 — oracle review: Run 3.1 corrections (ERR-72, ERR-73, ERR-74)

Reviewer: oracle (read-only, two rounds). Branch `011e-run3-1-permit-contractors`.
Dates: 2026-10-26 (round 1 on `e098063`, round 2 on `d53b055`).

## Score: round 1 70 / 100 (FAIL) → round 2 80 / 100 (PASS, pass bar 75)

## Round 1 (ERR-72, ERR-73): 70 / 100

The transform change was correct and safe; the manifest config would have published two false statements.

| # | Severity | Finding | Fix (commit) |
| --- | --- | --- | --- |
| F1 | High | Manifest dropped the `austin-address-points` source although the reused County data takes coordinates from it | `carryAddressPoints` carries it with delta 0 (`8381495`) |
| F2 | High/Medium | Run id and times were local time labelled UTC | UTC everywhere (`8381495`) |
| F3 | Medium | README edited by hand; the generator would restore the old ERR-32 wording | wording moved into `contract-docs.ts` and `columns.ts` (`8381495`) |
| F4 | Low/Medium | Stale "2007514 linked permits" note carried | dropped and restated as 2,008,095 (`8381495`) |
| F5 | Low | `dropLimitationPrefixes` silently ignored a prefix that matched nothing | refused (`8381495`) |
| F6 | Low | Contractor counts hand-copied into the config | `contractorCoverage` cross-check; registry sha256 in the note (`8381495`) |
| F7 | Info | `manifest.ts` comment described three buckets | five states (`8381495`) |

## Round 2 (round-1 fixes + ERR-74 address columns, contract v1.2): 80 / 100

All round-1 findings confirmed fixed. Patch confirmed correct (applies cleanly to 44bb182; deterministic first-seen column order; type conflicts become STRING; EXTRAS not duplicated). Numbers re-checked against the re-exported tables. Old runs still bind.

| # | Severity | Finding | Fix (commit) |
| --- | --- | --- | --- |
| 1 | Medium | `owner_mailing_reason` said `no_mailing_address` when the address exists without a ZIP/state (372 / 374 properties); the state reason checked the ZIP flag | `source_missing` when a mailing address exists; state checks `state_code` (`round-2 fixes`) |
| 2 | Medium | Contract docs and ADR-0002 still said addresses are not exported | `contract-docs.ts` passages rewritten; ADR-0002 dated update |
| 3 | Medium | Correction note said "every other table holds the same rows" (false for the 413 contractor rows); comparison not in the repo | note states per group; `run3-1/compare-tables.sh` + `table-compare.md` committed |
| 4 | Low | Patch provenance thin | patch and file sha256 in the note; `pipeline/publish/patches/README.md` with rebuild steps (verified to reproduce the patched file) |
| 5 | Low | Situs city/ZIP reason changes for older runs too, unannounced | stated in the v1.2 section |
| 6 | Low | ERR-74 paperwork pending | `fix_commit`, `retest_date`, Result filled |
| 7 | Low | `finishedAt` before the last export | 2026-10-25T22:55:00Z |
| 8 | Note | ERR-72 stores a person's name in `company` | PO decision; accepted risk, disclosed as "as printed, not verified" |

Round-2 fixes are in the commit "A-11: Run 3.1 review round 2 fixes (oracle 80/100)" and the manifest was rebuilt after them (`bafkreidbqsav3rsbxqy5fx3li73uskfth254nz5zw34xwac5w3fd4tmbai`).

## Not checked by the reviewer

Hosted pages and Playwright; gateway readback (not published at review time); `$ref` branches in other lexicon classes (none needed for `address`).
