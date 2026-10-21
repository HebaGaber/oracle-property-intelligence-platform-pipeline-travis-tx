---
id: CR-A-03
type: code-review-log
story: A-03
branch: 003-walking-skeleton
reviewed_commit: 071eb1b (early review, publish track, W1–W2)
tools: [soofi-xyz-team-kit:oracle]        # /code-review and the other reviewer agents are added before G7; /code-review ultra once per repo before G8
created: 2026-10-21
---

# Code Review Log: A-03 Walking skeleton

Run `/code-review` (with `--fix` if you want it to apply fixes) on the story branch before the G7 pre-check. Record every finding. Run `/code-review ultra` once per repo, on the feature branch, before G8. It runs in the cloud and uses paid credits, so you have to start it yourself.

## Runs

| Run | Tool | Effort | Date | Commit | Findings | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `soofi-xyz-team-kit:oracle` (read-only, early review of the publish track; W3 G-R1 T045) | n/a | 2026-10-21 | `071eb1b` | 13 (0 Critical, 2 Major, 10 Minor, 1 note) | **84 / 100** (pass) |
| 2 | `/code-review` | {high} | {date} | `{sha}` | {n} | n/a |

## Findings

OR-n = oracle reviewer (run 1). Later runs append their own prefixes (CR-n, DP-n, …).

| # | Severity | File:line | Finding | Resolution | Commit |
| --- | --- | --- | --- | --- | --- |
| OR-1 | Major (before D-8) | `pipeline/publish/src/sequence.ts:434`, `pipeline/publish/src/upload.ts:228`, `pipeline/publish/src/cli.ts:206-222` | The D-8 approval artifact is not pinned: `build` prints roots, sizes and SHA-256s to stdout only; `upload` re-runs phase 1 (`hash` fetches the live lexicon) and overwrites `reports/sequence.json`, and nothing compares the re-made phase-1 outputs with what the PO approved. The first public upload is the one irreversible act (published CIDs never change). | Open | — |
| OR-2 | Major (before G7) | `pipeline/publish/test/publish-order.test.ts:251-268`, `pipeline/publish/src/sequence.ts:501`, `tests/e2e/build-checks.spec.ts:68-82` | G6-approved TC-002(b) ("calls `upload` before `export-tables` → an out-of-order error naming both steps") is not asserted anywhere; only sub-case (a) is. The harness passes on any test name matching `/skip\|fail/`. The orchestrator has a one-sided guard (`upload-tables` only). | Open | — |
| OR-3 | Minor | `pipeline/publish/src/sequence.ts:450-457` | The six CAR check counts the pinned CLI prints ("CAR Validation Report", `dist/commands/validate.js`) are not kept: `StepRecord` has no stdout, so the required per-group evidence ("six CAR checks") must be copied by hand. | Open | — |
| OR-4 | Minor | `pipeline/publish/src/upload.ts:270-280` | The `carCid` adds (AM-05) get a node-side Hash check but no gateway readback before the manifest and index are written; FR-001 says each upload is followed by readback. `verify-manifest` covers it only after `runs/` exists. | Open | — |
| OR-5 | Minor (before A-11) | `pipeline/publish/src/sequence.ts:492` | `dataGroupCids` is recorded but never asserted to be exactly {seed root, group root}; A-11's `export-tables --atlas-page` requires exactly one non-seed schema. | Open | — |
| OR-6 | Minor | `pipeline/publish/src/verify.ts:209` | `fetch` follows redirects by default; the request log (TC-040 step 3) records the pre-redirect URL only, so a gateway redirect to a non-allowlisted host would pass unseen. | Open | — |
| OR-7 | Minor | `pipeline/publish/src/sequence.ts:414`, `:444` | The redaction set for `reports/sequence.json` is `secretValues(env)` only; the composed Filebase bearer (base64 of key:secret:bucket) that `upload.ts:207` and `kubo-add.ts:90` do redact is missing here. | Open | — |
| OR-8 | Minor | `pipeline/publish/src/cli.ts:134` | A stray `IPFS_API_TOKEN` in the operator env satisfies the credential check while argv pins `--api https://rpc.filebase.io` (`sequence.ts:38,258`); a local-kubo token would reach Filebase and fail only after phase 1. | Open | — |
| OR-9 | Minor | `pipeline/oracle-runtime/travis/adapters/socrata/socrata.ts:15-16`, `pipeline/oracle-runtime/travis/lib/source-client.ts:6-7` | A timeout is mapped to `blocked` and exit 2. `contracts/cli.md` defines exit 2 as "the first HTTP 403 or bot challenge"; a timeout is not evidence of a block and would be reported as one. | Open | — |
| OR-10 | Minor | `pipeline/publish/src/manifest.ts:275-285`, `pipeline/oracle-runtime/travis/runs/run-month.ts:702` | `sources[0].records` is the count of ok lines in the shared `jobDir/receipts.jsonl` (appended across runs, `socrata.ts:25`); a permit re-captured after its body changed is counted twice, so `records` can differ from `summary.counts.captured`. | Open | — |
| OR-11 | Minor | `pipeline/publish/src/readback.ts:144-229`, `pipeline/publish/src/verify.ts:196-242` | Two gateway-GET implementations with different policies (404 retried in readback, not in verify; 2 s vs 1 s base). Drift risk. | Open | — |
| OR-12 | Minor (evidence) | agent-design oracle § 4 | The determinism proof asked for (`export-tables` twice on the same CAR → same tables root) has no test or evidence yet; A-11 relies on it. | Open | — |
| OR-13 | Note | ARD AD-22, § 8 | Second pin and GitHub Release CARs are not in A-03 (oracle risk 5). Not a code defect; the evidence must say "one pin" and the release step must schedule them. | Open | — |

