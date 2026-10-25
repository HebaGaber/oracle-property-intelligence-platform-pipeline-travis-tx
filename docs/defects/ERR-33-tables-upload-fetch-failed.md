---
id: ERR-33
type: defect
feature: FEAT-A11
story: A-11
test_case: pipeline/publish test/tables-upload.test.ts, test/publish-run.test.ts (tables units use the resilient uploader)
ac_reference: A-11
severity: High
status: Fixed in code; first used for Run 3
found_by: Run 3 public upload (Filebase), diagnosed by the lead
found_date: 2026-10-25
fix_branch: 011c-run3-integrated
fix_commit: pending (the lead commits after CI)
retest_date: pending (the real Run 3 upload)
closed_date: pending
---

# ERR-33: Tables directory upload fails with "Upload failed: fetch failed"

## Brief description

`elephant-cli upload <tables dir> --api https://rpc.filebase.io` fails again and again with `Upload failed: fetch failed`. The CLI discards the cause. CAR uploads (`dag/import`) succeed. Run 1 showed the same failure on tables uploads for several batches and only passed on a later attempt (Run 1's upload took about 5 hours).

## Evidence

- The CLI (`car-import.service.js`, `importTables`) does, for every part, one plain `fetch` POST to `/api/v0/add?pin=true&cid-version=1&raw-leaves=true&chunker=size-262144` with no timeout and no retry of its own (Node's default 300 s header timeout applies). One failed fetch fails the whole attempt, and the next attempt re-uploads all 21 parts (about 94 MB; 3 minutes at the lab's 0.5 MB/s uplink, plus the stall).
- Direct `curl` uploads of all 21 `b01` parts to the same endpoint all returned HTTP 200 in 4 to 24 s each (2.5 minutes in total). The endpoint, the token and the network work; the failures are occasional stalled or reset requests.

## Root cause

A single stalled or reset request has no per-request timeout and no retry, so it aborts a 21-request sequence, and the retry of the whole attempt repeats the work already done. The real error (`UND_ERR_HEADERS_TIMEOUT`, `ECONNRESET`, ...) is in `error.cause` and is never printed.

## Fix

`pipeline/publish/src/tables-upload.ts` (`uploadTables`) replaces `elephant-cli upload` for tables units only; CAR units still use the CLI. It keeps the CLI's semantics exactly (same add parameters, each returned Hash must have the digest the `tables.car` index records, `dag/import` of `tables.car`, root readback with a sha256 check, first part read back and size compared) and writes the same `--output-json` summary (`api`, `root`, `countyRoot`, `parts`, `gatewayUrl`, `uploadedAt`). Differences:

| Behaviour | Value |
| --- | --- |
| Per-request timeout | 120 s plus part size / 256 KiB per second (so a 48 MiB part gets about 308 s), configurable |
| Retries per request | 6, backoff 2 s doubling to 60 s; on timeout, network error, HTTP 429 and 5xx |
| Never retried | a Hash that differs from the index; any 4xx except 429. These throw `TablesUploadFatal`, and `publish-run.ts` stops that unit at once instead of spending its 8 attempts |
| Retry log | `retry add property/part-00003.parquet (4/21, 4718592 bytes) try 2/7 failed after 120.3s: TypeError UND_ERR_HEADERS_TIMEOUT: fetch failed; waiting 4s` (the cause code is read from `error.cause`; credentials are redacted) |
| Resume | confirmed parts (path, size, cid) are written to `<receipt>.parts.state` next to the receipt after each add and skipped on the next attempt or run; removed on success. An add is idempotent, so this is only an optimisation. A sidecar from another API is ignored |
| Concurrency | option, default 1 (the uplink is the bottleneck) |
| Readback | the gateway poll treats network errors and 404 as "not yet" until 600 s (the CLI's default is 300 s); the failure message names the last answer |

`publish-run.ts` keeps 8 attempts per unit; each attempt is now far more tolerant. The script wires `uploadTables` through `FilebaseStepDeps.uploadTables`; without that dependency (older tests) tables still go through the CLI.

## Tests

`test/tables-upload.test.ts` uses a fake Kubo RPC and gateway on `127.0.0.1` (nothing is uploaded anywhere): all ok; a stalled add retried after the per-request timeout; 503 twice then ok; a connection reset retried; a hash mismatch and a 401 not retried; retry budget exhausted; readback 404 for a while then 200; readback deadline message; sidecar resume; size mismatch before the first add; concurrency 3. `test/publish-run.test.ts` checks that tables units use the new uploader and that a fatal error stops after one call.

## Status

Fixed in code; first used for Run 3. `publish-run.ts --dry-run` plans the same units as before (checked on the Run 3 manifest).
