# tests/e2e: the hosted Playwright harness (A-03)

Runs only against the hosted runtime. `localhost` is never evidence (constitution I).

```bash
RUNTIME_URL=https://<branch>.<appId>.amplifyapp.com pnpm --filter @countylens/e2e exec playwright test
RUNTIME_URL=… pnpm --filter @countylens/e2e exec playwright test -g "A-03-TC-044"   # one case
pnpm --filter @countylens/e2e test                                                   # harness unit tests (Vitest)
```

## Conventions

- **One test per G6 test case**, in the spec file `testplans/A-03-test-cases.md` § 7 names, titled
  exactly `@scenario:A-03-TC-nnn` (the describe block carries the human title). `--list` shows every
  case; `-g "A-03-TC-nnn"` runs one.
- **`RUNTIME_URL` guard** (`lib/runtime-url.ts`, TC-060): loading `playwright.config.ts` throws
  `RUNTIME_URL must be a hosted URL, not localhost: {value}` for localhost, `127.0.0.1`, `::1`, and
  `RUNTIME_URL is not set; set it to the hosted URL` when unset or blank.
- **`@needs-aws`** (`lib/needs-aws.ts`): a case that uses an AWS profile through `lib/aws.ts`
  (TC-044, TC-050, TC-NF-05 and similar) adds `@needs-aws` to its title. The `e2e-hosted` CI job
  has only `RUNTIME_URL`, so under `CI` without AWS credentials the config excludes those cases
  with `grepInvert` and prints a notice: they are not run and never reported as passed. Run them
  from an operator session with the `assess` profile (`assess-cid-writer` only for the TC-044
  overwrite attempt). The region comes from the profile configuration, never a literal (P0-18).
- **Step 0**: published-data cases import `test` from `./lib/fixtures.js`, whose worker fixture
  `run` opens `{RUNTIME_URL}/runs`, reads the manifest CID and runId from the run card's `data-cid`
  (never the truncated text), fetches the manifest by CID (CID copy first, Filebase gateway as the
  fallback) and validates `RunManifestV1`. Build-time cases open `{RUNTIME_URL}/build.json` and
  require the local `HEAD` to equal the deployed `sha` (`build-checks.spec.ts`).
- **Config keys** (environment): `CID_COPY_HOST` (the CloudFront domain; required by the specs
  that read the copy directly), `FILEBASE_GATEWAY_HOST` (`ipfs.filebase.io`), `PINATA_GATEWAY_HOST`
  (`gateway.pinata.cloud`), `READPATH_PRIVATE_PREFIX` (`private/bench/`).
- **Evidence**: every spawned command's output is attached to the test (`test-results/`, HTML
  report in `playwright-report/`, JSON in `test-results/results.json`).
- Specs never pass trivially: no `test.skip`, no empty bodies; a suite that selects zero tests is
  a failure.
