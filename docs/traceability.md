# Traceability: Oracle Pipeline (Travis County, TX)

There are two matrices. The **requirements matrix** gives each README acceptance criterion and demo line one row. The **chain matrix** follows each feature down to its release. An empty cell means something is missing.

Every artifact names its parent in its front matter, so the `developmentsupport-progress` skill can rebuild the chain matrix from the files. You fill only the first matrix by hand.

## 1. Requirements matrix (README → evidence)

Source: `README.md` at `e778d6f`. AC numbers follow the README's order, one per bullet, with sub-bullets numbered separately. The evaluation points A1–A6 are defined in [01-intent.md § 8](01-intent.md#8-evaluation-points-sum--40--success-criteria-mandatory). A second point in brackets marks a secondary link. FEAT, story, spec, test and evidence cells are filled at G1, P8, `/speckit-specify`, G6 and G7.

| # | README criterion / demo line | Eval point | FEAT | Story (US) | Spec FR | Test case | Evidence | Demo time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Geography & coverage** | | | | | | | | |
| AC-1 | Target Travis County, TX as the default and primary county for ingestion and demos. | A1 | FEAT-A01, FEAT-A04 | A-01, A-04 | A-01: FR-001, FR-001a–e (Travis, FIPS 48453; readiness PASS) | A-01-TC-001, A-01-TC-002 | `docs/evidence/A-01.md` (validator exit 0, catalog SHA-256 `0616593d…`) | |
| **Data loading** | | | | | | | | |
| AC-2 | Run the Oracle pipeline until all available county data is uploaded. | A1 | FEAT-A04–A09, FEAT-A11 | A-04–A-09, A-11 | | | | |
| AC-3 | Load available property records into the database. | A1 | FEAT-A04 | A-04 | | | | |
| AC-4 | Load available permit records into the database, with emphasis on roofing-related permits. | A1 | FEAT-A06 | A-06 | | | | |
| AC-5 | Preserve permit status, open/close dates (or equivalent), and duration-open signals so long-open permits can be identified. | A5 (A1) | FEAT-A06, FEAT-A02 | A-06, A-02 | A-02: FR-004, FR-005 (status map, open_days, stalled) | A-02-TC-016, A-02-TC-017, A-02-TC-018, A-02-TC-019 | `docs/evidence/A-02.md` (profile `travis-austin@1.0.0`, 19,031 candidates) |  |
| AC-6 | Load available ownership records into the database. | A1 | FEAT-A04 | A-04 | | | | |
| AC-7 | Load available contractor records into the database. | A1 | FEAT-A07 | A-07 | | | | |
| AC-8 | Load available BBB / contractor rating scores where publicly available. | A1 | FEAT-A08 | A-08 | | | | |
| AC-9 | Load available business records into the database. | A1 | FEAT-A09, FEAT-A07 | A-09, A-07 | | | | |
| AC-10 | Load available location and coordinate data into the database (required for GPS/pin-drop radius queries in the CRM). | A1 (A5) | FEAT-A05 | A-05 | | | | |
| AC-11 | Capture roof age or best-available proxies (year built, last roofing permit/completion date) so properties with roofs older than a configurable threshold (default 15 years) can be queried. | A5 (A1) | FEAT-A10 | A-10 | | | | |
| AC-12 | Reconcile duplicate entities across all uploaded datasets. | A2 | FEAT-A10, FEAT-A07 | A-10, A-07 | | | | |
| AC-13 | Preserve source provenance for uploaded records. | A2 | FEAT-A10, FEAT-A02 | A-10, A-02 | A-02: FR-007, FR-008, FR-010 (Provenance on every view row) | A-02-TC-024, A-02-TC-026, A-02-TC-028 | `docs/evidence/A-02.md` (sample: 0 null provenance) |  |
| AC-14 | Continuous / incremental: support ongoing ingestion of new and changed records (scheduled or on-demand refreshes, change detection or bounded windows, idempotent steps). | A3 | FEAT-A12, FEAT-A17 | A-12, A-06, A-17 (on-demand refresh) | | | | |
| AC-15 | Continuous / incremental: maintain a visible history of pipeline runs (timestamps, source list, record counts, deltas, any source limitations). | A3 | FEAT-A12, FEAT-A13 | A-12, A-13 | | | | |
| AC-16 | Continuous / incremental: demonstrate that data continues to be ingested and published over time (multiple runs or simulated ongoing updates). | A3 (A4) | FEAT-A12 | A-12 | | | | |
| **Infrastructure & access** | | | | | | | | |
| AC-17 | Optimize pipeline performance where feasible. | A1 | FEAT-A16, FEAT-A01 | A-16, A-01 | | | | |
| AC-18 | Identify slow source sites or constrained data sources. | A1 | FEAT-A01 | A-01 | FR-002, FR-003, FR-005, FR-006–FR-006f, NFR-001 | A-01-TC-007, A-01-TC-017, A-01-TC-019, A-01-TC-020, A-01-TC-021, A-01-TC-NF-01 | `docs/evidence/A-01.md` (throughput per source; blocked BBB and 7 cities; GIS operator egress blocked), `docs/sources.md` | |
| AC-19 | Document pipeline speed limitations and source constraints. | A1 | FEAT-A16 | A-16 | | | | |
| AC-20 | Design the infrastructure so Oracle does not carry ongoing infrastructure cost by default. | A4 | FEAT-A16, FEAT-A03 | A-16, A-03 | | | | |
| AC-21 | Use IPFS for decentralized storage of eligible dataset artifacts. | A4 | FEAT-A11, FEAT-A03 | A-11, A-03 | | | | |
| AC-22 | Use DuckDB for local or portable analytical querying. | A5 | FEAT-A02, FEAT-A03 | A-02, A-03, A-13 | A-02: FR-002 (four DuckDB views over export-tables) | A-02-TC-008, A-02-TC-009 | `docs/evidence/A-02.md` (frozen columns, Vitest) |  |
| AC-23 | Structure the database to support MCP access. | A6 | FEAT-A15, FEAT-A02 | A-15, A-02 | A-02: FR-002, FR-010 (one contract for UI, agent, MCP) | A-02-TC-008, A-02-TC-028 | `docs/evidence/A-02.md` (`contract/v1/columns.json`) |  |
| AC-24 | Enable agent access to query the database. | A6 | FEAT-A14 | A-14 | | | | |
| AC-25 | Provide a UI for exploring the uploaded data. | A5 | FEAT-A13, FEAT-A03, FEAT-A18 | A-13, A-03, A-18 | | | | |
| **IPFS publication** | | | | | | | | |
| AC-26 | Treat IPFS CIDs as the durable identity of published artifacts; a vendor-specific HTTP URL is not the source of truth. | A4 | FEAT-A11 | A-11 | | | | |
| AC-27 | Prefer CIDv1 (base32) for every published object. | A4 | FEAT-A11 | A-11 | | | | |
| AC-28 | Keep published bytes retrievable from the public IPFS network, not only from a private node, authenticated gateway, vendor dashboard or laptop. | A4 | FEAT-A11 | A-11 | | | | |
| AC-29 | Publish a machine-readable JSON artifact manifest per run, listing every eligible object with `cid`, name/path, `size`, codec (file/directory), content digest, and optional `origins`. | A4 | FEAT-A11 | A-11 | | | | |
| AC-30 | If IPNS is used, record both the IPNS name and the resolved CID for that run. | A4 | FEAT-A11 | N/A: no IPNS is used (ARD AD-03); the run chain (`previousManifestCid` + `runs/index.json`) replaces it, built in A-11 and A-12 | | | | |
| AC-31 | On incremental republish, keep prior CIDs immutable; new data produces a new CID; run history retains previous CIDs. | A4 (A3) | FEAT-A12, FEAT-A11 | A-12, A-11 | | | | |
| AC-32 | For directory artifacts, also publish a CAR of the DAG rooted at that CID. | A4 | FEAT-A11 | A-11 | | | | |
| AC-33 | Demonstrate each listed CID fetched from at least two independent public gateways not operated by this environment, with bytes matching the manifest size/digest. | A4 | FEAT-A11, FEAT-A13 | A-11, A-13 | | | | |
| AC-34 | Include the artifact manifest (and CARs) in the repository or demo packet so a third party can fetch the dataset by CID later. | A4 | FEAT-A11 | A-11 | | | | |
| **Roofing CRM–supporting queries** | | | | | | | | |
| AC-35 | Support radius-based property identification using coordinates (around a GPS point or map pin). | A5 | FEAT-A13, FEAT-A05 | A-13, A-05 | | | | |
| AC-36 | Support questions about properties with roofs older than 15 years (or a configurable threshold). | A5 | FEAT-A13, FEAT-A10 | A-13, A-10 | | | | |
| AC-37 | Support questions about properties with open roofing permits, including those open for many years. | A5 | FEAT-A13, FEAT-A06 | A-13, A-06 | | | | |
| AC-38 | Support returning permit details with contractor name and BBB rating score where available. | A5 | FEAT-A13, FEAT-A08 | A-13, A-08 | | | | |
| AC-39 | Support questions about properties that have not exchanged ownership in more than 10 years. | A5 | FEAT-A13, FEAT-A04 | A-13, A-04 | | | | |
| AC-40 | Support questions about properties with regional (or out-of-area) owners. | A5 | FEAT-A13, FEAT-A04 | A-13, A-04 | | | | |
| AC-41 | Return source-backed answers where source data is available. | A2 (A5, A6) | FEAT-A13, FEAT-A14, FEAT-A02 | A-13, A-14, A-02 | A-02: FR-001, FR-007 (carrier verdicts; missing says why) | A-02-TC-001, A-02-TC-003, A-02-TC-024 | `docs/evidence/A-02.md`, `docs/decisions/0002-lexicon-carriers.md` |  |
| **Demonstration** | | | | | | | | |
| AC-42 | Demonstrate the uploaded dataset through the UI. | A5 | FEAT-A13 | A-13 | | | | |
| AC-43 | Demonstrate the uploaded dataset through an agent query aligned to roofing lead discovery. | A6 | FEAT-A14 | A-14 | | | | |
| AC-44 | Demonstrate that Oracle can operate without carrying the infrastructure cost. | A4 | FEAT-A16 | A-16 | | | | |
| AC-45 | Demonstrate public, CID-addressed IPFS publication using the artifact manifest and independent gateway retrieval. | A4 | FEAT-A11, FEAT-A13 | A-11, A-13 | | | | |
| AC-46 | Confirm the candidate fulfilled both Oracle and builder responsibilities for this milestone. | A1 (A4) | FEAT-A11, FEAT-A13 | A-11, A-13 (evidence only; the "Oracle + builder" statement is a release task, see note) | | | | |
| AC-47 | Pass the demo using real uploaded Travis County records. | A1 | FEAT-A04–A10, FEAT-A13 | A-04–A-10, A-13 | | | | |
| **Demo transcript** | | | | | | | | |
| D-1 | Opening: the pipeline has loaded the available Travis County dataset, it is queryable through DuckDB, eligible artifacts are on IPFS as content-addressed snapshots, and the UI and agent answer roofing-lead questions. | A1–A6 (framing) | FEAT-A03, FEAT-A13, FEAT-A18 | A-03, A-13, A-16, A-18 (Hub) | | | | |
| D-2 | Open the pipeline run summary → completed run, source list, county coverage, record counts, timestamps, documented source limitations. | A1 (A3) | FEAT-A13, FEAT-A12 | A-13, A-12, A-03, A-01 | | | | |
| D-3 | Show total uploaded records by source → property, permit, ownership, contractor (with BBB where available), business and coordinate records with collection timestamps and provenance. | A1 (A2) | FEAT-A13, FEAT-A04–A09 | A-13, A-01, A-04–A-10 | | | | |
| D-4 | Open the DuckDB-backed query layer → data available for structured querying without Oracle-hosted database infrastructure. | A5 (A4) | FEAT-A03, FEAT-A02 | A-03, A-13, A-02, A-16 | A-02: FR-002 | A-02-TC-008 | `docs/evidence/A-02.md` (views compile over pilot tables) |  |
| D-5 | Show the published artifact manifest for this run → every eligible artifact with CID, size, name, codec, digest; gateway URLs derived from CIDs; IPNS name with resolved CID if used. | A4 | FEAT-A11, FEAT-A13 | A-11, A-13 | | | | |
| D-6 | Retrieve one artifact by CID from two independent public gateways → both succeed and bytes match manifest size/digest; private, local or authenticated serving fails. | A4 | FEAT-A11, FEAT-A13 | A-11, A-13 | | | | |
| D-7 | Show a later incremental publish produced a new CID → prior CID still resolves, new run has a distinct CID, IPNS (if used) points to it, both in run history, CAR for any directory root. | A3 (A4) | FEAT-A12 | A-12, A-13 | | | | |
| D-8 | UI: properties within a sample radius with roofs older than 15 years → results with roof-age basis, coordinates and source provenance. | A5 | FEAT-A13, FEAT-A10, FEAT-A05 | A-13, A-10, A-05 | | | | |
| D-9 | UI: properties in that area with open roofing permits, longest-open first → permit status/open duration, contractor identity, BBB score when present, source backing. | A5 | FEAT-A13, FEAT-A06, FEAT-A08 | A-13, A-06, A-07, A-08 | | | | |
| D-10 | Agent: "Which properties in Travis County within five miles of [city xyz] have roofs older than 15 years?" → matching properties, reasoning, source-backed evidence. | A6 | FEAT-A14 | A-14 | | | | |
| D-11 | Agent: "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?" → filtered list with open duration, contractor, BBB when available, assumptions and missing data stated. | A6 | FEAT-A14 | A-14 | | | | |
| D-12 | Show the system is MCP-ready → an MCP-ready interface or documented MCP-compatible query structure usable by agents and the CRM without changing the data model. | A6 | FEAT-A15 | A-15, A-02 | A-02: FR-002, FR-010 | A-02-TC-008, A-02-TC-028 | `docs/evidence/A-02.md` (`contract/v1`) |  |

