---
id: A-13
type: user-story
title: Build the Explorer UI with its hub, legal, catalog and Coming soon pages
parts: [A-13, A-18]
parent: [FEAT-A13, FEAT-A18]
vision: VIS-A
ard: ARD-A
eval_point: A5
priority: P1
moscow: Must
branch: 013-explorer-and-pages
spec: specs/013-explorer-and-pages/
depends_on: [A-02, A-03]
size_days: 2.5
agents:
  design: [metagross]
  builder: metagross
  reviewers: [metagross, audino]
  verify: "Playwright demo lines 1–8; Playwright: every page and Coming soon item renders; no sample data on the hosted site"
skills: [build-frontend-backends, frontend-bug-fix, responsive-design-tests, apply-engineering-guidelines]
ui: true
status: Draft
gate: G4
qc_testability_signoff: false
created: 2026-10-19
merged: 2026-10-21
---

# A-13 Build the Explorer UI with its hub, legal, catalog and Coming soon pages

**Merged story (2026-10-21).** This story combines the former stories **A-13** (Explorer UI) and **A-18** (content pages) so the story loop runs once. The original files are in [stories/merged/](merged/). Each AC, FR and NFR keeps a "was" tag pointing to its original ID, so the feature list and the traceability matrix still resolve.

| Field | Value |
| --- | --- |
| Evaluation point | A5 (primary) · A1, A2, A3, A4 |
| Demo line(s) | D-1 (opening: the Hub), D-2, D-3, D-4, D-5, D-6, D-7, D-8, D-9 |
| Agents | design `metagross` · builder `metagross` · reviewers `metagross`, `audino` · verify Playwright demo lines 1–8, plus every page and Coming soon item renders with no sample data on the hosted site (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-02, A-03. The full-county values, the 3-run history, the AC-6 scale test, AC-12 and G7 wait for A-11 (now including the incremental runs) |
| Size | 2.5 days (A-13 1.5 + A-18 1) |
| Branch | `013-explorer-and-pages`, merged into `feature/oracle-pipeline` |

| Part | Was | Priority | ACs | FRs |
| --- | --- | --- | --- | --- |
| 1 Explorer | A-13 | Must (P1) | AC-1 to AC-8 | FR-001 to FR-005 |
| 2 Hub, legal, catalog and Coming soon pages | A-18 | **Should (P3):** built after every Part 1 AC passes on the hosted URL; cut first if time runs out | AC-9 to AC-14 | FR-006 to FR-010 |

## Context

Most demo lines are shown in this UI, so it carries the visible half of almost every evaluation point. The **evaluator** walks D-1 to D-9 in order on the hosted URL; the **CRM developer** uses the same screens to judge the data. Every value must come from the published manifest and elephant-cli tables, with provenance, and every gap must say why (P0-11, P0-12).

The approved design (`docs/02-design.md` § 3) also has pages the demo doesn't need: a Hub landing page, Legal pages, a Data Catalog, a Runs log, and features the PO wants visible as a roadmap. The evaluator should see a finished-looking product, with the extra ideas shown as **"Must vs Coming soon"** rather than broken links (02-design § 3, "Presenting the breadth"). The CRM developer uses the catalog and legal pages to know what each published table is and under which terms it can be reused.

Real demo area (Austin permits, live 2026-10-19): within 5 miles of Pflugerville's Census internal point (GEOID 4857176, 30.447765, −97.602116, from the A-02 gazetteer) there are **44** Austin reroof permits: 41 `Final`, **3 `Expired`** (stalled: 2004-011296 BP, 2018-111955 BP, 2022-098180 BP) and **0 open**. Pflugerville's own permits come only if A-01 classifies its portal as supported. County-wide, the oldest open reroof is 1982-012866 BP (`Suspended`).

**Data rule (P0-12, constitution XI, CLAUDE.md):** nothing on the hosted site may show sample, prototype or invented data. Pages show **real** published data or **static text**. Coming soon items describe the planned feature and why it isn't live, never with example values.

## Description

As the **evaluator** (and the CRM developer), I want **one hosted explorer that shows runs, coverage, the manifest with live two-gateway verification, a SQL panel and roofing-lead searches by radius, roof age, open permits, tenure and out-of-area owners, reached from a Hub, with legal and data-licence pages, a data catalog and run log built from the published files, and every planned feature clearly marked Coming soon**, so that **I can check every demo claim on real Travis County records in the browser, with no Oracle-hosted database, and the product is honest about what exists today and what comes next**.

When done:
- **Part 1 (Explorer):** Atlas-only routes per `docs/02-design.md` § 1–2: Runs (+ Compare, run chain), Coverage (counts vs denominators, limitations, merge statistic), Data · Manifest and Verify (plain GET to ipfs.io and dweb.link, SHA-256 in the browser, 429 → retry → clear state), Explore · Filters (area as a place or a point `at`, radius, roof-age threshold, open/stalled permits with `openYrs`, tenure > 10, out-of-area owners; List view with Mi + bearing, Lat, lon, Source), Explore · SQL, Property drawer, and Help · MCP. All queries come from `packages/query-core`. One Playwright test per demo line D-2 to D-9 on the hosted URL.
- **Part 2 (pages):**
  - **Built with real data or static text:**
    - **Hub** (`/`): the CountyLens card (Open, What can I ask?), the Roofing CRM card "Coming soon · Not deployed yet" until Task B is live, run status chip from `runs/index.json`, Watch demo and PR links (wired at release).
    - **Legal** (`/legal/data`, `/legal/privacy`, `/legal/terms`): static text naming every source, its licence or terms, and the access rules (stop on 403, no CAPTCHA bypass).
    - **Data · Catalog** (`/data/catalog`): one row per published table from `tables-export.json` of the latest manifest, with columns, row count, CID and size.
    - **Runs · Log** (`/runs/log`): real run events from the manifests (start, publish, verify, finish, limitations).
  - **Could** (build only after every demo line D-1 to D-12 passes; otherwise Coming soon): run timeline scrubber over `runs/index.json`; gateway race (both Verify lanes timed side by side).
  - **Coming soon, shown as a skeleton only** (Atlas skeleton placeholder shapes of the planned layout, a "Soon" marker and a one-line description; no text, numbers, rows or CIDs inside the skeleton; PO decision 2026-10-19): Builder mode (#21), other counties and states (#20, only Travis is live), Street View (#17), AI-user sign-in (#66), saved searches, Similar properties (#63), SQL checks, pipeline diagram and Gantt, area matrix.

**Scope note:** the map, pin-drop markers and everything behind the prototype's "Map view (CRM preview)" toggle are not Task A scope (`docs/02-design.md` § 3, PO round 5 #74); the playbook's "Lead finder (map, pin/GPS)" is met by the `at` point and place area in List view. Verify uses ipfs.io and dweb.link only (P0-14).

**Independent test:** run the Playwright suite against `https://countylens.aldarraj.com` (or the Amplify branch URL): D-2 to D-9 pass, every route and Coming soon item renders, a scan of the rendered text finds none of the prototype's placeholder values (for example "SAMPLE, JORDAN A", "128 within 5 mi", fixed `bafybei…` strings not in a real manifest), and `smeargle` passes at 390, 768 and 1440 on every page.

## Acceptance Criteria

### Part 1 · Explorer (was A-13 · Must)

1. **AC-1** (was A-13 AC-1) · **Given** `runs/index.json` with Runs 1–3, **When** the evaluator opens Runs, **Then** the latest completed run shows its source list, counts, UTC timestamps, deltas, limitations (for example "BBB: blocked · 403") and "Next sync: none · scheduler off by default"; Compare shows Run 3 vs Run 2 with distinct manifest CIDs, the `previousManifestCid` link, and "old manifest still resolves on ipfs.io and dweb.link" (D-2, D-7). ☐ testable
2. **AC-2** (was A-13 AC-2) · **Given** the manifest `coverage` section, **When** Coverage opens, **Then** each record kind (property, ownership, permit, contractor by five states, BBB by status, business, places, coordinates) shows its published count, its denominator (TCAD certified roll; Austin 3syk-w9eu total at watermark; Comptroller Travis total), collection time, `derivation` label and the elephant-cli table it comes from (D-3). ☐ testable
3. **AC-3** (was A-13 AC-3) · **Given** the Manifest page, **When** the evaluator clicks Verify on a file artifact ≤ 50 MB, **Then** the browser fetches it from ipfs.io and from dweb.link, computes SHA-256 locally, and shows ✓ on both lanes with the exact URLs and the size and digest compared to the manifest; a directory shows "Verify via CAR" (D-5, D-6). ☐ testable
4. **AC-4** (was A-13 AC-4) · **Given** Explore · Filters where the search box resolves "Pflugerville" through the A-02 gazetteer (`search.suggest`, showing "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116"), radius 5 mi and roof ≥ 15 years, **When** the search runs, **Then** the header reads "{n} within 5 mi of Pflugerville · roof ≥ 15 yrs", each row shows address, roof age, `roof_age_basis`, confidence, distance and bearing, lat/lon, and a Source link with run and table CID, and changing the radius from 5 to 3 mi updates the count live (D-8). ☐ testable
5. **AC-5** (was A-13 AC-5) · **Given** the same area with "open or stalled" and "open ≥ 5 years", sorted by open longest, **When** results load, **Then** stalled permits show "Stalled {x} yrs · source says Expired" (AD-08), open ones show "Open {x} yrs · source says {status_raw}", the contractor shows "as printed on permit" with its five-state badge, and BBB shows a rating or its status reason; around Pflugerville this lists the stalled reroofs (2004-011296 BP, open about 22.6 years at 2026-10-19) and states that no open roofing permits exist in that radius on the current run (D-9). Fields whose A-02 carrier verdict is "no carrier" show "not published · no lexicon carrier" instead. ☐ testable
   - **Demo-area note:** the presenter picks the D-8/D-9 area from the published data (the area with the most open or stalled reroofs among the gazetteer places), records it in `docs/evidence/A-13-open-permits.md`, and uses the same area for D-10 and D-11.
6. **AC-6** (scale; was A-13 AC-6) · **Given** the full-county tables loaded in the browser, **When** the 5-mile radius + roof-age and open-permit searches each run 20 times on the hosted Explore page, **Then** p95 < 3 s once loaded and the first DuckDB load is ≤ 8 s with a progress bar (NFR-01); the SQL panel runs `SELECT count(*) FROM v_property` in the browser and shows "DuckDB-WASM in your browser · read-only" (D-4). ☐ testable
7. **AC-7** (missing data / error; was A-13 AC-7) · **Given** a result whose roof basis is `unknown`, whose contractor was not printed, whose BBB status is `blocked`, or whose tenure is unknown, **When** it renders, **Then** `<MissingReason/>` shows the reason in words and nothing is blank or guessed; **Given** a gateway answers 429 during Verify, **Then** the lane shows "rate-limited, retrying", retries with backoff, and never shows ✓ without a matching digest. ☐ testable
8. **AC-8** (was A-13 AC-8) · **Given** filters "tenure > 10 years" and "out-of-area owner" (preset `ooa78753`), **When** applied, **Then** results show `tenure_years` with `tenure_basis` and `owner_area_class` with the definitions on screen; properties with unknown tenure are excluded and counted as "tenure unknown: {n}" (AC-39, AC-40). ☐ testable

### Part 2 · Hub, legal, catalog and Coming soon pages (was A-18 · Should, P3: build after Part 1, cut first)

9. **AC-9** (was A-18 AC-1) · **Given** the hosted app, **When** a visitor opens `/`, **Then** the Hub shows the CountyLens card linking to Explore, the Roofing CRM card as "Coming soon · Not deployed yet" with a disabled button, and a status chip "Run {n} · {finishedAt}" read from `runs/index.json` (D-1). ☐ testable
10. **AC-10** (was A-18 AC-2) · **Given** the latest manifest (for example Run 3), **When** the visitor opens Data · Catalog, **Then** every published table appears with its columns from `tables-export.json`, its row count from the manifest `coverage` (`published_rows`), its CID and size, and each CID links to Verify. ☐ testable
11. **AC-11** (was A-18 AC-3) · **Given** the Legal pages, **When** opened, **Then** each source used (TCAD, Travis County GIS, City of Austin `3syk-w9eu`, TX Comptroller `9cir-efmm`, BBB, Overture, US Census Gazetteer) is listed with its terms or licence link, and the access rules (public sources only, stop on 403, no CAPTCHA bypass, Query DB never exposed) are stated. ☐ testable
12. **AC-12** (scale; was A-18 AC-4) · **Given** a run history of at least 3 runs, **When** Runs · Log opens, **Then** every event from every manifest appears in time order with its run ID, and the page renders in under 2.5 s LCP on mobile 4G. ☐ testable
13. **AC-13** (missing data; was A-18 AC-5) · **Given** a Coming soon item (for example Builder mode or "Harris County"), **When** a visitor opens or selects it, **Then** it shows the planned layout as a static skeleton (grey placeholder blocks, not animated, so it never looks like loading), a "Coming soon" label and one sentence on what it will do and why it is not live, with no example numbers, rows or CIDs; selecting another county shows "CountyLens has data for Travis County, TX only". ☐ testable
14. **AC-14** (was A-18 AC-6) · **Given** the full hosted site, **When** the no-sample-data scan runs, **Then** it finds 0 prototype placeholder values and 0 "not wired" toasts, and the ProtoBar is absent (02-design § 3, P0-12). ☐ testable

## Edge cases (at least two)

- Zero results in a radius → Close matches list (with miles outside) and the empty-state hint; never a blank table. (was A-13)
- The CID copy is down → Filebase gateway fallback labelled "fallback"; Verify unaffected (public gateways only). (was A-13)
- A SQL typo → the error line with its fix, from `SqlStates`; no stack trace. (was A-13)
- Phone width (390) → filters collapse into the sheet and Coming soon items sit in the More sheet; 48 px targets; no horizontal scroll. (was A-13, A-18)
- `tables-export.json` is unreachable → Catalog shows "Catalog unavailable · {reason}" and a link to the manifest; never a cached sample. (was A-18)
- Task B goes live during review → the CRM card switches to its live URL through config, without a code change. (was A-18)

## Requirements

| REQ | Requirement | Traces to | Was |
| --- | --- | --- | --- |
| FR-001 | Runs and Compare MUST read `runs/index.json` and manifests by CID | AC-1 | A-13 FR-001 |
| FR-002 | Coverage MUST read counts only from the manifest coverage section | AC-2 | A-13 FR-002 |
| FR-003 | Verify MUST fetch from ipfs.io and dweb.link and hash in the browser | AC-3, AC-7 | A-13 FR-003 |
| FR-004 | Explore MUST run `query-core` SQL in DuckDB-WASM with provenance on every row | AC-4, AC-5, AC-6, AC-8 | A-13 FR-004 |
| FR-005 | Every missing value MUST render its reason | AC-7 | A-13 FR-005 |
| FR-006 | Hub MUST link the live app and show the CRM as Coming soon until it is deployed | AC-9 | A-18 FR-001 |
| FR-007 | Catalog and Runs log MUST be built only from published files | AC-10, AC-12 | A-18 FR-002 |
| FR-008 | Legal pages MUST name every source's terms and the access rules | AC-11 | A-18 FR-003 |
| FR-009 | Coming soon items MUST describe the feature without example data | AC-13 | A-18 FR-004 |
| FR-010 | The hosted site MUST contain no prototype or sample values | AC-14 | A-18 FR-005 |
| NFR-001 | Search p95 < 3 s; first load ≤ 8 s (NFR-01) | AC-6 | A-13 NFR-001 |
| NFR-002 | Initial JS ≤ 300 KB gzipped excl. DuckDB; LCP < 2.5 s, CLS < 0.1 on mobile 4G; WCAG 2.2 AA; Atlas only; responsive at 390/768/1440 on every page (NFR-08) | AC-1 to AC-14 | A-13 NFR-002, A-18 NFR-001 |
| NFR-003 | 100% of result cards carry `<Provenance/>` (NFR-05) | AC-4, AC-5 | A-13 NFR-003 |

## Prototype reference (mandatory if the story has UI)

| Element | Value |
| --- | --- |
| Claude Design screen, Part 1 | `design/prototype/Runs1440.dc.html`, `RunsCompare1440.dc.html`, `RunChain.dc.html`, `Coverage1440.dc.html`, `DataManifest1440.dc.html`, `DataVerify1440.dc.html`, `ExploreQ-roof15.dc.html`, `ExploreQ-permits5.dc.html`, `ExploreQ-ooa78753.dc.html`, `ExploreQ-sql.dc.html`, `Property1440.dc.html`, `HelpMcp1440.dc.html` (with their 768 and 390 variants) |
| Claude Design screen, Part 2 | `design/prototype/Hub1440.dc.html` (+ 768, 390), `LegalData1440.dc.html`, `LegalPrivacy1440.dc.html`, `LegalTerms1440.dc.html` (+ variants), `DataCatalog1440.dc.html` (+ 768), `RunsLog1440.dc.html` (+ 768), `Shell390ComingSoon.dc.html`, `ExploreQ-builder.dc.html`, `UserSignIn1440.dc.html` (Coming soon, not linked), `Extensions.dc.html`, `EmptyHints.dc.html` |
| States covered | empty · loading · error · partial · populated · fallback · rate-limited · unavailable · coming soon (`ShellStates`, `CoverageStates`, `DataStates`, `ExploreStates`, `SqlStates`, `PropertyStates`, `RunsStates`) |
| Design system | `assessment-guide/design-system/` (Atlas, Material 3, mobile-first) |

## Demo Script

1. Presenter (opening line): "I will demonstrate that the Oracle pipeline has loaded the available dataset for Travis County, Texas…" → Expected: the Hub with the live run chip, then Open CountyLens.
2. Presenter: "First, I am opening the pipeline run summary." → Expected: completed run, sources, coverage, counts, timestamps, limitations.
3. Presenter: "Show the total uploaded records by source." → Expected: property, permit, ownership, contractor (with BBB where available), business and coordinate counts with collection time and provenance.
4. Presenter: "Now I am opening the DuckDB-backed query layer." → Expected: SQL runs in the browser; no database server.
5. Presenter: "Show the published artifact manifest for this run." → Expected: CID, size, name, codec, digest; run chain.
6. Presenter: "Retrieve one published artifact by CID from a public gateway that this environment does not operate, then again from a second independent public gateway." → Expected: two ✓ lanes with matching digest.
7. Presenter: "Show that a later incremental publish produced a new CID without mutating the previous one." → Expected: Compare Run 3 vs Run 2.
8. Presenter: "Using the UI, show properties within a sample radius that have roofs older than 15 years." → Expected: results with basis, coordinates, source.
9. Presenter: "Show properties in that area with open roofing permits, prioritizing permits that have remained open for many years, including contractor and BBB rating where available." → Expected: permits by open duration, contractor badge, BBB or its reason.

## Out of scope

- Map, markers, tiles and every item behind the CRM-preview toggle (`docs/02-design.md` § 3).
- Admin sign-in, Start/Stop/Retry and Activity (part of A-16 since the merge; was A-17, built last per AD-12).
- Any sample or demo values on Coming soon items (P0-12); the PO chose skeleton-only previews on 2026-10-19.
- Welcome tour and owner/contractor name search (cut, #33, #47).

## Evidence to capture

- `docs/evidence/A-13.md` (summary), with `docs/evidence/A-13-duckdb.md`, `A-13-roof-age.md`, `A-13-open-permits.md`: hosted URL, inputs, screenshots, counts, p95 timings, trace IDs.
- `docs/evidence/A-13-pages.md`: route list with screenshots, the no-sample-data scan output, Lighthouse scores (Part 2).
- `smeargle` report at 390/768/1440 for every page; `testplans/A-13-test-cases.md` results; `docs/reviews/CR-A-13.md` (metagross, audino).

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
