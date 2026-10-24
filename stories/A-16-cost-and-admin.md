---
id: A-16
type: user-story
title: Prove zero idle cost and let the operator run the pipeline from the hosted app
parts: [A-16, A-17]
parent: [FEAT-A16, FEAT-A17]
vision: VIS-A
ard: ARD-A
eval_point: A4
priority: P2
moscow: Must
branch: 016-cost-and-admin
spec: specs/016-cost-and-admin/
depends_on: [A-03, A-11, A-13]
size_days: 2
agents:
  design: [metagross, machamp]
  builder: [metagross, machamp]   # AGENT-MAP: metagross (cost page, sign-in, UI, API), machamp (cost jobs, queue, DLQ, bridge)
  reviewers: [metagross, machamp, audino]
  verify: "`docs/cost.md` + billing screenshot; Playwright admin sign-in + Start run reaches the bridge; non-admin gets 403"
skills: [build-frontend-backends, build-batch-workflows, frontend-bug-fix, responsive-design-tests, apply-engineering-guidelines]
ui: true
status: Draft
gate: G4
qc_testability_signoff: false
created: 2026-10-19
merged: 2026-10-21
---

# A-16 Prove zero idle cost and let the operator run the pipeline from the hosted app

**Merged story (2026-10-21).** This story now holds two former stories so the six-stage loop runs once: **A-16** (zero idle cost and source limits, Must) and **A-17** (admin sign-in and run commands, Should). The original files are in [stories/merged/](merged/) for history; this file is the one to plan, build and gate. Every AC keeps its old ID in brackets, for example `(A-17 AC-2)`, so older evidence and reviews still trace.

