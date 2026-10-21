---
id: A-04
type: user-story
title: "Load the county backbone: TCAD properties and owners, coordinates, and permits from every jurisdiction"
parts: [A-04, A-05, A-06]
merged: 2026-10-21
parent: [FEAT-A04, FEAT-A05, FEAT-A06]
vision: VIS-A
ard: ARD-A
eval_point: A1
priority: P1
moscow: Must
branch: 004-property-backbone
spec: specs/004-property-backbone/
depends_on: [A-01, A-02, A-03]
size_days: 2.5
agents:
  design: [oracle]
  builder: oracle
  reviewers: [oracle, donphan]
  verify: "`monitoring-county-ingestion`; roll count matches · coverage SQL ≥ 99% · per-jurisdiction counts"
skills: [county-seed-data, county-appraisal-onboarding, build-county-transform, county-ingest-run, use-oracle, query-db-loading-matching, county-permit-adapter, durable-workflow-builder, apply-engineering-guidelines]
ui: false
status: Draft
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

# A-04 Load the county backbone: TCAD properties and owners, coordinates, and permits from every jurisdiction

| Field | Value |
| --- | --- |
| Parts | A-04 TCAD property and owner backbone · A-05 Coordinates · A-06 Permits from every jurisdiction (merged 2026-10-21; originals in [merged/](merged/)) |
| Evaluation point | A1 (primary) · A2 · A5 |
| Demo line(s) | D-3 (property, ownership, coordinate and permit records by source), D-8 (properties behind the radius search, with coordinates), D-9 (open roofing permits by open duration) |
| Agents | design `oracle` · builder `oracle` · reviewers `oracle`, `donphan` · verify `monitoring-county-ingestion` with the roll count matching, coverage SQL ≥ 99%, per-jurisdiction counts (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-01, A-02, A-03 |
| Size | 2.5 days |
| Branch | `004-property-backbone`, merged into `feature/oracle-pipeline` |

## Context

Every lead starts from a property, is found by radius, and is ranked by its permits. This story loads all three layers for the whole county in one loop.

**Part A-04, properties and owners.** The **roofing sales rep** (through the CRM) needs every Travis County parcel with its owner, mailing address, situs address and year built, and the **evaluator** checks that the published property count matches the appraisal district's own certified roll. Owner tenure (AC-39) and out-of-area owners (AC-40) also depend on this backbone. The denominator is the TCAD 2026 certified roll account count that A-01 records in `pipeline/docs/travis-sources.yaml`: measured **N = 493,246 accounts** (TCAD 2026 certified roll, streaming count, captured 2026-10-19T21:33:41Z; export SHA-256 `6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346`, re-verified 2026-10-21). Real anchor parcels from the Austin permit data: TCAD id `0208011301` (permit 1982-012866 BP) and `0223120506` (permit 2000-000025 BP). Austin's `tcad_id` carries the TCAD geoID (`propertyIdentification[].geoID` in the export), which is resolved to the property key `pID` (see `pipeline/oracle-runtime/travis/pilot/capture-tcad-subset.ts` and `docs/evidence/A-03.md`); "TCAD id" in this story means that geoID.

**Part A-05, coordinates.** Radius search ("within five miles of Pflugerville") is the CRM's core interaction (AC-10, AC-35), so a property without coordinates is invisible to every lead query. The **CRM developer** needs a coordinate on nearly every property, plus an honest reason for the rest. The Travis County GIS layer `TCAD.TC_USER.TCAD_PARCELS` returns at most **2,000 features per request**, is refreshed by TCAD every one to two months, has some parcels with null attributes, and **timed out** from the operator machine on 2026-10-17 and 2026-10-19. A-01 counted **373,683** GIS features from a US runner (2026-10-20T07:31:05Z), a **24.24%** gap below the roll, passed under the PO exception `docs/decisions/DEC-A-01-parcel-gap-exception.md`. The Austin permit dataset carries `latitude` / `longitude` and `tcad_id` on most rows (63,019 of 2,380,507 rows lacked `tcad_id` on 2026-10-17; re-measured 2026-10-21T18:54:53Z: 2,381,226 rows, 63,021 with no `tcad_id`).

**Part A-06, permits.** Open and long-stalled roofing permits are the strongest lead signal the README names (AC-4, AC-5, AC-37). The **roofing sales rep** needs every permit with its status, dates and open duration; the **evaluator** checks per-jurisdiction counts against each source. Facts (Austin `3syk-w9eu`, live 2026-10-19): **2,380,725** rows; **22,084** reroof description matches, of which 21,694 are `AUSTIN FULL PURPOSE`, 78 `AUSTIN LTD`, 50 `AUSTIN 2 MILE ETJ`, 3 `WEST LAKE HILLS FULL PURPOSE`, 6 `OTHER`, 250 no jurisdiction; **508** reroof rows have no `tcad_id` (97.7% have one). Oldest still-open reroof: **1982-012866 BP**, `Suspended`, issued 1982-06-23. **Every row's `:updated_at` was re-stamped between 12:22 and 12:43 UTC on 2026-10-19**, so `:updated_at > watermark` alone can return the whole dataset after a city republish. A-03 already built the Austin Socrata adapter for one month of reroof permits; this part extends it to the full backfill and the other jurisdictions.

Order inside the story: coordinates (Part A-05) need the roll (Part A-04) to join on; permit linking (Part A-06 AC-14) needs the roll too. The permit backfill itself does not.

## Description

As a **Roofing CRM developer and roofing sales rep (through the CRM)**, I want **every property on the TCAD certified roll loaded with its owner, a labelled coordinate and every permit from every supported jurisdiction**, so that **every lead search covers the whole county, radius searches return every eligible property, and long-open and stalled reroofs can be ranked as leads**.

When done:

- **Part A-04:** `county-seed-data`, `county-appraisal-onboarding` and `build-county-transform` run on the TCAD certified special export (JSON, or the fixed-width layout if A-01 chose it), first as a 25-parcel pilot and then for the full county, through `county-ingest-run` on the local stack. The property key is the TCAD identifier exactly as printed (P0-5). Confidentiality flags (Texas Tax Code §25.025) are applied before `validate`.
- **Part A-05:** parcel centroids from `TCAD_PARCELS` through the kit runtime's `arcgis-feature-service` adapter (2,000 per page, concurrency ≤ 2), joined on the TCAD id; the fallback is the Austin permit latitude/longitude through `tcad_id`. `coordinate_source` is recorded per property. GIS is compared with the roll; it is never used as the population.
- **Part A-06:** the Austin Socrata adapter does a full backfill paged by `:id`, keeps raw payloads and digests, and then runs incrementally from a watermark. Permits link to properties by `tcad_id`, with an address-hash fallback; unmatched permits are kept and counted. Roofing work is classified only by the frozen A-02 profile. Other jurisdictions use the matching kit vendor module, or carry the A-01 evidence that they have no public history.

**Independent test:** `monitoring-county-ingestion` reports the run complete; the Query DB property count equals the certified roll count, or each difference is classified; the coverage SQL `SELECT avg((latitude IS NOT NULL)::int) FROM v_property`, run over `v_property` bound to a local `elephant-cli export-tables` run (never uploaded), returns ≥ 0.99, the same count is taken from the Query DB, with a gap report listing every property without coordinates by reason; and per-jurisdiction permit counts equal each source's own count at the run watermark, with the roofing status split matching the profile.

## Acceptance Criteria

### Part A-04 TCAD property and owner backbone

1. **AC-1** · **Given** a 25-parcel pilot including TCAD ids `0208011301` and `0223120506`, **When** the transform runs, **Then** each pilot property has owner name, mailing address, situs address, year built (or a missing reason), the source URL, capture time and payload digest, and the transform coverage report shows every mapped field. (was A-04 AC-1) ☐ testable
2. **AC-2** (scale) · **Given** the full TCAD certified roll (account count N recorded by A-01), **When** the full-county ingest completes, **Then** the loaded count equals N minus proven dead/invalid minus confidential records, the total difference is under 2% of N, and every differing account is classified (dead, invalid, confidential, transform failure) with 0 unexplained. (was A-04 AC-2) ☐ testable
3. **AC-3** · **Given** owners whose mailing ZIP is outside the versioned Travis ZIP list, **When** the property is transformed, **Then** `owner_is_out_of_area = true` and `owner_area_class` is `regional` (a neighbouring county on the versioned regional list) or `out_of_area`, and the list's SHA-256 is stamped on the classification (AD-26). (was A-04 AC-3) ☐ testable
4. **AC-4** (missing data) · **Given** a property with no deed or sale date in the export, **When** its tenure is derived, **Then** `tenure_basis = unknown` and the property is never counted as tenure > 10 years; **Given** a property with no year built, **Then** its roof-age basis stays `unknown` with that reason. (was A-04 AC-4) ☐ testable
5. **AC-5** · **Given** records flagged confidential under §25.025, **When** the run prepares data for `validate`, **Then** owner fields are redacted before validation, the redacted count goes into the run's source limitations, which A-11 copies into the manifest, and no confidential owner name reaches the Query DB export path. (was A-04 AC-5) ☐ testable
6. **AC-6** (error) · **Given** TCAD downloads are still blocked (403) at ingest time, **When** the run starts, **Then** it stops in `WAITING_HUMAN` with the blocked receipt and does not load partial or stale data as if complete. (was A-04 AC-6) ☐ testable

### Part A-05 Coordinates

7. **AC-7** · **Given** TCAD id `0208011301`, **When** coordinates are attached, **Then** the property has `lat`, `lon` and `coordinate_source = gis_centroid` (frozen value, `contract/v1/columns.json`) with the GIS layer URL, capture time and digest as provenance. (was A-05 AC-1) ☐ testable
8. **AC-8** (scale) · **Given** the full roll from Part A-04 (N accounts), **When** the GIS layer is paged at 2,000 features per request, **Then** at least 99% of the N properties have coordinates, the GIS feature count and its difference from N are recorded, and the page count, duration and throughput are recorded for `docs/source-limits.md`. (was A-05 AC-2) ☐ testable
9. **AC-9** · **Given** a property with no GIS feature but an Austin permit carrying its `tcad_id` and a latitude/longitude, **When** the fallback runs, **Then** the property gets that point with `coordinate_source = permit_point` and the permit's source URL. (was A-05 AC-3) ☐ testable
10. **AC-10** (missing data) · **Given** a property with neither a GIS feature nor a permit point, **When** coverage is reported, **Then** it keeps `lat`/`lon` null with a reason (`no_gis_feature`, `gis_null_geometry`, `no_permit_point`) and is counted in the gap; no coordinate is geocoded from an address or invented. (was A-05 AC-4) ☐ testable
11. **AC-11** (error) · **Given** the GIS service times out (as on 2026-10-17 and 2026-10-19), **When** the adapter pages, **Then** it retries with backoff (1 s base, 60 s cap, 5 attempts), resumes from the last completed page after a restart, and if it still fails records `blocked` with the timestamp instead of publishing partial coverage as complete. (was A-05 AC-5) ☐ testable

### Part A-06 Permits from every jurisdiction

12. **AC-12** (scale) · **Given** the Austin dataset at the run watermark (2,380,725 rows on 2026-10-19; 2,381,226 re-measured 2026-10-21T18:54:53Z), **When** the full backfill completes, **Then** the captured row count equals the source count at that watermark, each row keeps its raw payload digest and source URL, and permits outside Travis County are counted separately, not dropped. (was A-06 AC-1) ☐ testable
13. **AC-13** · **Given** the 22,084 Austin reroof candidates, **When** linked to properties, **Then** at least 97% link to a roll property by `tcad_id` or address hash (AD-16), and every unmatched permit (for example the 508 with no `tcad_id`) is kept and counted with its reason. (was A-06 AC-2) ☐ testable
14. **AC-14** · **Given** the A-02 profile, **When** the reroof candidates are classified, **Then** the counts by `status_class` are reported against the 2026-10-19 baseline (open 129: Active 125, Suspended 2, Re Review 1, Pending Permit 1; stalled 2,213; closed 17,251; exclude 2,491), and permit 1982-012866 BP shows `status_raw = Suspended`, `status_class = open`, `open_days` = run `as_of` − 1982-06-23. (was A-06 AC-3) ☐ testable
15. **AC-15** · **Given** each jurisdiction classified in A-01, **When** the run finishes, **Then** every supported one has a captured count with source total and timestamp, and every records-request or no-history one is listed in the run's source limitations, which A-11 copies into the manifest, with its evidence URL. (was A-06 AC-4) ☐ testable
16. **AC-16** (missing data / error) · **Given** a permit with no `issue_date`, **When** `open_days` is derived, **Then** it is null with reason `no_issue_date`, not zero; **Given** Socrata re-stamps every `:updated_at` in one republish (as on 2026-10-19), **When** the incremental run reads the window, **Then** the adapter detects the source-wide re-stamp, compares row content digests, writes only rows whose content changed, and records "source bulk re-stamp; delta by content digest" as a limitation. (was A-06 AC-5) ☐ testable
17. **AC-17** · **Given** a 429 or 5xx from Socrata, **When** paging, **Then** the adapter backs off (1 s base, 60 s cap, 5 attempts), resumes from the last committed page after a stop, and never skips a page. (was A-06 AC-6) ☐ testable

## Edge cases (at least two)

- One TCAD account with several improvements → one property, improvements kept as children; year built taken from the main improvement, rule recorded. (A-04)
- Two accounts with the same situs address → both kept (key is the TCAD id); A-10 (now part of A-07) decides merges. (A-04)
- A supplemental export lands during the run → not mixed in; A-12 (now part of A-11) handles it as an incremental source. (A-04)
- Mailing address abroad or missing ZIP → `owner_area_class = out_of_area` only with evidence, otherwise `unknown`. (A-04)
- A parcel polygon whose centroid falls outside the polygon (L-shaped lots) → use the adapter's interior point if available; record which. (A-05)
- One TCAD id with several GIS features (split parcels) → one coordinate by a recorded rule; others counted. (A-05)
- A permit point far from the GIS centroid of the same parcel (> 0.5 mi) → keep GIS, flag the permit for review. (A-05)
- A permit appears in a later page with a new status → upsert by permit number + jurisdiction; history kept in the capture receipts. (A-06)
- A row disappears from the source (deleted upstream) → detected by the periodic key-set diff; written as a `source_removed` tombstone, not silently dropped. (A-06)
- Austin-issued permits located in Lakeway (6,825) or Pflugerville (1,117 full purpose) → kept as Austin-issued; never counted as those cities' own permits. (A-06)
- A description matches both include and exclude terms ("REROOF AND SOLAR") → profile rule decides; uncertain ones go to `needs_review`. (A-06)

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST transform owner, mailing, situs, year built, improvements and sale date with provenance (was A-04 FR-001) | AC-1 |
| FR-002 | System MUST reconcile the loaded count to the certified roll with every difference classified (was A-04 FR-002) | AC-2 |
| FR-003 | System MUST classify out-of-area owners from versioned lists (was A-04 FR-003) | AC-3 |
| FR-004 | System MUST mark unknown tenure and unknown roof-age basis with reasons (was A-04 FR-004) | AC-4 |
| FR-005 | System MUST apply §25.025 confidentiality before `validate` (was A-04 FR-005) | AC-5 |
| FR-006 | System MUST stop on a blocked source (was A-04 FR-006) | AC-6 |
| FR-007 | System MUST attach GIS centroids by TCAD id with provenance (was A-05 FR-001) | AC-7, AC-8 |
| FR-008 | System MUST fall back to permit points through `tcad_id` and label the source (was A-05 FR-002) | AC-9 |
| FR-009 | System MUST classify every property without coordinates (was A-05 FR-003) | AC-10 |
| FR-010 | System MUST page GIS politely and resume after failure (was A-05 FR-004) | AC-11 |
| FR-011 | System MUST backfill every Austin row with raw payload and digest (was A-06 FR-001) | AC-12 |
| FR-012 | System MUST link permits to properties and keep unmatched permits (was A-06 FR-002) | AC-13 |
| FR-013 | System MUST classify roofing and status only through the versioned profile (was A-06 FR-003) | AC-14 |
| FR-014 | System MUST record every jurisdiction's count or documented absence (was A-06 FR-004) | AC-15 |
| FR-015 | System MUST derive open days from real dates only and detect bulk re-stamps (was A-06 FR-005) | AC-16 |
| FR-016 | System MUST page with backoff and resume (was A-06 FR-006) | AC-17 |
| NFR-001 | Completeness: difference < 2% of the roll, 0 unexplained (was A-04 NFR-001) | AC-2 |
| NFR-002 | Source etiquette: bounded concurrency, backoff, no evasion (NFR-07) (was A-04 NFR-002) | AC-6 |
| NFR-003 | Coordinate coverage ≥ 99% of the roll (was A-05 NFR-001) | AC-8 |
| NFR-004 | GIS concurrency ≤ 2, backoff on failure (NFR-07) (was A-05 NFR-002) | AC-11 |
| NFR-005 | ≥ 97% of Austin roofing permits matched; every unmatched one counted (AD-16) (was A-06 NFR-001) | AC-13 |
| NFR-006 | ≤ 50,000 rows per page with app token; backoff on 429/5xx (NFR-07) (was A-06 NFR-002) | AC-17 |

## Prototype reference

Not a UI story. Its counts appear on `design/prototype/Coverage1440.dc.html` and its fields on `design/prototype/Property1440.dc.html`; coordinates show as "Lat, lon" and "Mi + bearing" columns on `design/prototype/ExploreQ-roof15.dc.html`; permit chips ("Stalled 6.4 yrs · source says Expired") appear on `design/prototype/ExploreQ-permits5.dc.html` (all through A-13).

## Demo Script

1. Presenter: "Show the total uploaded records by source." → Expected: property and ownership counts next to the TCAD certified roll count, plus coordinate and permit counts by source.
2. Presenter: "Using the UI, show properties within a sample radius that have roofs older than 15 years." → Expected: each result carries coordinates and their source.
3. Presenter: "Show properties in that area with open roofing permits, prioritizing permits that have remained open for many years, including contractor and BBB rating where available." → Expected: the permits, statuses and open days loaded here, ranked by A-13.

## Out of scope

- Address geocoding services (no invented coordinates).
- The map view (not Task A scope, `docs/02-design.md` § 3).
- Contractor identity and BBB, merges and roof age (A-07, which now includes A-08 to A-10).
- Publication and the scheduled refresh (A-11, which now includes A-12).

## Evidence to capture

- `docs/evidence/A-04.md`, one section per part:
  - Part A-04: pilot output for the 25 parcels, roll count vs loaded count with the classified difference, confidential count, `monitoring-county-ingestion` report.
  - Part A-05: coverage SQL output, GIS count vs roll count, gap by reason, paging throughput.
  - Part A-06: per-jurisdiction counts vs source totals, match rate, unmatched by reason, status-class split, backfill throughput, re-stamp detection log.
- `testplans/A-04-test-cases.md` results, `docs/reviews/CR-A-04.md`.

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☐ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☐ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☐ |
| G4-4 | One scale AC and one missing-data or error AC | ☐ |
| G4-5 | At least two edge cases | ☐ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☐ |
| G4-7 | Prototype screen linked (UI stories) | ☐ |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☐ |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☐ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☐ |

**Decision:** ☐ Ready ☐ Returned, reason: {…} · {date}
