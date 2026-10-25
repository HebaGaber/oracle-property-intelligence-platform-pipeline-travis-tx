# Run 3.1 progress record (resume pointer)

Run id `travis-full-run3-1-20261025` · manifest `bafkreidbqsav3rsbxqy5fx3li73uskfth254nz5zw34xwac5w3fd4tmbai` · branch `011e-run3-1-permit-contractors` (pushed to the fork, no PR) · worktree `/Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx-p`.
Scope (PO 2026-10-26): ERR-72 person-only contractor names, ERR-73 registry-matched contractor counts, ERR-74 address and owner mailing ZIP in the tables (contract v1.2, patched export-tables). No county re-run, no CLI change other than the export patch. Owner-name fix (Task B question 10) rejected.
Times are local (EEST) unless marked Z.

## Done

| Item | Result | Evidence |
| --- | --- | --- |
| Task B questions answered | 13 answers sent; correction sent (addresses come in Parquet, not from the CARs) | session messages to `roofing-crm-c9` |
| ERR-72 code + rebuild | 413 more permits name a contractor (4,139 → 4,552) | `docs/defects/ERR-72-*.md`, `logs/reexport.log` |
| ERR-73 counts | candidate 130, conflicting 112, resolved 0, unresolved 14,783 | `contractor-coverage.json` |
| ERR-74 patch + re-export | 15 batches re-exported, CARs unchanged; situs text 441,940 of 441,961; mailing ZIP 408,833 of 409,205 | `p7-reexport-tables.sh`, `table-compare.md`, `pipeline/publish/patches/` |
| Contract v1.2 | 3 new `v_property` columns, docs/sample regenerated | `contract/v1/README.md` |
| Tests | query-core 439, contract 58, publish 404, permits 31, local-stack 19: all pass | — |
| Review | oracle round 1 70 → round 2 80/100 PASS; round 2 findings 1–7 fixed | reviewer reports (to be written to `docs/reviews/CR-A-11-run3-1.md`) |
| Merge of feature (Run 3 indexed) | `4549e54`, one comment conflict | — |
| PO publish approval | 2026-10-26 ~02:10 | session |
| Review record | `docs/reviews/CR-A-11-run3-1.md` written (both rounds) | — |
| Amplify preview | auto-created for `011e-run3-1-permit-contractors` (pattern `0*`) | `https://011e-run3-1-permit-contractors.d2lx0utip89u18.amplifyapp.com` |
| Publish 1/8 gate | PASS (15,025 permits, 0 of 10,792 unmatched) | `logs/p9-publish.log` |

## In progress

| Item | State | Next check |
| --- | --- | --- |
| Publish 2/8 filebase | uploading 10 county table folders + 5 permit CARs + 5 permit table folders (~1 GB, slow home link) | `logs/p9-publish.log` |

## Remaining (in order; items marked ∥ run in parallel with the upload)

| # | Item | Depends on | Owner |
| --- | --- | --- | --- |
| R1 | Publish 3/8 car-files (5 permit CARs + 15 directories; 10 county CARs adopted from Run 3) | 2/8 | this session |
| R2 | Publish 4/8 manifest, 5/8 cid-copy, 6/8 gate-remote, 7/8 release (reuses Run 3's county CAR assets), 8/8 index | R1 | this session |
| R3 | Public readback: all 286 files on CloudFront (285 + manifest), manifest on Filebase and Pinata | R2 | this session |
| R5 ∥ | A-11 evidence addendum for Run 3.1 (`docs/evidence/A-11.md`), ERR-72/73/74 status | — | this session |
| R6 | Hosted proof: Amplify branch preview of 011e, Runs page shows Run 3.1; `v_property` address columns on the hosted Explore (Playwright) | R2 | this session |
| R7 | Tell Task B: published manifest CID + commit to vendor from (contract v1.2) | R3 | this session |
| R8 | G7 pre-check (`developmentsupport-g7-precheck`), then PO approval to merge `011e` → `feature/oracle-pipeline` (`--no-ff`) and `scripts/progress.sh` | R3–R6 | PO decides |

## Known gaps carried

- Owner names: 17,160 unparsed names + 15,410 confidential still read `no_owner_record` (fix rejected for this run).
- Explore index for Run 3 / 3.1 is not built (A-16 session's item; hosted Explore shows `index_not_built`).
- Situs city/ZIP are inside `unnormalized_address` only (TCAD prints one line).

## Log

- 2026-10-26 02:13 publish started; 02:14 gate PASS; 02:20 uploading county-b01-tables.
- 02:22 review record written; Amplify preview exists.
