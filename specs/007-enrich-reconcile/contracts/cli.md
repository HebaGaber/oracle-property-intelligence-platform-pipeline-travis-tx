# CLI contract: A-07

All commands run against the local Restate ingress (`RESTATE_INGRESS_URL`, default `http://localhost:8080`), never Postgres directly, following A-01–A-04's pattern. Every command prints its `job_id` as the last line of stdout on success.

## Track A: identity

```
EN identity:load-registry --source tx-comptroller --scope travis --database-url-env DATABASE_URL
EN identity:resolve --scope austin-roofing-permits --registry-snapshot <digest>
EN identity:report --json
```

- `load-registry`: exit 0 with the row count, watermark and snapshot digest printed; exit 1 and no write on an egress-check failure.
- `resolve`: exit 0 with the five-state totals; never writes a company record for a non-`resolved` row.
- `report --json`: the manifest-coverage contribution shape (data-model.md's "Manifest coverage contribution").

## Track B: BBB (stub only, D-2)

```
EN bbb:probe --max-pages 2 --max-profiles 5 --target stub
EN bbb:apply-status --resolved-list <path>
```

- `--target stub` is the only accepted value this story; `--target live` exits 2 with an error citing D-2, never makes a request.
- Stops at the first 403/challenge/robots-disallow response from the stub with the evidence fields in `data-model.md`'s BBB status record.

## Track C: business/places (conditional)

```
EN business:transform --scope travis
EN places:probe-counts --release 2026-09-23.0 --county-fips 48453
EN places:clip --release 2026-09-23.0 --county-fips 48453 --licence-gate-result <pass|fail>
```

- `places:clip` refuses to run (exit 2) if the licence-gate result is `fail`; the caller then writes the "Places: not loaded · {reason}" limitation instead.

## Track D: reconcile + roof age

```
EN reconcile:merge --entity-type property|owner|contractor
roof-age:audit --limit 25 --offset 0 --as-of-date 2026-10-22 --source-system travis-austin-permits --report <path>
roof-age:backfill --as-of-date 2026-10-22 --source-system travis-austin-permits --report <path> [--apply]
```

- `roof-age:backfill` without `--apply` is a dry run; `--apply` is gated behind D-21's approval and never runs unattended.
- `reconcile:merge` exit 1 if any input pair spans two TCAD ids (refused merge, counted per FR-018).

## Exit codes (all commands)

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | A domain-level refusal (egress check failed, cross-TCAD merge, licence gate fail) — logged, not a crash |
| 2 | A disallowed flag combination (e.g. `bbb --target live`) |
