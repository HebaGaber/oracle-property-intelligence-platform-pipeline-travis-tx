---
id: UT-A-03
type: unit-test-report
story: A-03
branch: 003-walking-skeleton
commit: 570285d
ci_run: "Not used: these numbers are from local runs on the operator machine (no network in this run, so the GitHub Actions result was not read)"
created: 2026-10-21
---

# Unit and Integration Test Report: A-03

All numbers below were copied from local command output on 2026-10-21 (EEST, UTC+3) on branch `003-walking-skeleton` at commit `570285d58c27ee33866a36460e6fda0800913415`. These are **local unit and CDK assertion tests only**. They do not prove the hosted runtime. The Playwright run against the hosted URL is Stage 6 and is reported separately.

Environment for every command (reads local config only, no credentials):

```sh
export CDK_DEFAULT_REGION=$(aws configure get region --profile assess)   # eu-north-1
export CDK_DEFAULT_ACCOUNT=515618610572 OPERATOR_EMAIL=ops@example.invalid
```

**Working-tree note.** Other agents were editing the tree while these runs happened. The workspace tests (13:16), the runtime tests (13:17) and the static checks (13:18:09–13:18:12) ran before any edit, so they reflect `570285d` exactly. From 13:18:29 on, four files were modified without a commit: `infra/test/api.test.ts`, `infra/src/data-stack.ts` (adds an `s3:ListBucket` grant limited to the `private/bench/*` prefix), `pipeline/oracle-runtime/travis/runs/run-month.ts` and its test. The S5.5 CDK runs (13:19–13:20) therefore ran on `570285d` plus those uncommitted edits. See the CDK section.

| Item | Value |
| --- | --- |
| Command (workspace, all 11 Vitest projects) | `pnpm vitest run --coverage` (with extra `--coverage.reporter=text --coverage.reporter=json-summary`), then `pnpm vitest run --reporter=json` to get per-project counts |
| Command (runtime) | `cd pipeline/oracle-runtime && npm test` (the package has no coverage script, so `npx vitest run --coverage` was run once for information) |
| Suites / tests | workspace 56 files / 935 tests · runtime 45 files / 633 tests |
| Passed / failed / skipped | workspace 927 / 0 / 8 · runtime 633 / 0 / 0 |
| Coverage, `packages/query-core` (src + gazetteer) | lines 95.72 % · branches 90.00 % · functions 98.17 % · statements 93.67 %: **PASS** against 80 % |
| Coverage, `packages/contract` (src) | 100 % lines, branches, functions and statements: **PASS** against 80 % |
| Coverage, whole workspace include set | lines 92.77 % · branches 81.6 % · functions 91.95 % · statements 90.87 % |
| Duration | workspace 23.31 s (Vitest) · runtime 6.00 s |

## Per project (workspace run at 13:16, `570285d`)

Coverage is grouped by the root `vitest.config.ts` `coverage.include` globs. Test files under `infra`, `scripts` and `packages/eslint-config` are not in the coverage include set, so those rows show n/a.

| Project | Files | Passed | Skipped | Failed | Lines | Branches | Functions | Statements |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| packages/query-core | 15 | 225 | 5 | 0 | src 98.22 · gazetteer 88.17 | src 92.42 · gazetteer 81.36 | src 100 · gazetteer 90.00 | src 96.37 · gazetteer 85.59 |
| packages/contract | 3 | 58 | 0 | 0 | 100 | 100 | 100 | 100 |
| packages/shared | 2 | 32 | 0 | 0 | 100 | 100 | 100 | 100 |
| packages/api-client | 1 | 4 | 0 | 0 | 83.33 | 71.43 | 75.00 | 85.71 |
| packages/eslint-config | 1 | 15 | 0 | 0 | n/a | n/a | n/a | n/a |
| apps/api | 6 | 113 | 0 | 0 | 92.84 | 78.60 | 92.00 | 90.05 |
| apps/web | 7 | 100 | 0 | 0 | 90.59 | 80.50 | 85.53 | 88.42 |
| infra | 4 | 63 | 2 | 0 | n/a | n/a | n/a | n/a |
| scripts | 2 | 62 | 0 | 0 | n/a | n/a | n/a | n/a |
| profiles/travis-austin@1.0.0 | 6 | 79 | 0 | 0 | 90.83 | 85.54 | 95.00 | 90.91 |
| pipeline/publish | 9 | 176 | 1 | 0 | 91.92 | 78.44 | 91.87 | 90.04 |
| **Workspace total** | **56** | **927** | **8** | **0** | 92.77 | 81.6 | 91.95 | 90.87 |
| pipeline/oracle-runtime (own npm project) | 45 | 633 | 0 | 0 | 89.12 | 74.64 | 82.78 | 86.51 |

