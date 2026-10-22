# Build notes: Track A (contractor identity), Wave 1

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
  `sos_file_number`) are flagged in a code comment as this story's best reading, to confirm
  at the live load (T019, out of this wave's scope) — matching the existing codebase's own
  humility pattern in `discovery/probes/socrata.ts`.
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
  (module-not-found) and left red on purpose.
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

## Test results

- `pipeline/oracle-runtime`: `npx vitest run` → **995 passed**, 2 skipped, **3 failed test
  files** — all expected and out of this wave's scope:
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