## Constitution and architecture check

| Rule | Result | Note |
| --- | --- | --- |
| Zod on every tRPC input; no `any` | ✅ | No tRPC in this track. External inputs are Zod-parsed: `summary.json` (`upload.ts:54`), upload summaries (`readback.ts:33,43`), manifest and index (`verify.ts:287`, `cid-copy.ts:282`, `runs-index.ts:60`), receipts (`manifest.ts:145`). No `any`, `@ts-ignore` or `eslint-disable` in the reviewed sources. |
| LLM calls only through the Vercel AI SDK | n/a | No LLM call in the publish track. |
| Powertools logger, tracer and metrics in every Lambda | n/a | No Lambda in this track (operator CLIs and the local run script). |
| No secrets or PII in code or logs | ✅ | Credentials reach the CLI only through the child env (`sequence.ts:8-9,186-196,210`); every printed line passes `redact()` (`cli.ts:157-173`); the bearer is only a header (`kubo-add.ts:97`); tests assert no secret in argv or any report (`publish-order.test.ts:305`, `upload.test.ts:600`). See OR-7 for one gap. |
| P0 rules in `docs/architecture-constitution.md` | ✅ | P0-1/-2/-3/-4/-7/-9/-14/-15/-17 checked below; no breach found. |

**Open Critical findings:** 0

---

## Early review: publish (W1–W2, oracle)

Reviewer: `soofi-xyz-team-kit:oracle`, read-only, 2026-10-21, commit `071eb1b`. Skills loaded: `use-oracle` (with `reference/car-publication.md`), `apply-engineering-guidelines`. Scope: `git diff feature/oracle-pipeline...HEAD -- pipeline/ packages/shared packages/query-core scripts/verify-manifest.ts scripts/grep-gates.sh` plus the files themselves (`pipeline/oracle-runtime/travis/adapters/**`, `travis/runs/run-month.ts`, `pipeline/publish/src/**`, `pipeline/publish/test/**`, `scripts/verify-manifest.ts`). Judged against ARD A1/A2/A6, AD-01/03/04/22/24–26, P0-1/2/3/4/14/15, § 7–9, § 16 AM-01/04/05; the constitution's Task A addendum; spec FR-001/006/012/014 and "Fixed texts"; `contracts/cli.md`; `agent-design.md` (oracle section and Spike delta); test cases AC-1 and AC-6.