The story's 80 % requirement covers only `packages/query-core` and `packages/contract`, and both pass. These rows are under 80 % on one metric, which is not a story gate: `packages/api-client` (branches 71.43, functions 75.00), `apps/api` (branches 78.60), `pipeline/publish` (branches 78.44) and `pipeline/oracle-runtime` (branches 74.64).

### Skipped tests (8): every skip comes from an explicit `skipIf` with a stated reason

| Test | Why it is skipped |
| --- | --- |
| `packages/query-core/test/carrier-emission.test.ts` › A-02-TC-004 | `PILOT_DIR is not set`. This is a pilot-export-backed A-02 case. |
| `packages/query-core/test/carriers.test.ts` › each carrier's pilot row exists | needs `PILOT_DIR` |
| `packages/query-core/test/sample.test.ts` › contract/v1 sample row-for-row | `PILOT_DIR is not set` |
| `packages/query-core/test/views.pilot.test.ts` › views over the pilot export (T058) | `PILOT_DIR is not set` |
| `packages/query-core/test/acceptance/a02.acceptance.test.ts` › A-02 pilot cases | `PILOT_DIR is not set` |
| `pipeline/publish/test/manifest.test.ts` › every committed `runs/<runId>/manifest.json` recomputes to the CID in `runs/index.json` | `skipIf(!existsSync("runs/index.json"))`. No run index is committed yet. |
| `infra/test/api.test.ts` › COUNTYLENS_BUNDLE=1: the real asset holds the linux-arm64 DuckDB binary and httpfs | runs only with `COUNTYLENS_BUNDLE=1`. It was run separately and passed (see S5.5). |
| `infra/test/stacks.test.ts` › A-03-TC-052 AWS::Budgets::Budget | runs only with `BUDGET_REGION` set (see S5.5) |

### Excerpts

```text
$ pnpm vitest run --coverage            # 13:16:26
 Test Files  55 passed | 1 skipped (56)
      Tests  927 passed | 8 skipped (935)
   Duration  23.31s
All files          |   90.87 |     81.6 |   91.95 |   92.77 |

$ cd pipeline/oracle-runtime && npm test # 13:17:36
 Test Files  45 passed (45)
      Tests  633 passed (633)
   Duration  6.00s
```

## Static checks and gates (13:18, `570285d`)

| Command | Result |
| --- | --- |
| `pnpm turbo run typecheck lint` | exit 0. `Tasks: 9 successful, 9 total` (7 cached), 13 packages in scope. Tasks: `//:typecheck`, `//:lint`, `@countylens/{api,api-client,e2e,infra,web}:typecheck`, `@countylens/web:lint` |
| `pnpm format:check` | exit 0. `All matched files use Prettier code style!` |
| `sh scripts/grep-gates.sh` | exit 0. `grep-gates: OK (5 gates …)`, covering reroof-terms, like-roof, query-db, region-literal and atlas-phrase |
| `pnpm --filter @countylens/web run build` | `✓ built in 568ms`. `compress-wasm: OK: 1 file(s)` (duckdb-eh wasm 34.3 MB → 5.2 MB brotli) |
| `pnpm exec tsx scripts/bundle-size.ts` | exit 0. `bundle-size: OK: 181437 bytes gzipped (177.2 KB) against limit 307200 (300.0 KB)` for `apps/web/dist/assets/*.js`, DuckDB chunks excluded. Counted chunks: index 111.1 KB gz, Skeleton 57.9 KB gz, Runs 5.0 KB gz, Permits 3.2 KB gz |

## CDK assertions (S5.5)

Commands, run in `infra/` with the environment above:

```text
$ pnpm exec vitest run --reporter=verbose                     # 13:20:05
 Test Files  4 passed (4)
      Tests  63 passed | 2 skipped (65)
$ COUNTYLENS_BUNDLE=1 pnpm exec vitest run test/api.test.ts    # 13:19:50
 Test Files  1 passed (1)
      Tests  14 passed (14)          # includes the bundled-asset case (5460 ms)
$ COUNTYLENS_BUNDLE=1 pnpm exec cdk synth --no-notices --quiet -o <scratchpad>/cdk.out
Bundling asset CountyLensApi/Trpc/Code/Stage...  index.mjs 1.2mb
Successfully synthesized … (exit 0; cdk-nag validation report: pluginReports [])
```

