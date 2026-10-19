---
id: A-01
type: user-story
title: Discover Travis County sources and pass readiness preflight
parent: FEAT-A01
vision: VIS-A
ard: ARD-A
eval_point: A1
priority: P1
moscow: Must
branch: 001-discover-sources
spec: specs/001-discover-sources/
depends_on: []
size_days: 1
agents:
  design: [oracle]
  builder: oracle
  reviewers: [oracle]
  verify: "readiness validator exits 0"
skills: [onboard-county, county-discovery, county-readiness-preflight, bootstrap-oracle-infra, apply-engineering-guidelines]
ui: false
status: Draft
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

# A-01 Discover Travis County sources and pass readiness preflight

| Field | Value |
| --- | --- |
| Evaluation point | A1 (primary) |
| Demo line(s) | D-2 (source list, documented limitations), D-3 (denominators per source) |
| Agents | design `oracle` · builder `oracle` · reviewers `oracle` · verify readiness validator exits 0 (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | none |
| Size | 1 day |
| Branch | `001-discover-sources`, merged into `feature/oracle-pipeline` |

## Context

Coverage is the heaviest evaluation point (A1, 10 of 40), and "all available" only means something if every Travis County source is listed, measured and classified before anything is downloaded. The **Oracle operator** needs to know each source's size, speed and access rules; the **evaluator** later checks every coverage number against these denominators. The kit's readiness validator fails closed, so nothing is ingested until it passes.

Facts already known (live queries, 2026-10-19 unless stated): Austin Socrata `3syk-w9eu` has **2,380,725** rows; the TX Comptroller franchise-tax dataset `9cir-efmm` has **342,334** rows with Travis county code `227`; `traviscad.org/publicinformation` answered **HTTP 403** on 2026-10-17 and 2026-10-19 from the operator machine; the Travis County GIS `TCAD_PARCELS` layer timed out on both days; BBB answered with a Cloudflare bot challenge (2026-10-17).

## Description

As the **Oracle operator**, I want **every public Travis County source and permit jurisdiction discovered, measured and classified, with the readiness validator passing**, so that **full-county ingestion starts from known denominators, known speeds and known access limits instead of guesses**.

When done, `pipeline/docs/travis-sources.yaml` (shaped like the kit's `duval-sources.yaml`) and its readable summary `docs/sources.md` list each source with its denominator, measured throughput, anti-bot posture and a bulk / ingest / runtime-retrieval decision. Every permit jurisdiction is classified as supported, records request or no public history, with evidence. The TCAD Export Layouts and the Certified Special Export (JSON) are downloaded into `pipeline/data/raw/tcad/` (gitignored) if the source allows it within its terms.

**Independent test:** run the `county-readiness-preflight` validator against `pipeline/docs/travis-sources.yaml` for FIPS 48453; it exits 0, and every number in `docs/sources.md` has a source URL and a capture time.

## Acceptance Criteria

1. **AC-1** · **Given** the local Restate + Postgres stack is up and the kit flow `onboard-county` → `county-discovery` → `county-readiness-preflight` runs for Travis County (FIPS 48453), **When** the validator runs on `pipeline/docs/travis-sources.yaml`, **Then** it exits 0 and the file names every source in `reference/A-oracle.md` § 4 (TCAD certified + supplemental exports, TCAD parcel GIS, Austin permits, other jurisdictions, TX Comptroller, BBB, Overture). ☐ testable
2. **AC-2** · **Given** the Austin permits dataset `3syk-w9eu`, **When** discovery measures it, **Then** the YAML records its row count (2,380,725 on 2026-10-19, re-measured at capture), its `tcad_id` null count (63,019 on 2026-10-17), the measured rows-per-minute at ≤ 50,000 rows per page, the projected full-backfill hours, and the decision "ingest" or "bulk" with the reason. ☐ testable
3. **AC-3** · **Given** the TCAD certified roll, **When** discovery reads it, **Then** the YAML records the **certified account count** (the property denominator, ASM-6), the chosen property key (`prop_id` or `geo_id`, exactly as printed; ARD § 7), whether deed or sale dates are present (needed for tenure), and the GIS feature count with its difference from the roll. ☐ testable
4. **AC-4** (scale) · **Given** every permit jurisdiction in Travis County (at least the 18 named in `reference/A-oracle.md` § 4: Travis County unincorporated, Austin, Pflugerville, Lakeway, Bee Cave, West Lake Hills, Manor, Sunset Valley, Rollingwood, Lago Vista, Jonestown, Briarcliff, Creedmoor, Mustang Ridge, Webberville, and the Travis parts of Cedar Park, Leander and Round Rock, plus any other municipality discovery finds), **When** preflight classifies them, **Then** each has exactly one class (supported / records request / no public history) with an evidence URL and date, and Austin-issued records located elsewhere (Lakeway 6,825; Bee Cave 4,822; Pflugerville 1,117 full purpose + 592 ETJ) are recorded as Austin-issued, not as those cities' own permits. ☐ testable
5. **AC-5** · **Given** any source whose full capture is projected above 48 hours, **When** the YAML is written, **Then** it carries an explicit decision (download, ingest or runtime retrieval) and the measurement behind it. ☐ testable
6. **AC-6** (missing data / error) · **Given** `traviscad.org/publicinformation` returns HTTP 403 (as on 2026-10-17 and 2026-10-19) or the GIS layer times out, **When** discovery reaches it, **Then** the source is recorded as `blocked` with the response code, time and evidence, the run moves to `WAITING_HUMAN`, nothing is retried with a changed IP or user agent, and the YAML names the lawful next step (a US GitHub Actions runner **only** if the evidence shows a geo-block, otherwise a records request; ARD § 8). Seed, pilot and full ingest for that source stay stopped until it is resolved. ☐ testable

## Edge cases (at least two)

- A jurisdiction's portal exists but shows no permit history before a given year → classify as "supported from {year}", record the earliest date seen.
- The Austin row count changes between discovery and backfill → store the count with its capture time; A-06 reconciles to the count at its own watermark.
- Socrata answers 429 during throughput measurement → back off (1 s base, 60 s cap, 5 attempts), record the observed limit in the YAML.
- The TCAD JSON special export lacks a field the legacy fixed-width layout has (for example the deed date) → record both layouts and which one A-04 uses.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST run the kit flow `onboard-county` → `county-discovery` → `county-readiness-preflight` and keep the validator's exit code as evidence | AC-1 |
| FR-002 | System MUST record denominator, throughput, anti-bot posture and decision for every source | AC-2, AC-3, AC-5 |
| FR-003 | System MUST classify every permit jurisdiction with evidence | AC-4 |
| FR-004 | System MUST record a blocked source as `blocked` and stop, never evade | AC-6 |
| NFR-001 | Source etiquette: concurrency ≤ 2 per source, backoff on 429/5xx, identified user agent, 0 CAPTCHA bypasses (NFR-07) | AC-2, AC-6 |

## Prototype reference

Not a UI story. Its numbers appear later on the Coverage screen (`design/prototype/Coverage1440.dc.html`) through the manifest `coverage` section (AD-04).

## Demo Script

1. Presenter: "First, I am opening the pipeline run summary." → Expected: the source list and documented limitations on the Runs page come from this story's classification (shown through A-13).
2. Presenter: "Show the total uploaded records by source." → Expected: each count sits next to the denominator recorded here.

## Out of scope

- Downloading or ingesting full datasets (A-04 to A-09).
- Requesting the BBB API key or filing records requests (recorded as next steps only).

## Evidence to capture

- `docs/evidence/A-01.md`: validator output with exit code, the YAML digest, one row per source with URL, count and capture time.
- `docs/evidence/A-01-coverage.md` (started here; completed in A-11 with the published counts).
- `testplans/A-01-test-cases.md` results, `docs/reviews/CR-A01.md`.

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
