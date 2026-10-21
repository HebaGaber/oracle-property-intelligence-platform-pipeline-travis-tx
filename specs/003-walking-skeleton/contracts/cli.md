# CLI contract (A-03)

## `pipeline/oracle-runtime`: `npx tsx travis/runs/run-month.ts --month 2026-09 [--job <jobId>]`
- Captures the Austin slice through `travis/adapters/socrata/` (≤ 50,000 rows/page, one pass, ≤ 1 req/s, stop on 403), classifies with `travis-austin@1.0.0`, builds the TCAD subset from the local certified zip (sha256 checked against `travis-sources.yaml`), applies confidentiality flags, writes `pipeline/data/runs/<runId>/groups/{county,property_improvement}`.
- Exit 0 with a summary (captured, accepted, excluded, emitted, no-tcad); exit 2 on `blocked`; non-zero on any other failure.

## `pipeline/publish`: `pnpm --filter @countylens/publish exec tsx src/cli.ts build --run <runId>`
- Phase 1 for both groups (validate → hash+CAR → validate CAR → export-tables `--part-size 48m`). Prints roots, part counts, sizes, SHA-256s and the list of files that would go public (input to 🛑 D-8). Never uploads.

## `… src/cli.ts upload --run <runId>` (🛑 D-8 gated)
- Requires `FILEBASE_*` in env (loaded with `set -a; . ~/.config/assessment/filebase.env; set +a`). Uploads CAR then tables per group, readback, Kubo-adds each `.car` (carCid), writes and uploads the manifest, writes `runs/<runId>/manifest.json` and `runs/index.json`. Exit non-zero on any readback mismatch; no manifest written then.

## `… src/cli.ts cid-copy --manifest runs/<runId>/manifest.json`
- Assumes `assess-cid-writer` profile; bucket from SSM `/countylens/cid-copy/bucket`. Re-reads each local file, recomputes size/SHA-256/CID, conditional PUT, readback. Idempotent (same object → skip); different object → exit non-zero.

## `npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json`
- Fetches the manifest by CID and every artifact (tables by `cid`, directories and CARs by `carCid`) from `https://gateway.pinata.cloud/ipfs/<cid>` and `https://ipfs.filebase.io/ipfs/<cid>` with plain GETs; size + streamed SHA-256; 120 s timeout, backoff on 429/5xx honouring `Retry-After`, ≤ 2 concurrent per gateway. Host allowlist rejects CloudFront, `w3s.link`, any other host. One line per artifact per gateway; prints `ALL ARTIFACTS VERIFIED` and exits 0 only if all match.

## `npx tsx scripts/bench-lambda.ts --prefix private/bench/austin-48m/ --preset TC_NF_05|ADR_0001 --runs 20` (🛑 D-10 gated)
- Invokes the API function directly 20× per query (count, radius, roofAge); prints each `queryDurationMs` and p50/p95 as JSON (consumed by `tests/e2e/lambda-fallback.perf.spec.ts`, which owns upload and deletion of the private copy). Refuses a prefix outside `READPATH_PRIVATE_PREFIX`.
