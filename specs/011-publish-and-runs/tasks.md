---
description: "Task list: A-11 Publish the full county by CID and keep it current with incremental runs"
---

# Tasks: Publish the full county by CID and keep it current with incremental runs

> **Correction (2026-10-23, mid-build):** T003/T004/T009/T010/T015 below describe widening
> `DataGroup` to 5 groups and adding `owner`/`contractor`/`parcels` coverage keys. That was
> wrong — see `research.md`'s "Correction" section — and was reverted in commit `dd884fd`.
> The real fix, done as an added task **T031**, wires A-07's contractor identity into
> `property_improvement`'s existing permit records instead of creating 3 new groups.

**Input**: Design documents from `/specs/011-publish-and-runs/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/publish-sequence.md, agent-design.md

**Tests**: MANDATORY. Test tasks come first in every phase and must fail before implementation tasks run.

**Builder groups (light lane L4, ≤ 4 groups)**: `G-PUB1` (oracle: tracks A+B), `G-PUB2` (oracle: tracks C+D), `G-RUN` (oracle: track E), `G-SCHED` (machamp: track F). Each group owns files no other group touches.

**Waves**: Wave 1 — G-PUB1, G-PUB2, G-RUN(a), G-SCHED run together (tests first, own files). Wave 2 — G-RUN(b)/(c) build on G-PUB1's manifest builder (cannot start until G-PUB1's T013 lands). After each wave: one integration check (full unit suite + typecheck + lint) before the next wave.

**Critical path**: Wave 1 (max of G-PUB1 ≈25m, G-PUB2 ≈25m, G-RUN(a) ≈20m, G-SCHED ≈25m → 25m) → integration check (≈3m) → Wave 2 (G-RUN(b)/(c) ≈15m) → integration check (≈3m) → the Run 1 dry run (unmeasured, runs in background from the start of Wave 1, overlaps the whole build) → draft manifest → review round. **Build-only critical path ≈ 46 min**; the dry run (Stage 5) and the UTC-date waits (Stage 6) dominate total wall-clock, not the build.

## Phase 1: Setup

- [ ] T001 Confirm `~/.config/assessment/filebase.env` and `~/.config/assessment/pinata.env` both readable (chmod 600) before any builder starts; no file change.
- [ ] T002 [P] Confirm `pipeline/publish/` and `infra/` both typecheck and lint clean on `011-publish-and-runs` before any task starts (baseline for the Wave 1→2 integration checks).

**Checkpoint**: baseline green; builder groups may start.

## Phase 2: Foundational

- [ ] T003 [oracle] Widen `DataGroup` from `"county" | "property_improvement"` to the 5 full-county groups (`county`, `property_improvement`, `owner`, `contractor`, `parcels`) in `pipeline/publish/src/sequence.ts`. `groupPlan`/`planBuild`/`planUpload` already generalize over `groups: readonly DataGroup[]` — no change needed there, only the type.
- [ ] T004 [oracle] Extend `SOURCE_ORDER` and the required-coverage-key list in `pipeline/publish/src/manifest.ts` from a hardcoded 2-item tuple to a per-run profile covering all 5 groups' coverage keys (e.g. `parcels_published`, `contractor_resolved/candidate/unresolved` per AD-05's five states) — keep `checkInput`'s exact-match, fail-closed throw; extend the fixed list, never loosen it.

**Checkpoint**: `DataGroup` and the manifest's required-keys list both cover all 5 groups; `checkInput` still fail-closed. User-story work can now begin.

---

## Phase 3: User Story 1 - Publish Run 1, verifiable by a stranger (Priority: P1) 🎯 MVP

**Goal**: Every Run 1 artifact for Travis County published as CIDv1 with a manifest, verifiable from two public gateways this environment does not operate.

**Independent Test**: `npx tsx scripts/verify-manifest.ts runs/{run1}/manifest.json` prints `ALL ARTIFACTS VERIFIED`, exit 0.

### Tests for User Story 1 (write first, must fail before implementation)

- [ ] T005 [P] [US1] [oracle] (G-PUB1) Extend the six-step order test to all 5 groups, asserting no step is skipped and an upload-readback failure stops before the manifest, in `pipeline/publish/test/sequence.test.ts`.
- [ ] T006 [P] [US1] [oracle] (G-PUB1) Add `checkInput` tests for the widened 5-group/coverage-key profile (missing group, missing coverage key, extra undeclared source all still throw) in `pipeline/publish/test/manifest.test.ts`.
- [ ] T007 [P] [US1] [oracle] (G-PUB2) Add gateway-hardening tests (429/504/timeout → `unverified`, non-zero exit, never `ALL ARTIFACTS VERIFIED` without both gateways matching; dweb.link redirect followed; >50MB artifact hashed by streaming) in a new `scripts/test/verify-manifest.test.ts`.
- [ ] T008 [P] [US1] [oracle] (G-PUB2) Add second-pin-client tests (readback required before success; refuses to overwrite an existing S3 CID-copy object, compares instead) in `pipeline/publish/test/upload.test.ts`.

### Implementation for User Story 1

- [ ] T009 [US1] [oracle] (G-PUB1) Implement the 5-group coverage-key profile in `pipeline/publish/src/manifest.ts`'s `checkInput`, satisfying T006.
- [ ] T010 [US1] [oracle] (G-PUB1) Wire `groupArtifacts` (already group-agnostic) to the 5-group list; confirm `carCid` is present on every directory and `previousManifestCid` is `null` for Run 1, in `pipeline/publish/src/manifest.ts`.
- [ ] T011 [P] [US1] [oracle] (G-PUB2) Harden `scripts/verify-manifest.ts`: retry with backoff on 429/504/timeout (`TIMEOUT_MS` 300000, 5 attempts), mark `unverified` with the gateway's response, exit non-zero on any miss, satisfying T007.
- [ ] T012 [P] [US1] [oracle] (G-PUB2) Add the Pinata (Kubo RPC) upload client as a sibling to the existing Filebase client in `pipeline/publish/src/upload.ts`, same interface, readback-gated, satisfying T008.
- [ ] T013 [US1] [oracle] (G-PUB1) Draft the Run 1 manifest from the dry-run outputs once available (depends on T009, T010; feeds G-RUN's Wave 2 tasks T017-T019) in `pipeline/publish/src/manifest.ts`.
- [ ] T014 [US1] [oracle] (G-PUB2) GitHub Release step: attach each CAR (split if > 2 GB) and record the release URL target location, in `pipeline/publish/src/release.ts` (new file).
- [ ] T015 [US1] [oracle] (G-PUB1) Add the per-group coverage labels (`published_rows`, `capture_receipt`, `aggregate_match`) with their derivation strings, never a direct Query DB read, in `pipeline/publish/src/manifest.ts`.

**Checkpoint**: User Story 1 is fully buildable and testable independently (verify-manifest against a local/dry-run manifest); the real Run 1 upload itself is a Stage 6 stop (D-7), not a build task.

---

## Phase 4: User Story 2 - Keep Travis County current with incremental runs (Priority: P2)

**Goal**: Run 2/3 publish only what changed as new linked manifests, keeping every earlier CID resolvable.

**Independent Test**: After a third run, `runs/index.json` lists ≥ 3 runs on ≥ 3 UTC dates, each `previousManifestCid` links back, and `verify-manifest` on Run 1's manifest still passes.

### Tests for User Story 2 (write first, must fail before implementation)

- [ ] T016 [P] [US2] [oracle] (G-RUN, wave 1) Test per-source watermark + content-digest delta computation (re-stamp of 100% of a window → delta from digests, not from `:updated_at`) in `pipeline/publish/test/incremental.test.ts` (new).

### Implementation for User Story 2 (wave 1, can start at once)

- [ ] T017 [US2] [oracle] (G-RUN, wave 1) Implement per-source watermark + content-digest delta computation reusing A-04's re-stamp-detection pattern (≥50% of window or ≥90% within 6h ⇒ bulk re-stamp) for Austin permits, the TCAD supplemental export date, and BBB harvest date only (per D-2(c) — no other source is re-checked), in `pipeline/publish/src/incremental/delta.ts` (new).

### Implementation for User Story 2 (wave 2, after G-PUB1's manifest builder lands — T013)

- [ ] T018 [US2] [oracle] (G-RUN, wave 2) Change `ManifestSourceInput`/`source()` in `pipeline/publish/src/manifest.ts` from the hardcoded "first run: everything added" to explicit `added`/`changed`/`removed` fields supplied by T017's delta computation.
- [ ] T019 [US2] [oracle] (G-RUN, wave 2) Implement zero-delta-with-reason (`limitations: ["no newer export"]` / `["blocked · 403"]`) and "unchanged group omits its artifact entries from this run's manifest" (per research.md, AD-03) in `pipeline/publish/src/manifest.ts`.
- [ ] T020 [US2] [oracle] (G-RUN, wave 2) Implement `source_removed` tombstones counted in `removed`, in `pipeline/publish/src/incremental/delta.ts`.
- [ ] T021 [US2] [oracle] (G-RUN, wave 2) Add the idempotency test: identical inputs re-run → 0 rows written, identical **data-group** CAR/table CIDs (not the manifest CID, which legitimately varies by `startedAt`/`finishedAt` — research.md), in `pipeline/publish/test/manifest.test.ts`.
- [ ] T022 [US2] [oracle] (G-RUN, wave 2) Implement failed-mid-publish handling: no manifest written, next run resumes from the last committed watermark, failed attempt logged but not listed in `runs/index.json`, in `pipeline/publish/src/incremental/delta.ts`.
- [ ] T023 [US2] [oracle] (G-PUB1, wave 2, same file as T013) Confirm `runs-index.ts`'s existing `appendRun` (already correctly append-only, throws on duplicate `runId`/`manifestCid`) needs no change for the run chain; add a test confirming the A-03 walking-skeleton entry is preserved and Run 1 starts its own chain (`previousManifestCid: null`, per D-2(a)) in `pipeline/publish/test/runs-index.test.ts`.

**Checkpoint**: User Stories 1 AND 2 both buildable and testable independently; the real Run 2/Run 3 uploads happen in Stage 6, on later UTC dates, never as build tasks.

---

## Phase 5: User Story 3 - A scheduler that costs nothing until someone turns it on (Priority: P3)

**Goal**: A CDK-defined EventBridge schedule, DISABLED, targeting a Fargate task, proven to cost $0 while disabled.

**Independent Test**: `cdk synth` on the scheduler stack passes a CDK assertion confirming DISABLED state, the Fargate target, no Query DB connection string, and $0 idle cost.

### Tests for User Story 3 (write first, must fail before implementation)

- [ ] T024 [P] [US3] [machamp] (G-SCHED) Write the CDK assertion tests: `State: "DISABLED"`, target references this stack's `TaskDefinition` logical id, no `AWS::ECS::Service` exists, in `infra/test/scheduler.test.ts` (new).
- [ ] T025 [P] [US3] [machamp] (G-SCHED) Write the repo-wide grep test for no Postgres connection-string literal or hardcoded host anywhere in `apps/` or `infra/`, and that the ECS `Secret`'s `valueFrom` is a Secrets Manager/SSM ARN never a plaintext `environment` entry, in `infra/test/no-connection-string.test.ts` (new).

### Implementation for User Story 3

- [ ] T026 [US3] [machamp] (G-SCHED) Create `CountyLensSchedulerStack` in `infra/src/stacks/scheduler-stack.ts`: `CfnSchedule`/`Schedule` with `state: "DISABLED"`, ECS RunTask target, Fargate `TaskDefinition` (no `FargateService`), added after DataStack in `infra/bin/app.ts` with no dependents.
- [ ] T027 [US3] [machamp] (G-SCHED) Wire the task definition's secrets (DB credentials, Filebase + Pinata pinning credentials) as ECS `Secret` → Secrets Manager ARN, and bucket/CloudFront names via cross-stack refs from DataStack, in `infra/src/stacks/scheduler-stack.ts`.
- [ ] T028 [US3] [machamp] (G-SCHED) Add a DLQ and one CloudWatch alarm for the Fargate task's failure path, in `infra/src/stacks/scheduler-stack.ts`.
- [ ] T029 [US3] [oracle] (G-RUN, wave 2, after T018-T022) Expose a non-interactive `publishRun`-equivalent entrypoint (gated by the six-step sequence's own readback, not a human D-8 approval — per research.md's disagreement resolution) for the Fargate task to call, in `pipeline/publish/src/batch-entrypoint.ts` (new).
- [ ] T030 [US2] [oracle] (G-RUN, wave 2) FR-008 unit test: building a later run's manifest must never alter an earlier run's already-written manifest file or its artifact CIDs — assert Run 1's manifest bytes/CIDs are byte-identical before and after building Run 2's manifest, in `pipeline/publish/test/manifest.test.ts` (closes analyze finding F1; runs alongside T018-T023, numbered last only because it was added after the initial draft).
- [ ] T031 [US1] [oracle] Added 2026-10-23 (the design correction): wire A-07's contractor-identity resolution (AD-05's five states) into `pipeline/oracle-runtime/travis/transforms/austin-property-improvement.ts`'s emitted-permit records (`contractor_company_cid`, `contractor_resolution`, null when no DBPR match exists at all), roll up `contractor_resolved`/`contractor_candidate`/`contractor_unresolved` counts into `run-month.ts`'s summary coverage, and add those 3 keys to `property_improvement`'s entry in `pipeline/publish/src/manifest.ts`'s `GROUP_COVERAGE_KEYS` in the same change (never the coverage key alone, ahead of its producer — that's what broke Wave 1).

**Checkpoint**: all three user stories independently buildable; `cdk synth` green; the scheduler is never deployed as a build task — deployment (still DISABLED) is Stage 6's D-8 stop.

---

## Phase Z: Prove on the hosted runtime (mandatory, always last)

- [ ] TZ01 Run the reviewer agents (`oracle`, `donphan`, `machamp`, `porygon`) read-only on the branch; record scores in `docs/reviews/CR-A-11.md` (each ≥ 75 or justified).
- [ ] TZ02 Deploy the scheduler stack to `eu-north-1` in state **DISABLED** (Stage 6b, 🛑 D-8) — not an app deploy, since `ui: false`; record `aws scheduler get-schedule` output.
- [ ] TZ03 Run `verify-manifest` on Run 1's manifest against ipfs.io and dweb.link (🛑 D-7 precedes this); after Run 3, run the immutability check (checks.md § 6.2): ≥ 3 runs on ≥ 3 UTC dates, chain links, Run 1 still verifies.
- [ ] TZ04 N/A: `ui: false` — no `smeargle` responsive-design-tests.
- [ ] TZ05 Run the story's two independent tests: (1) `verify-manifest` prints `ALL ARTIFACTS VERIFIED` after Run 1; (2) the immutability check passes after Run 3.
- [ ] TZ06 Write `docs/reports/A-11-test-report.md`, `docs/evidence/A-11.md` (+ `A-11-manifest.md`, `A-11-gateways.md`, `A-11-runs.md`, `A-11-immutability.md`), the `docs/traceability.md` row, and one `docs/kit-usage.md` line.

---

## Dependencies & Execution Order

- **Setup (Phase 1)** → **Foundational (Phase 2)**: T003/T004 block every group's Wave-1 work that touches `DataGroup` or coverage keys.
- **Wave 1** (parallel, own files): G-PUB1 (T005, T006, T009, T010, T015), G-PUB2 (T007, T008, T011, T012, T014), G-RUN(a) (T016, T017), G-SCHED (T024-T028). The Run 1 dry run starts in the background alongside Wave 1.
- **Integration check 1** after Wave 1 (full unit suite + typecheck + lint on the combined result).
- **Wave 2** (depends on T013, G-PUB1's manifest builder): G-RUN(b)/(c) (T018-T023), plus T029 (depends on T018-T022).
- **Integration check 2** after Wave 2.
- User Story 1 has no dependency on US2/US3. User Story 2's wave-1 tasks (T016/T017) are independent of US1, but wave-2 tasks need US1's T013. User Story 3 is independent except for T029, which needs US2's completed delta/manifest work.

## Parallel Example: Wave 1

```text
Task: "[oracle] G-PUB1: sequence order test + checkInput tests + manifest coverage/carCid wiring"
Task: "[oracle] G-PUB2: verify-manifest hardening + Pinata client + GitHub Release step"
Task: "[oracle] G-RUN(a): watermark + digest delta computation"
Task: "[machamp] G-SCHED: scheduler stack + CDK assertions + DLQ/alarm"
```

## Implementation Strategy

**MVP = User Story 1** (Run 1 publication + gateway verification) — the primary evaluation point (A4). User Story 2 (incremental runs) and User Story 3 (scheduler) both build on the Foundational phase independently and can proceed in the same Wave 1/2 structure without blocking US1's critical path.
