# Quickstart: validating A-07

A-07 is pipeline-only (`ui: false`) — there is no hosted URL to click through. Every validation step runs from a terminal at the repo root, on branch `007-enrich-reconcile`, against the local stack (Restate + Postgres).

## Prerequisites

- Local stack up: `bootstrap-oracle-infra` passes, `http://localhost:9070` answers.
- Egress check passes (VPN off) before any Comptroller or Overture request.
- `~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli --help` prints (never the Homebrew copy).

## Track A — contractor identity

```bash
EN identity:load-registry --source tx-comptroller --scope travis --database-url-env DATABASE_URL
EN identity:resolve --scope austin-reroof --registry-snapshot <digest-from-previous-step>
EN identity:report --json
```
Expected: five-state totals sum to the permit total (22,084); `resolved` = 0 with the AC-2 fixture test proving the code path separately; `contractor_not_printed` count ≈ 15,060.

## Track B — BBB (stub only)

```bash
npx vitest run pipeline/oracle-runtime/test/travis/a07/bbb
EN bbb:probe --max-pages 2 --max-profiles 5 --target stub
```
Expected: ≤ 7 requests total against the stub; `bbb_status_counts` shows `"not computable: 0 resolved companies"` (resolved = 0 this run).

## Track C — business/places (only if tracks A and D merged before 2026-10-23 12:00 EEST)

```bash
EN business:transform --scope travis
EN places:probe-counts --release 2026-09-23.0 --county-fips 48453
```
Expected: business count equals the Comptroller source count at the watermark; places either loaded with category counts and the pinned release recorded, or the "Places: not loaded · {reason}" limitation if the licence gate (D-15) failed.

## Track D — reconcile and roof age

```bash
EN reconcile:merge --entity-type property
EN reconcile:merge --entity-type owner
EN reconcile:merge --entity-type contractor
roof-age:audit --limit 25 --offset 0 --as-of-date 2026-10-22 --source-system travis-austin-permits --report pipeline/data/roof-age/travis/<jobId>/audit.json
```
Expected: `merge {entityType, inputRecords, canonical}` per type (contractor merges = 0, expected); the 25-row audit report ready for D-21 review. After approval, `--apply` then a re-run shows `rowsWritten: 0`.

## Unit tests (all tracks)

```bash
cd pipeline/oracle-runtime && npm test && npx vitest run --coverage
```
Expected: ≥ 80% coverage on business-rule code in `packages/query-core`, `packages/contract` and the profiles (NFR-09).
