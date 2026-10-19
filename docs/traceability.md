# Traceability: Oracle Pipeline (Travis County, TX)

There are two matrices. The **requirements matrix** gives each README acceptance criterion and demo line one row. The **chain matrix** follows each feature down to its release. An empty cell means something is missing.

Every artifact names its parent in its front matter, so the `developmentsupport-progress` skill can rebuild the chain matrix from the files. You fill only the first matrix by hand.

## 1. Requirements matrix (README → evidence)

Source: `README.md` at `e778d6f`. AC numbers follow the README's order, one per bullet, with sub-bullets numbered separately. The evaluation points A1–A6 are defined in [01-intent.md § 8](01-intent.md#8-evaluation-points-sum--40--success-criteria-mandatory). A second point in brackets marks a secondary link. FEAT, story, spec, test and evidence cells are filled at G1, P8, `/speckit-specify`, G6 and G7.

| # | README criterion / demo line | Eval point | FEAT | Story (US) | Spec FR | Test case | Evidence | Demo time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Geography & coverage** | | | | | | | | |
| AC-1 | Target Travis County, TX as the default and primary county for ingestion and demos. | A1 | FEAT-A01, FEAT-A04 | | | | | |
| **Data loading** | | | | | | | | |
| AC-2 | Run the Oracle pipeline until all available county data is uploaded. | A1 | FEAT-A04–A09, FEAT-A11 | | | | | |
| AC-3 | Load available property records into the database. | A1 | FEAT-A04 | | | | | |
| AC-4 | Load available permit records into the database, with emphasis on roofing-related permits. | A1 | FEAT-A06 | | | | | |
| AC-5 | Preserve permit status, open/close dates (or equivalent), and duration-open signals so long-open permits can be identified. | A5 (A1) | FEAT-A06, FEAT-A02 | | | | | |
| AC-6 | Load available ownership records into the database. | A1 | FEAT-A04 | | | | | |
| AC-7 | Load available contractor records into the database. | A1 | FEAT-A07 | | | | | |
| AC-8 | Load available BBB / contractor rating scores where publicly available. | A1 | FEAT-A08 | | | | | |
| AC-9 | Load available business records into the database. | A1 | FEAT-A09, FEAT-A07 | | | | | |
| AC-10 | Load available location and coordinate data into the database (required for GPS/pin-drop radius queries in the CRM). | A1 (A5) | FEAT-A05 | | | | | |
| AC-11 | Capture roof age or best-available proxies (year built, last roofing permit/completion date) so properties with roofs older than a configurable threshold (default 15 years) can be queried. | A5 (A1) | FEAT-A10 | | | | | |
| AC-12 | Reconcile duplicate entities across all uploaded datasets. | A2 | FEAT-A10, FEAT-A07 | | | | | |
| AC-13 | Preserve source provenance for uploaded records. | A2 | FEAT-A10, FEAT-A02 | | | | | |
| AC-14 | Continuous / incremental: support ongoing ingestion of new and changed records (scheduled or on-demand refreshes, change detection or bounded windows, idempotent steps). | A3 | FEAT-A12 | | | | | |
| AC-15 | Continuous / incremental: maintain a visible history of pipeline runs (timestamps, source list, record counts, deltas, any source limitations). | A3 | FEAT-A12, FEAT-A13 | | | | | |
| AC-16 | Continuous / incremental: demonstrate that data continues to be ingested and published over time (multiple runs or simulated ongoing updates). | A3 (A4) | FEAT-A12 | | | | | |
| **Infrastructure & access** | | | | | | | | |
| AC-17 | Optimize pipeline performance where feasible. | A1 | FEAT-A16, FEAT-A01 | | | | | |
| AC-18 | Identify slow source sites or constrained data sources. | A1 | FEAT-A01 | | | | | |
| AC-19 | Document pipeline speed limitations and source constraints. | A1 | FEAT-A16 | | | | | |
| AC-20 | Design the infrastructure so Oracle does not carry ongoing infrastructure cost by default. | A4 | FEAT-A16, FEAT-A03 | | | | | |
| AC-21 | Use IPFS for decentralized storage of eligible dataset artifacts. | A4 | FEAT-A11, FEAT-A03 | | | | | |
| AC-22 | Use DuckDB for local or portable analytical querying. | A5 | FEAT-A02, FEAT-A03 | | | | | |
| AC-23 | Structure the database to support MCP access. | A6 | FEAT-A15, FEAT-A02 | | | | | |
| AC-24 | Enable agent access to query the database. | A6 | FEAT-A14 | | | | | |
| AC-25 | Provide a UI for exploring the uploaded data. | A5 | FEAT-A13, FEAT-A03 | | | | | |
| **IPFS publication** | | | | | | | | |
| AC-26 | Treat IPFS CIDs as the durable identity of published artifacts; a vendor-specific HTTP URL is not the source of truth. | A4 | FEAT-A11 | | | | | |
| AC-27 | Prefer CIDv1 (base32) for every published object. | A4 | FEAT-A11 | | | | | |
| AC-28 | Keep published bytes retrievable from the public IPFS network, not only from a private node, authenticated gateway, vendor dashboard or laptop. | A4 | FEAT-A11 | | | | | |
| AC-29 | Publish a machine-readable JSON artifact manifest per run, listing every eligible object with `cid`, name/path, `size`, codec (file/directory), content digest, and optional `origins`. | A4 | FEAT-A11 | | | | | |
| AC-30 | If IPNS is used, record both the IPNS name and the resolved CID for that run. | A4 | FEAT-A11 | N/A: no IPNS is used (ARD AD-03); the run chain (`previousManifestCid` + `runs/index.json`) replaces it | | | | |
| AC-31 | On incremental republish, keep prior CIDs immutable; new data produces a new CID; run history retains previous CIDs. | A4 (A3) | FEAT-A12, FEAT-A11 | | | | | |
| AC-32 | For directory artifacts, also publish a CAR of the DAG rooted at that CID. | A4 | FEAT-A11 | | | | | |
| AC-33 | Demonstrate each listed CID fetched from at least two independent public gateways not operated by this environment, with bytes matching the manifest size/digest. | A4 | FEAT-A11, FEAT-A13 | | | | | |
| AC-34 | Include the artifact manifest (and CARs) in the repository or demo packet so a third party can fetch the dataset by CID later. | A4 | FEAT-A11 | | | | | |
| **Roofing CRM–supporting queries** | | | | | | | | |
| AC-35 | Support radius-based property identification using coordinates (around a GPS point or map pin). | A5 | FEAT-A13, FEAT-A05 | | | | | |
| AC-36 | Support questions about properties with roofs older than 15 years (or a configurable threshold). | A5 | FEAT-A13, FEAT-A10 | | | | | |
| AC-37 | Support questions about properties with open roofing permits, including those open for many years. | A5 | FEAT-A13, FEAT-A06 | | | | | |
| AC-38 | Support returning permit details with contractor name and BBB rating score where available. | A5 | FEAT-A13, FEAT-A08 | | | | | |
| AC-39 | Support questions about properties that have not exchanged ownership in more than 10 years. | A5 | FEAT-A13, FEAT-A04 | | | | | |
| AC-40 | Support questions about properties with regional (or out-of-area) owners. | A5 | FEAT-A13, FEAT-A04 | | | | | |
| AC-41 | Return source-backed answers where source data is available. | A2 (A5, A6) | FEAT-A13, FEAT-A14, FEAT-A02 | | | | | |
| **Demonstration** | | | | | | | | |
| AC-42 | Demonstrate the uploaded dataset through the UI. | A5 | FEAT-A13 | | | | | |
| AC-43 | Demonstrate the uploaded dataset through an agent query aligned to roofing lead discovery. | A6 | FEAT-A14 | | | | | |
| AC-44 | Demonstrate that Oracle can operate without carrying the infrastructure cost. | A4 | FEAT-A16 | | | | | |
| AC-45 | Demonstrate public, CID-addressed IPFS publication using the artifact manifest and independent gateway retrieval. | A4 | FEAT-A11, FEAT-A13 | | | | | |
| AC-46 | Confirm the candidate fulfilled both Oracle and builder responsibilities for this milestone. | A1 (A4) | FEAT-A11, FEAT-A13 | | | | | |
| AC-47 | Pass the demo using real uploaded Travis County records. | A1 | FEAT-A04–A10, FEAT-A13 | | | | | |
| **Demo transcript** | | | | | | | | |
| D-1 | Opening: the pipeline has loaded the available Travis County dataset, it is queryable through DuckDB, eligible artifacts are on IPFS as content-addressed snapshots, and the UI and agent answer roofing-lead questions. | A1–A6 (framing) | FEAT-A03, FEAT-A13 | | | | | |
| D-2 | Open the pipeline run summary → completed run, source list, county coverage, record counts, timestamps, documented source limitations. | A1 (A3) | FEAT-A13, FEAT-A12 | | | | | |
| D-3 | Show total uploaded records by source → property, permit, ownership, contractor (with BBB where available), business and coordinate records with collection timestamps and provenance. | A1 (A2) | FEAT-A13, FEAT-A04–A09 | | | | | |
| D-4 | Open the DuckDB-backed query layer → data available for structured querying without Oracle-hosted database infrastructure. | A5 (A4) | FEAT-A03, FEAT-A02 | | | | | |
| D-5 | Show the published artifact manifest for this run → every eligible artifact with CID, size, name, codec, digest; gateway URLs derived from CIDs; IPNS name with resolved CID if used. | A4 | FEAT-A11, FEAT-A13 | | | | | |
| D-6 | Retrieve one artifact by CID from two independent public gateways → both succeed and bytes match manifest size/digest; private, local or authenticated serving fails. | A4 | FEAT-A11, FEAT-A13 | | | | | |
| D-7 | Show a later incremental publish produced a new CID → prior CID still resolves, new run has a distinct CID, IPNS (if used) points to it, both in run history, CAR for any directory root. | A3 (A4) | FEAT-A12 | | | | | |
| D-8 | UI: properties within a sample radius with roofs older than 15 years → results with roof-age basis, coordinates and source provenance. | A5 | FEAT-A13, FEAT-A10, FEAT-A05 | | | | | |
| D-9 | UI: properties in that area with open roofing permits, longest-open first → permit status/open duration, contractor identity, BBB score when present, source backing. | A5 | FEAT-A13, FEAT-A06, FEAT-A08 | | | | | |
| D-10 | Agent: "Which properties in Travis County within five miles of [city xyz] have roofs older than 15 years?" → matching properties, reasoning, source-backed evidence. | A6 | FEAT-A14 | | | | | |
| D-11 | Agent: "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?" → filtered list with open duration, contractor, BBB when available, assumptions and missing data stated. | A6 | FEAT-A14 | | | | | |
| D-12 | Show the system is MCP-ready → an MCP-ready interface or documented MCP-compatible query structure usable by agents and the CRM without changing the data model. | A6 | FEAT-A15 | | | | | |

