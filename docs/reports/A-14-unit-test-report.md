---
id: UT-A-14
type: unit-test-report
story: A-14
branch: 014-agent-and-mcp
commit: 9715212
ci_run: "Numbers below are from local runs on the operator machine at 9715212, 2026-10-22 ~22:54 UTC. CI run on this branch not yet pushed (Stage 6, TZ02)."
created: 2026-10-22
---

# Unit and Integration Test Report: A-14

All numbers below were copied from local command output on 2026-10-22 between 22:52 and 22:54 UTC on branch `014-agent-and-mcp` at commit `9715212`, clean working tree before and after. These are **local unit, fixture-engine and CDK assertion tests only**. They do not prove the hosted runtime — the golden queries against the deployed `agent.ask`, MCP Inspector against the hosted `/mcp`, and Playwright against the hosted URL are Stage 6 and will be reported in `docs/reports/A-14-test-report.md`.

Environment for every command (reads local config only, no credentials):

```sh
export CDK_DEFAULT_REGION=eu-north-1
export AWS_REGION=eu-north-1
export CDK_DEFAULT_ACCOUNT=515618610572
export OPERATOR_EMAIL=ops@example.com   # placeholder for a local synth only, never committed
```

| Item | Value |
| --- | --- |
| Command (query-core, coverage) | `pnpm --filter @countylens/query-core exec vitest run --coverage` |
| Command (contract, coverage, unchanged this story) | `pnpm --filter @countylens/contract exec vitest run --coverage` |
| Command (apps/api) | `pnpm --filter @countylens/api exec vitest run` |
| Command (infra, CDK assertions + `cdk synth`) | `pnpm --filter infra exec vitest run` |
| Command (tests/agent, golden grader) | `pnpm --filter @countylens/agent-tests exec vitest run` |
| Command (typecheck, whole workspace) | `pnpm -r typecheck` |
| Command (lint, touched source) | `npx eslint apps/api/src apps/api/test packages/query-core/src packages/query-core/test tests/agent infra/src infra/test --ext .ts` |
| Suites / tests | query-core 22 files / 332 (327 passed, 5 skipped) · contract 7 files / 58 (all passed, unchanged) · apps/api 15 files / 196 (195 passed, 1 skipped) · infra 8 files / 93 (92 passed, 1 skipped) · tests/agent 1 file / 1 (skipped) |
| Passed / failed / skipped (A-14's own new/changed test files only) | 195 passed / 0 failed / 1 skipped (apps/api) + 10 new query-core test files all passed |
| Coverage, `packages/query-core` (src + gazetteer + tools) | statements 91.80 % · branches 85.25 % · functions 92.55 % · lines 93.18 %: **PASS** against 80 % |
| Coverage, `packages/contract` (unchanged this story) | 100 % statements, branches, functions, lines: **PASS** against 80 % (NFR-09, still true, not re-derived) |
| `cdk synth` (whole `CountyLensApi` stack, all three Lambdas) | succeeds; `CountyLensApi/Trpc`, `CountyLensApi/Mcp`, `CountyLensApi/Agent` all bundle; 0 cdk-nag errors (one acknowledged suppression, `AwsSolutions-DDB3`, documented reason: the spend counter is cheap to rebuild, never a system of record) |
| Forbidden-provider-SDK check | `grep -rn "@aws-sdk/client-bedrock-runtime\|@anthropic-ai/sdk\|from "openai"" apps/api/src apps/web/src` → zero import hits (one comment-only mention in `agent/model.ts`'s header, naming what is forbidden) |
| Typecheck | 6/6 workspace projects report "Done", 0 errors |
| Lint | 0 errors, 0 warnings on every touched file |
| Duration | query-core 2.2 s · contract 0.3 s · apps/api 1.4 s · infra 5.0 s · tests/agent 0.4 s |

## Per-file breakdown of A-14's new test files

| Test file | Tests | Result | Builder |
| --- | --- | --- | --- |
| `packages/query-core/test/tools.schemas.test.ts` | — | pass | alakazam |
| `packages/query-core/test/tools.functions.test.ts` | — | pass | alakazam |
| `packages/query-core/test/tools.geocode.test.ts` | — | pass | alakazam |
| `packages/query-core/test/permits.test.ts` | — | pass | alakazam |
| `packages/query-core/test/agent-citations.test.ts` | 8 | pass | alakazam (spec that ash's real implementation matches) |
| `packages/query-core/test/tools.parity.test.ts` → relocated to `apps/api/test/tools.parity.test.ts` (see note) | 3 | pass | alakazam |
| `apps/api/test/agent-model.test.ts` | 8 | pass | ash |
| `apps/api/test/agent-spend.test.ts` | 8 | pass | ash |
| `apps/api/test/agent-ask.test.ts` | 9 | pass | ash |
| `apps/api/test/mcp-auth.test.ts` | 10 | pass | oracle |
| `apps/api/test/mcp-tools.test.ts` | 11 | pass | oracle |
| `apps/api/test/mcp-runs-index.test.ts` | 9 | pass | oracle |
| `apps/api/test/parity-hosted.test.ts` | 2 (1 pass, 1 skip — hosted `agent.ask` leg) | pass + 1 expected skip | alakazam |
| `infra/test/countylens-api-agent.test.ts` | 3 | pass | ash |
| `infra/test/countylens-api-mcp.test.ts` | 6 | pass | oracle |
| `tests/agent/golden.test.ts` | 1 | skip (expected — no `AGENT_URL`, no deployed endpoint yet) | alakazam |

**Location deviations from `tasks.md` (both explained in-file, both intentional engineering judgment, not gaps):**
- `tools.parity.test.ts` moved from the originally-planned `packages/query-core/test/` to `apps/api/test/`, because it needs apps/api's MCP and agent tool adapters, and `apps/api` depends on `@countylens/query-core` (never the reverse) — putting it in query-core would invert the dependency direction. The same deep-relative-import pattern already exists in `apps/api/test/duckdb-node.test.ts` (importing `packages/contract/test/helpers/`).
- The fixture-engine leg of `tests/agent/parity-hosted.test.ts` (T032) lives in `apps/api/test/parity-hosted.test.ts` instead, because `tests/agent`'s package is deliberately kept thin (an HTTP-only client against a deployed `agent.ask`, with no `@modelcontextprotocol/sdk`/AWS SDK dependency) — adding the MCP-adapter import there would have broken that isolation.

## Skipped tests (2 relevant to A-14, both with a stated reason, neither a gap)

| Test | Why it is skipped |
| --- | --- |
| `apps/api/test/parity-hosted.test.ts` — "agent.ask leg" | No `AGENT_URL` set (no deployed endpoint in this local run); same unset/localhost-rejection guard pattern as `tests/agent/golden.test.ts`. Re-run at Stage 6 (TZ03/TZ05) once the branch is deployed. |
| `tests/agent/golden.test.ts` | Same reason — the golden-query grader (G1–G6) needs the deployed `agent.ask` endpoint; this is explicitly a Stage 6 hosted check, not a local unit test. |

The pre-existing skips in `query-core` (5), `contract` (0, unchanged), and `infra` (1, a bundling test gated on `COUNTYLENS_BUNDLE=1`) are all unrelated to A-14 and were already skipped before this story's build started.

## Architecture correction made during the build (recorded here for traceability)

T001 initially promoted the AD-18 DuckDB/CID-copy engine binder into a new top-level package (`packages/engine-duckdb`), per `research.md`'s stated rationale ("AD-21 puts MCP on its own Lambda, so `apps/mcp` would grow its own copy"). The wave-1 integration check's repo-wide `eslint` run caught that this tripped the existing `no-restricted-imports` guard ("DuckDB is wired only in `apps/*/src/engine/**`", ARD § 4/AD-19) — and on inspection, no separate `apps/mcp` app was actually built; the MCP and agent Lambdas are both just handler entry points inside `apps/api` (`apps/api/src/handlers/{mcp,agent}.ts`). The promotion was therefore unnecessary and was reverted back into `apps/api/src/engine/` before wave 2 started, restoring the original, already-correct architecture guard rather than loosening it. No code built on top of the promoted package needed to change beyond its import path.

A second gap, also caught by an integration check (this time the wave-2 one): the MCP server's `runs/index.json` resolution initially read a local repo-root file path, which would not exist on the deployed Lambda. Fixed by aligning it with the agent Lambda's existing, correct solution (an S3 `GetObject` on the CID-copy bucket, same bucket/key the engine already reads from), keeping the local-file read only for the legitimate local-stdio-build/test case.

## Conclusion

All of A-14's own new/changed test files pass (the only skips are the two hosted-endpoint legs, explicitly deferred to Stage 6, not dropped). Coverage on `query-core` (91.80%) and the unchanged `contract` (100%) both clear the 80% NFR-09 bar. `cdk synth` succeeds for the full three-Lambda stack. No forbidden provider SDK import anywhere. Ready for Stage 5's review round.