**Coverage by evaluation point** (primary tags): A1 16 rows · A2 3 · A3 4 · A4 15 · A5 14 · A6 6 · framing 1. All 47 acceptance criteria and 12 demo lines are tagged. The README's Acceptance Criteria section has 54 bullets: the heading bullet "Design and implement the pipeline as continuous / incremental" is covered by its sub-bullets AC-14 to AC-16, and the six manifest field names (`cid`, name, `size`, codec, digest, `origins`) are part of AC-29.

**Story coverage (P8, 2026-10-19).** Every AC row and demo line has at least one story (`stories/A-01` to `A-18`; A-17 and A-18 are Should stories added by the PO on 2026-10-19). The first story listed in a cell owns the observable proof; the others supply data or parts. Partly uncovered:
- **AC-46** (Oracle + builder responsibilities): A-11 (Oracle publication) and A-13 (builder UI) produce the evidence, but the statement itself is the README/PR section of demo-map row 12, written in release step R5 (draft PR, playbook Part 4), not in a story.
- **AC-29 `origins`** (optional multiaddrs): no story commits to listing them. A-11 publishes through Filebase and a second pin; `origins` is filled only if a candidate-run kubo node serves the blocks.
- **AC-30** (IPNS): not applicable by AD-03.

## 2. Chain matrix (BN → release)