**Coverage by evaluation point** (primary tags): A1 16 rows · A2 3 · A3 4 · A4 15 · A5 14 · A6 6 · framing 1. All 47 acceptance criteria and 12 demo lines are tagged. The README's Acceptance Criteria section has 54 bullets: the heading bullet "Design and implement the pipeline as continuous / incremental" is covered by its sub-bullets AC-14 to AC-16, and the six manifest field names (`cid`, name, `size`, codec, digest, `origins`) are part of AC-29.

## 2. Chain matrix (BN → release)

| BN | VIS | FEAT | US | REQ | TASK | TC | Code (merge commit) | CR | REL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BN-A | VIS-A | | | | | | | | |

## 3. Gate log

| Gate | Artifact | Version | Pre-check | Decision | Date |
| --- | --- | --- | --- | --- | --- |
| G0 | docs/01-intent.md | 0.1 | PASS (4 warnings), `docs/gates/G0-VIS-A-precheck.md` | Approved (HebaGaber) | 2026-10-17 |
| G1 | docs/feature-list.md | 0.1 | PASS, `docs/gates/G1-FL-A-precheck.md` | Approved (HebaGaber) | 2026-10-17 |
| G2 | docs/plan.md | 0.2 | PASS, `docs/gates/G2-PROJ-A-precheck.md` (re-run for 0.2) | Approved (HebaGaber) | 2026-10-19 |
| Design CP | docs/02-design.md, design/ | 1.5 | `developmentsupport-prototype-review`, `design/design-review-log.md` | Approved (HebaGaber) | 2026-10-19 |
| G3 | docs/architecture-constitution.md | 0.2 | `docs/gates/G3-ARD-A-precheck.md` | PASS; Approved (HebaGaber) | 2026-10-19 |
| G4–G7 | per story; see `docs/progress.md` | | | | |
| G8 | docs/release.md | | | | |