| Field | Value |
| --- | --- |
| Evaluation point | A4 (primary) · A1 · A3 |
| Demo line(s) | D-1 (opening claim), D-4 ("without requiring Oracle-hosted database infrastructure"); the admin part needs no demo line and supports D-2 by showing how a run is started |
| Agents | design `metagross`, `machamp` · builder `metagross` (cost page, sign-in, UI, API), `machamp` (cost jobs, queue, DLQ, bridge) · reviewers `metagross`, `machamp`, `audino` · verify `docs/cost.md` + billing screenshot; Playwright admin sign-in + Start run reaches the bridge; non-admin gets 403 (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-03, A-11 (full publish and incremental runs, which now include the former A-12), A-13 (Explorer pages) |
| Size | 2 days (0.5 + 1.5) |
| Branch | `016-cost-and-admin`, merged into `feature/oracle-pipeline` |

## Context

**Part 1, cost and limits (was A-16, Must).** The README asks to "demonstrate that Oracle can operate without carrying the infrastructure cost" (AC-20, AC-44) and to identify and document slow or constrained sources (AC-17 to AC-19). The **evaluator** wants a real billing number, not a claim; the **Oracle operator** needs the measured limits to plan refreshes.

Measured constraints so far: TCAD `publicinformation` HTTP 403 (2026-10-17, 2026-10-19); Travis GIS timed out (same days) and pages at 2,000 features per request; Austin Socrata 2,380,725 rows, ≤ 50,000 rows per page, and a full `:updated_at` re-stamp on 2026-10-19; BBB Cloudflare challenge (2026-10-17), ≤ 1 request per 3 s; Bedrock 10 requests per minute (2026-10-17).

**Part 2, admin sign-in and run commands (was A-17, Should).** Architecture decision AD-12 (Accepted 2026-10-19) puts admin pieces in the product and builds them **last**: Cognito email-code sign-in, an SQS command queue, and a local bridge next to the pipeline. The **Oracle operator** gets a way to trigger the incremental refresh (part of A-11) on demand from the hosted app without exposing the laptop or the Query DB. The bridge **pulls** commands outbound, so nothing in AWS can reach the operator machine (ARD § 2.2). The public demo never needs this; every demo step works signed out.

The two parts share infrastructure and cost rules: Part 2's Cognito, SQS, DLQ and SNS must stay inside Part 1's $0-idle rule, and Part 1's CDK assertions cover both.

## Description

As the **evaluator**, I want **to see on the hosted Coverage page what CountyLens costs while idle, who pays for each part, and how fast each source can be read**, so that **I can confirm Oracle carries no standing infrastructure cost and that source limits are known and respected**.

As the **Oracle operator**, I want **to sign in with an email code and start, stop or retry an incremental run from the Runs page, and see recent activity**, so that **I can refresh Travis County data on demand while the Query DB stays private on my machine**.

When done:
- **Part 1:** `docs/cost.md` (component, idle cost, cost per use, who pays) with real numbers from Cost Explorer and Filebase, plus a Budgets/Cost Explorer screenshot; `docs/source-limits.md` (throughput, rate limits, anti-bot posture, slow sites, BBB limits) from the A-01 to A-11 measurements; both shown on the Coverage page's Cost and Limits sections. CDK assertions enforce the cost rules.
- **Part 2:** A Cognito user pool with the built-in email code, self sign-up off, and an `admin` group. An `adminProcedure` that verifies the JWT with `aws-jwt-verify`. `admin.runs.start / stop / retry` send a command to an SQS queue (15-minute expiry, cancel by command ID) with a DLQ and one alarm that emails the operator through SNS. A local bridge in `pipeline/` polls the queue outbound and starts the Restate `CountyIngest` workflow. It writes `runs/live.json`, a small admin S3 status object. The Activity page shows `admin.activity.summary / list` from the query log through Logs Insights, cached 5 minutes. Admin controls appear only after sign-in.

**Independent test:** (1) open Coverage · Cost on the hosted URL; it shows "$0.00 fixed per month" with the billing date, and `cdk synth` assertions pass. (2) Sign in as the admin on the hosted URL, press Start for an Austin-permits window, see the command reach the bridge and the run state change in `runs/live.json`; sign in as a non-admin and get 403.

## Acceptance Criteria

### Part 1 · Zero idle cost and source limits (was A-16, Must)

1. **AC-1** (A-16 AC-1) · **Given** the deployed stacks with no traffic, **When** Cost Explorer is read for the last full day, **Then** `docs/cost.md` shows each component's idle cost (Amplify static, Lambda, API Gateway, S3 + CloudFront CID copy, DynamoDB on-demand, SSM, CloudWatch Logs, disabled scheduler, Cognito, SQS + DLQ, SNS) with $0.00 fixed per month plus storage cents, who pays per use, and the screenshot is in `docs/evidence/img/`. ☐ testable
2. **AC-2** (A-16 AC-2) · **Given** the CDK app, **When** `cdk synth` runs, **Then** assertions confirm: scheduler `DISABLED`; no Secrets Manager, RDS, KMS CMK, provisioned concurrency, WAF or Route 53 hosted zone; log retention 14 days (query log 30); a $10 budget alert; region from config. ☐ testable
3. **AC-3** (A-16 AC-3, scale) · **Given** the measurements from A-01 to A-11, **When** `docs/source-limits.md` is written, **Then** every source has throughput (rows or requests per minute), page size, the full-capture duration measured at full scale (for example the 2,380,725-row Austin backfill and the full GIS paging), rate limits, anti-bot posture and the optimisation applied. ☐ testable
4. **AC-4** (A-16 AC-4) · **Given** the hosted Coverage page, **When** the evaluator opens Cost and Limits, **Then** both sections render the same numbers as the two docs, each with its "as of" date and source. ☐ testable
5. **AC-5** (A-16 AC-5, missing data) · **Given** Cost Explorer has not yet produced data for the current day (about 24 h lag) or Filebase usage is not readable through its API, **When** the page renders, **Then** it shows the last available date with "as of {date}" or "Filebase usage: not available · {reason}", never a zero filled in. ☐ testable

### Part 2 · Admin sign-in and run commands (was A-17, Should)

6. **AC-6** (A-17 AC-1) · **Given** the operator's email is in the `admin` group, **When** they open Admin, enter the email and the 6-digit code from the Cognito email, **Then** they land on Runs with Start / Stop / Retry visible and "Signed in as admin" shown; signed-out visitors never see these controls. ☐ testable
7. **AC-7** (A-17 AC-2) · **Given** a signed-in admin and the bridge running, **When** they press Start for "Austin permits since Run {n} watermark", **Then** one SQS message with a command ID is sent, the bridge picks it up within 60 s, the Restate `CountyIngest` workflow starts, and the Runs page shows "Running · started {UTC time}" from `runs/live.json`. ☐ testable
8. **AC-8** (A-17 AC-3, error) · **Given** a signed-in user who is not in the `admin` group, or an expired token, **When** they call any `admin.*` procedure, **Then** the API answers 403 or 401, sends nothing to SQS, and logs the refusal without the token. ☐ testable
9. **AC-9** (A-17 AC-4, missing data / error) · **Given** the bridge is offline, **When** a Start command waits 15 minutes, **Then** it expires, the UI shows "Bridge offline · command expired at {time}", nothing runs later by surprise, and after 3 failed receives the message goes to the DLQ, whose alarm emails the operator. ☐ testable
10. **AC-10** (A-17 AC-5, scale) · **Given** 30 days of query log, **When** the admin opens Activity, **Then** the summary (questions per day, p95 latency, failures by outcome) loads in p95 < 3 s through the 5-minute cache, and every number links to its Logs Insights query. ☐ testable
11. **AC-11** (A-17 AC-6) · **Given** the CDK app, **When** `cdk synth` runs, **Then** assertions confirm self sign-up off, the queue's DLQ and alarm, no inbound path from AWS to the operator machine, no Query DB connection string in `apps/` or `infra/`, and $0 idle cost (Cognito free tier, SQS per request). ☐ testable

## Edge cases (at least two)

- (A-16) AWS free-plan credits show a credit offset → show both gross cost and credits applied, so "$0" is not just credits.
- (A-16) A Lambda invocation during the sampled day (evaluator traffic) → shown as per-use cost, not idle cost.
- (A-16) A source that never became reachable (TCAD 403) → its limit row says "blocked" with dates, not a throughput.
- (A-17) Two Start presses in a row → the second is rejected while a run is active ("A run is already running"); one command ID per run.
- (A-17) Stop during publication → the bridge finishes the current atomic step, never leaves half-published CIDs, and records "stopped by admin" in the run limitations.
- (A-17) The Cognito email quota (default SES sender) is reached → the sign-in screen shows "Code could not be sent, try later"; the public app is unaffected.
- (merge) The Part 2 resources (Cognito, SQS, DLQ, SNS) appear in Cost Explorer → they are listed in `docs/cost.md` as per-use, with $0 idle; a non-zero idle line fails AC-1.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | (A-16 FR-001) System MUST document idle and per-use cost per component from billing data | AC-1 |
| FR-002 | (A-16 FR-002) CDK MUST assert the zero-idle-cost rules | AC-2 |
| FR-003 | (A-16 FR-003) System MUST document measured limits for every source | AC-3 |
| FR-004 | (A-16 FR-004) Coverage page MUST show both documents' numbers with dates | AC-4 |
| FR-005 | (A-16 FR-005) Page MUST show reasons for unavailable cost data | AC-5 |
| FR-006 | (A-17 FR-001) System MUST sign in admins with a Cognito email code and show admin controls only to them | AC-6 |
| FR-007 | (A-17 FR-002) System MUST deliver run commands through SQS to an outbound-polling bridge | AC-7 |
| FR-008 | (A-17 FR-003) System MUST reject non-admin and expired tokens on every admin procedure | AC-8 |
| FR-009 | (A-17 FR-004) System MUST expire unpicked commands and alarm on DLQ messages | AC-9 |
| FR-010 | (A-17 FR-005) System MUST show Activity from the query log with links to its queries | AC-10 |
| NFR-001 | (A-16 NFR-001) $0.00 fixed per month while idle; $10 budget alert (NFR-02) | AC-1, AC-2, AC-11 |
| NFR-002 | (A-16 NFR-002) Responsive at 390/768/1440, Atlas only (NFR-08) | AC-4, AC-6 |
| NFR-003 | (A-17 NFR-001) Activity p95 < 3 s cached; command pickup ≤ 60 s while the bridge runs | AC-7, AC-10 |
| NFR-004 | (A-17 NFR-002) Least-privilege IAM; no token in logs; WCAG 2.2 AA | AC-6, AC-8 |

## Prototype reference (mandatory if the story has UI)

| Element | Value |
| --- | --- |
| Claude Design screens, Part 1 | `design/prototype/Coverage1440.dc.html` (Cost section), `Coverage768.dc.html`, `Coverage390.dc.html`, `CoverageStates.dc.html` |
| Claude Design screens, Part 2 | `design/prototype/AdminSignIn1440.dc.html` (+ 768, 390), `design/prototype/RunsAdmin1440.dc.html`, `design/prototype/Activity1440.dc.html` (+ 768, 390), `design/prototype/ActivityStates.dc.html` |
| States covered | Cost: populated · partial (as of yesterday) · unavailable with reason. Admin: signed out · code sent · signed in · running · bridge offline · expired · empty activity · error |
| Design system | `assessment-guide/design-system/` (Atlas, Material 3, mobile-first) |

## Demo Script

1. Presenter: "Now I am opening the DuckDB-backed query layer." → Expected: alongside the SQL panel, Coverage · Cost shows that no Oracle-hosted database or standing infrastructure is billed.
2. (Optional closing aside, not on the README transcript) "As the Oracle operator I can also start the next incremental run from here; the command is pulled by my machine, so the database never leaves it." → Expected: Start, then "Running" on Runs.

## Carried forward from A-11 (known gaps to close here)

A-11 (Run 1, full publish) merged with seven recorded, deliberate gaps — tracked in `specs/011-publish-and-runs/run-log.md` — that this story's "operator starts a run" scope (Part 2, was A-17) is the right place to close, rather than reopening A-11:

1. **Sequence-runner batching isn't automated.** Run 1's county/permits batching (10 + 2 CARs) was done with separate scripts, not wired into the pipeline's own orchestrator. **AC-7's bridge-starts-the-workflow path needs this wired in before "Start" can run a real full-scale incremental refresh** — this is foundational to Part 2, not an add-on. **The wired batch publish must go through `pipeline/publish/src/bind-guard.ts` and the identity gate (`src/identity-gate.ts`, the `gate` and `gate-remote` steps of `scripts/publish-run.ts`); publishing outside a gated path is not allowed.** Run 1 was published by side scripts that bypassed both and shipped with 0 of 17,387 permits joining their county property.
2. **Runs 2 and 3 are still pending** (need UTC dates ≥ 2026-10-25 and ≥ 2026-10-26). Once gap 1 is fixed, **the natural way to produce them is the admin "Start" button itself** (AC-7) on the right UTC dates, rather than a manual script run — this story's own acceptance test effectively re-proves Runs 2/3 as a side effect.
3. **No genuine second independent pin.** Pinata's free plan can't pin-by-CID (paid-only, confirmed 2026-10-24), and its upload fallback assigns an unrelated CID. The Pinata account was upgraded to a paid plan same-day, but `pinByHash` still returned `403 PAID_FEATURE_ONLY` after the upgrade and a retry — either propagation delay or a tier mismatch, unconfirmed; needs checking directly in Pinata's dashboard. Fallback real fix if that doesn't resolve: a self-hosted Kubo node kept online. Revisit alongside Part 1's cost accounting (AC-1), since either option has a real cost line that belongs in `docs/cost.md`.
4. **Run 1's full gateway verification (`ALL ARTIFACTS VERIFIED`) was not complete at A-11's merge** — blocked by sustained Pinata rate-limiting from testing volume, not a data problem. Continuing on `011-publish-and-runs` after merge; confirm it's reached `ALL ARTIFACTS VERIFIED` before this story's own G7, since Part 2's run-history UI depends on Run 1 being provably real.
5. **Atlas registration pending** (no Atlas access in this environment) — an external dependency, not work of ours: it never blocks this story, A-11's closure or any run (neither README requires it; `PUBLISHING.md`). Stays documented as the known P0-4 default and carried forward honestly.
6. **Manifest reconciliation gap** (porygon's A-11 review, non-blocking there): `buildManifest()`'s coverage section doesn't yet sum the 5 permit-exclusion keys against captured-vs-emitted totals. Harmless at A-11's scope (3 of 5 are provably zero), but **must be fixed before AC-7's real incremental runs rely on it**, since those will exercise the full-scale permit path where the gap is live.
7. **~~Client-side CID verification can't handle real table parts~~ — closed in A-11 (2026-10-24).** PO decision "SHA-256 from manifest": table parts are now accepted only when their SHA-256 equals the one the CID-verified manifest records (constitution A3 amended); the Permits page prefetches its 14-part subset (Run 1: 1,234 requests / 76.7 s → 15 / ~8 s), and TC-032/033/034 are no longer `fixme`. Left here: a manifest above 256 KiB would still hit `rawCid()`'s single-chunk limit (Run 2's is 87 KB); a full UnixFS CID check stays optional.
8. **Publish/resume hardening left from the A-11 reviews** (`docs/reviews/CR-A-11-machamp-fix.md`, 80/100; `CR-A-11-porygon-fix.md`, 80/100): a test and run evidence for `batch-hash-validate-export.sh`'s `.done`/`split.done` resume (M4); run locks for the re-export and batch scripts; removing stray folders from a hashed group directory; deriving the re-export fingerprint's code list from real imports instead of a hand list; a Runs-page cue that Run 1 is superseded by Run 2 (17,387 → 15,025 is a correction, not lost permits); a code check for `permits_trade_sub_permit`. (M1–M3 — index rollback on failed verification, atomic receipt/index writes, CAR hash check before a Release upload — were fixed in A-11.) Also: record a receipt once a file is confirmed on the gateways, so later publishes do not re-probe it (Run 2's carCid step spent ~25 min re-confirming Run 1's 20 county carCids).
9. **Fallback memory limit — PO decision 2026-10-24: show a message.** When the Filebase fallback would prefetch a run larger than the browser can hold (the full county run is ~3 GB), the page must show an explicit "too large for the fallback path" state instead of loading it all (today the fallback prefetches without a ceiling; `apps/web/src/engine/load-permits.ts`).
10. **`/code-review medium` findings carried from A-11** (`docs/reviews/CR-A-11.md`): (a) `pipeline/publish/src/gateway-readback.ts:136` `gatewaysAgree` treats Pinata's 403/429 bot challenges as inconclusive, so "both gateways" can pass on Filebase alone — needs a PO policy call; (b) stale-lock takeover is check-then-delete (`pipeline/local-stack/scripts/run-lock.ts:39`, `batch-hash-validate-export.sh`) — make it atomic; (c) the permits path always passes the assembled coordinate while the County writer does so only once coordinates are assembled (`pipeline/oracle-runtime/travis/permits/write-group.ts:133`) — mirror the County flag before any run on an unassembled database; (d) coverage keys are carried unchanged when the permit count is unchanged (`run-manifest.ts:187`); (e) the Permits page waits for the DuckDB module before prefetching parts (`load-permits.ts:158`), ~1 s against the 8 s target.
11. **Permits page first-load time at full-county scale (moved from A-11, PO 2026-10-24: "Revise target, optimize later").** Run 2 on the hosted site: 15,025 rows, no error, COUNT 0.26 s, list 0.56 s, but first load 24–28 s from a home connection and ~45 s from GitHub runners (~95 MB: DuckDB engine start 6–10 s + all columns of the 10 `county.property` parts the join needs). TC-NF-01's limit was revised 8 s → 60 s for full scale (`tests/e2e/lib/perf.ts`). Optimize here: fetch only the columns the join needs (`county.property.cid`) instead of whole parts, cut engine start, then restore a tighter limit. Also find why hosted CI was cancelled ~2 min into the Permits cases with 2 or 4 Playwright workers on a 16 GB runner (1 worker completes): check a Permits tab's peak memory at full scale, then raise the parallel phase's workers again.

## Out of scope

- Enabling the scheduler or any paid plan as a default; enabling the EventBridge schedule (stays disabled, AD-15).
- Company PagerDuty and Lexicon metric registration (deviations D-04, D-05).
- AI-user sign-in (Coming soon in A-13, which now includes the former A-18).

## Evidence to capture

- `docs/evidence/A-16.md`, one section per part:
  - Part 1: `docs/cost.md`, `docs/source-limits.md`, billing screenshot, `cdk synth` assertion output.
  - Part 2: sign-in screenshots, the SQS message ID → bridge log → Restate workflow ID chain, 403 check, DLQ alarm test email, CDK assertion output, trace ID.
- `smeargle` report (Coverage and admin screens); `testplans/A-16-test-cases.md` results; `docs/reviews/CR-A-16.md`.

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☐ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☐ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☐ |
| G4-4 | One scale AC and one missing-data or error AC | ☐ |
| G4-5 | At least two edge cases | ☐ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☐ |
| G4-7 | Prototype screen linked (UI stories) | ☐ |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☐ |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☐ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☐ |

**Decision:** ☐ Ready ☐ Returned, reason: {…} · {date}
