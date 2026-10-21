---
id: TASKS-A-03
type: tasks
parent: PLAN-A-03
story: A-03
gate: G5
created: 2026-10-21
---

# Tasks: Publish one month of Austin roofing permits by CID and show them in the hosted UI

**Input**: `specs/003-walking-skeleton/` — [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md); test cases `testplans/A-03-test-cases.md` (v1.0, G6).

**Tests**: MANDATORY (constitution X, XXI, XXII). Test tasks come first in every phase and must fail before the implementation tasks run. Hosted acceptance tests are one Playwright test per TC, tagged `@scenario:A-03-TC-nnn`, in the spec file the G6 coverage matrix (§ 7) names.

**Builder**: every task is delegated to the subagent in its tag (constitution XV): `[metagross]` = `soofi-xyz-team-kit:metagross` with build-frontend-backends, integrate-ci-cd, responsive-design-tests + apply-engineering-guidelines; `[oracle]` = `soofi-xyz-team-kit:oracle` with use-oracle, county-permit-adapter + apply-engineering-guidelines. `[PO]` = a step the PO does in their own terminal or browser.

## Format: `[ID] [P?] [Story] [builder] Description — owns: files · ⏱ minutes · group`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task).
- **[USn]**: user story from spec.md (US1 Runs + publication, US2 Permits list, US3 no-TCAD count, US4 read path at scale, US5 observability).
- **⏳**: a test task of a later phase that can be written while a long run goes (Austin capture, elephant-cli steps, deploys, CI).
- **🛑 D-8 / 🛑 D-10**: gated on that PO decision. D-8 = first public upload to Filebase. D-10 = first `cdk deploy` + push of the branch.
- **Group** `G-xx`: one builder subagent, ≤ 8 tasks or ≈ 15 min, owns its files exclusively within its wave (see Waves).
- Exact texts (plan § "Fixed texts and config keys", test plan § 3) are quoted in the tasks that emit them and must be copied verbatim.

## Path conventions

Turborepo per plan.md § Project Structure: `apps/web`, `apps/api`, `packages/*`, `pipeline/oracle-runtime` (npm, outside pnpm), `pipeline/publish`, `infra/`, `runs/`, `scripts/`, `tests/e2e/`.

---

## Phase 1: Setup (Track A, Turborepo scaffold)

**Purpose**: workspace, toolchain and app/package skeletons. `pipeline/oracle-runtime` stays outside the pnpm graph.

