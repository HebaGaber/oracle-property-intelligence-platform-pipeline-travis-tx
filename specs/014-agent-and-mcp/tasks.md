---
description: "Tasks for A-14 roofing-lead agent and MCP server (merged A-14 + A-15)"
---

# Tasks: Answer roofing-lead questions through a source-backed agent and an MCP server

**Input**: `specs/014-agent-and-mcp/` (spec.md, plan.md, research.md, data-model.md, contracts/, quickstart.md, agent-design.md)

**Tests**: MANDATORY (constitution X, XXI, XXII). In every phase the test tasks come first and must be shown failing before the implementation tasks run.

**Builder**: every implementation task is delegated to its owning `soofi-xyz-team-kit` subagent (constitution XV) — `alakazam` (G-1), `ash` (G-2), `oracle` (G-3, G-4) — one subagent per group per wave, loading `build-rag-systems`/`build-ai-agents`/`deploy-open-data-mcp`/`use-elephant-mcp`/`responsive-design-tests` (per group) plus `apply-engineering-guidelines`.

**Format**: `- [ ] T### [P?] [US?] (group · builder · est.) Description — files owned`. `[P]` = no shared file with another open task. `⏳` = test task that may be written while a long run goes (preview build, CI, paced golden run).

## Builder groups and file ownership (light lane L4)

No file is owned by two groups at the same time.

| Group | Owns | Builder | Wave |
| --- | --- | --- | --- |
| **G-1** Shared retrieval | `packages/query-core/src/tools/{schemas,functions}.ts`, `packages/query-core/src/permits.ts`, `packages/query-core/src/index.ts` (additive), `packages/query-core/test/tools.*.test.ts`, `apps/api/src/agent/citations.ts` (logic), `tests/agent/{golden.json,golden.test.ts,grader.ts}` | `alakazam` | 1–3 |
| **G-2** Agent runtime + AI tab | `apps/api/src/agent/{ask,model,spend}.ts`, `apps/api/src/agent/tools.ts` (wiring), `apps/api/src/agent/citations.ts` (wiring), the agent half of `infra/lib/stacks/countylens-api-stack.ts` (Lambda, spend table, 80% alarm), `apps/web/` AI tab (deferred wiring until A-13 merges) | `ash` | 1–3 |
| **G-3** MCP tools + clients | `apps/api/src/mcp/tools.ts`, `apps/api/src/mcp/stdio.ts`, `docs/mcp.md` | `oracle` | 2–3 |
| **G-4** MCP transport + auth | `apps/api/src/mcp/{auth,server}.ts`, the MCP half of `infra/lib/stacks/countylens-api-stack.ts` (Lambda, `/mcp` route, throttle, SSM read grant) | `oracle` | 1, 3 |
| **shared pre-task** | `packages/engine-duckdb/` (promoted from `apps/api/src/engine/{duckdb-node,s3-read}.ts`) | `oracle` (build), `alakazam` (reviews no behavior change to the existing query router) | 1 |

**Narrowed by `/speckit-analyze` finding F1 (2026-10-22):** place-based area resolution (`geocodePlace`, and the `area` input of `searchProperties`/`listPermits`) does **not** need to wait for A-13. `gazetteer.lookup()` — already on this branch, from A-02, `packages/query-core/gazetteer/travis-places@1.0.0/index.ts` — already returns everything A-13's `resolvePlace` adds (`partial_in_travis`, `counties`, source stamp); A-13's `places.ts` is confirmed (by reading it directly) to be a thin formatting wrapper over this same function, not new logic. So `geocodePlace`, `searchProperties` and `listPermits`'s area resolution are all built **now**, directly on `gazetteer.lookup()` and the existing `builders.ts` SQL primitives (T011, T013). **Deferred (blocked on A-13 merging, narrowly scoped, not scheduled into a wave):** reconciling `searchProperties`'s exact SQL against A-13's `exploreSearchSql` once A-13 merges, to close the specific divergence risk alakazam flagged (e.g. the tenure off-by-one) — caught by the parity test (T029) and fixed in T030 if it fires, not a rebuild.