### Score: 84 / 100 (pass; the bar is 75)

### Verdict

The services and seams are the ones I would choose. `sequence.ts` is a pure plan (`planBuild`/`planPublish` read no input, `sequence.ts:249-351`) run by an executor that stops on exit code, missing output or an unparseable root (`:459-481`); `readback.ts`, `kubo-add.ts`, `manifest.ts`, `runs-index.ts`, `verify.ts` and `cid-copy.ts` are single-purpose, take injectable `fetch`/`run`/`sleep`/`random`, and the AWS SDK is loaded only by `cid-copy` (`cli.ts:275-277`). The Socrata adapter is split as designed: generic `socrata.ts` plus an `austin-3syk-w9eu.ts` that holds only coordinates and the month window, with the include predicate generated by the profile (`austin-3syk-w9eu.ts:33`). `run-month.ts` drives the adapter directly per PO decision D-5 and records why (`run-month.ts:2`). Nothing publishes outside `elephant-cli` output plus the descriptive manifest and index.

### Guardrails, with evidence

| Guardrail | Result | Evidence |
| --- | --- | --- |
| Only `elephant-cli` output becomes public (A2, P0-1, P0-2, AD-01) | ✅ | `publicFiles` = archive CAR, `tables.car`, parts (`upload.ts:123-129`); the manifest is built from CLI outputs, receipts and `summary.json` only (`manifest.ts:1-3`); `pipeline/publish` has no `pg`/`postgres`/`DATABASE_URL` (test `manifest.test.ts:507`, gate `grep-gates.sh:121-124`). |
| Fixed step order, no skip on any size (P0-2, FR-001) | ✅ | 12-step plan, phase 1 for both groups before any upload (`sequence.ts:341-351`); plan identical for an empty and a 2,000-file group (`publish-order.test.ts:294`); no skip/dry-run flag or env switch (`cli.ts:92-103`, `publish-order.test.ts:270`); each of the 12 steps failing stops every later call (`publish-order.test.ts:251`). |
| CIDv1 only (A3, P0-3) | ✅ | Printed roots must match `b[a-z2-7]+` (`sequence.ts:131-132`); contract `CidV1` on every artifact; `cidCopyKey` refuses non-CIDv1 (`cid-copy.ts:89-93`); `kubo add` with `cid-version=1&raw-leaves=true` and Hash must equal the local CID (`kubo-add.ts:17,110-112`). |
| No IPNS, no `coverage.json` (AD-03, AD-04) | ✅ | Contract superRefine rejects IPNS keys and gateway URLs (`packages/contract/src/manifest.ts:99-112`); counts live only in manifest `coverage` (`run-month.ts:635-694`); `runs/index.json` is append-only (`runs-index.ts:29-48`, tests `manifest.test.ts:591-658`). |
| Secrets never on argv or in logs (P0-17) | ✅ (OR-7) | `assertCleanArgv` refuses `--token`, `--pinata-jwt`, `--atlas-page` and any secret value (`sequence.ts:186-196`); env file loaded into the child env only (`cli.ts:131-150`); `Printer.protect` redacts the composed token (`cli.ts:163-166`). |
| Query DB never imported (P0-1, § 9) | ✅ | `grep-gates.sh:119-124`; `manifest.test.ts:507-531`; `pipeline/publish/package.json` adds only `@aws-sdk/client-s3`/`client-ssm`. |
| Polite capture, stop on 403, no evasion (A6, P0-7, FR-014) | ✅ (OR-9) | 1 request/s including retries (`socrata.ts:289-304`), no app token whatever the env (`socrata.ts:333`, `source-client.ts:493`), backoff only on 429/5xx, 403/challenge → `blocked` receipt and stop (`socrata.ts:504`), exit 2 (`socrata.ts:141-143`, `run-month.ts:785`), nothing under `groups/` on a stop (`run-month.ts:403-405` before `:550`). Tests `socrata-adapter.test.ts:421-528`. |
| Profile-only classification (P0-9, AD-26) | ✅ | The adapter carries no term (`socrata.ts:9-10`); include predicate from `toSoqlInclude()` (`austin-3syk-w9eu.ts:33`); `strictProfileApi` (`run-month.ts:152-170`); profile digest and commit stamped (`run-month.ts:715-734`); gate `grep-gates.sh:104-108`; test `socrata-adapter.test.ts:599-607`. |
| `carCid` additive (AM-05, D-5) | ✅ (OR-4) | `car` and `directory` both carry `carCid` (`manifest.ts:252-266`); every `carCid` must be one of the adds (`upload.ts:320-329`); the manifest's own bytes are added and the Hash must be `cidOfBytes` (`upload.ts:333`). |
| Verify on Pinata + Filebase with an allowlist (AM-01, FR-006, P0-14) | ✅ (OR-6) | Allowlist and exact refusal text (`verify.ts:23-46`); manifest first, byte compare, stop on a differing gateway (`verify.ts:296-339`); tables by `cid`, car/directory by `carCid`, never a dag-json root as a file (`verify.ts:266-270`); plain GET, no Range (`verify.ts:209`, test `:432`); `ALL ARTIFACTS VERIFIED` only with both gateways (`verify.ts:385-390`). |
| CID copy refuses overwrite (FR-012, AD-02) | ✅ | HeadObject → same size/sha/cid skip, different → throw (`cid-copy.ts:233-247`); `IfNoneMatch: "*"`, `ChecksumSHA256`, immutable Cache-Control, readback with `ChecksumMode` (`cid-copy.ts:249-269`); `ipfs/<cid>` keys only, CloudFront origin path `/ipfs` matches `copyUrl` (`infra/src/data-stack.ts:96`, `packages/shared/src/urls.ts`); region from the profile, no literal (`cid-copy.ts:72`, gate `grep-gates.sh:126-145`). |
| P0-15 redaction before `validate` | ✅ | The County transform withholds owners before `groups/` is written (`run-month.ts:549-591`); `owners_redacted` is required, never defaulted (`upload.ts:69`, `manifest.ts:326-331`); note text verbatim (`manifest.ts:43-45`). |
| P0-4 wording | ✅ | `PUBLICATION_STATE_TEXT` in `packages/shared/src/labels.ts`; gate `grep-gates.sh:147-151`; no `--atlas-page` in A-03 (`sequence.ts:191`). |
| Gateway URLs derived, never stored (P0-3) | ✅ | `packages/shared/src/urls.ts` builds every URL at call time from configured bare hosts; contract refinement rejects stored ones. |
| Kit runtime, not reimplemented (A1, AD-17) | ✅ with recorded deviation | The adapter is a `county-permit-adapter` vendor module driven directly (D-5; Restate wiring A-05/A-06); the publish sequence wraps the pinned CLI (`sequence.ts:146-168`, commit 44bb182 asserted before the first step). |

