---
id: DATA-MODEL-A-03
type: data-model
parent: PLAN-A-03
---

# Data model: A-03 (Phase 1)

The public schemas are frozen in `contract/v1` (`packages/contract`) and are used unchanged. This file lists the entities A-03 touches, the fields it relies on, and the validation and state rules it adds. Additive items are marked **(new, internal)** or **(additive, AM-05)**.

## Public (contract/v1)

### RunManifestV1 (`oracle-travis-run-manifest.v1`)
- `runId` `^[a-z0-9][a-z0-9-]*$`, no "pilot"; `county`, `state`, `fips`; `startedAt`, `finishedAt` (UTC ISO).
- `previousManifestCid`: `null` for this first run (view shows `first_run`).
- `sources[]` (order is display order, strict): `{ name, url, watermark, captured_at, records, added, changed, removed, limitations[] }`. A-03: `austin-3syk-w9eu` first, `tcad-2026-certified-json` second.
- `artifacts[]`: `{ name, cid, codec, size, sha256, kind: "car" | "table" | "directory", carCid? }`. Refinements: CIDv1 only; no gateway URLs; `directory` requires `carCid`. **(additive, AM-05)** `car` artifacts also carry `carCid` = raw-leaves file CID of the `.car` bytes.
- `coverage`: `permits_emitted {count, derivation: "published_rows"}`, `permits_no_tcad_geoid {count, derivation: "aggregate_match"}`, profile exclusions (`trade_permit`) as counts; no Query DB rows.
- `profiles[]`: `travis-austin@1.0.0` with DIGEST.
- Stored as exact JCS bytes; its CID = `cidOfBytes(bytes)` (raw codec, CIDv1).

### RunsIndexV1
- `runs[] {runId, manifestCid, finishedAt}` ordered by `finishedAt`; JCS bytes; committed in `runs/index.json`; copied to `apps/web/public/runs/index.json` at build.

### v_roofing_permit row (view over the CLI tables)
- Shown columns: `permit_number`, `improvement_status`, `status_class` (open / stalled / closed), `issue_date`, `contractor_resolution`, provenance `{source_url, captured_at, table, table_cid, run_id, manifest_cid}`, `missing: {field, reason}[]`.
- Reason ∈ the closed list of 21 (`columns.json` `missingReasons`).

### v_run row
- `run_id`, `started_at`, `finished_at`, sources, coverage counts, `manifest_cid`.

## UI mappings (packages/shared)

| Map | Key | Rule |
| --- | --- | --- |
| `MISSING_REASON_LABELS` | each of the 21 reasons | `Record<MissingReason,string>` (tsc fails on a missing key); Vitest walks `MISSING_REASONS` (FR-011). |
| `missingLabel(field, reason)` | (field, reason) | Contractor fields with `source_missing` → "Contractor not printed on permit"; else the table label (D-2). |
| `SOURCE_LABELS` | source `name` | `austin-3syk-w9eu` → "City of Austin Issued Construction Permits (3syk-w9eu)"; `tcad-2026-certified-json` → "TCAD 2026 certified export"; test fails on an unmapped manifest source. |
| Coverage label | `permits_no_tcad_geoid` | "No TCAD id on source record". |

## Internal (never public)

### CaptureReceipt (oracle-runtime)
`{ url, multiValueQueryString, status, bytes, sha256, captured_at, outcome: "ok" | "blocked" | "error", ua, attempts }`. A 403 or challenge → `blocked`, run stops.

### PermitStatus (oracle-runtime, `status/<safePermitName>.json`)
State: `pending → captured → classified(accepted | excluded:trade_permit) → emitted | not_emitted:no_tcad_id`. Idempotent: a `captured` key is skipped on re-run.

### SequenceStep **(new, internal)** (`reports/sequence.json`)
`{ group, step: "validate" | "hash" | "validate-car" | "export-tables" | "upload-car" | "upload-tables", argv (no secrets), exitCode, outputs[{path, sha256}] }`. Order invariant: 2×4 build steps, then (after D-8) 2×2 uploads; any non-zero exit stops all later steps; no skip flag exists.

### ReadbackResult **(new, internal)**
`{ group, rootMatches, partCount, parts[{cid, size, sha256, ok}] }`. Any `ok=false` → no manifest.

### CidCopyObject **(new, internal)**
S3 key `ipfs/<cid>`; metadata `{cid, sha256}`; `ChecksumSHA256`; `Cache-Control: public, max-age=31536000, immutable`; Content-Type by kind. States: `absent → written(verified)`; `exists-same → skipped`; `exists-different → error` (never overwritten).

### VerifyResult **(new, internal)**
Per artifact × gateway (`gateway.pinata.cloud`, `ipfs.filebase.io`): `{ name, cid (or carCid), gateway, status, size, sha256, ok }`. `ALL ARTIFACTS VERIFIED` iff all `ok` on both gateways.

### FetchByCid state (web)
`copy(pending) → ok` | `copy(error | non-200 | >4 s) → fallback(pending) → ok(label "fallback")` | `fallback(error) → error banner`.

### Permits page state (web)
`loading(stage text, progress) → ready(table)` | `error`. The table renders only in `ready` (FR-008). If row count ≠ `coverage.permits_emitted` → error banner (FR-009).

### BenchEvent / BenchResult **(new, internal)**
Event `{kind: "bench", query: "count" | "radius" | "roofAge", preset: "TC_NF_05" | "ADR_0001", prefix: "private/bench/<name>/"}`; result `{query, rows, queryDurationMs, initMs, coldStart}`.