---

## Phase 1: Setup (wave 1)

- [ ] T001 (shared pre-task · oracle · 15m) Promote `apps/api/src/engine/{duckdb-node,s3-read}.ts` (the existing AD-18 CID-copy DuckDB binder) into a new package, same public interface, imported by the existing query router unchanged — `packages/engine-duckdb/src/{duckdb-node,s3-read,index}.ts`, `apps/api/package.json`, `apps/api/src/routers/*.ts` (import path only)
- [ ] T002 [P] (G-1 · alakazam · 5m) Add `packages/query-core/src/tools/` directory with barrel export — `packages/query-core/src/tools/index.ts`, `packages/query-core/src/index.ts`
- [ ] T003 [P] (G-4 · oracle · 5m) Pin `@modelcontextprotocol/sdk` to one exact version (research.md) — `apps/api/package.json`, `pnpm-lock.yaml`

---

## Phase 2: Foundational (wave 1, blocks every user story)

### Tests first

- [ ] T004 [P] (G-1 · alakazam · 15m) Vitest for the six Zod schemas: `AreaInput` union (place | lat/lon, global bounds so an out-of-Travis point is a valid input, not a Zod error), `SearchPropertiesInput`/`ListPermitsInput` numeric bounds (`radius_mi` 0.25–25, `roof_age_years_min` 0–120, `tenure_years_min` 1–100, `open_years_min` 0–60, `limit` 1–1000 default 50), `permit_number` regex `/^\d{4}-\d{6} [A-Z]{2}$/` (rejects a free-form SQL string per the edge case), `.strict()` on every object (rejects an unknown key) — `packages/query-core/test/tools.schemas.test.ts`
- [ ] T005 [P] (G-1 · alakazam · 15m) Vitest for `searchProperties`, `listPermits`, `getProperty`, `getCoverage`, `listRuns`, `getSchema` over the committed pilot fixture tables (`scripts/duckdb-engine.ts`): `ResultEnvelope` shape (`returned`, `total`, `truncated = total > returned`, `unknown_excluded`), each `empty_reason` path (`not_found` for an unknown `permit_number`/`property_cid`, `run_not_found` for an unknown `manifest_cid`, `no_match` for a valid filter with 0 rows, `out_of_scope` for ZIP 99999, `field_not_published` for `owner_is_out_of_area`), `getCoverage` deep-equals the manifest `coverage` section unchanged — `packages/query-core/test/tools.functions.test.ts`
- [ ] T005a [P] (G-1 · alakazam · 10m) Vitest for `geocodePlace`/area resolution over `gazetteer.lookup()`: "Pflugerville" → "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116"; Round Rock → `partial_in_travis: true`; ZIP 99999 → `out_of_scope` — `packages/query-core/test/tools.geocode.test.ts`
- [ ] T006 [P] (G-1 · alakazam · 10m) Vitest for `permitsSql()`: radius optional (omitted = county-wide, AC-10), `status_class` filter, `open_days >= openYrs × 365.25`, sort `open_desc`, `status_raw`/`contractor.name_as_printed` null with `missing: [{field, reason: "no_lexicon_carrier"}]` when the source has no carrier (today: always) — `packages/query-core/test/permits.test.ts`
- [ ] T007 [P] (G-2 · ash · 10m) Vitest for `getModel()`: returns a Bedrock-backed model when `AI_PROVIDER=bedrock` (default), a Gateway-backed model when `AI_PROVIDER=gateway`; a static-analysis test asserting no file under `apps/api/src/agent/` imports `@aws-sdk/client-bedrock-runtime`, `@anthropic-ai/sdk` or `openai` (constitution VI) — `apps/api/test/agent-model.test.ts`
- [ ] T008 [P] (G-2 · ash · 10m) Vitest for the spend counter: one on-demand item per UTC day, `spent_usd` increments after a call, read-before-call returns `paused` when `spent_usd ≥ 3`, no TTL/idle cost (constitution A7) — `apps/api/test/agent-spend.test.ts`
- [ ] T009 [P] ⏳ (G-2 · ash · 10m) CDK assertion tests: agent Lambda (arm64, 1,769 MB, timeout 25 s per AD-27, **no** reserved concurrency per research.md), spend-counter DynamoDB table (on-demand billing mode), CloudWatch alarm at 80% of $3 — `infra/test/countylens-api-agent.test.ts`
- [ ] T010 [P] ⏳ (G-4 · oracle · 10m) CDK assertion tests: MCP Lambda (arm64, 1,769 MB, timeout per AD-11, **no** reserved concurrency), `/mcp` POST route with a 5 rps / burst 10 route-level throttle (not stage-wide), one SSM `GetParameter` read grant scoped to the single token parameter name from plan.md, no Secrets Manager resource anywhere in the diff — `infra/test/countylens-api-mcp.test.ts`
- [ ] T010a [P] (G-4 · oracle · 10m) Vitest for `auth.ts`'s token-check logic (not the CDK resource, the function): missing SSM parameter at cold start → fails fast with a clear log line, no default fallback; correct bearer token → passes through; missing/wrong token → the `401` helper returns the typed shape, no DuckDB bind attempted — `apps/api/test/mcp-auth.test.ts`

