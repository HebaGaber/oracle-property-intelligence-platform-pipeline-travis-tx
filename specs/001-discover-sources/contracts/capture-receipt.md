---
id: CT-A-01-receipt
parent: PLAN-A-01
---

# Contract: capture receipt and discovery run record (internal)

Matches the ARD § 6 internal contracts. Written by `source-client.ts` for every request; never published.

## Capture receipt

| Field | Type | Notes |
| --- | --- | --- |
| `url` | string | no credentials or tokens in the URL |
| `method` | string | `GET` / `HEAD` |
| `status` | int or `null` | `null` on timeout |
| `bytes` | int | response size |
| `sha256` | string | body digest |
| `captured_at` | UTC ISO-8601 | |
| `user_agent` | string | constant project UA (no email unless the PO consents) |
| `attempts` | int | 1 for 403/challenge/timeout; ≤ 5 for 429/5xx |
| `outcome` | `ok` \| `blocked` \| `throttled-then-ok` \| `failed` | |
| `geo_signal` | `none` or quoted text | only from the saved response (FR-006b) |

## Guard behavior (tested in Vitest)

| Response | Attempts | Outcome | Run state |
| --- | --- | --- | --- |
| 2xx that parses with Zod | 1 | `ok` | unchanged |
| 2xx challenge page (fails the parse) | 1 | `blocked` | `WAITING_HUMAN` |
| 403 | 1 | `blocked` | `WAITING_HUMAN` |
| Timeout | 1 | `blocked` | `WAITING_HUMAN` |
| 429 / 5xx | ≤ 5, backoff 1 s base, 60 s cap, full jitter, honors `Retry-After` | `throttled-then-ok` or `failed` | `failed` → recorded, run continues for other sources |

## Discovery run record

`run_id`, `started_at`, `state` (`DISCOVERING` \| `WAITING_HUMAN` \| `READY`), `blockers[]` (`source_key`, `receipt`, `records_request`, `next_step`), `validator` (`exit_code`, `report_path`, `vendored_sha256`). State transitions are in [data-model.md](../data-model.md#discovery-run-state-machine).
