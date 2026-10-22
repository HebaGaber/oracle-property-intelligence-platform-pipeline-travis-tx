# Build notes: Track A (contractor identity)

## Wave 2 (this update)

- **T018**: `travis/identity/totals.ts` (`computeFiveStateTotals`) implemented against the
  already-red T013 test; now green. Pure aggregation, `derivation: "aggregate_match"`,
  `limitation: null`.
- **T019 [RUN], Wave 2 DB writer**: new CLI verb
  `pipeline/oracle-runtime/travis/backbone/commands/identity:load-registry.ts`
  (`backbone identity:load-registry --source tx-comptroller --scope travis`). OR-B1 egress
  check first (first-ever run of this track, no recorded reference, so
  `requireReference: false`, same as `discover`'s own first-run case) — observed country
  recorded with the run. Talks to the live Comptroller source through the T010 shared
  adapter, then `Loader.merge` on the `comptroller` track through the Restate ingress only
  (never Postgres directly from the CLI, matching T056's reconcile:merge redo; the
  contract's `--database-url-env` flag is dropped for the same reason).
  Executed live end to end: Restate deployment re-registered at revision 17 (picked up the
  `comptroller` track and `identity` report section), migrations confirmed already applied
  (14/14, 0 new), then a real run against `data.texas.gov/9cir-efmm`:
  - **job_id**: `travis-a07-identity-registry-20261022182314`
  - **rows loaded**: **342,333** (7 pages, Travis county code 227 scope) — matches the
    342,334 reference within normal day-to-day drift (docs/sources.md's own figure is from
    2026-10-19; this run is 2026-10-22)
  - **watermark** (max `:updated_at`): `2026-10-17T10:35:22.788Z`
  - **snapshot digest**: `d327b29fdad4f655258a63dfc94099276b298a71c74e999dab1d09a07f19fbba`
  - **egress**: EG (operator network, recorded with the run; no VPN)
  - rowsWritten via the Loader: 342,333; verified directly against Postgres
    (`comptroller_registry` count = 342,333; `comptroller_registry_loads` row matches the
    report exactly)
  - report: `pipeline/data/identity/travis/travis-a07-identity-registry-20261022182314/registry-load-report.json`

  Not written to run-log.md myself, per instruction.

## Wave 1

Builder: `soofi-xyz-team-kit:oracle`, story A-07, branch `007-enrich-reconcile`.

## Toolchain (T002)

Measured in this worktree: Node `v22.23.3`, pnpm `10.34.7`, DuckDB CLI `v1.5.6 (Variegata)`.
Matches Stage 0's measured toolchain (run-log.md S0.3: node 22.23.3, pnpm 10.34.7, duckdb
1.5.6). No drift; no new dependency added. Not written to run-log.md myself, per instruction
(the PO logs it).

## Tasks completed

- **T001**: created the Track A/B/C/D directories under `pipeline/oracle-runtime/travis/` and
  the shared test/fixture trees under `pipeline/oracle-runtime/test/travis/a07/` and
  `test/fixtures/a07/` (identity/bbb/places/reconcile/roof-age, comptroller/bbb-stub/
  overture/reconcile/roof-age).
- **T003 / T004**: `pipeline/local-stack/migrations/0401_comptroller_registry.sql` (staging
  table `comptroller_registry` keyed on `taxpayer_number`, `ON CONFLICT` upsert target,
  `updated_at` watermark column, plus `comptroller_registry_loads` for the per-load row
  count/watermark/digest) and `0402_contractor_ledger.sql` (append-only
  `contractor_resolution_ledger` per data-model.md, plus a `contractor_resolution_current`
  view for the latest verdict per permit).
- **T009 / T010**: adapter test
  `test/travis/a07/identity/tx-comptroller.test.ts` written and run red (module not found)
  before `travis/adapters/socrata/tx-comptroller.ts` existed; then implemented. Keyset-paged
  Socrata load of `9cir-efmm`, Travis-scoped (`taxpayer_county_code='227'`), in-memory
  staging/upsert keyed on `taxpayer_number` (`stageComptrollerRows`), max-`:updated_at`
  watermark, order-independent sha256 snapshot digest (`registrySnapshotDigest`), staged
  artifact written to `<jobDir>/registry-rows.json`. Column names
  (`taxpayer_number`/`taxpayer_name`/`taxpayer_county_code`/`right_to_transact_business`/
  `sos_file_number`) were flagged in a code comment as this story's best reading, to confirm
  at the live load — **confirmed live at T019** (Wave 2): the real run against
  `data.texas.gov/9cir-efmm` parsed all of them without a schema error over 342,333 rows.
- **T011–T015**: resolver tests (`resolver.test.ts`), crosswalk negative-finding test
  (`crosswalk.test.ts`) written red, then `travis/identity/resolver.ts` and
  `travis/identity/crosswalk.ts` implemented green. Decision order matches
  `contracts/resolver.md` exactly (1 no-name → `contractor_not_printed`; 2 registry
  unavailable → `registry_unavailable`; 3 crosswalk match → `resolved`, proven only via a
  labelled fixture since `LIVE_CROSSWALK` is empty per D-10; 4 one active match →
  `candidate`; 5 two+ active → `ambiguous`, all kept; 6 a match with non-active status →
  `conflicting`; 7 no match → `unresolved`, no reason code). Name normalisation
  (`normalize-name-v1`) expands `CO`/`CORP`/`INC`/`LTD` after stripping punctuation, so
  "Roofing Co." and "ROOFING COMPANY" compare equal and resolve to `candidate`, never
  `resolved`.
- **T013** (totals test only, **no implementation** per instruction — T018 is Wave 2):
  `test/travis/a07/identity/totals.test.ts` written against the intended
  `travis/identity/totals.ts` API (`computeFiveStateTotals`); confirmed red
  (module-not-found) and left red on purpose in Wave 1. **Implemented in Wave 2 (T018)**: now
  green — pure aggregation, `derivation: "aggregate_match"`.
- **T016 / T017**: Loader track test (`pipeline/local-stack/test/tracks/comptroller.test.ts`)
  written red, then `services/tracks/comptroller.ts` (track name `"comptroller"`, one input
  kind `load_registry`: reads the staged artifact, verifies its sha256, batch-upserts into
  `comptroller_registry`, records a `comptroller_registry_loads` row, returns the watermark
  value including row count and digest) and `services/report-sections/identity.ts`
  implemented green.
- **T021** (sampler test only, **no implementation** per instruction — T022 is Wave 3):
  `test/travis/a07/identity/sampler.test.ts` written against the intended
  `travis/identity/sampler.ts` API (`sampleContractorLedger`, seeded, every-non-empty-state
  guarantee); confirmed red and left red on purpose.

## Shared-file edits (minimal, additive only)

- `pipeline/local-stack/services/loader.ts`: widened `TrackName` to add `"comptroller"`.
- `pipeline/local-stack/services/report.ts`: added `"identity"` to `SECTION_KEYS` and the
  `BackboneReportV1` schema's optional keys.
- `pipeline/local-stack/test/report.test.ts`: updated the "all six keys" assertion to the
  new seven (it now also finds `identity`); this is the test the SECTION_KEYS change
  correctly turns red, then green once the identity section is added.
- `pipeline/oracle-runtime/test/travis/socrata-adapter.test.ts`: updated the adapter
  file-list assertion in "adapter files carry no classification term" to include
  `tx-comptroller.ts` (verified it contains no `roof`/profile-term text, so the
  no-classification-term assertion in the same describe block still passes unchanged).

## Test results (updated after Wave 2)

- `pipeline/oracle-runtime`: `npx vitest run` → **997 passed**, 2 skipped, **2 failed test
  files** — both expected and out of this wave's scope (T013/totals is now green):
  - `test/travis/a07/identity/sampler.test.ts` (T021, red by design; T022 is Wave 3)
  - `test/travis/a07/identity/totals.test.ts` (T013, red by design; T018 is Wave 2)
  - `test/travis/a07/runs/a07-coverage.test.ts` (Track D's T052, not this builder's file)
- `pipeline/local-stack`: `npx vitest run` → **159 passed**, 3 skipped, **0 failed**.
- `npm run typecheck` in `oracle-runtime`: clean except the same three not-yet-implemented
  modules (module-not-found only, no other type errors in my files); `local-stack` typecheck
  clean.
- `npx eslint` on every file I added/touched: clean (one `@typescript-eslint/no-non-null-
  assertion` finding in `resolver.ts` fixed before handback).

## Deviations from tasks.md

None in scope or sequencing. All deferred tasks (T018, T019, T020, T022) were left
untouched as instructed, and their tests were written to stay red rather than skipped, so
the "tests first, must fail" contract is visible in the test output rather than silently
absent.
