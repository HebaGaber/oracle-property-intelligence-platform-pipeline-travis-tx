# A-13 evidence: demo area for D-8 and D-9 (AC-5 demo-area note)

**Decision:** Austin city (PO D-11, round R4, 2026-10-22: "Austin city (Recommended)"). A-14 reuses it for its demo lines D-10 and D-11.

**Why not Pflugerville:** on the published run, Pflugerville (30.447765, −97.602116, 5 mi) holds 0 properties and 0 reroof permits. The story's 2026-10-19 reference (44 Austin reroofs, 3 Expired, 0 open) came from the full Austin dataset; the published run holds only one month of it.

## Measurement (2026-10-21 21:59–22:02 UTC; re-measured at run time by TC-009)

Run `travis-202609-permits-20261021t103516z`, manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`. All 23 table parts were fetched from the public Pinata gateway and matched the manifest sha256 and size; queried with the repo's own `bindManifest` and `exploreSearchSql` on the Node DuckDB engine. Within 5 mi of each gazetteer place (travis-places@1.0.0):

| Place | Properties with an open or stalled reroof | Open reroofs | Stalled | Longest open | Reroofs in radius (all statuses) | Roof ≥ 15 yrs |
| --- | --- | --- | --- | --- | --- | --- |
| **Austin city** | 3 | 16 | 0 | 0.13 yrs (47 d) | 17 | 3 |
| Rollingwood city | 3 | 3 | 0 | 0.13 yrs | 5 | 3 |
| Sunset Valley city | 3 | 4 | 0 | 0.13 yrs | 13 | 2 |
| Pflugerville | 0 | 0 | 0 | none | 0 | 0 |

The run holds 14 properties and 35 reroof permits (22 open, 13 closed, 0 stalled).

## What the demo shows today, honestly

- **D-8** (Austin city, 5 mi, roof ≥ 15 yrs): 3 properties, each with roof-age basis, confidence, coordinates and source.
- **D-9** (open or stalled, open ≥ 5 yrs, longest first): no permit has been open that long in this run, so the page shows "no open roofing permits in this radius on the current run". Stalled permits are not emitted yet (`improvement_status` has no Expired carrier, ADR-0002 D-4a).
- With A-04, A-07 and A-11 (full county, all permit years) the same area shows the long-open and stalled list; this file is re-measured then.

Hosted p95 and the 5 → 3 mi change are recorded in `A-13-roof-age.md` after the hosted run.
