---
id: CR-A-01
type: code-review-log
story: A-01
branch: 001-discover-sources
reviewed_commit: 672f14f
tools: [/code-review, soofi-xyz-team-kit:oracle]
created: 2026-10-20
---

# Code Review Log: A-01 Discover Travis County sources and pass readiness preflight

Scope: `git diff feature/oracle-pipeline...HEAD`. Reviewers: `/code-review` (default effort) and the kit reviewer agent `soofi-xyz-team-kit:oracle` (read-only; constitution XIII–XVII, pass mark 75/100).

## Runs

| Run | Tool | Effort | Date | Commit | Findings | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/code-review` | default | 2026-10-20 | `672f14f` | 10 | n/a |
| 1 | `soofi-xyz-team-kit:oracle` (read-only) | n/a | 2026-10-20 | `672f14f` | 16 (1 blocker, 5 major, 8 minor, 2 nits) | **72 / 100** (below 75) |

## Findings

Severity: Critical = blocks G7 (oracle "blocker", or data loss / evidence that misleads); Major; Minor; Nit. CR-n = `/code-review`, OR-x = oracle reviewer.

| # | Severity | File:line | Finding | Resolution | Commit |
| --- | --- | --- | --- | --- | --- |
| OR-B1 | Critical | `docs/evidence/blocked/bbb-20261020T072323Z.md:21`, `docs/evidence/A-01.md:57`, `docs/evidence/blocked/tcad_gis-20261020T072223Z.md:19` | BBB (Cloudflare challenge) was requested again from a different egress (VPN on during the 2026-10-19 run, off on 2026-10-20), against FR-006a/AC-6, while the evidence says "no retry with a changed identity". Intake item 5 says egress EG, but some 2026-10-19 receipts show Cloudflare `-LHR`. | Open | |
| CR-3 / OR-M1 | Critical | `travis/discovery/workflow.ts:698`, `:857-862`; `workflow.ts:259`; `resolve.ts:51` | A resolution round re-assembles the whole catalog from the run journal and overwrites `travis-sources.yaml`, erasing every offline command's fields. The superseded run `travis` is still WAITING_HUMAN and is `resolve`'s default run id, so one `resolve` would replace the committed catalog with the 2026-10-19 journal. | Open | |
| OR-M2 | Major | `pipeline/docs/travis-sources.yaml:596-597`; `travis/discovery/reprobe-jurisdictions.ts:89-96` | San Leanna's HTTP 406 body says "blocked by Mod Security" (a WAF block), but it was re-probed and the catalog calls it "not a block". | Open | |
| OR-M3 | Major | `pipeline/docs/travis-sources.yaml:751-753` | The parcel exception was written by hand, is not tied to the approved values (it would also pass a much larger gap), is not visible in the readiness report or `docs/sources.md`, and has no approval record stating the coverage effect. | Open | |
| OR-M4 | Major | `specs/001-discover-sources/spec.md:155`; `docs/evidence/blocked/tcad_gis-20261020T072223Z.md` | The US-runner probe rests on a TCP connect failure, which FR-006b says is not geo evidence; the PO approval is not reflected in the spec or AC-6. | Open | |
| OR-M5 | Major | `pipeline/docs/travis-sources.yaml:5`; `docs/evidence/A-01-coverage.md:18`; `docs/sources.md:155` | Offline amendments are not stamped (`snapshot_time` predates captured values); `A-01-coverage.md` still says GIS not reached; `sources.md` lists `tcad_gis` as blocked while the row is available. | Open | |
| CR-1 | Major | `travis/lib/source-client.ts:765` | On a non-206 resume answer, `refusal()` reads the whole body into memory (`arrayBuffer()`); a full 200 of the 3.5 GB export exhausts the heap. | Open | |
| CR-2 | Major | `travis/lib/source-client.ts:715` | `pump()` never listens for the `.part` WriteStream's `error` and awaits `drain` with no error path: a disk-full crashes the process or hangs the download. | Open | |
| CR-4 | Major | `travis/discovery/workflow.ts:851` | Permanent failures (validator hash mismatch, validator crash, schema-invalid catalog) throw plain Errors inside `ctx.run`, so Restate retries them forever. | Open | |
| CR-5 | Major | `travis/discovery/record-gis-runner.ts:384` | Re-running `record-gis-runner` keeps the old `gap_reconciliation`, `account_breakdown` and `separately_assessed_without_geometry`, so the catalog can contradict itself. | Open | |
| CR-6 | Major | `travis/lib/source-client.ts:807` | The Content-Length check runs only when `resumes > 0`; a first download that ends short without an error is accepted as complete. | Open | |
| OR-m1 | Minor | `travis/discovery/parcel-gap.ts:35-48` | State-code meanings (A4, F4, O1) have no source; `condoUnit` is filled on 89% of O1 rows, so the O1 label is doubtful; "no export point" stands in for "no own GIS polygon"; the exception reason states the condo count as fact. | Open | |
| OR-m2 | Minor | `travis/discovery/reprobe-jurisdictions.ts:99-112` | The once-only re-probe rule relies on counting evidence files; superseded evidence (Austin) is not marked; a changed URL is a new probe, not a re-probe. | Open | |
| OR-m3 | Minor | `.github/workflows/a01-us-gis-probe.yml:11-14` | The US probe fires again on any push that touches the file; its artifact expires after 30 days. | Open | |
| OR-m4 | Minor | `travis/discovery/destination-proof.ts:72-152` | Both destination identities come from inside the same container; neither ties in the connection the A-04 loader will use. | Open | |
| OR-m5 | Minor | `pipeline/docs/travis-sources.yaml:693-707` | Webberville is classified with no Webberville evidence; the Census file is called "the official page"; the request channel did not answer. | Open | |
| OR-m6 | Minor | `austin_issued_located_here` rows | Austin-issued counts include ETJ (outside city limits); AC-4 uses full purpose only. | Open | |
| OR-m7 | Minor | `docs/evidence/A-01-readiness.json` | The report says `auto_advance_required: true`; no artifact beside it says the kit's auto-advance is overridden. | Open | |
| OR-m8 | Minor | evidence, `travis/discovery/discover.ts` | The TCAD export was fetched more than once (`requests: 3`) though AC-3 says "downloaded once". | Open | |
| CR-7 | Minor | `travis/discovery/probes/tcad.ts:264` | ZIP scans destroy the inflate stream but not the underlying file stream: one leaked file descriptor per scan. | Open | |
| CR-8 | Minor | `travis/discovery/probes/tcad.ts:630` | Local file names come from the URL basename only; two links with the same basename overwrite each other. | Open | |
| CR-9 | Minor | `travis/discovery/record-gis-runner.ts:262`, `:417` | Duplicates the atomic write and the gap formula; rounds `gap_pct` to 2 decimals where `computeGap` rounds to 3. | Open | |
| CR-10 | Minor | `travis/lib/zip-entry.ts:129` | A zero-size entry streams one stray byte. | Open | |
| OR-n1 | Nit | `docs/evidence/A-01.md` front matter, "Live run" | Status still "in-progress"; the "Live run" section points to a report file that now holds the PASS result. | Open | |
| OR-n2 | Nit | `pipeline/docs/travis-sources.yaml` | `waiting_human_hours` is not labelled with its run id. | Open | |

## Oracle reviewer, run 1 (72/100)

Strengths: the vendored validator is unmodified and hash-checked; every source guardrail (one identified User-Agent, two per host, backoff only on 429/5xx, stop on 403/challenge/timeout, resume with the same identity) sits at one HTTP boundary with tests; the parcel block is honest (raw 24.24% printed, residual called unexplained); `pID` proven on 493,246 records; Census-based jurisdiction set (23 rows); offline commands refuse before sending; `docs/sources.md` re-renders byte-identically.

Services: Restate plus local Postgres, the vendored validator and the streaming export scan are the right choices; the offline commands as a second write path into the workflow's catalog are the main reservation (OR-M1), and a US-runner venue for A-05 GIS paging needs an ARD decision (rule 10).

Confidence: high on OR-B1, OR-M1, OR-M2, OR-M3 and OR-M5 (reproduced from files and local Restate state); medium on OR-m1 (state-code meanings unverified). No third-party requests were made.

## Constitution and architecture check

| Rule | Result | Note |
| --- | --- | --- |
| Zod on every tRPC input; no `any` | n/a / ✅ | no tRPC in A-01; catalog and command inputs are Zod-validated |
| LLM calls only through the Vercel AI SDK | n/a | no LLM calls |
| Powertools logger, tracer and metrics in every Lambda | n/a | no Lambda in A-01 (local Restate stack) |
| No secrets or PII in code or logs | ✅ | gitleaks on git history: no leaks; one public Application Insights key suppressed by fingerprint |
| P0 rules in `docs/architecture-constitution.md` | ❌ | source etiquette (OR-B1, OR-M2) and the spec's geo-evidence rule (OR-M4) |

**Open Critical findings:** 2 (OR-B1, CR-3/OR-M1). Must be 0 before G7.
