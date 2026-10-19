---
id: DM-A-01
parent: PLAN-A-01
---

# Data model: A-01 Discover Travis County sources

All entities are internal (catalog file, receipts, run record). Nothing here is published. Exact keys are in [contracts/catalog.md](contracts/catalog.md) and [contracts/capture-receipt.md](contracts/capture-receipt.md).

## Measurement

Every number in the catalog is a Measurement, never a bare value (FR-007a).

| Field | Rule |
| --- | --- |
| `value` | number, or `null` with `missing_reason` |
| `missing_reason` | required when `value` is `null` (for example "TCAD blocked: HTTP 403 at 2026-10-19T09:12Z") |
| `source_url` | required; the exact query or file URL |
| `captured_at` | required; UTC ISO-8601 |
| `method` / `query` | how it was measured (`count(*)`, `returnCountOnly`, streaming count) |

## Source (one row per A-oracle § 4 source)

| Field | Rule |
| --- | --- |
| `key` | one of `tcad_certified`, `tcad_supplemental`, `tcad_gis`, `austin_permits`, `other_jurisdictions`, `tx_comptroller`, `bbb`, `overture`, `contractor_licensing` (all 9 required) |
| `status` | `available` or `blocked` |
| `denominator` | Measurement (Comptroller: `travis_coded_rows` is the denominator, plus `statewide_rows`) |
| `throughput` | Throughput, or `download_rate` for single-file sources |
| `anti_bot` | rate limits observed, challenge seen, `app_token_used` |
| `projected_full_capture_hours` | number; derived (denominator ÷ median rate ÷ 60) |
| `decision` | `bulk download` \| `ingest` \| `runtime retrieval`; required when projected hours > 48, and always present |
| `decision_reason` | required with `decision` |
| `blocked_evidence` | required when `status: blocked` |

## Throughput

`rows_per_minute_median`, `pages_read` (≥ 3), `page_size` (≤ 50,000), `window_start`, `window_end`, `app_token_used`, `rate_limits_observed`.

## Parcel (TCAD roll vs GIS)

`canonical_source` (TCAD 2026 certified roll), `assessed_parcel_count` (Measurement), `roll_year` (2026), `certification_date`, `identifier_name` (`prop_id` or `geo_id`, as printed), `identifier_proven`, `identifier_format`, `deed_or_sale_dates_present`, `gis_feature_count` (Measurement), `gap_pct` (number or `unknown` + reason), `discrepancy_threshold_pct: 2.0`, `discrepancy_explanation`, `separately_assessed_without_geometry` (`acknowledged` | `none`, required when GIS is below the roll), `export_receipt` (Capture receipt of the one download).

Rules: the roll is always the denominator; a gap above 2% blocks GIS-only seeding; a null GIS count gives `gap_pct: unknown` with a reason, enforced by the checker (oracle risk 3).

## Permit jurisdiction

| Field | Rule |
| --- | --- |
| `jurisdiction`, `key` | name as in the Census list; stable key |
| `spec_class` | `supported` \| `records request` \| `no public history` |
| `status` | validator word derived from `spec_class` + case ([research R3](research.md#r3-spec-classes-vs-validator-statuses)) |
| `historical_records` | boolean, required on every row |
| `portal_kind`, `portal` | `application-intake` for one-stop or intake portals, which never have `historical_records: true` |
| `evidence_url`, `evidence_captured_at` | required |
| `earliest_record_date` | for "supported from {year}" |
| `records_request` | required for `custodian-only`, `manual-only`, `blocked` |
| `issued_by` | required for `delegated` |
| `austin_issued_located_here` | Measurement; informational, never changes the row's own status |

Set rule: the row count equals `census_reference.place_count + 1` (unincorporated), and no row is `needs-review`.

## Records request

`recipient_office`, `system_scope` (system and date range), `route` (`api-first` | `records-first`), and `request_portal_url` or `request_email`. All required to count as complete (validator rule 5).

## Blocked evidence

`http_status` or `timeout_ms`, `captured_at`, `url`, `evidence_path` (committed file with headers and a body excerpt, no secrets), `body_sha256`, `geo_signal` (`none` or the quoted signal; only a quoted signal permits the US check, FR-006b).

## Destination proof

`writes_in_scope: true`, `proven: true`, `independent_identity_sources` (2 entries: Docker-side container ID + image digest; SQL-side system identifier + database + version). No URLs or passwords.

## Census reference

`dataset`, `vintage`, `source_url`, `captured_at`, `place_count`.

## Capture receipt (internal)

`url`, `method`, `status`, `bytes`, `sha256`, `captured_at`, `user_agent`, `attempts`, `outcome` (`ok` | `blocked` | `throttled-then-ok` | `failed`).

## Discovery run (state machine)

```text
DISCOVERING ──all probes ok──────────────────────────▶ READY (validator exit 0)
     │
     └─any source blocked─▶ WAITING_HUMAN ──human resolves: captured──▶ DISCOVERING (re-probe that source)
                                  │
                                  └──human resolves: still blocked + records request──▶ WAITING_HUMAN (documented blocker; story judged per FR-006c)
```

`READY` never auto-advances to seed (A-04). Each probe step is journaled with the idempotency key `source:measurement:captured_date`.