### Implementation

- [ ] T011 (G-1 · alakazam · 30m) `searchProperties`, `listPermits`, `getProperty`, `getCoverage`, `listRuns`, `getSchema` functions, each validating its Zod input then building SQL from existing `builders.ts` primitives (`radiusSql`, `roofAgeSql`, `listRoofingPermitsSql`, `runSummarySql`) or the new `permits.ts`, mapping rows to the `ResultEnvelope` shape in data-model.md. `searchProperties`'s filter SQL is built now (not deferred, per analyze finding F1) but flagged for reconciliation against A-13's `exploreSearchSql` in T030 once merged — `packages/query-core/src/tools/functions.ts`, `packages/query-core/src/index.ts`
- [ ] T011a (G-1 · alakazam · 15m) `geocodePlace` and the shared area-resolution helper used by `searchProperties`/`listPermits`, built directly on `gazetteer.lookup()` (`travis-places@1.0.0`) — no A-13 dependency (analyze finding F1) — `packages/query-core/src/tools/functions.ts`
- [ ] T012 (G-1 · alakazam · 15m) `permitsSql()` + its count statement over `v_roofing_permit` ⋈ `v_property` — `packages/query-core/src/permits.ts`
- [ ] T013 [P] (G-1 · alakazam · 10m) The six Zod input schemas plus `RunRef`, `AreaInput`, `ResultEnvelope`, `EmptyReason` — `packages/query-core/src/tools/schemas.ts`
- [ ] T014 (G-2 · ash · 15m) `getModel()` (the only `AI_PROVIDER` read site in `apps/api/src/agent/`) — `apps/api/src/agent/model.ts`
- [ ] T015 (G-2 · ash · 15m) Spend counter read/increment against DynamoDB — `apps/api/src/agent/spend.ts`
- [ ] T016 (G-2 · ash · 20m) Agent Lambda, spend-counter table, 80% alarm (CDK, no reserved concurrency) — `infra/lib/stacks/countylens-api-stack.ts` (agent-owned resource block)
- [ ] T017 (G-4 · oracle · 20m) `auth.ts`: SSM SecureString token read at cold start via Powertools Parameters + cache, fail-fast with a clear log line and no default if the parameter is missing; `401` helper for no/wrong token — `apps/api/src/mcp/auth.ts`
- [ ] T018 (G-4 · oracle · 20m) MCP Lambda, `/mcp` route, route-level throttle, SSM read grant for the one token parameter (CDK) — `infra/lib/stacks/countylens-api-stack.ts` (MCP-owned resource block)

