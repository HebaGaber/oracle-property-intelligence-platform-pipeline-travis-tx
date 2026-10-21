---
id: QUICKSTART-A-04
type: quickstart
parent: PLAN-A-04
created: 2026-10-21
---

# Quickstart: prove the A-04 backbone

A run guide, not code. Commands from the repo root on branch `004-property-backbone`; names from [contracts/cli.md](contracts/cli.md) and test plan § 3.3. Nothing here publishes anything; no command calls GIS from the laptop.

## Prerequisites

- `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`; Node ≥ 22; `docker compose -f pipeline/local-stack/docker-compose.yml up -d` (Postgres + Restate); `npm --prefix pipeline/local-stack start` (services on :9080, registered with Restate); `restate` CLI; `gh` authenticated on the fork; `~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli` (44bb182); DuckDB CLI 1.5.6; ≥ 20 GiB free.
- `qdb_ro` helper from test plan § 3.3 defined in the shell.
- Migrations: `npm --prefix pipeline/local-stack run migrate` → applies `0000_core` … `0301_permits` once.

## 1. Unit and integration check (offline)

`(cd pipeline/oracle-runtime && npm test && npm run typecheck && npm run lint && npm run format:check)` and `(cd pipeline/local-stack && npm run typecheck && npm test)` → all green; every A-04 case is addressable as `npx vitest run test/travis/a04/<file> -t "A-04-TC-nnn"`.

## 2. Pilots

1. `npm --prefix pipeline/oracle-runtime run backbone -- pilot --select` → writes `pipeline/data/seeds/travis-a04-pilot.csv` (25 rows with reasons: `0223120506`, second anchor, P/MH/MN, coded-confidential, shared geoID, several improvements, no dated sale, no year built, out-of-area / regional / foreign mailing).
2. `npm --prefix pipeline/oracle-runtime run backbone -- pilot --seed pipeline/data/seeds/travis-a04-pilot.csv` → `job_id=…`; then `elephant-cli validate` on `pipeline/data/runs/<jobId>/groups/county` → exit 0; the transform coverage report lists every mapped field.
3. `npm --prefix pipeline/oracle-runtime run backbone -- permits --mode pilot` → one 50,000-row page captured, digested, loaded; then `permits --link`.
4. Check the seven pilot conditions (tasks T067); `backbone report --job <jobId> --json` shows no `blocked` or `waiting_human`.

## 3. GIS on the US runner

Set `"mode": "pilot"` in `pipeline/oracle-runtime/travis/gis/runner-config.json`, commit, push the branch → `gh run list --workflow a04-gis-capture.yml --branch 004-property-backbone` → `gh run download <id> -D pipeline/data/raw/gis/us-runner-<id>`; `egress.txt` reads `loc=US`. Then `"mode": "full"`, commit, push, download; `complete.json` present. Then the job gets `if: false`.

## 4. Full runs (one at a time)

1. `backbone -- permits --mode backfill` → report `permits.captured_at_watermark = source_total_at_watermark`.
2. `backbone -- ingest --track appraisal` → `monitoring-county-ingestion` reports complete; `qdb_ro "SELECT class, count(*) FROM roll_reconciliation WHERE job_id = '<jobId>' GROUP BY class"` → difference < 9,865, 0 unexplained.
3. `backbone -- coords --gis-artifact pipeline/data/raw/gis/us-runner-<id>`; `backbone -- permits --link`; `backbone -- coords --assemble-only`.
4. `backbone -- ingest --write-group --job <jobId>`; `elephant-cli validate` → `hash` → `validate` (CAR) → `export-tables --part-size 48m` into `pipeline/data/runs/<jobId>/tables/` (never uploaded).
5. `backbone -- coords --coverage --tables pipeline/data/runs/<jobId>/tables` → `coverage_public ≥ 0.99`, `coverage_qdb ≥ 0.99` over the 441,961 R accounts; difference = `permit_point`.
6. `backbone -- permits --mode incremental` → re-stamp verdict, rows written, tombstones.

## 5. Expected outcomes

| Check | Expected |
| --- | --- |
| Roll | loaded = N − dead − invalid; difference < 2% of N; 0 unexplained; confidential (15,410 R, re-measured) inside loaded |
| Coverage | ≥ 437,542 of 441,961 R both ways; non-land 51,285 with `non_land_account`; gap by reason sums to the rest |
| Austin | captured = source count at the watermark; ≥ 97% of reroof candidates linked; status split vs baseline; 1982-012866 BP `Suspended` / `open` / `no_tcad_geoid`, `open_days = as_of − 1982-06-23` |
| Jurisdictions | Austin captured with total + timestamp; 22 records-request rows in `limitations` with evidence URLs |
| Honesty | no confidential name in any output (TC-015 grep); no GIS request from the laptop (TC-NF-03); no Query DB export (TC-NF-02) |