| BN | VIS | FEAT | US | REQ | TASK | TC | Code (merge commit) | CR | REL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BN-A | VIS-A | | | | | | | | |
| BN-A | VIS-A | FEAT-A01 | A-01 | `specs/001-discover-sources/spec.md` FR-001–FR-007, NFR-001 | `specs/001-discover-sources/tasks.md` T001–T055 (T039, T048–T054 still unticked; reconciled in `/speckit-converge`) | `testplans/A-01-test-cases.md` (27/27 applicable pass, `docs/reports/A-01-test-report.md`) | branch `001-discover-sources` @ `d93f746` (merge pending G7) | `docs/reviews/CR-A-01.md` (83/100) | |
| BN-A | VIS-A | FEAT-A03 | A-03 | `specs/003-walking-skeleton/spec.md` FR-001–FR-014, NFR-001–NFR-004. AC → FR: AC-1 FR-001, FR-012, FR-014 · AC-2 FR-002, FR-009, FR-013 · AC-3 FR-003, FR-011, FR-013 · AC-4 FR-004, FR-008 · AC-5 FR-005, FR-009, FR-011 · AC-6 FR-006 · AC-7 FR-007 · edge FR-010 | `specs/003-walking-skeleton/tasks.md` T001–T086, TZ01–TZ06 | `testplans/A-03-test-cases.md` (43 TCs). AC-1 TC-001–006, 044 · AC-2 TC-010–014, NF-03 · AC-3 TC-020–023, 025–027, NF-03 · AC-4 TC-005, 024, 026, 028, NF-01, NF-02, NF-05, NF-06 · AC-5 TC-022, 030–034 · AC-6 TC-040–043 · AC-7 TC-050–053, NF-04. FR-001 TC-001–005 · FR-002 TC-010–014 · FR-003 TC-020, 021, 023, 026 · FR-004 TC-028, NF-01, 02, 05, 06 · FR-005 TC-022, 030–034 · FR-006 TC-040–043 · FR-007 TC-050–053, NF-04 · FR-008 TC-024, 029 · FR-009 TC-011, 012, 029, 031 · FR-010 TC-060, 061 · FR-011 TC-022, 025, 027 · FR-012 TC-020, 044, NF-05 · FR-013 TC-010, 020 · FR-014 TC-006. Evidence: `docs/evidence/A-03.md`, `docs/reports/A-03-test-report.md` (run 1 on `1380ad3`: 23 pass / 13 fail; run 2 on `fbdb68b`: 42 / 43 pass, TC-NF-04 FAIL → ERR-19; run 3 on `86694cc`: TC-050, TC-NF-04, TC-051, TC-061 PASS, cold start 2,525 ms; **43 / 43 pass across runs 2–3**). Defects: ERR-10 (TC-020–022, 025; FR-003, FR-011), ERR-11 (TC-020), ERR-12, ERR-13 (TC-NF-03; NFR-003), ERR-14 (TC-023, 028; FR-003, FR-004), ERR-15 (TC-032–034; FR-005), ERR-16 (TC-024; FR-008), ERR-17 (TC-NF-01; NFR-001), ERR-18 (TC-NF-05; NFR-001): all Fixed (`660f73c`, `a1fd50a`), Re-tested PASS in hosted run 2 and Closed (2026-10-21). ERR-19 (TC-NF-04; NFR-004): Fixed (`9191b3c`), Re-tested PASS in hosted run 3 (cold start 2,525 ms) and Closed (2026-10-21). Manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`, `verify-manifest` ALL ARTIFACTS VERIFIED | branch `003-walking-skeleton` @ `7563084`, hosted build `86694cc` (no app code change since; merge pending G7) | `docs/reviews/CR-A-03.md` (oracle 88 → 90/100, metagross 81 → 86/100, delta review at `fe2b26a`; `/code-review` high at `570285d`: 0 Critical, 4 Major fixed in `327c11f`) | |

## 3. Gate log

| Gate | Artifact | Version | Pre-check | Decision | Date |
| --- | --- | --- | --- | --- | --- |
| G0 | docs/01-intent.md | 0.1 | PASS (4 warnings), `docs/gates/G0-VIS-A-precheck.md` | Approved (HebaGaber) | 2026-10-17 |
| G1 | docs/feature-list.md | 0.1 | PASS, `docs/gates/G1-FL-A-precheck.md` | Approved (HebaGaber) | 2026-10-17 |
| G1 | docs/feature-list.md | 0.2 | FAIL (3) → fixed → PASS, `docs/gates/G1-FL-A-precheck.md` | Re-approved (HebaGaber); adds FEAT-A17, FEAT-A18 | 2026-10-19 |
| G2 | docs/plan.md | 0.2 | PASS, `docs/gates/G2-PROJ-A-precheck.md` (re-run for 0.2) | Approved (HebaGaber) | 2026-10-19 |
| Design CP | docs/02-design.md, design/ | 1.5 | `developmentsupport-prototype-review`, `design/design-review-log.md` | Approved (HebaGaber) | 2026-10-19 |
| G3 | docs/architecture-constitution.md | 0.2 | `docs/gates/G3-ARD-A-precheck.md` | PASS; Approved (HebaGaber) | 2026-10-19 |
| G4 | stories/A-01-discover-sources.md | rev 3 | FAIL (3) → FAIL (1) → PASS, `docs/gates/G4-A-01-precheck.md`; C-04 justified exception (Project feature) | Ready (HebaGaber) | 2026-10-19 |
| G5 | specs/001-discover-sources (spec, plan, tasks) | 2026-10-19 | PASS (0 FAIL; C-05 via the G4 C-04 exception), `docs/gates/G5-A-01-precheck.md`; analyze CRITICAL/HIGH fixed, 3 MEDIUM open | Approved (HebaGaber) | 2026-10-19 |
| G6 | testplans/A-01-test-cases.md | 0.4 | FAIL (2) → PASS → FAIL (1) → PASS, `docs/gates/G6-A-01-precheck.md`; C-05/C-07/C-09 justified exceptions (Project story) | Approved (HebaGaber, QC Lead) | 2026-10-19 |
| G7 | A-01 (branch `001-discover-sources`) | `f3e4ceb` + fixes | FAIL (2) → PASS, `docs/gates/G7-A-01-precheck.md`; C-04/C-07 justified exceptions (Project story); CI run 39490116172 green; oracle 83/100; ERR-1 to ERR-8 closed | Validated (HebaGaber) | 2026-10-20 |
| G4 | stories/A-02-data-contract.md | rev 2 | FAIL (2) → PASS, `docs/gates/G4-A-02-precheck.md`; C-04 and C-10/G4-8 justified exceptions (Project story; pilot made in A-02) | Ready (HebaGaber) | 2026-10-20 |
| G5 | specs/002-data-contract (spec, plan, tasks) | 2026-10-21 | FAIL (2) → PASS, `docs/gates/G5-A-02-precheck.md`; C-05 TZ02–TZ04 N/A (Project story); analyze 0 CRITICAL, 3 HIGH fixed | Approved (HebaGaber) | 2026-10-21 |
| G6 | testplans/A-02-test-cases.md | 0.2 | FAIL (1) → PASS, `docs/gates/G6-A-02-precheck.md`; C-05/C-09 justified exceptions (Project story) | Approved (HebaGaber, QC Lead) | 2026-10-21 |
| G7 | A-02 (branch `002-data-contract`) | `323ae0b` | PASS (run 1), `docs/gates/G7-A-02-precheck.md`; C-02/C-04/C-07 justified exceptions (Project story); tests 33/33; oracle 80, donphan 76; ERR-9 closed | Validated (HebaGaber) | 2026-10-21 |
| G4 | stories/A-03-walking-skeleton.md | rev 2 | FAIL (3) → PASS 11/11, `docs/gates/G4-A-03-precheck.md`; run 1 C-04, C-06, C-08 fixed after PO D-1 (run-log 02:48–02:52) | Ready (HebaGaber, 🛑 D-1, run-log 02:54) | 2026-10-21 |
| G5 | specs/003-walking-skeleton (spec, plan, tasks) | 2026-10-21 | FAIL (2) → PASS 10/10, `docs/gates/G5-A-03-precheck.md`; run 1 C-04, C-07 fixed (run-log 10:58) | Approved (HebaGaber, 🛑 D-6, run-log 11:00) | 2026-10-21 |
| G6 | testplans/A-03-test-cases.md | v1.0 | FAIL (2) → PASS, `docs/gates/G6-A-03-precheck.md`; run 1 C-05, C-09 fixed in v1.0 (run-log 10:42) | Approved (HebaGaber, QC Lead, 🛑 D-7, run-log 11:00) | 2026-10-21 |
| G4–G7 | per story; see `docs/progress.md` | | | | |
| G8 | docs/release.md | | | | |
