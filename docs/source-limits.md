# Source limits and measured throughput (A-04, 2026-10-22)

Facts for A-11 (publish and incremental runs). All numbers are measured in this repository's runs; the run log (`specs/004-property-backbone/run-log.md`) has the job ids.

| Source | Access | Measured | Etiquette and limits |
| --- | --- | --- | --- |
| TCAD 2026 certified JSON export | one file on disk, SHA-256 `6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346`, 3,554,021,795 B (29.86 GB uncompressed), 493,246 records, key `pID` | streaming scan ≈ 10 min; full load 21.7 min at 260 → 382 records/s (2,000-record chunks, 3 in flight, 1 s pause) | no new download without a stop; one 403 or a SHA-256 mismatch ends in `WAITING_HUMAN`; never a retry with another identity |
| Austin Socrata `3syk-w9eu` | keyset pages `$order=:id`, 50,000 rows, no app token | 48 pages, 2,381,226 rows, 31 min (35–45 s per ~88 MB page); 1 page timed out and succeeded on attempt 2 | ≤ 1 request/s, project User-Agent, page timeout 5 min, up to 5 attempts with backoff (1 s base, 60 s cap, full jitter); 403 or challenge: stop, no retry; `date_trunc_ymdh` does not exist: use `date_trunc_ymd` + `date_extract_hh` on `to_floating_timestamp(:updated_at,'UTC')` |
| Travis County GIS layer 6 | **not reachable from the operator machine**; GitHub-hosted US runner only (DEC-A-04-gis-runner) | 187 pages of 2,000 features, 373,683 features, 81.6 s at concurrency 2; ids sent as a POST form body (a 2,000-id URL fails) | concurrency ≤ 2; fields `OBJECTID`, `PROP_ID`, `geo_id` only; layer fields include owner and address columns that are never requested |
| `elephant-cli` 44bb182 (local) | validate / hash / export-tables | validate of loose files 0.50 s per property (≈ 61 h for the county); `validate <county.car>` ≈ 13 ms per property (≈ 9–10 min per 44,000); hash ≈ 13 ms per property; export-tables ≈ 25 s per 44,000 | validate the CAR for the whole county; validate loose files only for samples |

## Limitations carried in the run report (A-11 copies them into the manifest)

- Confidential owner records redacted (conservative rule on sale-confidentiality codes): 15,410 accounts; the export carries no owner-level §25.025 marker.
- `property_type` of 28,595 real-estate accounts is a generic fallback (`Building` with an improvement, `LandParcel` without); A4 (54,675 accounts, `Townhouse`, deprecated and unverified) and F4 (2,891) are listed.
- `tenure_years` comes from the latest dated sale, which may not be the current owner's.
- Austin roofing-permit match rate 88.36% (PO exception `DEC-A-04-permit-match-rate`); coverage of map points 99.63% of ordinary land parcels and 28.43% of condo-coded accounts (`DEC-A-04-coverage-exception`).
- 22 jurisdictions are `records request`, not filed; each carries its evidence URL in the report.

## Machine notes (16 GiB laptop)

Docker's engine was killed twice by memory exhaustion during one-shot database scans; long steps run in small batches with a health gate (waits up to 30 minutes for Postgres). Disk: the County group is 2.3 GB, the ten county archives 2.2 GB, the exported tables 0.5 GB, the Query DB 6 GB.