### Strengths

1. The plan/executor split makes P0-2 structural rather than procedural: the order is a value, not a control flow, and the tests prove it (`publish-order.test.ts:143-360`).
2. Fail-closed everywhere it matters: a missing output with exit 0 fails (`sequence.ts:460-463`); a part that re-derives to another CID fails (`manifest.ts:236-241`); a readback mismatch writes no manifest (`upload.ts:256-262`); the index refuses a re-publish or an altered `manifestCid` (`runs-index.ts:29-43`); a dirty tree refuses to build a manifest (`manifest.ts:350-351`).
3. The pinned CLI is verified from the pnpm store path, and I confirmed from `dist/commands/validate.js` that both `validate <dir>` and `validate <car>` exit 1 on any lexicon or CAR-check error, so gating on exit code is sound.
4. `cid.ts` uses `ipfs-unixfs-importer` with `cidVersion 1, rawLeaves true` and the default 256 KiB balanced layout, and `kubo-add.ts:17` asks the node for the same (`chunker=size-262144`); the test at `kubo-add.test.ts:121` covers the multi-chunk (dag-pb root) case.
5. Credentials are handled the way the design asked: child env only, argv asserted clean, every printed line redacted, token never in a URL or form.
6. The adapter's politeness is testable and tested: pacer, identical UA, no app token, 429 retried, 403 and a 200 challenge page stopped at first sight.