- [ ] T001 [metagross] Write failing Vitest `scripts/test/workspace-layout.test.ts`: `pnpm-workspace.yaml` members are exactly `packages/*`, `profiles/*`, `pipeline/publish`, `apps/*`, `infra`, `tests/e2e` (not `pipeline/oracle-runtime`); `supportedArchitectures` has `os [current, linux]`, `cpu [current, arm64]`, `libc [current, glibc]`; `turbo.json` has tasks `build` (`^build`, outputs `dist/**`), `typecheck`, `lint`, `test` (outputs `coverage/**`), `synth` — owns: scripts/test/workspace-layout.test.ts · ⏱ 2m · G-A1
- [ ] T002 [metagross] Add Turborepo: `turbo.json`; root `package.json` scripts (`turbo run typecheck lint test synth`, `format:check`, add devDeps `turbo`, `stylelint`, `stylelint-declaration-strict-value`, `dependency-cruiser`); `pnpm-workspace.yaml` members + `supportedArchitectures` (keep the `onlyBuiltDependencies` block) — owns: turbo.json, package.json, pnpm-workspace.yaml · ⏱ 4m · G-A1
- [ ] T003 [P] [metagross] Create `packages/tsconfig` (`base.json`, `node.json`, `react.json`) from `tsconfig.base.json`; make `tsconfig.base.json` extend `packages/tsconfig/base.json` — owns: packages/tsconfig/**, tsconfig.base.json · ⏱ 3m · G-A1
- [ ] T004 [metagross] Create `packages/eslint-config` and re-export it from `eslint.config.js`: `no-restricted-imports` bans `pg`, `postgres`, `@elephant-xyz/query-db` in `packages/*`, `apps/*`, `pipeline/publish`; bans `openai`, `@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime` everywhere; allows `@duckdb/*` only in `apps/*/src/engine/**`; bans `@aws-sdk/*` in `apps/web`; bans inline `style={{…}}` literals in `apps/web` — owns: packages/eslint-config/**, eslint.config.js · ⏱ 4m · G-A1
- [ ] T005 [P] [metagross] Add `runs/** -text` to `.gitattributes`, `runs/` to `.prettierignore`, and `cdk.out/`, `dist/`, `pipeline/data/runs/`, `test-results/`, `playwright-report/` to `.gitignore` — owns: .gitattributes, .prettierignore, .gitignore · ⏱ 1m · G-A1
- [ ] T006 [metagross] Write failing tests `apps/web/test/app-shell.test.tsx` (routes `/runs` and `/permits` are lazy; `/` redirects to `/runs`; no inline style literal) and `apps/api/test/config.test.ts` (Zod env requires `CID_COPY_BUCKET`, `CID_COPY_HOST`, `FILEBASE_GATEWAY_HOST`, `READPATH_PRIVATE_PREFIX`; throws with the missing key name) — owns: apps/web/test/app-shell.test.tsx, apps/api/test/config.test.ts · ⏱ 3m · G-A2
- [ ] T007 [metagross] Scaffold `apps/web`: `package.json` (react 19, react-dom, vite, react-router, @tanstack/react-query, `@countylens/api-client`, `@countylens/shared`, vitest + jsdom + @testing-library/react), `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx` (lazy `routes/Runs.tsx`, `routes/Permits.tsx` stubs), `src/styles/tokens.css` (copied from `../assessment-guide/design-system/tokens.css`), `src/components/AppShell.tsx` + `.module.css`, typed export stubs (signatures only, bodies `throw new Error('not implemented')`) for `src/data/{runs-index,manifest,fetch-by-cid}.ts` so G-C3 and G-C4 code against fixed interfaces in W3, `.stylelintrc.json` (`declaration-strict-value` for color, spacing, font) — owns: apps/web/** (except routes bodies filled later) · ⏱ 5m · G-A2
- [ ] T008 [metagross] Scaffold `apps/api`: `package.json` (name `@countylens/api`, @trpc/server v11, zod, @aws-lambda-powertools/{logger,tracer,metrics}, @middy/core, `@duckdb/node-api@1.5.6-r.2`, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, `@countylens/query-core`, `@countylens/contract`), `tsconfig.json`, `src/config.ts` (Zod env per T006), `src/routers/index.ts` (empty `appRouter`, export type `AppRouter`), `src/handlers/trpc.ts` stub, typed export stubs for `src/engine/duckdb-node.ts` (`getEngine()`, `bindOnce(manifestCid)`, `query(sql)`) and `src/s3-read.ts` (`getManifest(cid)`, `presignPart(cid)`, `presignPrefix(prefix)`) so G-C2a and G-C2b code against fixed interfaces in W3 — owns: apps/api/** · ⏱ 4m · G-A2
- [ ] T009 [metagross] Create `packages/api-client`: the only tRPC client, `AppRouter` imported type-only from `@countylens/api` , `splitLink` (agent/mcpProxy never batched), `httpBatchLink` to `/api/trpc`, React Query hooks — owns: packages/api-client/** · ⏱ 3m · G-A2

**Checkpoint**: `pnpm install && pnpm turbo typecheck lint test` runs (new tests fail where expected).

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: browser-safe query layer, labels, the Data stack, CI and the hosted test harness. No user-story work starts before this phase is done.

- [ ] T010 [metagross] Write failing `packages/query-core/test/browser-safe.test.ts`: `src/sql.generated.ts` string constants equal `views.sql` and the generated status-map SQL byte for byte; digest constants equal recomputed SHA-256 of the profile and gazetteer files; no `node:` import reachable from `src/index.ts` (static scan) — owns: packages/query-core/test/browser-safe.test.ts · ⏱ 3m · G-C0
- [ ] T011 [P] [metagross] Write failing `packages/query-core/test/builders.test.ts`: `listRoofingPermitsSql()` selects `permit_number`, `improvement_status`, `status_class`, `issue_date`, `contractor_resolution`, provenance columns and `missing`, `ORDER BY permit_number`; `runSummarySql()`; `radiusSql({lat,lon,miles,limit})` uses a lat/lon bbox prefilter then haversine, `limit ≤ 1000`; `roofAgeSql` takes `asOf` as a parameter (never `now()`); `bench-sql.ts` builders are parametrised (`{lat, lon, miles, minYears}`) and export two presets: `TC_NF_05` = centre 30.2672, −97.7431, 1 mi, roof-age ≥ 15 years (the G6 acceptance case) and `ADR_0001` = Pflugerville 30.447765, −97.602116, 5 mi (8,046.72 m), `LIMIT 500`, ≥ 15 years (spike comparability); `DATE '2026-10-21'` fixed; `bindManifest` with `partUrl` builds URLs from `{name, cid}` and the default path is unchanged — owns: packages/query-core/test/builders.test.ts · ⏱ 3m · G-C0
- [ ] T012 [metagross] Add `packages/query-core/scripts/gen-sql.ts` → `src/sql.generated.ts` + digest constants; refactor `src/sql.ts`, `profiles/travis-austin@1.0.0/index.ts` and `packages/query-core/gazetteer/**/index.ts` to use the constants (behaviour and contract unchanged); add `gen` to the package `build` — owns: packages/query-core/{scripts/gen-sql.ts,src/sql.ts,src/sql.generated.ts,gazetteer/**/index.ts,package.json}, profiles/travis-austin@1.0.0/index.ts · ⏱ 5m · G-C0
- [ ] T013 [metagross] Add optional `BindOptions.partUrl?: (a: {name: string; cid: string}) => string` to `packages/query-core/src/bind-manifest.ts` (additive; `contract/v1` untouched) — owns: packages/query-core/src/bind-manifest.ts · ⏱ 2m · G-C0
- [ ] T014 [metagross] Implement `packages/query-core/src/builders.ts` (`listRoofingPermitsSql`, `runSummarySql`, `radiusSql`, `roofAgeSql`) and `src/bench-sql.ts` (labelled "performance stand-in, not a roof classification", P0-9); export from `src/index.ts` — owns: packages/query-core/src/{builders,bench-sql,index}.ts · ⏱ 4m · G-C0
- [ ] T015 [metagross] Write failing `packages/shared/test/missing-labels.test.ts` (Vitest behind TC-027): walks `MISSING_REASONS` from `@countylens/contract` — 21 of 21 have a label equal to the spec's Missing-reason labels table verbatim; `missingLabel('contractor_*', 'source_missing')` = "Contractor not printed on permit", other fields keep the table label; `SOURCE_LABELS` throws on an unmapped source name; `copyUrl(cid)` = `https://${CID_COPY_HOST}/${cid}`, `gatewayUrl(cid,'filebase'|'pinata')` derived from `FILEBASE_GATEWAY_HOST` / `PINATA_GATEWAY_HOST`, never stored — owns: packages/shared/test/missing-labels.test.ts · ⏱ 3m · G-C1
- [ ] T016 [metagross] Create `packages/shared`: `src/labels.ts` (`MISSING_REASON_LABELS: Record<MissingReason,string>` with the 21 spec strings, `COVERAGE_LABELS.permits_no_tcad_geoid = "No TCAD id on source record"`, `missingLabel`), `src/sources.ts` (`austin-3syk-w9eu` → "City of Austin Issued Construction Permits (3syk-w9eu)", `tcad-2026-certified-json` → "TCAD 2026 certified export"), `src/urls.ts`, `package.json` — owns: packages/shared/** · ⏱ 5m · G-C1
- [ ] T017 [metagross] Write failing `infra/test/stacks.test.ts` (whole app: no `AWS::Route53::HostedZone`, `AWS::SecretsManager::Secret`, `AWS::KMS::Key`, `AWS::WAFv2::*`, `AWS::CertificateManager::Certificate`, `AWS::RDS::*`, `AWS::Lambda::Url`, `ProvisionedConcurrencyConfig`, `ReservedConcurrentExecutions`; tag `project_name=oracle-travis` on every taggable resource; no region literal in `infra/**/*.ts`; every `AWS::SQS::Queue` has a `RedrivePolicy` or is a DLQ with exactly one alarm) and `infra/test/data.test.ts` (Block Public Access ×4, `AES256`, `enforceSSL`, RETAIN, OAC, origin path `/ipfs`, cache TTL 1 y, 404 error TTL 10 s, CORS response-headers policy per contracts/storage.md, bucket policy denies `s3:PutObject` on `ipfs/*` without `s3:if-none-match`, `CountyLensCidCopyWriter` has no Delete/ACL actions, outputs `CidCopyBucketName` and `CID_COPY_HOST`, SSM `/countylens/cid-copy/bucket`) — owns: infra/test/stacks.test.ts, infra/test/data.test.ts · ⏱ 4m · G-A3
- [ ] T018 [metagross] Create `infra`: `package.json`, `cdk.json`, `bin/countylens.ts` instantiating all five stacks with `addDependency` for the order Data → Api → Web → Ops → Cert (AM-02; Api/Web/Ops/Cert as empty stub classes in their own files), `src/config.ts` (Zod; throws if `CDK_DEFAULT_REGION` is missing; `OPERATOR_EMAIL`, GitHub repo/ref context), cdk-nag AwsSolutions with documented suppressions — owns: infra/{package.json,cdk.json,bin/countylens.ts,src/config.ts,src/{api,web,ops,cert}-stack.ts stubs} · ⏱ 4m · G-A3
- [ ] T019 [metagross] Implement `infra/src/data-stack.ts` per contracts/storage.md (bucket, OAC distribution with origin path `/ipfs`, PriceClass_100, cache + response-headers policies, write-guard policy, writer role, `private/bench/*` outside the origin path, outputs + SSM String parameters) — owns: infra/src/data-stack.ts · ⏱ 6m · G-A3
- [ ] T020 [metagross] Write failing `scripts/test/gates.test.ts`: `scripts/grep-gates.sh` fails on reroof terms in `pipeline/oracle-runtime/travis/adapters/**`, on `LIKE '%ROOF%'`-style patterns in `packages/query-core/views.sql`, on `pg|postgres|DATABASE_URL` in `pipeline/publish`; `scripts/bundle-size.ts` fails when gzipped `apps/web/dist/assets/*.js` excluding duckdb chunks > 300 KB — owns: scripts/test/gates.test.ts · ⏱ 3m · G-A6
- [ ] T021 [metagross] Implement `scripts/grep-gates.sh` and `scripts/bundle-size.ts` — owns: scripts/grep-gates.sh, scripts/bundle-size.ts · ⏱ 3m · G-A6
- [ ] T022 [metagross] Write `.github/workflows/ci.yml`: jobs `workspace` (pnpm install, `turbo typecheck lint test synth`, prettier, stylelint, grep gates, bundle gate), `oracle-runtime` (every step of `pipeline-ci.yml` unchanged, every push, no path filter), `gitleaks` (with `.gitleaksignore`), `deploy` (push to `0*` and `feature/oracle-pipeline`, `concurrency: deploy-countylens` never cancelled, GitHub OIDC role from Ops, `cdk deploy --all --require-approval never`), `e2e-hosted` (poll `https://{branch-slug}.{AMPLIFY_APP_ID}.amplifyapp.com/build.json` until `sha == GITHUB_SHA`, 12 min, then Playwright with `RUNTIME_URL`); company shared workflows not used (D-05) — owns: .github/workflows/ci.yml · ⏱ 6m · G-A6
- [ ] T023 [metagross] Create the hosted test harness: `tests/e2e/package.json`, `tests/e2e/playwright.config.ts` (reads `RUNTIME_URL`; throws exactly `RUNTIME_URL must be a hosted URL, not localhost: {value}` for localhost/127.0.0.1/::1), `tests/e2e/lib/runtime.ts` (`/build.json` sha, manifest CID and `runId` from `{RUNTIME_URL}/runs`, config keys `CID_COPY_HOST`, `FILEBASE_GATEWAY_HOST`, `PINATA_GATEWAY_HOST`, `READPATH_PRIVATE_PREFIX`), `tests/e2e/lib/aws.ts` (profile `assess`, region from config), and `tests/e2e/config-guard.spec.ts` (TC-060) — owns: tests/e2e/{package.json,playwright.config.ts,lib/**,config-guard.spec.ts} · ⏱ 4m · G-E1
- [ ] T024 [P] [metagross] ⏳ Write `tests/e2e/build-checks.spec.ts`: step 0 opens `{RUNTIME_URL}/build.json` and asserts local `HEAD` equals the deployed `sha`; then spawns and asserts: TC-001 and TC-002 (`pipeline/publish/test/publish-order.test.ts`), TC-027 (`packages/shared/test/missing-labels.test.ts`), TC-052 (`infra/test/stacks.test.ts`), TC-053 (`infra/test/api.test.ts`) — owns: tests/e2e/build-checks.spec.ts · ⏱ 3m · G-E1

**Checkpoint**: foundation ready; user-story groups can start.

---

## Phase 3: User Story 1 — See the run that published the data (P1) 🎯 MVP

**Goal**: real September 2026 slice captured, published only as `elephant-cli` output, manifest + run index, CID copy, Runs page, `verify-manifest`.

**Independent Test**: open `{RUNTIME_URL}/runs`; see run ID, UTC start/finish, both sources with `records`, manifest CID; `npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json` prints `ALL ARTIFACTS VERIFIED`.

### Tests for User Story 1 (write first, must fail) ⚠️

- [ ] T025 [P] [US1] [oracle] Write failing `pipeline/oracle-runtime/test/travis/socrata-adapter.test.ts`: list query for September 2026 issue dates with the profile's `toSoqlInclude()`, ≤ 50,000 rows per page, one pass; one GET per permit (`?permit_number=…`); receipt fields `url, multiValueQueryString, status, bytes, sha256, captured_at, outcome, ua, attempts`; deterministic `safePermitName` keys, already-captured keys skipped; ≤ 1 request/s including retries; backoff only on 429/5xx (1 s base, 60 s cap, 5 attempts, full jitter); first 403 or challenge → `blocked` receipt, run stops, exit 2; query has no `tcad_id IS NOT NULL`; no reroof terms in adapter files — owns: pipeline/oracle-runtime/test/travis/socrata-adapter.test.ts · ⏱ 3m · G-B1
- [ ] T058 [P] [US3] [oracle] (US3 test, listed here so it is written before T036, the implementation it covers) Write failing `pipeline/oracle-runtime/test/travis/run-month.test.ts`: a captured permit without `tcad_id` is not in `groups/property_improvement`, is counted in the summary as `permits_no_tcad_geoid`, and its parcel is not pulled into `county`; excluded trade sub-permits pull no parcel — owns: pipeline/oracle-runtime/test/travis/run-month.test.ts · ⏱ 2m · G-B1
- [ ] T026 [P] [US1] [oracle] Extend failing `pipeline/publish/test/publish-order.test.ts` (Vitest behind TC-001/TC-002) with the injected `fakeCli`: recorded calls = 2×4 build steps (validate, hash, validate-car, export-tables `--part-size 48m`) then 2×2 uploads (upload-car, upload-tables); a parametrized case fails each of the 12 steps in turn and asserts no later call; no flag or env var can skip a step; `plan()` is identical for 0-row and huge input; CLI pin = 44bb182 asserted; no `--token` and no secret in any recorded argv; no `--atlas-page` — owns: pipeline/publish/test/publish-order.test.ts (renamed from sequence.test.ts) · ⏱ 4m · G-B2
- [ ] T027 [P] [US1] [oracle] Extend failing `pipeline/publish/test/manifest.test.ts`: every artifact CIDv1 with `name, codec, size, sha256`; `directory` and `car` artifacts carry `carCid`; table parts ≤ 50.3 MB; manifest is JCS bytes with no trailing newline and its CID = `cidOfBytes`; `sources[]` order `austin-3syk-w9eu` then `tcad-2026-certified-json`; `coverage.permits_emitted {derivation:"published_rows"}`, `coverage.permits_no_tcad_geoid {derivation:"aggregate_match"}`; `previousManifestCid: null`; `runId` matches `^[a-z0-9][a-z0-9-]*$` and has no "pilot"; `RunsIndexV1` ordered by `finishedAt`; a committed `runs/<runId>/manifest.json` recomputes to the CID in `runs/index.json`; `pipeline/publish/package.json` and `src` contain no `pg`, `postgres`, `@elephant-xyz/query-db`, `DATABASE_URL` — owns: pipeline/publish/test/manifest.test.ts · ⏱ 3m · G-B2
- [ ] T028 [P] [US1] [oracle] Write failing `pipeline/publish/test/{upload,readback,kubo-add}.test.ts` against a fake Kubo RPC: upload root equals hash/export root by `sameDigest`; part count matches; every part GET from `FILEBASE_GATEWAY_HOST` matches size + SHA-256, any mismatch → no manifest; `add?cid-version=1&raw-leaves=true&pin=true` of each `.car` returns the locally computed CID (`carCid`); manifest add CID = `cidOfBytes`; Filebase credentials only in the child env — owns: pipeline/publish/test/{upload,readback,kubo-add}.test.ts · ⏱ 3m · G-B3
- [ ] T029 [P] [US1] [oracle] Write failing `pipeline/publish/test/verify.test.ts` (unit level for TC-040…043): any host other than `PINATA_GATEWAY_HOST`, `FILEBASE_GATEWAY_HOST` (CloudFront, `w3s.link`, `ipfs.io`, `dweb.link`) is refused with exactly `Refused gateway {host}: verify-manifest only uses {PINATA_GATEWAY_HOST}, {FILEBASE_GATEWAY_HOST}`; size or SHA-256 mismatch fails; `car` and `directory` artifacts are fetched by `carCid`; plain GETs (no Range); 429/5xx backoff honours `Retry-After`, 5 attempts; ≤ 2 concurrent per gateway; `ALL ARTIFACTS VERIFIED` only when every artifact matches on both — owns: pipeline/publish/test/verify.test.ts · ⏱ 3m · G-B4
- [ ] T030 [P] [US1] [oracle] Write failing `pipeline/publish/test/cid-copy.test.ts` (mock S3): re-reads each local file and fails if size/SHA-256/CID differ from the manifest; HeadObject same size+sha → skip; different → fail; PutObject with `IfNoneMatch: "*"`, `ChecksumSHA256`, metadata `{cid, sha256}`, `Cache-Control: public, max-age=31536000, immutable`, Content-Type by kind; HeadObject readback with `ChecksumMode`; keys only `ipfs/<cid>`, never `runs/index.json` — owns: pipeline/publish/test/cid-copy.test.ts · ⏱ 3m · G-B4
- [ ] T031 [P] [US1] [metagross] ⏳ Write `tests/e2e/manifest.spec.ts` (TC-003, TC-004, TC-005), `tests/e2e/verify-manifest.spec.ts` (TC-040, TC-041, TC-042, TC-043; spawns `scripts/verify-manifest.ts`, asserts the exact refusal and success texts) and `tests/e2e/cid-copy.spec.ts` (TC-044: every `ipfs/<cid>` object is byte-identical to the manifest artifact, nothing under `ipfs/` except the manifest and its artifacts; overwrite refused; a non-manifest key such as `querydb/` or `capture/` → 403/404) — owns: tests/e2e/{manifest,verify-manifest,cid-copy}.spec.ts · ⏱ 5m · G-E1
- [ ] T032 [P] [US1] [metagross] ⏳ Write `tests/e2e/runs.spec.ts` TC-010, TC-011, TC-012, TC-013, TC-061 (counts read from the manifest at run time, never hard-coded) — owns: tests/e2e/runs.spec.ts · ⏱ 4m · G-E2
- [ ] T033 [P] [US1] [metagross] Write failing `apps/web/test/fetch-by-cid.test.ts` (copy OK → no label; abort, 500, > 4 s → Filebase, label `fallback` + gateway host; both down → exactly `Data could not be reached from the CID copy or the Filebase gateway`; rawCid mismatch rejected) and `apps/web/test/runs.test.tsx` (renders run ID, UTC start/finish, sources in manifest order with `SOURCE_LABELS` + `records`, manifest CID, "Server check" line; counts only from the manifest) — owns: apps/web/test/{fetch-by-cid.test.ts,runs.test.tsx} · ⏱ 3m · G-C3
- [ ] T034 [P] [US1] [metagross] Write failing `infra/test/web.test.ts`: Amplify `CfnApp` platform `WEB`, auto-branch pattern `0*` stage DEVELOPMENT, branch auto-deletion off, `CfnBranch feature/oracle-pipeline` stage PRODUCTION, `AccessToken` = Ref to a parameter with `NoEcho: true`, env `AMPLIFY_MONOREPO_APP_ROOT=apps/web`, `VITE_CID_COPY_HOST`, `VITE_FILEBASE_GATEWAY_HOST`; rules `/api/<*>` → `${httpApiUrl}/<*>` (200) and SPA fallback excluding `wasm|json|js|css|…`; custom headers `*.wasm` `Content-Type: application/wasm` + `Content-Encoding: br`, `/build.json` no-cache; Cert stack: one `AWS::Amplify::Domain` `countylens.aldarraj.com`, sub-domain prefix `''` → `feature/oracle-pipeline`, AMPLIFY_MANAGED certificate, no root-domain association — owns: infra/test/web.test.ts · ⏱ 3m · G-A5

### Implementation for User Story 1

- [ ] T035 [US1] [oracle] Promote `travis/pilot/capture-austin.ts` and `travis/lib/source-client.ts` into `pipeline/oracle-runtime/travis/adapters/socrata/socrata.ts` (generic, `county-permit-adapter` contract: list → per-permit GET → raw + receipt → `status/<key>.json`, StopOnBlocked) and `austin-3syk-w9eu.ts` (domain, dataset, date window, `toSoqlInclude()`); identified UA, no app token; artifacts to `pipeline/data/artifacts/permits/travis/<jobId>/{permit-lists,raw,extracted,status}` — owns: pipeline/oracle-runtime/travis/adapters/socrata/** · ⏱ 6m · G-B1
- [ ] T036 [US1] [oracle] Add `pipeline/oracle-runtime/travis/runs/run-month.ts --month 2026-09` from the stages of `run-pilot.ts` (September slice only): classify with `profiles/travis-austin@1.0.0` only; TCAD subset via `capture-tcad-subset.ts` after checking the certified zip sha256 against `export_sha256` in `pipeline/docs/travis-sources.yaml`, selecting only emitted permits' `tcad_id`s; confidentiality flags before `validate`; permits with no `tcad_id` not emitted and counted; contractor state `contractor_unresolved` with note "Comptroller baseline not loaded (A-07)"; writes `pipeline/data/runs/<runId>/groups/{county,property_improvement}` + summary — owns: pipeline/oracle-runtime/travis/runs/run-month.ts · ⏱ 5m · G-B1
- [ ] T037 [US1] [oracle] Extend `pipeline/publish/src/sequence.ts`: phase 1 (validate → hash `--output-car` → validate CAR → export-tables `--part-size 48m`) for both groups, phase 2 (upload CAR, upload tables, `--api https://rpc.filebase.io --gateway https://ipfs.filebase.io --timeout 300 --output-json`); assert CLI at `node_modules/.bin/elephant-cli` is 44bb182; Filebase keys only in child env; spawn `cwd` = run dir; `reports/sequence.json` without secrets — owns: pipeline/publish/src/sequence.ts · ⏱ 5m · G-B2
- [ ] T038 [US1] [oracle] Update `pipeline/publish/src/manifest.ts` (no `PILOT_LIMITATION`, sources order, coverage counts with derivations, `carCid` on `car` and `directory` artifacts, fail on dirty tree) and add `src/runs-index.ts` (RunsIndexV1, JCS) — owns: pipeline/publish/src/{manifest,runs-index}.ts · ⏱ 5m · G-B2
- [ ] T039 [US1] [oracle] Add `pipeline/publish/src/{upload,readback,kubo-add}.ts` and `src/cli.ts` (`build`, `upload`, `cid-copy` subcommands per contracts/cli.md; `build` prints roots, part counts, sizes, SHA-256s and the list of files that would go public); export from `src/index.ts` — owns: pipeline/publish/src/{upload,readback,kubo-add,cli,index}.ts · ⏱ 8m · G-B3
- [ ] T040 [US1] [oracle] Implement `pipeline/publish/src/verify.ts` and `scripts/verify-manifest.ts` (gateways from `PINATA_GATEWAY_HOST` = `gateway.pinata.cloud`, `FILEBASE_GATEWAY_HOST` = `ipfs.filebase.io`; streamed SHA-256 capped at size+1; 120 s timeout; one line per artifact per gateway; exact texts from T029) — owns: pipeline/publish/src/verify.ts, scripts/verify-manifest.ts · ⏱ 6m · G-B4
- [ ] T041 [US1] [oracle] Implement `pipeline/publish/src/cid-copy.ts` (bucket from SSM `/countylens/cid-copy/bucket`, region from config, profile `assess-cid-writer`) and add `@aws-sdk/client-s3`, `@aws-sdk/client-ssm` to `pipeline/publish/package.json` — owns: pipeline/publish/src/cid-copy.ts, pipeline/publish/package.json · ⏱ 5m · G-B4
- [ ] T042 [US1] [metagross] Implement the Runs page: `apps/web/src/data/runs-index.ts` (fetch `/runs/index.json`, `RunsIndexV1`, latest run), `src/data/manifest.ts` (rawCid check, `RunManifestV1`), `src/data/fetch-by-cid.ts` (CID copy first; fallback on error, non-200 or > 4 s; both-down text verbatim), `src/components/FallbackChip.tsx` (`fallback` + host), `src/routes/Runs.tsx` (run ID, UTC start/finish, sources with `SOURCE_LABELS` + `records`, manifest CID, "Server check" from `runs.summary` via `@countylens/api-client`), Atlas tokens only — owns: apps/web/src/{data/**,components/FallbackChip.*,routes/Runs.*} · ⏱ 8m · G-C3
- [ ] T043 [US1] [metagross] Implement `infra/src/web-stack.ts` (L1 `CfnApp`/`CfnBranch` per T034, `GitHubAccessToken` `CfnParameter` noEcho, env and custom rules/headers) and `infra/src/cert-stack.ts` (`CfnDomain` only) — owns: infra/src/{web,cert}-stack.ts · ⏱ 6m · G-A5
- [ ] T044 [US1] [metagross] Write `amplify.yml` (`appRoot: apps/web`, Node 22, `pnpm install --frozen-lockfile --filter @countylens/web...`, copy `runs/index.json` to `apps/web/public/runs/index.json`, write `public/build.json` `{sha: $AWS_COMMIT_ID, branch: $AWS_BRANCH}`, run `scripts/compress-wasm.ts` after build) — owns: amplify.yml · ⏱ 3m · G-A5
- [ ] T045 [US1] [oracle] Early read-only review of the publish track (adapter, sequence, manifest, upload/readback, cid-copy, verify) against P0-1/2/3, A6 and the tests; findings in `docs/reviews/CR-A-03.md` § "Early review: publish"; fixes before 🛑 D-8 — owns: docs/reviews/CR-A-03.md · ⏱ 8m · G-R1
- [ ] T046 [US1] [oracle] **Long run (background)**: `npx tsx travis/runs/run-month.ts --month 2026-09` (polite: ≤ 50,000 rows/page, one pass, ≤ 1 req/s, stop on 403) then `cli.ts build --run <runId>` (phase 1, both groups); append the D-8 summary (captured/accepted/excluded/emitted/no-tcad, roots, part sizes, SHA-256, the exact list of files that would go public) to `specs/003-walking-skeleton/run-log.md` — owns: `pipeline/data/runs/<runId>/` (gitignored), specs/003-walking-skeleton/run-log.md · ⏱ 8m · G-B5
- [ ] T047 [US1] [oracle] 🛑 **D-8 GATED** — first public upload: `set -a; . ~/.config/assessment/filebase.env; set +a`; `cli.ts upload --run <runId>` (CAR + tables per group, readback, `carCid` adds, manifest add); write `runs/<runId>/manifest.json` (JCS bytes) and `runs/index.json` only after readback passes; record roots and CIDs in `docs/evidence/A-03.md` — owns: runs/**, docs/evidence/A-03.md · ⏱ 12m · G-B6
- [ ] T048 [US1] [metagross] Wire the Runs and Permits pages to the real run: confirm `runs/index.json` is copied at build and the pages resolve the real manifest CID through the copy/fallback (no fixture or prototype values anywhere in `apps/web/src`) — owns: apps/web/src/data/runs-index.ts · ⏱ 3m · G-C5
- [ ] T049 [US1] [oracle] 🛑 **D-10 GATED** (needs `CountyLensData` from TZ02): `cli.ts cid-copy --manifest runs/<runId>/manifest.json` with profile `assess-cid-writer`; readback log to `docs/evidence/A-03.md` — owns: docs/evidence/A-03.md (CID-copy section) · ⏱ 5m · G-B7
- [ ] T050 [US1] [metagross] [PO] Track D, after TZ02: PO adds the two Namecheap CNAMEs from `aws amplify get-domain-association --profile assess` (✋ A-4); wait for `AVAILABLE`; check TLS on `https://countylens.aldarraj.com/runs`; evidence names which URL the hosted tests used (FR-010) — owns: docs/evidence/A-03.md (hosted URL section) · ⏱ 15m (mostly DNS wait, off the critical path) · G-D1

**Checkpoint**: US1 works on the hosted URL (TC-010…013, 040…044, 061).

---

## Phase 4: User Story 2 — List the published permits in the browser, with provenance (P1)

**Goal**: Permits list over DuckDB-WASM (range reads, Brotli WASM) with provenance and labelled missing reasons.

**Independent Test**: open `{RUNTIME_URL}/permits`; rows = `coverage.permits_emitted`; engine line exact; no blank absent field.

### Tests for User Story 2 (write first, must fail) ⚠️

- [ ] T051 [P] [US2] [metagross] ⏳ Write `tests/e2e/permits.spec.ts` TC-020, TC-021, TC-022, TC-023 (engine line exactly `DuckDB-WASM in your browser · read-only`; no request to any API/database for rows), TC-024, TC-025, TC-026 (206 range requests to `CID_COPY_HOST`), TC-028 (`duckdb-eh.wasm` served with `Content-Encoding: br`) — owns: tests/e2e/permits.spec.ts · ⏱ 6m · G-E2
- [ ] T052 [P] [US2] [metagross] ⏳ Write `tests/e2e/fallback.spec.ts` TC-032 (abort), TC-033 (500), TC-034 (> 4 s delay) with `page.route` on `CID_COPY_HOST` on the hosted page (no debug flag in production); asserts `fallback` + `FILEBASE_GATEWAY_HOST` — owns: tests/e2e/fallback.spec.ts · ⏱ 3m · G-E2
- [ ] T053 [US2] [metagross] Write failing `apps/web/test/{permits-state.test.ts,missing-reason.test.tsx,provenance.test.tsx,duckdb-config.test.ts}`: table renders only in `ready`; progress bar with stage text in `loading`; row count ≠ `coverage.permits_emitted` → error banner; `<MissingReason/>` shows `missingLabel(field, reason)` and never a blank; `<Provenance/>` shows source URL, capture time, table CID, run; `db.open` flags exactly `{ allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false }` — owns: apps/web/test/{permits-state.test.ts,missing-reason.test.tsx,provenance.test.tsx,duckdb-config.test.ts} · ⏱ 3m · G-C4

### Implementation for User Story 2

- [ ] T054 [US2] [metagross] Implement `apps/web/src/engine/duckdb-wasm.ts` (dynamic `import()`, self-hosted eh bundle, flags from T053, `bindManifest(..., {partUrl})` → `copyUrl`/fallback) and add `@duckdb/duckdb-wasm@1.33.1-dev57.0` to `apps/web/package.json` — owns: apps/web/src/engine/**, apps/web/package.json · ⏱ 4m · G-C4
- [ ] T055 [US2] [metagross] Implement render-only `src/components/{Provenance,MissingReason,EngineLine,LinearProgress}.tsx` + `.module.css` (Atlas tokens only; EngineLine text verbatim) — owns: apps/web/src/components/{Provenance,MissingReason,EngineLine,LinearProgress}.* · ⏱ 4m · G-C4
- [ ] T056 [US2] [metagross] Implement `apps/web/src/routes/Permits.tsx` (state machine, `listRoofingPermitsSql()`, cards at 390 px, table at 768/1440 px, fallback chip, count check) — owns: apps/web/src/routes/Permits.* · ⏱ 4m · G-C4
- [ ] T057 [US2] [metagross] Add `apps/web/scripts/compress-wasm.ts` (Brotli level 11 of `duckdb-eh.wasm` in `dist/`, keeps the file name so the `Content-Encoding: br` header applies) — owns: apps/web/scripts/compress-wasm.ts · ⏱ 2m · G-C4

**Checkpoint**: US2 works on the hosted URL (TC-020…028, 032…034).

---

## Phase 5: User Story 3 — Know what was left out, and why (P1)

**Goal**: the no-`tcad_id` permit is not published and is counted on Runs.

**Independent Test**: Runs shows "No TCAD id on source record" = `coverage.permits_no_tcad_geoid.count`.

- T058 (`run-month.test.ts`, `[US3]`) is listed in Phase 3's test block so it precedes T036, the implementation it covers (G-B1 order: T025 → T058 → T035 → T036).
- [ ] T059 [P] [US3] [metagross] ⏳ Add TC-031 to `tests/e2e/runs.spec.ts` and TC-030 to `tests/e2e/permits.spec.ts` — owns: tests/e2e/{runs,permits}.spec.ts (same group as T032/T051) · ⏱ 2m · G-E2
- [ ] T060 [US3] [metagross] Add the coverage row to `apps/web/src/routes/Runs.tsx`: `COVERAGE_LABELS.permits_no_tcad_geoid` ("No TCAD id on source record") with `coverage.permits_no_tcad_geoid.count` and its derivation label (test first in `apps/web/test/runs.test.tsx`) — owns: apps/web/src/routes/Runs.*, apps/web/test/runs.test.tsx · ⏱ 2m · G-C3

(Implementation of the count itself is in T036 and T038.)

---

## Phase 6: User Story 4 — Trust the read path at full scale (P1)

**Goal**: radius and roof-age on the Lambda DuckDB fallback with in-region p95 < 3 s over 20 direct invocations on a private copy (deleted after); browser first load and COUNT within NFR-001; gateway legs on our own CIDs.

**Independent Test**: `docs/evidence/A-03.md` has the 20-run p50/p95 table, the private copy's deletion, and `docs/decisions/0001-read-path.md` has the spike numbers and the D-8 gateway legs.

- [ ] T061 [P] [US4] [metagross] ⏳ Write `tests/e2e/perf.spec.ts` (TC-NF-01, TC-NF-02: 20 runs, p95 to evidence), `tests/e2e/lambda-fallback.perf.spec.ts` (TC-NF-05 exactly as in the test plan: upload to `READPATH_PRIVATE_PREFIX`, 403/404 on `https://{CID_COPY_HOST}/{private key}` and on the public API, 20 direct invocations each for radius and roof-age with the `TC_NF_05` preset via `scripts/bench-lambda.ts`, p95 < 3,000 ms, delete, `head-object` → 404 recorded) and `tests/e2e/read-path-record.spec.ts` (TC-NF-06) — owns: tests/e2e/{perf,lambda-fallback.perf,read-path-record}.spec.ts · ⏱ 5m · G-E3
- [ ] T062 [P] [US4] [metagross] Write failing `apps/api/test/query.test.ts`: `query.radius` / `query.roofAge` Zod bounds (`lat` −90…90, `lon` −180…180, `miles` (0, 25], `limit` 1…1000 default 500, `minYears` 1…100), `as_of` = manifest `finishedAt`, ≤ 1,000 rows — owns: apps/api/test/query.test.ts · ⏱ 3m · G-C2a
- [ ] T063 [P] [US4] [metagross] Write failing `apps/api/test/bench.test.ts`: bench event Zod (`kind:"bench"`, `query ∈ {count, radius, roofAge}`, `preset ∈ {TC_NF_05, ADR_0001}`, `prefix` matches `^private/bench/[a-z0-9-]+/$`); an API Gateway event carrying `kind` is rejected; `scripts/bench-lambda.ts` refuses a prefix outside `READPATH_PRIVATE_PREFIX` — owns: apps/api/test/bench.test.ts · ⏱ 3m · G-C2b
- [ ] T064 [US4] [metagross] Implement `apps/api/src/routers/query.ts` (`query.radius`, `query.roofAge` per contracts/api.md) and register in `src/routers/index.ts` — owns: apps/api/src/routers/{query,index}.ts · ⏱ 3m · G-C2a
- [ ] T065 [US4] [metagross] Implement `apps/api/src/handlers/bench.ts` (direct-invoke branch called from `trpc.ts`: list parts under the prefix, presign, run `bench-sql.ts` on the same engine; returns `{query, rows, queryDurationMs, initMs, coldStart}`) and `scripts/bench-lambda.ts` (20 direct invocations per query and preset, p50/p95 from each response's `queryDurationMs`; used by `tests/e2e/lambda-fallback.perf.spec.ts`) — owns: apps/api/src/handlers/bench.ts, scripts/bench-lambda.ts · ⏱ 5m · G-C2b
- [ ] T066 [US4] [metagross] 🛑 **D-10 GATED** (needs Data + Api stacks from TZ02): run `RUNTIME_URL=… npx playwright test -g "A-03-TC-NF-05"` early (the spec itself uploads `pipeline/data/raw/austin-parquet/v48m/` to `READPATH_PRIVATE_PREFIX`austin-48m/, checks 403/404 on CloudFront, runs `scripts/bench-lambda.ts` for count, radius and roof-age with the `TC_NF_05` preset and once more with the `ADR_0001` preset, deletes the object and records the `head-object` 404). Copy the 20-run timings into `docs/evidence/A-03.md` and the A-03 section of `docs/decisions/0001-read-path.md`. If a p95 ≥ 3 s, apply the two-step query (research R-03) and re-run; full-size COUNT p95 is recorded too (see plan § Read-path scope) — owns: docs/evidence/A-03.md (Lambda proof section), docs/decisions/0001-read-path.md (A-03 section) · ⏱ 12m · G-C7
- [ ] T067 [US4] [oracle] After 🛑 D-8: re-measure the gateway legs on this run's own CIDs (plain GET, Range, CORS, TTFB, SHA-256 on Filebase and Pinata; DuckDB-WASM range reads through Filebase on one real table part) and fill the "Pending D-8" lines of `docs/decisions/0001-read-path.md` (D-3 option c) — owns: docs/decisions/0001-read-path.md · ⏱ 8m · G-B8

---

## Phase 7: User Story 5 — Operate the hosted API with evidence (P2)

**Goal**: one hosted `runs.summary` call → one JSON log line with correlation ID, one X-Ray trace with `duckdb.query`, one `QueryDurationMs`; retention 14/30 d; alarms → SNS email; $10 budget.

**Independent Test**: TC-050, TC-051, TC-052, TC-053, TC-NF-04 pass; trace ID in `docs/evidence/A-03.md`.

- [ ] T068 [P] [US5] [metagross] ⏳ Write `tests/e2e/observability.spec.ts` (TC-050, TC-051, TC-NF-04: 30 warm calls p95 < 1 s from `QueryDurationMs`; forced cold start via env change < 3 s incl. DuckDB init) and `tests/e2e/responsive.spec.ts` (TC-NF-03 with smeargle `responsive-design-tests` at 390/768/1440, Atlas tokens only) — owns: tests/e2e/{observability,responsive}.spec.ts · ⏱ 7m · G-E3
- [ ] T069 [US5] [metagross] Write failing `infra/test/api.test.ts` (TC-053 and: arm64, `MemorySize 1769`, `Timeout 15`, `TracingConfig Active`, `LoggingConfig.LogFormat JSON`, `SystemLogLevel WARN`, function log group 14 d, HTTP API access log group 30 d with JSON format, stage throttle 10 rps / burst 20, `AWS::XRay::SamplingRule` FixedRate 1 for `countylens-api`, no Function URL, no reserved/provisioned concurrency, asset contains the linux-arm64 DuckDB binary and the `httpfs` extension) and add Ops assertions to `infra/test/stacks.test.ts` (budget 10 USD with 80 % actual + 100 % forecast notifications; every alarm has `AlarmActions` and `OKActions` → the SNS topic and `TreatMissingData notBreaching`; email subscription from `OPERATOR_EMAIL`, not in git) — owns: infra/test/{api,stacks}.test.ts · ⏱ 4m · G-A4
- [ ] T070 [US5] [metagross] Write failing `apps/api/test/runs.test.ts`: `runs.summary` input `CidV1` (else `BAD_REQUEST`); key absent → `NOT_FOUND`; bytes whose rawCid ≠ input → `INTERNAL_SERVER_ERROR`; output `{manifestCid, verified, tablesBound, roofingPermitRows, queryDurationMs}` — owns: apps/api/test/runs.test.ts · ⏱ 3m · G-C2a
- [ ] T071 [US5] [metagross] Write failing `apps/api/test/observability.test.ts`: exactly one `logger.info` per request with `correlation_id` and a `queryDurationMs` field (TC-NF-05 reads it); subsegment `duckdb.query` with annotations `manifestCid`, `query`; metrics `QueryDurationMs` (ms), `ItemsProcessed` (rows returned) and `ItemsFailed` (failed queries), dimension `procedure` (constitution VIII business metrics); response headers `x-correlation-id`, `x-trace-id` — owns: apps/api/test/observability.test.ts · ⏱ 3m · G-C2b
- [ ] T072 [US5] [metagross] Implement `apps/api/src/engine/duckdb-node.ts` (module-scope instance, `threads = 2`, bundled `httpfs` via `extension_directory`, remote autoinstall off, views bound once per manifest CID), `src/s3-read.ts` (manifest GET + rawCid check, `/tmp` manifest cache, presigned `ipfs/<cid>` part URLs) and `src/routers/runs.ts` (`runs.summary`) — owns: apps/api/src/{engine/**,s3-read.ts,routers/runs.ts}, apps/api/package.json · ⏱ 7m · G-C2a
- [ ] T073 [US5] [metagross] Implement `apps/api/src/observability.ts` and `src/handlers/trpc.ts` (middy: `injectLambdaContext` with `correlationIdSearchFn: search` + `correlationPaths.API_GATEWAY_HTTP`, `captureLambdaHandler`, `logMetrics({captureColdStartMetric: true})`; emits `QueryDurationMs`, `ItemsProcessed`, `ItemsFailed`; routes bench events to `bench.ts`; sets `x-correlation-id`, `x-trace-id`) — owns: apps/api/src/{observability.ts,handlers/trpc.ts} · ⏱ 4m · G-C2b
- [ ] T074 [US5] [metagross] Implement `infra/src/api-stack.ts`: `NodejsFunction` arm64, 1,769 MB, 15 s, no reserved concurrency, `@duckdb/*` external + `afterBundling` `npm install --prefix <out> --os=linux --cpu=arm64 --libc=glibc @duckdb/node-api@1.5.6-r.2` + httpfs extension copy; env `CID_COPY_BUCKET`, `CID_COPY_HOST`, `FILEBASE_GATEWAY_HOST`, `READPATH_PRIVATE_PREFIX`; S3 read on `ipfs/*` and `private/bench/*`; HTTP API + stage throttles + JSON access log 30 d; log group 14 d; `CfnSamplingRule` — owns: infra/src/api-stack.ts · ⏱ 6m · G-A4
- [ ] T075 [US5] [metagross] Implement `infra/src/ops-stack.ts`: SNS topic + email subscription (`OPERATOR_EMAIL`), alarms Lambda `Errors ≥ 1/5 min`, `Throttles ≥ 1`, HTTP API `5xx ≥ 1` (ALARM + OK actions, notBreaching), `CfnBudget` 10 USD, GitHub OIDC provider + deploy role (trust: the fork's `0*` and `feature/oracle-pipeline` refs; may assume only `cdk-hnb659fds-*` roles) — owns: infra/src/ops-stack.ts · ⏱ 5m · G-A4

---

## Phase N: Integration & cross-cutting

- [ ] T076 [metagross] `pnpm --filter @countylens/infra exec cdk synth` (all green, cdk-nag clean) and `cdk diff --profile assess` for all five stacks; write the 🛑 D-10 summary (what each stack creates, nothing that bills while idle, region `eu-north-1` from the profile, deploy order Data → Api → Web → Ops → Cert) to `specs/003-walking-skeleton/run-log.md` — owns: specs/003-walking-skeleton/run-log.md (D-10 section) · ⏱ 5m · G-A7
- [ ] T077 [metagross] Early read-only review of the app, API and infra (layout, api-client, banned resources, Powertools, Atlas-only CSS) → `docs/reviews/CR-A-03.md` § "Early review: app" — owns: docs/reviews/CR-A-03.md (app section) · ⏱ 8m · G-R2
- [ ] T078 [metagross] After the first green `ci.yml` run on the branch: record step parity of the `oracle-runtime` job vs `pipeline-ci.yml` in `docs/evidence/A-03.md`, then delete `.github/workflows/pipeline-ci.yml` — owns: .github/workflows/pipeline-ci.yml, docs/evidence/A-03.md (CI section) · ⏱ 3m · G-A8
- [ ] T079 [metagross] Run the [quickstart.md](quickstart.md) steps 1 and 5 against the hosted URL and note any drift in `docs/evidence/A-03.md` — owns: docs/evidence/A-03.md (quickstart section) · ⏱ 5m · G-Z

---

## Phase Z: Prove on the hosted runtime (mandatory, always last)

**Purpose**: Constitution I, XVI, XXII. The story is not done until these pass.

- [ ] TZ01 Run the reviewer agents from the story front matter (`metagross`, `oracle`) read-only; record scores in docs/reviews/CR-A-03.md (each ≥ 75 or justified; 🛑 D-9 only if needed)
- [ ] TZ02 🛑 **D-10 GATED** Deploy to the hosted runtime: from the PO laptop with profile `assess`, `cdk deploy` in order `CountyLensData` → `CountyLensApi` → `CountyLensWeb` (with `GitHubAccessToken` from SSM `/countylens/github/amplify-access-token`, typed by the PO) → `CountyLensOps` → `CountyLensCert`; push `003-walking-skeleton` to the fork so CI runs and Amplify builds the branch preview; record the URL and `/build.json` SHA in docs/evidence/A-03.md (⏱ 25m deploy + ~10m Amplify build)
- [ ] TZ03 Run the Playwright scenario tests (one per TC in testplans/A-03-test-cases.md, tagged @scenario:A-03-TC-nnn) against RUNTIME_URL; screenshots to docs/evidence/img/ (⏱ 15m)
- [ ] TZ04 [UI stories] Run smeargle responsive-design-tests at 390 / 768 / 1440 on the hosted URL (Runs and Permits) (⏱ 10m)
- [ ] TZ05 Run the story's `agents.verify` check: `npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json` → `ALL ARTIFACTS VERIFIED` on Pinata + Filebase, output in docs/evidence/A-03.md (⏱ 10m)
- [ ] TZ06 Write docs/reports/TR-A-03.md, docs/evidence/A-03.md, the docs/traceability.md row and one docs/kit-usage.md line (⏱ 10m)

---

## Requirement coverage (spec FR/NFR → tasks → G6 TCs)

| Requirement | Tasks | TCs |
| --- | --- | --- |
| FR-001 publish sequence, manifest, carCid, index | T025–T028, T035–T039, T046, T047 | TC-001…005 |
| FR-002 Runs page | T032, T042, T048, T060 | TC-010…013 |
| FR-003 Permits over DuckDB-WASM | T051, T053–T056 | TC-020, 021, 023, 026 |
| FR-004 read-path measurement + fallback proof | T011, T014, T054, T057, T061, T063, T065, T066, T067 | TC-028, NF-01, NF-02, NF-05, NF-06 |
| FR-005 labels, no-tcad_id, fallback (error / non-200 / > 4 s) | T033, T036, T042, T052, T058–T060 | TC-022, 030…034 |
| FR-006 verify-manifest (Pinata + Filebase) | T029, T031, T040, TZ05 | TC-040…043 |
| FR-007 observability, retention, alarms, budget | T017, T068–T075 | TC-050…053, NF-04 |
| FR-008 progress bar, no empty table | T053, T056 | TC-024 |
| FR-009 counts only from the manifest | T032, T042, T053 | TC-011, 012, 031 |
| FR-010 hosted URL in evidence, no localhost | T023, T050, TZ02 | TC-060, 061 |
| FR-011 21/21 labels | T015, T016, T055 | TC-022, 025, 027 |
| FR-012 CID copy = CLI output only, immutable | T017, T019, T030, T041, T049 | TC-044, NF-05 |
| FR-013 public, read-only (no sign-in, no controls) | T042, T056 | TC-010, 020 |
| NFR-001…004 | T061, T066, T068, T069, T074, T075, TZ04 | NF-01…05 |

## Dependencies & Execution Order

### Phase dependencies

- Setup (Phase 1) → Foundational (Phase 2) → user stories. US1 publication (Track B) and the app (Tracks A/C) run in parallel; US2 needs US1's manifest for real rows; US3 rides on US1 (T036/T038) and the Runs page; US4 and US5 need the API scaffold; Phase Z after all.
- Gates: G5 (🛑 D-6) and G6 (🛑 D-7) before `/speckit-implement`; 🛑 D-8 before T047 (and so T048, T049, T067); 🛑 D-10 before TZ02 (and so T049, T050, T066, T078, TZ03–TZ05).

### Waves (task groups whose prerequisites are met run together)

Shared-file owners per wave: root `package.json`, `pnpm-workspace.yaml`, `eslint.config.js` → G-A1 (W1) only; `packages/query-core` → G-C0 (W1) only; `packages/contract` → nobody (frozen); `pipeline/publish/package.json` → G-B4 (W2); `apps/web/package.json` → G-A2 (W2), G-C4 (W3); `apps/api/package.json` → G-A2 (W2), G-C2a (W3); `pipeline/publish/src/index.ts` → G-B3 (W2); `tests/e2e/runs.spec.ts`, `permits.spec.ts` → G-E2 (W3); `infra/test/stacks.test.ts` → G-A3 (W2), G-A4 (W3); `docs/reviews/CR-A-03.md` → G-R1 (W3), G-R2 (W4); `docs/evidence/A-03.md` sections → one group per section.

| Wave | Prerequisites | Groups (builder · tasks · ≈ min) |
| --- | --- | --- |
| **W1** | G5 + G6 approved | G-A1 [metagross] T001–T005 · 14 · G-C0 [metagross] T010–T014 · 17 · G-C1 [metagross] T015–T016 · 8 · G-B1 [oracle] T025, T058, T035, T036 · 16 · G-B2 [oracle] T026, T027, T037, T038 · 17 |
| **W2** | W1 | G-A2 [metagross] T006–T009 · 15 · G-A3 [metagross] T017–T019 · 14 · G-A6 [metagross] T020–T022 · 12 · G-B3 [oracle] T028, T039 · 11 · G-B4 [oracle] T029, T030, T040, T041 · 17 · G-E1 [metagross] T023, T024, T031 · 12 ⏳ |
| **W3** | W2 | G-C2a [metagross] T062, T064, T070, T072 · 16 · G-C2b [metagross] T063, T065, T071, T073 · 15 · G-C3 [metagross] T033, T042, T060 · 13 · G-C4 [metagross] T053–T057 · 17 · G-A4 [metagross] T069, T074, T075 · 15 · G-A5 [metagross] T034, T043, T044 · 12 · G-E2 [metagross] T032, T051, T052, T059 · 15 ⏳ · G-B5 [oracle] T046 **long run** (needs `cli.ts` from G-B3) · 8 · G-R1 [oracle reviewer] T045 · 8 |
| — | 🛑 **D-8** (asked when G-R1 and G-B5 are done) | PO approves the first public upload |
| **W4** | D-8, W3 | G-B6 [oracle] T047 · 12 · G-A7 [metagross] T076 · 5 · G-R2 [metagross reviewer] T077 · 8 · G-E3 [metagross] T061, T068 · 12 ⏳ |
| **W5** | G-B6 | G-C5 [metagross] T048 · 3 · G-B8 [oracle] T067 · 8 |
| — | 🛑 **D-10** (asked with the T076 diff) | PO approves first deploy + push |
| **W6** | D-10, W5 | TZ02 deploy + push (Amplify build and CI run in the background) · 35 |
| **W7** | TZ02 | G-B7 [oracle] T049 · 5 · G-C7 [metagross] T066 · 12 · G-D1 [metagross + PO] T050 · 15 (DNS wait) · G-A8 [metagross] T078 · 3 (after CI green) · TZ01 reviewers · 15 |
| **W8** | G-B7, G-C7 | TZ03 · 15 · TZ04 · 10 · TZ05 · 10 (parallel) |
| **W9** | W8 | TZ06 + G-Z T079 · 10 |

Groups per wave: W1 5 · W2 6 · W3 9 · W4 4 · W5 2 · W6 1 · W7 5 · W8 3 · W9 2.

### Critical path

`W1 (G-B2, 17) → W2 (G-B4, 17) → W3 (G-C4, 17; the capture/CLI long run G-B5 and the publish review G-R1 finish inside it) → 🛑 D-8 (≈ 8, round R6) → W4 (G-B6 upload + readback, 12) → W5 (G-C5, 3) → 🛑 D-10 + TZ02 (deploy 25 + Amplify build 10) → W7 (G-B7 CID copy, 5) → W8 (TZ03, 15) → W9 (TZ06, 10)` = **17 + 17 + 17 + 8 + 12 + 3 + 35 + 5 + 15 + 10 = 139 min**, excluding PO think time beyond the estimates. Off the critical path: the domain wait (G-D1), the Lambda proof (G-C7, runs beside G-B7 and must finish before TZ03's TC-NF-05), the gateway re-measure (G-B8), CI parity (G-A8).

### Written while long runs go (⏳)

- During W2 (ahead of the capture): T023, T024, T031 (G-E1).
- During the Austin capture + elephant-cli build (G-B5, W3): T032, T051, T052, T059 (G-E2).
- During the D-8 wait and the Filebase upload (W4): T061, T068 (G-E3).
- During TZ02 (deploy, Amplify build, CI): TZ01 drafting and the evidence skeleton for TZ06.

### Parallel example (W1)

```text
metagross: G-A1 scaffold          | metagross: G-C0 query-core | metagross: G-C1 shared labels
oracle:    G-B1 Socrata adapter   | oracle:    G-B2 sequence + manifest
```

## Implementation Strategy

1. MVP = US1 (publication + Runs page + verify-manifest) on the branch URL; it is the D-2 demo line.
2. Add US2 (Permits) and US3 (coverage row) in the same deploy; then US4 proof and US5 evidence on the deployed stacks.
3. Never mark a task done on localhost; Phase Z is the definition of done.

## Notes

- Commit messages start with `A-03:`; never commit to `main`; no auto-commit hooks.
- No fixture, sample or prototype values in `apps/web/src`; unit tests build their own in-test data and never ship it.
- Any hosted test failure → `docs/defects/ERR-{n}.md`.