`-o` pointed synth output at a scratch folder so the repo's `infra/cdk.out` was left untouched.

The S5.5 runs saw the concurrent edits described at the top of this report:

- **13:19:24 (red):** a verbose run hit the newly edited test before its source fix existed. `test/api.test.ts › reads only ipfs/* and private/bench/* … lists private/bench/* only` failed with `presignPrefix (ListObjectsV2) needs s3:ListBucket on the bucket: expected [] to have a length of 1 but got +0`. The result was 62 passed, 1 failed, 2 skipped.
- **13:19:30:** `infra/src/data-stack.ts` gained the matching `ListBenchPrefixOnly` statement.
- **13:20:05 (green):** a rerun passed, 63 passed and 2 skipped.
- **13:16:26 (green):** in the earlier workspace run on unmodified `570285d`, the old version of that test also passed, with infra at 63 passed and 2 skipped.

These two files are **uncommitted**. Commit them before G7, or the committed tree will carry the old assertion without the `ListBucket` grant.

### AC-7 (observability, alarms, budget)

| Requirement | Assertion (file › test name) | Result |
| --- | --- | --- |
| Powertools JSON logs | `infra/test/api.test.ts` › is exactly one arm64 function: 1,769 MB, 15 s, X-Ray Active, JSON logs, SystemLogLevel WARN | PASS |
| Powertools JSON logs (one log line per request) | `apps/api/test/observability.test.ts` › writes exactly one logger.info per request with correlation_id and queryDurationMs | PASS |
| X-Ray Active | `infra/test/api.test.ts` › is exactly one arm64 function … X-Ray Active … ; `infra/test/stacks.test.ts` › A-03-TC-052: every Lambda traces Active; function log groups keep 14 days, the API access log 30 | PASS |
| X-Ray sampling rule FixedRate 1 | `infra/test/api.test.ts` › X-Ray: AWS::XRay::SamplingRule FixedRate 1 for service countylens-api (NFR-004) | PASS |
| QueryDurationMs / ItemsProcessed / ItemsFailed | `apps/api/test/observability.test.ts` › emits QueryDurationMs, ItemsProcessed and ItemsFailed=0 with the procedure dimension. This is a unit test of the handler, not a CDK assertion. | PASS |
| Log retention 14 days (function) | `infra/test/api.test.ts` › logs: the function log group keeps 14 days; it is the only log group besides the access log | PASS |
| Log retention 30 days (access / query log) | `infra/test/api.test.ts` › access log (the query log, AM-03): JSON lines with request id, route, status and latency into a 30-day group; identifiers and counts only | PASS |
| One self-resolving alarm per DLQ rule | `infra/test/stacks.test.ts` › A-03-TC-052: every AWS::SQS::Queue has a RedrivePolicy or is a DLQ with exactly one alarm (AD-12). There are **0 queues today**, so this passes vacuously. | PASS |
| Self-resolving alarms (ALARM + OK actions) | `infra/test/stacks.test.ts` › A-03-TC-052: three alarms (Lambda Errors ≥ 1 / 5 min, Throttles ≥ 1, HTTP API 5xx ≥ 1), each ALARM + OK → the topic, notBreaching | PASS |
| SNS email | `infra/test/stacks.test.ts` › A-03-TC-052: one SNS topic with exactly one email subscription from OPERATOR_EMAIL, SSL enforced; › the operator email is never in git | PASS |
| $10 budget | `infra/test/stacks.test.ts` › A-03-TC-052: AWS::Budgets::Budget 10 USD monthly, notifications at 80 % actual and 100 % forecast to the operator email, no budget action | **SKIP** |

**Why the budget case is skipped.** The test is `it.skipIf(!process.env.BUDGET_REGION)`. The test comment says `AWS::Budgets::Budget` is available only in US East (N. Virginia), so the budget lives in its own `BudgetStack` whose region comes from `BUDGET_REGION`. Which region that should be is still an open question for the PO, because the project is locked to `eu-north-1` and only CloudFront, WAF and CloudWatch Logs may use `us-east-1`. The synthesized app has no `AWS::Budgets::Budget`: no Ops template contains one.