### What must be fixed before PO decision D-8 (first public upload)

- **OR-1.** Pin the approval artifact. Write the build report under a phase-specific name (`reports/sequence-build.json`) and, in `publishRun`, require every phase-1 `outputs[].sha256`, `carRoot` and `tablesRoot` of the fresh run to equal the build report before the first `upload` step; print the compared digests. Also write the `build` listing to `reports/public-files.json` so the D-8 evidence is a file, not a terminal scrollback.
- Operational prerequisites I would check at D-8 (not code defects): the tree is clean (`specs/003-walking-skeleton/run-log.md` is currently modified and would make `buildManifest` refuse); `~/.config/assessment/filebase.env` holds the three `FILEBASE_*` names and no `IPFS_API_TOKEN` (OR-8); the Filebase Free plan can hold both groups' CARs and tables (AM-04); the lexicon manifest URL and the CLI commit are recorded in the evidence.

### What can wait (before G7 unless stated)

- **OR-2** (G7): add `assertOrdered(plan)` in `execute` that throws `"<step> of <group> before <earlier step>"` naming both steps, and a test that feeds a reordered plan (export an internal `executePlan` for tests, or test `assertOrdered` directly) so TC-002(b) is asserted by name.
- **OR-3**: keep the redacted stdout of `validate` and `validate-car` in `StepRecord` (or parse the per-check lines) so the six CAR check counts land in `sequence.json`.
- **OR-4**: after each `kuboAddFile`, GET `https://{FILEBASE_GATEWAY_HOST}/ipfs/{carCid}` through readback's `getDigest` and compare size + SHA-256 before the manifest is built.
- **OR-5** (before A-11): assert `dataGroupCids.length === 2` and that one equals the seed schema CID from `capture/lexicon/receipt.json`.
- **OR-6**: `redirect: "manual"` in `fetchBytes`, treat 3xx as a failure, or record `new URL(res.url).host` and refuse it unless allowlisted.
- **OR-7**: compute the Filebase token inside `sequence.ts` (avoids the import cycle with `kubo-add.ts`) and add it to `secrets` for the stderr redaction.
- **OR-8**: in `uploadEnv`, require the three `FILEBASE_*` names explicitly and refuse `IPFS_API_TOKEN` when the API is pinned to Filebase.
- **OR-9**: map `blocked_reason: "timeout"` to `error` (exit 1, still a stop) and keep exit 2 for 403/challenge, or amend `contracts/cli.md` to say so.
- **OR-10**: dedupe receipts by `key` keeping the latest ok line, or point `sources[0].receipts` at a per-run file; assert `records === summary.counts.captured`.
- **OR-11**: one `gateway-get.ts` with explicit retry policy parameters used by both readback and verify.
- **OR-12**: at D-8 time, run `export-tables` twice on the kept CAR and record both tables roots in the evidence.
- **OR-13**: evidence says "one pin (Filebase); second pin and GitHub Release at release".

### Confidence note

Static read of the sources, tests and the pinned CLI's compiled `validate` command; no test suite, CLI or network call was run (read-only brief). Line numbers are from commit `071eb1b`. I did not review `packages/query-core` SQL builders or `packages/shared` labels beyond their publication touch points (`urls.ts`, `sources.ts`, the generated-SQL seam), which belong to metagross's review. The AM-01 assumption that Pinata's public gateway serves Filebase-pinned objects by bare CID rests on the 0001 spike evidence, not on anything I re-verified.

### Fixes (early review)