**Checkpoint (end of wave 1):** integration check — `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm cdk synth` (both stack test files green). Commit `A-14: wave 1 shared function interfaces, agent CDK resources, MCP transport and auth`.

---

## Phase 3: [US1] Ask roofing-lead questions in plain language (P1, part A-14, wave 2) · AC-1 to AC-6

**Independent test**: ask G1 then G2 against the deployed `agent.ask`; the answer cites real rows, states its assumptions, and the follow-up keeps "that area."

### Tests first

- [ ] T018a [P] [US1] (G-1 · alakazam · 10m) Vitest for the citation registry: rows register once by `cid` in first-seen order with a stable index `n`; a post-check strips any `[n]` outside range or any unregistered CID-shaped token from a sample `answer` string — `packages/query-core/test/agent-citations.test.ts` (test lives in query-core so it runs before `apps/api/src/agent/citations.ts` exists; the implementation task below creates the real file)
- [ ] T020 [P] [US1] (G-1 · alakazam · 20m) Golden set `tests/agent/golden.json` (G1–G6 word for word from checks.md § 7.1, oracle query-core calls per design-alakazam.md § 6.2) and grader `tests/agent/grader.ts` (groundedness, correctness, recall ≥ 80% of top-N, honesty via `must_mention`/`must_flag_missing`, G6 zero-match check, budget check ≤6 steps/≤3 calls/≤1,500 tokens) — written against the not-yet-built `agent.ask` contract, must fail until T022 lands — `tests/agent/{golden.json,golden.test.ts,grader.ts}`
- [ ] T023 [P] [US1] ⏳ (G-2 · ash · 10m) Contract-level tests asserting each `outcome` value (`answered`, `paused`, `throttled`, `timed_out`) is reachable via documented, reversible config (lowered abort threshold, lowered spend cap, forced throttle) — written against the not-yet-built `agent.ask` contract, must fail until T022 lands; stands in for AI-tab Playwright until A-13's shell merges — `apps/api/test/agent-ask.test.ts`

### Implementation

- [ ] T019 [US1] (G-1 · alakazam · 15m) Citation registry: every row returned this turn registered once by `cid`, stable index `n` in first-seen order, `matches[]` built from tool-row provenance only (never model text); post-check strips any `[n]` outside range or any unregistered CID-shaped token from `answer` — `apps/api/src/agent/citations.ts`
- [ ] T021 [US1] (G-2 · ash · 10m) 4 camelCase AI SDK tools wired to G-1's functions: `getProperty`, `searchRoofingPermits` (→ `listPermits`), `searchProperties`, `geocodePlace` — all four real (not stubbed, per analyze finding F1) — `apps/api/src/agent/tools.ts`
- [ ] T022 [US1] (G-2 · ash · 35m) `agent.ask` tRPC procedure: AI SDK tool loop with `stopWhen` + explicit counters (≤6 steps, ≤3 model calls, ≤1,500 tokens), 4-layer timeout (23 s abort → `timed_out`, 25 s Lambda, 25 s client, 29–30 s HTTP API backstop), spend-cap pre-check → `paused`, Bedrock throttle → `throttled`, conversation state from client-sent `turns[]` (no server store), server composes `how`/`missing[]`/`query` from tool results — `apps/api/src/agent/ask.ts`

