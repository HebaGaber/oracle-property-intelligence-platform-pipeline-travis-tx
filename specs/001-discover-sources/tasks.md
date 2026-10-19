---
id: TASKS-A-01
parent: PLAN-A-01
description: "Tasks for A-01 Discover Travis County sources and pass readiness preflight"
---

# Tasks: Discover Travis County sources and pass readiness preflight

**Input**: Design documents from `specs/001-discover-sources/` ([plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md), [agent-design.md](agent-design.md))

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: MANDATORY (constitution X, XXI, XXII). Test tasks come first in every phase and must fail before the implementation tasks run. The story ends with the Phase Z tasks below.

**Builder**: every implementation task is delegated to the story's `agents.builder` subagent (constitution XV): `soofi-xyz-team-kit:oracle`, loading onboard-county, county-discovery, county-readiness-preflight, bootstrap-oracle-infra and apply-engineering-guidelines. Tasks marked **(builder: oracle)** go to it; test tasks are written by the same builder, first. Tasks marked **(operator)** need the user's machine, network or approval.

**Organization**: Tasks are grouped by user story. Phases run US1 → US2 → US4 → US3 because the readiness verdict (US3) needs the finished catalog, including US4's blocked rows; story labels match [spec.md](spec.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Paths are relative to the repository root. `RT` below means `pipeline/oracle-runtime`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the `pipeline/oracle-runtime` package (AD-23) and vendor the kit gate.

- [ ] T001 Create `pipeline/oracle-runtime/package.json` (type module, private; dependencies `zod`, `yaml`, `stream-json`, `p-limit`, `@restatedev/restate-sdk` as a **peer** dependency matching `pipeline/local-stack` (one SDK instance), dev `tsx`, `typescript`, `vitest`, `eslint`, `prettier`; scripts `test`, `typecheck`, `lint`, `format:check`, `discover`, `check-catalog`, `validate`, `render-sources` per [contracts/cli.md](contracts/cli.md)) and `pipeline/oracle-runtime/tsconfig.json` (strict, no implicit any) **(builder: oracle)**
- [ ] T002 [P] Add ESLint and Prettier config in `pipeline/oracle-runtime/eslint.config.js` and `pipeline/oracle-runtime/.prettierrc` (ban `any`, ban direct `console.log` outside `RT/travis/lib/log.ts`) **(builder: oracle)**
- [ ] T003 [P] Vendor the kit validator **unmodified** from kit 0.99.1 `skills/use-oracle/scripts/validate-county-readiness.py` to `pipeline/oracle-runtime/kit/use-oracle/scripts/validate-county-readiness.py`, plus its 6 self-test fixtures from `skills/use-oracle/fixtures/readiness/*.yaml` to `pipeline/oracle-runtime/kit/use-oracle/fixtures/readiness/` (the script resolves `../fixtures/readiness`); write `pipeline/oracle-runtime/kit/VENDORED.md` with kit version, source paths and the SHA-256 of every vendored file; confirm `python3 …/validate-county-readiness.py --self-test` exits 0 **(builder: oracle)**
- [ ] T004 [P] Create the empty folders and placeholders `pipeline/docs/`, `docs/evidence/`, `docs/evidence/blocked/`, and confirm `git check-ignore pipeline/data/raw/tcad/probe.json` succeeds (root `.gitignore` already ignores `pipeline/data/`) **(builder: oracle)**

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The single HTTP boundary, the catalog schema, the status mapping, the YAML writer and the workflow shell, which every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational (MANDATORY, write first) ⚠️