Fixer: `soofi-xyz-team-kit:oracle`, 2026-10-21, on top of `071eb1b` (uncommitted). Tests first: each test below failed before its fix (19 publish failures plus `upload.test.ts` failing to import `approval.js`; 2 `run-month` failures) and passes after. Suites: `pnpm vitest run pipeline/publish` 171 passed / 1 skipped; `pipeline/oracle-runtime` `npm test` 633 passed, `typecheck`, `lint`, prettier clean; root `tsc`, `tests/e2e` `tsc` and eslint clean.

| Finding | State | What changed | Tests (file › name) |
| --- | --- | --- | --- |
| OR-1 | Fixed | `build` writes `reports/sequence-build.json` (every phase-1 step, exit code, roots, every output file's path/size/SHA-256; directories listed file by file) and `reports/public-files.json` (exactly the CARs, `tables.car` and every part: path, size, SHA-256, CID; group roots; SHA-256 of the build report; no timestamp). `upload --run <id> --approved <sha256 of public-files.json>` is required; `publishRun` calls `verifyApprovedBuild` before the first upload step (`ApprovalError` on a wrong/missing approval or no build; `BuildDriftError` naming the file on any size/SHA-256/CID/root/extra-file difference), never re-runs phase 1 (`runUpload`, phase 2 only) and writes `reports/sequence-upload.json`; the build report is never rewritten. New `src/approval.ts`. | `upload.test.ts` › "the D-8 approval…": "writes sequence-build.json with every phase-1 step…", "writes public-files.json listing exactly the CARs…", "uploads the approved build without re-running phase 1 and never rewrites sequence-build.json", "refuses an approval that is not the SHA-256 of public-files.json…", "refuses when no build exists for the run…", "refuses with BuildDriftError naming a part…", "…a public file the approval does not list", "…when sequence-build.json (its roots) changed…", "…a CAR swapped after the approval…"; `cli.test.ts` › "cli build › runs phase 1 only…" (prints the listing SHA-256 and the `--approved` command), "cli usage" (`upload` without `--approved` exits 1) |
| OR-2 | Fixed | `assertOrdered(plan)` throws `PlanOrderError` "`<step> of <group> before <step> of <group>`" (also "… missing", "… twice"); `executePlan` asserts before any directory or CLI call. Test titles carry `A-03-TC-001` / `A-03-TC-002`; `tests/e2e/build-checks.spec.ts` filters by those exact IDs and requires ≥ 1 passed per TC (4 and 17 locally). | `publish-order.test.ts` › "A-03-TC-002 refuses upload-car before export-tables, naming both steps", "A-03-TC-002 runs no step of a reordered plan…", "A-03-TC-002 refuses an upload of one group before another group's build step", "A-03-TC-002 refuses a plan that skips a step, naming it", "A-03-TC-001 accepts the fixed build, upload and publish plans" |
| OR-4 | Fixed | Each `.car` add is read back from `FILEBASE_GATEWAY_HOST` by `carCid` (size + SHA-256, `readbackFile`) before the manifest; stage `car-readback`. | `upload.test.ts` › "carCid readback (OR-4)": "reads every .car add back…", "writes no manifest when the gateway serves other bytes for a carCid" |
| OR-6 | Fixed | `verify.ts` `fetchBytes` uses `redirect: "manual"`; a 3xx (or a response that was redirected) fails the check naming the Location host. `scripts/verify-manifest.ts` is unchanged (thin CLI over `verify.ts`). | `verify.test.ts` › "redirects (OR-6) › does not follow a redirect off the allowlisted host…" |
| OR-7 | Fixed | `filebaseToken` moved into `sequence.ts`; `secretValues` adds the composed token and `Bearer <token>` (and `Bearer <IPFS_API_TOKEN>`); every sequence report is redacted as a whole. | `publish-order.test.ts` › "redaction of the composed Filebase bearer (OR-7)": "counts the composed token and its Authorization value…", "keeps the composed token out of a failed step's stderr and the sequence report" |
| OR-8 | Fixed | `filebaseEnvProblem`: all three `FILEBASE_*` names required, `IPFS_API_TOKEN` refused beside the Filebase RPC; enforced in `cli.ts uploadEnv`, `publishRun` pre-flight and `kuboAdd`. | `cli.test.ts` › "cli upload credentials fail closed (OR-8)" (2 tests); `upload.test.ts` › "Filebase credentials fail closed (OR-8)" (2 tests) |
| OR-9 | Fixed | `run-month.ts` labels a timed-out capture `error` (exit 1, still a stop, nothing under `groups/`); exit 2 stays for 403/challenge, per `contracts/cli.md`. | `run-month.test.ts` › "labels a timed-out permit GET an error (exit 1), not blocked (exit 2)…", "keeps exit 2 for a 403 (blocked)" |
| OR-10 | Fixed | `run-month.ts` writes this run's receipts to `<runDir>/capture/austin-receipts.jsonl`; `sources[0].receipts` points there, so `records` equals `counts.captured`. | `run-month.test.ts` › "counts sources[0].records from this run's receipts only…" |
| OR-14 | Fixed | Preflight ordering. Before this fix, `publishRun` ran the four uploads, the readback and the carCid adds before `buildManifest` checked the working tree, so a dirty tree published files and then stopped with no manifest. Nothing had been uploaded when this was found. The new `preflight()` in `upload.ts` runs first in `publishRun` and in `cli.ts upload`. Before any CLI call or network write, it checks the summary and profiles, that the run is not already in the index, all three `FILEBASE_*` names (names only), a clean tree (`git status --porcelain --untracked-files=no`; `workTreeStatus` can be injected), that the recorded `profiles[].gitCommit` equals HEAD (`headCommit` can be injected), and the D-8 approval and build drift. A failure throws `PreflightError` with `check` set to `filebase-env`, `work-tree` or `commit`, or throws `ApprovalError`/`BuildDriftError`, and the command exits 1. `buildManifest` still runs its own clean-tree check. Red: 4 failures (the CLI exited 0 on a dirty tree; `PreflightError` did not exist). Green: 176 passed, 1 skipped. | `upload.test.ts` › "preflight before the first network write (OR-14)": "refuses a dirty working tree before any upload: zero upload calls, no add, no manifest", "refuses a build whose recorded gitCommit is not HEAD, naming both commits, before any upload", "refuses incomplete Filebase credentials before any upload, naming the variables only", "proceeds as before on a clean tree whose HEAD is the recorded commit"; `cli.test.ts` › "cli upload preflight before any upload (OR-14)": "refuses a dirty working tree before publishRun: zero CLI calls, a named error, exit 1" |
| OR-3 | Deferred (G7) | CAR check counts in the step record. | — |
| OR-5 | Deferred (before A-11) | `dataGroupCids` length and seed-CID assertion. | — |
| OR-11 | Deferred (G7) | One shared `gateway-get.ts`. | — |
| OR-12 | Deferred (D-8 evidence) | Second `export-tables` run on the kept CAR. | — |
| OR-13 | Deferred (release) | "One pin (Filebase)" wording in the evidence. | — |

Re-build of `travis-202609-permits-20261021t093125z` (phase 1 only, pinned CLI 44bb182b, nothing uploaded): exit 0; roots equal the earlier build (county archive `baguqeeraqc3y3bh65rbd42zgdrkctaulckvvidmgb52pghyansb43vumoh6q`, tables `baguqeeramjzy4a3oqe5sldka4hdbbm65xkbjh2yaxkb2j4dtqqkctodfxayq`; property_improvement archive `baguqeeraraakl5mdoba2lz4zgn4wtiuqiw6qfpez3dhimgfc6b7tkacv2gfq`, tables `baguqeerauingvk5n6ow4zjjn3zgj57by6ef6jpfzetcz4j7qphu4gbsl5hhq`). `reports/public-files.json` lists 27 files (county 18, property_improvement 9), 212,217 bytes, SHA-256 `ae2f47bbe86b3f84c0f4e4273be42eaf047767eec8f08fe1f49ff9256f318697`; `verifyApprovedBuild` with that digest passes on disk. That digest is the D-8 input.