**Checkpoint (end of wave 2, US1):** integration check green (G-1 + G-2 combined: `listPermits`/`getProperty` loop end to end on today's A-03 slice, honest `no_match`/`field_not_published` answers). Commit `A-14: wave 2 agent loop (listPermits/getProperty tracks)`.

---

## Phase 4: [US2] Call the same data through a standard MCP server (P1, part A-15, wave 2) · AC-7 to AC-12

**Independent test**: MCP Inspector against the hosted `/mcp` with the token lists six tools and returns rows for a real call; a wrong/missing token is refused.

### Tests first

- [ ] T024 [P] [US2] (G-3 · oracle · 15m) Vitest for the six MCP tool adapters over the fixture engine: `inputSchema` **is** the matching G-1 Zod schema object (not re-derived), output envelope unchanged, `get_coverage` byte-for-byte matches the manifest, truncation flag at a forced small `limit` — written against the not-yet-built adapters, must fail until T025 lands — `apps/api/test/mcp-tools.test.ts`

### Implementation

- [ ] T025 [US2] (G-3 · oracle · 25m) `search_properties`, `list_permits`, `get_property`, `get_coverage`, `list_runs`, `get_schema` — all six real thin adapters over G-1's functions/schemas (per analyze finding F1, none are stubbed) — `apps/api/src/mcp/tools.ts`
- [ ] T026 [US2] (G-4 · oracle · 25m) Streamable HTTP server: `POST /mcp` (auth via T017, Origin allowlist empty by default, so no browser Origin is ever accepted directly), `GET /health` (no auth) — `apps/api/src/mcp/server.ts`
- [ ] T027 [P] [US2] (G-3 · oracle · 15m) Local stdio build entry point for Claude Desktop/Claude Code — `apps/api/src/mcp/stdio.ts`
- [ ] T028 [US2] (G-3 · oracle · 15m) `docs/mcp.md`: Claude Desktop, Claude Code and Inspector setup with `Authorization: Bearer <token>` placeholders, the six tools' input schemas (from `get_schema`), never a sample response — `docs/mcp.md`

**Checkpoint (end of wave 2, US2):** integration check green (MCP Lambda answers `tools/list`/`tools/call` against the fixture engine; 401 without a token). Commit `A-14: wave 2 MCP server (tools, transport, auth, stdio, docs)`.

---

## Phase 5: Cross-surface agreement (wave 3) · AC-8, FR-011

- [ ] T029 [P] [US1,US2] (G-1 · alakazam · 15m) Parity test: for the same area/radius/filters, `listPermits`'s distinct `property_cid`s equal `searchProperties`'s, and both equal `search_properties`'s (MCP) over the fixture engine — runs now, since T011/T011a/T025 are all real (not stubbed) after the F1 fix — `packages/query-core/test/tools.parity.test.ts`
- [ ] T030 **(deferred — narrowly scoped, blocked on A-13 merging, per analyze finding F1)** [US1,US2] (G-1 · alakazam · 10m) Reconcile `searchProperties`'s SQL against A-13's `exploreSearchSql` once `013-explorer-and-pages` merges into this branch's base: re-run T029/T032 and fix any divergence the parity test surfaces (e.g. the tenure off-by-one alakazam flagged) — `packages/query-core/src/tools/functions.ts`
- [ ] T032 [US1,US2] ⏳ (G-1 · alakazam · 15m) AC-8 three-way comparison test, against the fixture engine now and re-run against the hosted endpoints at Stage 6: `agent.ask` G1 `matches[]`, `search_properties` rows, and `searchProperties`'s own result return the identical `property_cid` set for the same `manifest_cid`; re-run once more after T030 lands to also compare against the Explore page's live query — `tests/agent/parity-hosted.test.ts`
- [ ] T033 **(deferred — blocked on A-13 merging)** [US1] (G-2 · ash · 20m) Wire the real AI tab (Working… timer, answer, editable "How I read this" chips, citations `[n]` linked to numbered rows, missing-data list, session counter) into A-13's Explore shell once it merges, replacing T023's contract-level stand-in (spec.md FR-012, analyze finding F2) — `apps/web/src/routes/Explore.*` (AI tab additions)

`cdk synth` (both stack test files from Phase 2) re-run here as the wave-3 integration check once T016/T018 are both present in the diff together.

**Checkpoint (end of wave 3):** integration check green; deferred tasks (T030, T033) recorded as open in `run-log.md`, not silently dropped. Commit `A-14: wave 3 — parity test (fixture-engine complete), cdk synth, deferred-task bookkeeping`.

---

## Phase Z: Prove on the hosted runtime (mandatory, always last)

- [ ] TZ01 Run the reviewer agents `alakazam`, `ash`, `oracle`, `donphan` read-only plus `/code-review medium`; record scores in `docs/reviews/CR-A-14.md` (each ≥ 75)
- [ ] TZ02 Deploy (🛑 D-9): backend from the laptop as A-03/A-13 do it (`cdk deploy` profile `assess`, stack order `CountyLensCert` → `CountyLensData` → `CountyLensApi` → `CountyLensWeb` → `CountyLensOps`), then `git push origin 014-agent-and-mcp` for the Amplify branch preview; record the preview URL once `/build.json` shows the head SHA
- [ ] TZ03 Golden queries G1–G6 as Vitest against the deployed `agent.ask` (paced under Bedrock's 10 req/min), Playwright on the hosted URL for demo D-10 and D-11 (`tests/e2e/A-14.spec.ts`, one test per `testplans/A-14-test-cases.md` UI TC), and MCP request-fixture Playwright tests against the hosted `/mcp` for demo D-12 (`tests/e2e/A-14-mcp.spec.ts`, one test per MCP TC) — screenshots to `docs/evidence/img/A-14-TC-{nnn}-{step}.png`
- [ ] TZ04 Run `smeargle` responsive-design-tests at 390 / 768 / 1440 on the AI tab states and `/help/mcp` (light lane L6: only the pages this story changes)
- [ ] TZ05 Run the independent test: G1–G6 pass the grader on the deployed agent; MCP Inspector against the hosted `/mcp` lists six tools and returns rows for `search_properties`; `donphan` answers a question through the MCP server alone, transcript saved. If T030/T033 are still deferred at Stage 6 (A-13 not yet merged), record the AC-8-vs-Explore-page comparison and the AI-tab UI proof as deferred, not failed, per quickstart.md
- [ ] TZ06 Write `docs/reports/A-14-test-report.md`, `docs/evidence/{A-14,A-14-agent,A-14-mcp}.md`, `docs/mcp.md` final pass, the A-14 row of `docs/traceability.md`, one `docs/kit-usage.md` line

---

## Dependencies and execution order

- Phase 1 → Phase 2 (T001 before T017/T018; T002/T013 before T004–T006, T011–T012) → Phase 3 (US1) and Phase 4 (US2) run in parallel in wave 2, both depending on Phase 2's G-1 functions (now including `searchProperties`/`geocodePlace`, per F1) → Phase 5 (wave 3, cross-surface) → Phase Z.
- Only T030 (narrow SQL reconciliation) and T033 (AI tab UI wiring) are out of the critical path until A-13 merges; everything else — including `searchProperties`, `geocodePlace`, and the fixture-engine parity test T029/T032 — builds and tests now, per analyze finding F1.

**Critical path** (work minutes, parallel groups counted once per wave): T001 (15) → T004/T004a (15, parallel with T007–T010) → T011 (30) → T011a (15) → T012 (15) → wave-1 check (5) → T019 (15, parallel with T024) → T022 (35) → wave-2 US1 check (5) || T025 (25) → T026 (25) → wave-2 US2 check (5) → T029 (15) → T032 (15) → wave-3 check (5) → review round (≈35, per walkthrough S5.3) → TZ02 (15) → TZ03 (26) → TZ04 (0, parallel) → TZ06 (8) ≈ **279 min** (≈4h39m), inside the walkthrough's ≈6h28m estimate once stage overhead (G5/G6 approval, converge, evidence drafting) is added. Group totals (work, not wall clock): G-1 ≈ 135 min (excl. T030), G-2 ≈ 150 min (excl. T033), G-3 ≈ 55 min, G-4 ≈ 45 min, shared pre-task ≈ 15 min.