### NFR-02 (nothing that bills while idle)

| Requirement | Assertion (file › test name) | Result |
| --- | --- | --- |
| No Route 53 hosted zone, no Secrets Manager secret, no KMS CMK, no WAFv2 (plus ACM certificate, RDS, Lambda Function URL) | `infra/test/stacks.test.ts` › creates nothing that bills while idle (A7, P0-19): banned resource types are absent | PASS |
| No provisioned or reserved concurrency | `infra/test/stacks.test.ts` › A-03-TC-053: no Lambda sets ReservedConcurrentExecutions or a ProvisionedConcurrencyConfig (AD-11); `infra/test/api.test.ts` › A-03-TC-053: no ReservedConcurrentExecutions, no ProvisionedConcurrencyConfig, no Function URL (AD-11, AD-09) | PASS |
| No WAF on the CID-copy CDN | `infra/test/data.test.ts` › has one distribution with OAC, origin path /ipfs, PriceClass_100 and no WAF | PASS |
| No Route 53 / ACM in the Web stack | `infra/test/web.test.ts` › creates nothing else: no Route 53, no ACM, no Lambda, no custom resource | PASS |
| Ops has no KMS key or secret | `infra/test/stacks.test.ts` › Ops has no Lambda, queue, key, secret or Function URL of its own | PASS |

**Count:** 16 AC-7 and NFR-02 rows. 15 PASS, 1 SKIP (budget), 0 FAIL. Across the whole infra suite: 63 PASS, 2 SKIP. The bundled-asset skip passes when run with `COUNTYLENS_BUNDLE=1`.

A `grep` of the synthesized templates for Route53, SecretsManager, KMS::Key, WAFv2, Budgets, ProvisionedConcurrency, ReservedConcurrent and SQS::Queue found no matches. The Api template contains exactly `RetentionInDays: 14` and `RetentionInDays: 30`.

### Synth resource counts (bundling on)

| Stack | Resources | Types |
| --- | --- | --- |
| CountyLensData | 11 | S3 Bucket 1, BucketPolicy 1, CloudFront CachePolicy 1, ResponseHeadersPolicy 1, OriginAccessControl 1, Distribution 1, IAM Role 1, SSM Parameter 3, CDK Metadata 1 |
| CountyLensApi | 15 | Logs LogGroup 2, IAM Role 1, IAM Policy 1, Lambda Function 1, Lambda Permission 2, ApiGatewayV2 Api 1, Integration 1, Route 2, Stage 1, XRay SamplingRule 1, SSM Parameter 1, CDK Metadata 1 |
| CountyLensWeb | 4 | Amplify App 1, Amplify Branch 1, SSM Parameter 1, CDK Metadata 1 |
| CountyLensOps | 9 | SNS Topic 1, TopicPolicy 1, Subscription 1, CloudWatch Alarm 3, IAM OIDCProvider 1, IAM Role 1, CDK Metadata 1 |
| CountyLensCert | 3 | Amplify Domain 1, SSM Parameter 1, CDK Metadata 1 |
| **Total** | **42** | |

## Tests written first (TDD)

The red-first line for each task group is recorded in `specs/003-walking-skeleton/run-log.md`, and this report does not repeat it. This run did see one test fail before its fix, as the S5.5 section describes: `infra/test/api.test.ts` failed on the missing `ListBucket` grant at 13:19:24 and passed after `data-stack.ts` changed at 13:19:30.

## Failures and flakes

| Test | Cause | Action |
| --- | --- | --- |
| `apps/api/test/runs.test.ts` › runs.summary (T070) › re-binds after BIND_TTL_MS so the presigned part URLs never outlive their signature | It timed out at 5000 ms (5246 ms) in the first full workspace run at 13:15:39, when the result was 1 failed and 926 passed. The machine was loaded because another process was rebuilding `pipeline/data/runs`. The file passed alone (19/19, 7.82 s) and passed in the full rerun at 13:16:26. | Flaky under load. Consider a per-test timeout for this case. Not fixed here. |
| `infra/test/api.test.ts` › reads only ipfs/* and private/bench/* … lists private/bench/* only | An uncommitted test edit was made test-first by a concurrent agent. It was red at 13:19:24 and green at 13:20:05 after the uncommitted `infra/src/data-stack.ts` change. | Commit the test and source change together before G7. |