- [ ] T005 [P] Guard tests in `RT/test/source-client.test.ts` with synthetic fixtures (test-only): 403 → exactly 1 attempt, receipt `outcome: blocked`; a 2xx challenge HTML page that fails its Zod parse → `blocked`, not "0 rows"; timeout → 1 attempt, `blocked` with `timeout_ms`; 429 and 5xx → backoff "1 s base, 60 s cap, 5 attempts" with full jitter, honouring `Retry-After`, then `throttled-then-ok` or `failed`; User-Agent constant across attempts; no proxy or agent rotation configured; at most 2 concurrent requests per host; `isGeoBlock` false for a bare 403 and true only for an explicit body, error-code or header signal (FR-006b) **(builder: oracle)**
- [ ] T006 [P] Schema tests in `RT/test/catalog.schema.test.ts`: a Measurement needs `source_url` and `captured_at` (UTC ISO-8601); `value: null` requires `missing_reason`; `decision` is one of `bulk download | ingest | runtime retrieval`; source `key` is one of the 9 keys in [data-model.md](data-model.md#source-one-row-per-a-oracle--4-source); `historical_records` required on every jurisdiction row **(builder: oracle)**
- [ ] T007 [P] Status-map tests in `RT/test/status-map.test.ts`, exhaustive over the 6 rows of [research R3](research.md#r3-spec-classes-vs-validator-statuses): every `spec_class` + case gives the listed validator `status` and its required extras; `portal_kind: application-intake` never yields `historical_records: true`; output is always in `supported, delegated, manual-only, blocked, unavailable, excluded, custodian-only` **(builder: oracle)**
- [ ] T008 [P] Writer tests in `RT/test/write-catalog.test.ts`: block style only (no `{`/`[` flow collections, anchors or multi-line scalars); `fips` emitted as `"48453"`; IDs, dates and any string containing `#` or `:` are quoted; no bare `yes`/`no`; round-trip read equals the input object **(builder: oracle)**

### Implementation for Foundational

- [ ] T009 [P] Implement JSON logger with redaction of tokens, credential URLs and absolute home paths in `RT/travis/lib/log.ts` **(builder: oracle)**
- [ ] T010 Implement the single HTTP boundary in `RT/travis/lib/source-client.ts`: `p-limit(2)` per host, one constant identified User-Agent naming the project and repo URL (no email), StopOnBlocked on 403/challenge/timeout with zero retries, backoff only on 429/5xx, `isGeoBlock`, a capture receipt per request per [contracts/capture-receipt.md](contracts/capture-receipt.md), optional Socrata app token from the environment recorded only as `app_token_used` (depends on T009) **(builder: oracle)**
- [ ] T011 [P] Implement the Zod catalog schema in `RT/travis/discovery/catalog.schema.ts` per [contracts/catalog.md](contracts/catalog.md) and [data-model.md](data-model.md) **(builder: oracle)**
- [ ] T012 [P] Implement the spec-class → validator-status mapping in `RT/travis/discovery/status-map.ts` (research R3) **(builder: oracle)**
- [ ] T013 Implement block-style YAML emit and read in `RT/travis/discovery/write-catalog.ts` (research R5; validates with T011 before writing `pipeline/docs/travis-sources.yaml`) **(builder: oracle)**
- [ ] T014 Implement the `TravisDiscovery` Restate workflow shell in `RT/travis/discovery/workflow.ts` (run record `state: DISCOVERING | WAITING_HUMAN | READY`, journaled `ctx.run` steps with idempotency key `source:measurement:captured_date`, no auto-advance to seed) and bind it in `pipeline/local-stack/services/app.ts`; confirm one Restate SDK instance is loaded **(builder: oracle)**

**Checkpoint**: T005–T008 pass; the workflow starts on the local stack and records an empty run.

---

## Phase 3: User Story 1 - Measure every source before ingesting anything (Priority: P1) 🎯 MVP

**Goal**: Every A-oracle § 4 source has a denominator, measured throughput, anti-bot posture and decision, each with a source URL and UTC capture time (AC-2, AC-3, AC-5; FR-001b, FR-001e, FR-002, FR-003–FR-003c, FR-005).

**Independent Test**: `npm --prefix pipeline/oracle-runtime run check-catalog` passes rules 1–5 and 8 of [contracts/catalog.md](contracts/catalog.md#checker-rules-check-catalogts-exit-0--all-pass) on a catalog containing only the `sources` and `parcel` blocks.

### Tests for User Story 1 (MANDATORY, write first) ⚠️

- [ ] T015 [P] [US1] Measurement tests in `RT/test/measure.test.ts`: median of "at least 3 consecutive full pages of at most 50,000 rows"; fewer than 3 pages or a page above 50,000 rows is rejected; projected hours = denominator ÷ median ÷ 60; a source above 48 hours without `decision` fails; single-file sources use `download_rate` **(builder: oracle)**
- [ ] T016 [P] [US1] Socrata probe tests in `RT/test/probes/socrata.test.ts` with synthetic responses: Austin `3syk-w9eu` count, `tcad_id IS NULL` count, `jurisdiction` group-by, 3 pages read one after another with `$order=:id` and `$limit=50000`; Comptroller `9cir-efmm` returns both `travis_coded_rows` (county code 227) and `statewide_rows` **(builder: oracle)**
- [ ] T017 [P] [US1] TCAD probe tests in `RT/test/probes/tcad.test.ts`: streaming count over a small synthetic export without loading it fully; field list; receipt with bytes, SHA-256, download rate, `roll_year: 2026`, `certification_date`; the file path is under `pipeline/data/raw/tcad/` **(builder: oracle)**
- [ ] T018 [P] [US1] ArcGIS probe tests in `RT/test/probes/arcgis.test.ts`: one `returnCountOnly=true` request; a 60 s timeout gives `gis_feature_count: null`, blocked evidence and `gap_pct: unknown` with a reason; GIS is never used as the denominator **(builder: oracle)**
- [ ] T019 [P] [US1] Checker tests in `RT/test/check-catalog.sources.test.ts` for rules 1–5 and 8 (all 9 source keys; Measurement provenance; decisions; Comptroller both counts; Austin completeness; GIS counted or `unknown` with reason) **(builder: oracle)**

### Implementation for User Story 1

- [ ] T020 [P] [US1] Implement median rate, projected hours and the 48-hour rule in `RT/travis/discovery/measure.ts` **(builder: oracle)**
- [ ] T021 [P] [US1] Implement Socrata probes for Austin `3syk-w9eu` (count, null `tcad_id` count, jurisdiction group-by, 3-page throughput) and Comptroller `9cir-efmm` (statewide and county-227 counts) in `RT/travis/discovery/probes/socrata.ts`, Zod-parsing every response **(builder: oracle)**
- [ ] T022 [P] [US1] Implement the TCAD probe in `RT/travis/discovery/probes/tcad.ts`: download the Export Layouts (field definitions), confirm the JSON record path, download the 2026 Certified Special Export **once** to `pipeline/data/raw/tcad/` with a long step timeout, stream-count accounts with `stream-json`, list fields, record `identifier_name` exactly as printed and `deed_or_sale_dates_present`; supplemental exports are listed, not downloaded **(builder: oracle)**
- [ ] T023 [P] [US1] Implement the ArcGIS `TCAD_PARCELS` count-only probe with a 60 s timeout in `RT/travis/discovery/probes/arcgis.ts` **(builder: oracle)**
- [ ] T024 [P] [US1] Implement evidence probes for BBB (reuse the 2026-10-17 challenge evidence or at most one observation; never solve the challenge), Overture (licence page), contractor licensing ("no statewide roofing licence": TDLR and HB 3344 status) and TCAD supplemental (listing) in `RT/travis/discovery/probes/evidence.ts` **(builder: oracle)**
- [ ] T025 [US1] Add the US1 probe steps to `RT/travis/discovery/workflow.ts` and assemble the `sources` and `parcel` blocks (depends on T020–T024) **(builder: oracle)**
- [ ] T026 [US1] Implement checker rules 1–5 and 8 with a CLI exit code in `RT/travis/discovery/check-catalog.ts` **(builder: oracle)**

**Checkpoint**: T015–T019 pass; the US1 independent test passes on a catalog built from synthetic probe output.

---

## Phase 4: User Story 2 - Classify every permit jurisdiction (Priority: P1)

**Goal**: The jurisdiction count equals the Census expected count; each row has one class with evidence; Austin-issued records located elsewhere are recorded as Austin-issued (AC-4; FR-004–FR-004c).

**Independent Test**: `check-catalog` passes rules 6–7: jurisdiction count = `census_reference.place_count + 1`, no `needs-review`, every `spec_class` maps to its `status`, Austin-issued counts present under Austin.

### Tests for User Story 2 (MANDATORY, write first) ⚠️

- [ ] T027 [P] [US2] Census probe tests in `RT/test/probes/census.test.ts`: keeps only incorporated places (class `C*`) with land area in county 48453; records `dataset`, `vintage`, `source_url`, `captured_at`, `place_count` **(builder: oracle)**
- [ ] T028 [P] [US2] Profile tests in `RT/test/profiles/jurisdictions.test.ts`: every profile entry has a class, `evidence_url`, and the extras its status needs (`records_request` for `custodian-only`/`manual-only`/`blocked`, `issued_by` for `delegated`); the profile set equals the Census set + unincorporated (a missing or extra place fails) **(builder: oracle)**
- [ ] T029 [P] [US2] Checker tests in `RT/test/check-catalog.permits.test.ts` for rules 6–7, including a city row whose `austin_issued_located_here` count does not change its own status **(builder: oracle)**

### Implementation for User Story 2

- [ ] T030 [P] [US2] Implement the Census probe in `RT/travis/discovery/probes/census.ts` (research R6; record the exact file URL used) **(builder: oracle)**
- [ ] T031 [US2] Research and write the curated jurisdiction profile in `RT/travis/profiles/jurisdictions.ts`: one entry per Census place with land in Travis County plus Travis County unincorporated (start from the 18 leads; verify candidates such as Point Venture, San Leanna, The Hills, Volente and the Travis part of Elgin against the Census file, never assume), each with class per FR-004b, portal, `portal_kind`, evidence URL, `earliest_record_date` where supported, a complete `records_request` where required (recipient office, system and date scope, `api-first`/`records-first`, portal URL or email) and `issued_by` where delegated **(builder: oracle)**
- [ ] T032 [US2] Add jurisdiction steps to `RT/travis/discovery/workflow.ts`: probe each profile evidence URL through the source client, stamp `evidence_captured_at`, map status with `status-map.ts`, attach Austin-issued counts from the T021 group-by (Lakeway, Bee Cave, Pflugerville full purpose and ETJ) as `austin_issued_located_here`, and build the `permits` block with `assumes_unified_countywide_history: false` **(builder: oracle)**
- [ ] T033 [US2] Add checker rules 6–7 to `RT/travis/discovery/check-catalog.ts` **(builder: oracle)**

**Checkpoint**: T027–T029 pass; US1 and US2 checker rules pass together.

---

## Phase 5: User Story 4 - Stop honestly when a source is blocked (Priority: P1)

**Goal**: A blocked source is recorded with code, time and evidence, the run waits for a human, nothing is retried with a changed identity, and a complete records request is named; the US check happens only on a saved geo signal (AC-6; FR-006–FR-006d).

**Independent Test**: with a synthetic 403 for TCAD, the run reaches `WAITING_HUMAN`, the TCAD row has `blocked_evidence` with `geo_signal: none` and a complete `records_request`, and no second request was made.

### Tests for User Story 4 (MANDATORY, write first) ⚠️

- [ ] T034 [P] [US4] Workflow tests in `RT/test/workflow.blocked.test.ts`: a blocked receipt moves the run to `WAITING_HUMAN` and waits on a durable promise (no timer loop); resolving it as "captured" re-probes only that source; resolving it as "still blocked" keeps `WAITING_HUMAN` with the blocker recorded; `READY` never starts seed **(builder: oracle)**
- [ ] T035 [P] [US4] Blocked-evidence tests in `RT/test/blocked-evidence.test.ts`: the evidence file under `docs/evidence/blocked/` contains status or timeout, time, URL, headers and a body excerpt with its SHA-256, and no tokens, credential URLs or absolute home paths; `geo_signal` is `none` unless the saved response quotes an explicit signal **(builder: oracle)**

### Implementation for User Story 4

- [ ] T036 [US4] Implement the `WAITING_HUMAN` durable promise and its resolve handler in `RT/travis/discovery/workflow.ts` **(builder: oracle)**
- [ ] T037 [P] [US4] Implement blocked-evidence writing in `RT/travis/discovery/blocked-evidence.ts` and attach `blocked_evidence` to blocked source and jurisdiction rows **(builder: oracle)**
- [ ] T038 [US4] Add the records requests for blocked sources to the catalog: TCAD (custodian, Public Information Act route, 2026 certified plus supplemental exports, `records-first` or `api-first`, portal URL or email) and BBB (next step: official API application, recorded only), in `RT/travis/discovery/workflow.ts` **(builder: oracle)**
- [ ] T039 [US4] **Only if** a saved TCAD or GIS response has `geo_signal` other than `none`: add `.github/workflows/geo-check.yml` (`workflow_dispatch` only, one identified request with the project User-Agent, uploads status, headers and body digest as an artifact). If there is no geo signal, mark this task "N/A: no geo signal (FR-006b)" in `docs/evidence/A-01.md` **(builder: oracle; trigger: operator)**

**Checkpoint**: T034–T035 pass; the US4 independent test passes.

---

## Phase 6: User Story 3 - Get a readiness verdict the evaluator can check (Priority: P1)

**Goal**: The vendored validator runs on the real catalog; the catalog, summary and report are committed; every number in the summary has a URL and UTC time (AC-1, AC-7; FR-001–FR-001d, FR-007, FR-007a).

**Independent Test**: [quickstart.md](quickstart.md) Scenario 1: exit 0 with `overall: PASS`, or exit 1 where `parcel` is the only blocked gate with the blocker documented; `check-catalog` exits 0; `render-sources` leaves no diff.

### Tests for User Story 3 (MANDATORY, write first) ⚠️

- [ ] T040 [P] [US3] Destination-proof tests in `RT/test/destination-proof.test.ts`: two identities from independent sources (Docker side, SQL side); output contains no URL, host credentials or password **(builder: oracle)**
- [ ] T041 [P] [US3] Validator-runner tests in `RT/test/run-validator.test.ts`: calls the vendored script with the relative path `pipeline/docs/travis-sources.yaml`; saves stdout to `docs/evidence/A-01-readiness.json` and the exit code; checks the vendored SHA-256 against `kit/VENDORED.md`; the report contains no absolute home path **(builder: oracle)**
- [ ] T042 [P] [US3] Renderer tests in `RT/test/render-sources-md.test.ts`: every number links its source URL and UTC capture time; a null shows its `missing_reason`; output is deterministic (same catalog → byte-identical file) **(builder: oracle)**
- [ ] T043 [P] [US3] Checker tests in `RT/test/check-catalog.hygiene.test.ts` for rule 9 (no `postgres://`, token values or absolute home paths anywhere in the catalog) **(builder: oracle)**

### Implementation for User Story 3

- [ ] T044 [P] [US3] Implement destination proof in `RT/travis/discovery/destination-proof.ts` (research R9) and fill the `destination` block **(builder: oracle)**
- [ ] T045 [P] [US3] Implement the validator runner in `RT/travis/discovery/run-validator.ts` **(builder: oracle)**
- [ ] T046 [P] [US3] Implement the renderer in `RT/travis/discovery/render-sources-md.ts` writing `docs/sources.md` **(builder: oracle)**
- [ ] T047 [US3] Add checker rule 9 to `RT/travis/discovery/check-catalog.ts` **(builder: oracle)**
- [ ] T048 [US3] Live run on the operator machine: start the local stack (`bootstrap-oracle-infra` checks), run `npm --prefix pipeline/oracle-runtime run discover`, producing `pipeline/docs/travis-sources.yaml` with real Travis County measurements **(operator, with builder: oracle)**
- [ ] T049 [US3] Write the county-discovery findings profile in `pipeline/docs/travis-county-findings.md` (appraiser portal, parcel identifier, permit portals, bulk sources, use codes, additional sources, feasibility, risks) from the live run **(builder: oracle)**
- [ ] T050 [US3] Run `check-catalog` (exit 0) and `validate` on the live catalog; save `docs/evidence/A-01-readiness.json`; run the validator again with `python3 -s` (no PyYAML) and confirm the report is identical (parser parity) **(builder: oracle)**
- [ ] T051 [US3] Run `render-sources` to write `docs/sources.md`; write `docs/evidence/A-01.md` (validator exit code, catalog SHA-256, one row per source with URL, count and capture time, the blocker record and run state if TCAD stays blocked per FR-006c) and start `docs/evidence/A-01-coverage.md` (completed in A-11) **(builder: oracle)**

**Checkpoint**: Quickstart Scenarios 1, 2 and 4 pass on the real catalog.

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: CI, hygiene and quickstart validation across all stories.

- [ ] T052 [P] Add `.github/workflows/pipeline-ci.yml`: on push and pull request for `pipeline/oracle-runtime/**`, run `npm ci`, `typecheck`, `lint`, `format:check`, `test`, and `python3 …/validate-county-readiness.py --self-test` (research R12) **(builder: oracle)**
- [ ] T053 Hygiene: run gitleaks on the branch; grep `docs/evidence/`, `docs/sources.md` and `pipeline/docs/` for `postgres://`, token values and `/Users/`; confirm `git check-ignore` on the TCAD file and that no TCAD rows are committed **(builder: oracle)**
- [ ] T054 Run every scenario in `specs/001-discover-sources/quickstart.md` and record the results in `docs/evidence/A-01.md`; then run every test case in `testplans/A-01-test-cases.md` (the G6 cases derived from AC-1 to AC-7, constitution XXII) against the committed catalog, `docs/sources.md`, the validator report and the unit-test results, since there is no hosted URL (G4 C-04 exception), and record pass/fail per TC with evidence links in `docs/reports/TR-A-01.md` **(builder: oracle)**

---

## Phase Z: Prove on the hosted runtime (mandatory, always last)

**Purpose**: Constitution I, XVI, XXII. The story is not done until these pass.

- [ ] TZ01 Run the reviewer agents from the story front matter read-only (`oracle`); record scores in docs/reviews/CR-A-01.md (each ≥ 75 or justified)
- [ ] TZ02 N/A: Project story, no hosted runtime until A-03
- [ ] TZ03 N/A: Project story, no hosted runtime until A-03
- [ ] TZ04 N/A: Project story, no hosted runtime until A-03
- [ ] TZ05 Run the story's `agents.verify` check: the readiness validator (`npm --prefix pipeline/oracle-runtime run validate`) exits 0 with `overall: PASS`, or exits 1 with `parcel` as the only blocked gate and the FR-006c blocker documented; record the exit code and report path in docs/evidence/A-01.md
- [ ] TZ06 Write docs/reports/TR-A-01.md, docs/evidence/A-01.md, the docs/traceability.md row and one docs/kit-usage.md line

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; blocks all user stories.
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on Foundational; T032 uses the Austin group-by from T021 (US1).
- **US4 (Phase 5)**: depends on Foundational; its blocked rows apply to sources from US1 and jurisdictions from US2.
- **US3 (Phase 6)**: depends on US1, US2 and US4 (the verdict needs the complete catalog).
- **Polish (Phase N)**: T052 can start after Setup; T053–T054 after US3.
- **Phase Z**: last, after Polish.

### Within Each Phase

- Tests are written first and must fail before implementation.
- Schema and mapping before probes; probes before workflow steps; workflow before checker rules that read its output.
- Live run (T048) only after every unit test passes.

### Parallel Opportunities

- Setup: T002, T003, T004.
- Foundational tests: T005–T008; implementation: T009, T011, T012 in parallel, then T010, T013, T014.
- US1 tests T015–T019 together; probes T020–T024 together.
- US2 tests T027–T029 together; T030 in parallel with T031.
- US4 tests T034–T035 together.
- US3 tests T040–T043 together; T044–T046 together.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "Measurement tests in pipeline/oracle-runtime/test/measure.test.ts"
Task: "Socrata probe tests in pipeline/oracle-runtime/test/probes/socrata.test.ts"
Task: "TCAD probe tests in pipeline/oracle-runtime/test/probes/tcad.test.ts"
Task: "ArcGIS probe tests in pipeline/oracle-runtime/test/probes/arcgis.test.ts"

# Then the probes, together (builder: oracle):
Task: "Socrata probes in pipeline/oracle-runtime/travis/discovery/probes/socrata.ts"
Task: "TCAD probe in pipeline/oracle-runtime/travis/discovery/probes/tcad.ts"
Task: "ArcGIS probe in pipeline/oracle-runtime/travis/discovery/probes/arcgis.ts"
Task: "Evidence probes in pipeline/oracle-runtime/travis/discovery/probes/evidence.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup and Phase 2 Foundational.
2. Phase 3 (US1): every source measured with provenance.
3. **Stop and validate**: checker rules 1–5 and 8 pass.

### Incremental Delivery

1. US1 → measured sources.
2. US2 → classified jurisdictions.
3. US4 → honest blocked handling (expected for TCAD today).
4. US3 → live run, verdict, committed proof.
5. Polish, then Phase Z (oracle review ≥ 75, readiness validator).

---

## Notes

- [P] tasks = different files, no dependencies.
- Every number in committed files is a real measurement with URL and capture time; synthetic fixtures live only under `RT/test/` and are never shown as real data.
- Never print `pipeline/local-stack/.env`; never push to `elephant-xyz/Counties-trasform-scripts` (PO decision 2026-10-19).
- Commit after each task group with the `A-01:` prefix.
