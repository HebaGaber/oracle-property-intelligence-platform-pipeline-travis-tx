---
id: ERR-74
type: defect
feature: FEAT-A11
story: A-11
test_case: packages/query-core tests (views over a run with address columns and without); trial export compare in specs/011-publish-and-runs/run3-1/
ac_reference: A-04 AC-1 (situs address), FU-A-01-contract-address-contractor
severity: High
status: Fixed for Run 3.1 (travis-full-run3-1-20261025), contract v1.2
found_by: Task B (Roofing CRM) Run 3 data-gap questions 1 and 2, for HebaGaber
found_date: 2026-10-25
fix_branch: 011e-run3-1-permit-contractors
fix_commit: pending
retest_date: pending
closed_date: pending
---

# ERR-74: Property address and owner mailing ZIP are not in the published tables

## Brief description

The Roofing CRM shows "Address not published" on every property and owner area "unknown" on all 441,961 properties. The data is published: every situs `address` record in the County CARs carries `unnormalized_address` (for example "2725 WOODALL DR 1401, CEDAR PARK, TX 78613"), and every mailing-address record carries `city_name`, `state_code`, `postal_code`. But the Parquet `address` table has only `cid, property_cid, data_group_cid, request_identifier`.

## Cause

The lexicon `address` class is a top-level `oneOf` (unnormalized or structured) with no top-level `properties`. elephant-cli `export-tables` (pinned `44bb182`, still GitHub `main` on 2026-10-26) builds a table's columns from `schema.properties` only (`dist/services/tables-export.service.js`), so the address fields get no column.

## Lexicon re-check (2026-10-26, PO asked)

- The live lexicon manifest is unchanged (18,499 bytes, sha256 `7084b933…`, same class CIDs).
- The only flat address class is `unnormalized_address` (`full_address`), reached by the Seed group's `property_seed` relationship. It requires `county_jurisdiction` from a 140-county enum that has no Travis, so no record would validate (same gap as drafted request R7).
- Owner mailing addresses link only to `address` (`person_to_address`, `company_to_address`).

So no lexicon carrier avoids the `oneOf` class.

## Decision

PO (HebaGaber), 2026-10-26, option A: patch `export-tables` so a top-level `oneOf`/`anyOf` class gets the union of its branches' properties as columns (first-seen order; a field the branches type differently becomes STRING). The patch is `pipeline/publish/patches/elephant-cli-export-oneof.patch` (applied to a copy at `~/.local/share/elephant-cli-oneof`; the pinned install is untouched). Only `export-tables` is re-run, on the unchanged CAR files: no county re-run, the CAR CIDs stay the same.

## Fix

- Re-export the tables of all 15 Run 3.1 batches with the patched CLI (`specs/011-publish-and-runs/run3-1/p7-reexport-tables.sh`).
- `packages/query-core`: `bindManifest` builds `meta.address_fields` (address text, ZIP, state; NULL columns for an older export); `v_property` gains `unnormalized_address`, `owner_mailing_postal_code`, `owner_mailing_state_code` (contract v1.2, additive); `owner_area_class` now reads real ZIPs.
- The situs `city_name` / `postal_code` stay gaps with `source_missing`: TCAD prints the situs as one line.

## Result

Trial on permits batch b01: only `address/part-00000.parquet` changed, and every other table part was byte-identical; 2,159 of 2,159 situs rows carry `unnormalized_address`. Full-run counts: see `specs/011-publish-and-runs/run3-1/` once the export finishes.
