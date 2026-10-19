---
id: A-03
type: user-story
title: Publish one month of Austin roofing permits by CID and show them in the hosted UI
parent: FEAT-A03
vision: VIS-A
ard: ARD-A
eval_point: A4
priority: P1
moscow: Must
branch: 003-walking-skeleton
spec: specs/003-walking-skeleton/
depends_on: [A-01, A-02]
size_days: 1.5
agents:
  design: [metagross, oracle]
  builder: [metagross, oracle]   # AGENT-MAP: metagross (app), oracle (publish)
  reviewers: [metagross, oracle]
  verify: "Playwright demo line 1 + `verify-manifest`"
skills: [build-frontend-backends, integrate-ci-cd, use-oracle, county-permit-adapter, responsive-design-tests, apply-engineering-guidelines]
ui: true
status: Draft
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

# A-03 Publish one month of Austin roofing permits by CID and show them in the hosted UI

| Field | Value |
| --- | --- |
| Evaluation point | A4 (primary) · A5 |
| Demo line(s) | D-1 (opening: data on IPFS, queryable through DuckDB), D-2 (Runs page), D-4 (DuckDB in the browser) |
| Agents | design `metagross`, `oracle` · builder `metagross` (app), `oracle` (publish) · reviewers `metagross`, `oracle` · verify Playwright demo line 1 + `verify-manifest` (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-01, A-02 |
| Size | 1.5 days |
| Branch | `003-walking-skeleton`, merged into `feature/oracle-pipeline` |

## Context

The **evaluator** scores only what runs on the hosted URL, so a thin end-to-end slice must be live before scale is added: source → kit runtime → `elephant-cli` → IPFS → hosted page. It also proves the zero-idle-cost read path before the full county depends on it.

Real slice (Austin `3syk-w9eu`, live query 2026-10-19): **42** permits issued in September 2026 match the reroof description terms (2026 so far: 270). The final count after the A-02 profile runs is whatever the manifest records.

## Description

As a **CRM developer**, I want **one real month of Austin reroof permits published as CIDv1 artifacts and listed on the hosted CountyLens site through DuckDB-WASM**, so that **I can see the whole path from public source to public CID to query working before the full county lands**.

When done: the Turborepo scaffold (`apps/web`, `apps/api`, `packages/*`, `pipeline/*`, `infra/` with the five CDK stacks, AD-23), CI, the vendored kit runtime in `pipeline/oracle-runtime` with a Travis county folder, a minimal Socrata adapter for September 2026 reroof permits, the exact publication sequence (validate → hash → validate CAR → export-tables → upload with readback), `runs/{runId}/manifest.json`, `runs/index.json`, and a hosted Runs page and Permits list that read the CID through DuckDB-WASM.

**Before Stage 3:** the 4-hour read-path spike (`docs/decisions/0001-read-path.md`) measures p50/p95 for COUNT, radius and roof-age queries through both the S3 + CloudFront CID copy and the Filebase gateway, plain GETs on ipfs.io and dweb.link, the Filebase plan limits, and the projected full-county size, and chooses the `export-tables` part size.

**Overrides applied (ARD § 15, AD-30):** the domain is `countylens.aldarraj.com` through Namecheap CNAMEs (ASM-8, AD-13), not `explorer.{domain}`; reads go through the S3 + CloudFront CID copy with Filebase as the labelled fallback (AD-02), not Filebase range reads; the spike measures both. No IPNS (AD-03).

**Independent test:** open `https://countylens.aldarraj.com/runs` (or the Amplify branch URL), see the run; open the Permits list, see the September 2026 rows; run `npx tsx scripts/verify-manifest.ts runs/{runId}/manifest.json`.

## Acceptance Criteria

1. **AC-1** · **Given** September 2026 Austin reroof permits captured through the kit runtime, **When** the publication sequence runs, **Then** each step runs in order with no step skipped (a test asserts the order), the manifest lists every artifact with a CIDv1 (`bafy…`), name, codec, size and SHA-256, and the tables directory has a `carCid`. ☐ testable
2. **AC-2** · **Given** the hosted site, **When** the evaluator opens Runs, **Then** it shows the run's ID, start and finish time (UTC), the source "City of Austin Issued Construction Permits (3syk-w9eu)", the record count from the manifest, and the manifest CID; Playwright on the hosted URL checks it (demo line D-2). ☐ testable
3. **AC-3** · **Given** the Permits list, **When** it loads, **Then** DuckDB-WASM in the browser reads the CID copy and lists every published September 2026 reroof permit with permit number, `status_raw`, `issue_date`, contractor as printed, and provenance (source URL, capture time, table CID, run); the engine line says "DuckDB-WASM in your browser · read-only" and no database server is involved. ☐ testable
4. **AC-4** (scale) · **Given** the read-path spike's full-size Parquet of the 2,380,725-row Austin permit table, **When** 20 timed runs query it through the CID copy, **Then** COUNT, bounding-box + haversine radius and roof-age filters each have p95 < 3 s and the first DuckDB load is ≤ 8 s with a progress bar; if p95 ≥ 3 s, the decision record switches to the Lambda DuckDB fallback before Stage 3. ☐ testable
5. **AC-5** (missing data / error) · **Given** a published permit with no `tcad_id` (508 of the 22,084 reroof candidates on 2026-10-19) or no printed contractor, **When** it is listed, **Then** the row shows "No TCAD id on source record" or "Contractor not printed on permit" as its missing reason, never a blank; and **Given** the CID copy is unreachable, **When** the page loads, **Then** it reads through the Filebase gateway and labels the result "fallback". ☐ testable
6. **AC-6** · **Given** `verify-manifest` runs against the run's manifest, **When** it fetches every artifact from ipfs.io and dweb.link, **Then** sizes and SHA-256 match and it prints `ALL ARTIFACTS VERIFIED`. ☐ testable
7. **AC-7** (observability) · **Given** the deployed `CountyLensApi` and `CountyLensOps` stacks, **When** the hosted Runs page calls the API once, **Then** the Lambda writes one JSON log line through Powertools Logger with the request's correlation ID, an X-Ray trace with the DuckDB query as a subsegment, and a `QueryDurationMs` metric; log groups keep 14 days (query log 30 days); every queue has a DLQ with one self-resolving CloudWatch alarm that emails the operator through SNS (D-04, PagerDuty substitute); the `$10` AWS Budget alert exists; CDK assertions check all of these, and the trace ID is written into `docs/evidence/A-03.md`. ☐ testable

## Edge cases (at least two)

- Fewer than 42 permits survive the profile (some descriptions are solar or RTU work) → the page shows the manifest's count; nothing is padded.
- The Amplify certificate is still pending on `countylens.aldarraj.com` → the Amplify branch URL is the hosted runtime (ASM-8); evidence names which URL was used.
- `aws lambda get-account-settings` shows a total concurrency limit of 10 → no reserved concurrency (AD-11); API throttles only.
- Loading state while DuckDB-WASM initialises → progress bar, no empty table flash.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST publish only `elephant-cli export-tables` output in the fixed order | AC-1, AC-6 |
| FR-002 | Hosted Runs page MUST read `runs/index.json` and the manifest by CID | AC-2 |
| FR-003 | Permits list MUST query through DuckDB-WASM over the CID copy and show provenance per row | AC-3 |
| FR-004 | System MUST show a missing reason for absent fields and label fallback reads | AC-5 |
| NFR-001 | Browser query p95 < 3 s; first load ≤ 8 s (NFR-01) | AC-4 |
| NFR-002 | $0.00 fixed per month while idle; no Route 53 zone (AD-13); budget alert at $10 (NFR-02) | AC-2 |
| NFR-003 | Responsive at 390 / 768 / 1440 with Atlas tokens only (NFR-08) | AC-2, AC-3 |
| FR-005 | Every Lambda MUST use Powertools Logger, Tracer and Metrics with X-Ray active; every queue MUST have a DLQ and one alarm | AC-7 |
| NFR-004 | Observability: JSON logs, X-Ray on 100% of hosted requests, logs 14 days / query log 30 days, one alarm per DLQ (NFR-03); API p95 < 1 s warm, cold start incl. DuckDB init < 3 s | AC-7 |

## Prototype reference (mandatory if the story has UI)

| Element | Value |
| --- | --- |
| Claude Design screen | `design/prototype/Runs1440.dc.html`, `design/prototype/ExploreQ-sqlperm.dc.html`, `design/prototype/ShellStates.dc.html` |
| States covered | loading · populated · fallback · error |
| Design system | `assessment-guide/design-system/` (Atlas, Material 3, mobile-first) |

## Demo Script

1. Presenter: "First, I am opening the pipeline run summary." → Expected: the run with source, count, UTC timestamps and manifest CID.
2. Presenter: "Now I am opening the DuckDB-backed query layer." → Expected: permit rows queried in the browser, with the engine line showing no database server.

## Out of scope

- Full-county data, coverage page, verify button (A-04 to A-13).
- Admin sign-in and run controls (built last, AD-12).

## Evidence to capture

- `docs/evidence/A-03.md`: hosted URL, build SHA from `/build.json`, manifest CID, `verify-manifest` output, Playwright trace, spike p95 table, one CloudWatch log line and X-Ray trace ID, CDK assertion output.
- `docs/decisions/0001-read-path.md`.
- `testplans/A-03-test-cases.md` results, `docs/reviews/CR-A-03.md`.

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
