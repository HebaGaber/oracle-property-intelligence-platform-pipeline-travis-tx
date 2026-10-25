# Oracle pipeline, Travis County TX: work in progress (stories A-01 to A-13)

> **Draft.** This PR is open as a draft while the last two stories are built (A-14 agent and MCP, A-16 cost and admin). It is not ready for review. Stories A-01, A-02, A-03, A-04, A-07, A-11 and A-13 are merged on `feature/oracle-pipeline`, each through gates G4 to G7. All links below point to files on the [feature branch](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/tree/feature/oracle-pipeline) of the fork.

## Outcome so far

The full Travis County roll (**441,961 properties**) and **15,025 City of Austin roofing permits** are mined, validated with `elephant-cli`, published to IPFS as CIDv1 artifacts (two full runs listed in the run index), and served by a hosted site at **https://countylens.aldarraj.com**: Hub, Runs and Compare, Coverage, Data · Manifest and Verify (the browser re-hashes the files from two public gateways), Data · Catalog, Runs · Log, Legal, Help, and an in-browser SQL panel (DuckDB-WASM, read-only). Nothing on the site is sample data, and every figure shows where it comes from. One thing does **not** work on the full county yet: the Explorer's filter search (radius, roof age, open permits). It works on the earlier 14-property slice and is carried to A-16; see Known gaps.

## Links

| What | Where |
| --- | --- |
| Runtime | https://countylens.aldarraj.com (`/`, `/runs`, `/tx/travis/coverage`, `/data/manifest`, `/data/catalog`, `/permits`) |
| Test credentials | Public, no login (admin sign-in comes in A-16) |
| Demo video | Not recorded yet (release step R4, see Known gaps) |
| Latest run manifest | [`runs/travis-full-run2-20261024/manifest.json`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/runs/travis-full-run2-20261024/manifest.json) · manifest CID `bafkreife3vk3cgcod3v6tue2xes3hvl2vndqoshbhrhsnjtriskihpcute` · no IPNS (AD-03); the run index is [`runs/index.json`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/runs/index.json) |
| Independent verification | `npx tsx scripts/verify-manifest.ts runs/travis-full-run2-20261024/manifest.json` prints `ALL ARTIFACTS VERIFIED` (Pinata and Filebase gateways; ipfs.io and dweb.link retired on 2026-09-21, see [`docs/decisions/0001-read-path.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/0001-read-path.md)) |
| CI | GitHub Actions runs on the fork, so they do not appear in this PR's checks list: [all runs on `feature/oracle-pipeline`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions?query=branch%3Afeature%2Foracle-pipeline) |

## Evaluation points covered so far

| Point | Where to see it | Evidence |
| --- | --- | --- |
| A1 Coverage and scale | `/tx/travis/coverage`, `/data/catalog`: 441,961 properties and 15,025 permits with denominators and source limits | [`docs/evidence/A-01.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-01.md), [`docs/evidence/A-04.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-04.md) |
| A2 Reconciliation and provenance | Data · Manifest and Verify; the data contract with missing-data reasons ([`contract/v1/README.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/contract/v1/README.md)) | [`docs/evidence/A-02.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-02.md), [`docs/evidence/A-07.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-07.md) |
| A3 Continuous incremental ingestion | `/runs` and `/runs/compare`: Runs 1 and 2 with history and deltas. **Partly met:** a third run is not published (A-16) | [`docs/evidence/A-11.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-11.md) |
| A4 IPFS publication, zero idle cost | `/runs`, the manifest CID, `verify-manifest` | [`docs/evidence/A-03.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-03.md), [`docs/evidence/A-11.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-11.md) |
| A5 DuckDB query layer and UI | `/permits`, `/tx/travis/explore?mode=sql`, `/data/manifest` | [`docs/evidence/A-13.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-13.md), [`docs/decisions/0001-read-path.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/0001-read-path.md) |

## Story status

| Story | Status | Evidence |
| --- | --- | --- |
| A-01 Discover Travis County sources | ✅ merged (G7) | [`docs/evidence/A-01.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-01.md) |
| A-02 Freeze the data contract | ✅ merged (G7) | [`docs/evidence/A-02.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-02.md) |
| A-03 Walking skeleton: one month by CID, hosted UI | ✅ merged (G7): 43/43 hosted test cases, CI green | [`docs/evidence/A-03.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-03.md), [`docs/reports/A-03-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-03-test-report.md) |
| A-04 Property backbone | ✅ merged (G7 10/10, two PO exceptions: permit match rate, coverage of ordinary parcels) | [`docs/evidence/A-04.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-04.md), [`docs/reports/A-04-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-04-test-report.md) |
| A-07 Enrich and reconcile | ✅ merged (G7 10/10; Tracks A and D built, B documented gap because bbb.org blocks automated access, C conditional) | [`docs/evidence/A-07.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-07.md), [`docs/reports/A-07-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-07-test-report.md) |
| A-11 Full publish and incremental runs | ✅ merged (G7): Runs 1 and 2 published; Run 3 moved to A-16 | [`docs/evidence/A-11.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-11.md), [`docs/reports/A-11-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-11-test-report.md) |
| A-13 Explorer UI and content pages | ✅ merged (G7, with a PO exception): 44 of 73 hosted cases pass, 0 fail, 29 parked as documented A-16 gaps; CI green on 7 hosted shards | [`docs/evidence/A-13.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-13.md), [`docs/reports/A-13-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-13-test-report.md), [`docs/decisions/DEC-A-13-explore-full-county.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/DEC-A-13-explore-full-county.md) |
| A-14 Agent and MCP · A-16 Cost and admin | not started | [`docs/progress.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/progress.md) |

## Architecture

Constitution and decisions: [`docs/architecture-constitution.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/architecture-constitution.md) (§ 16 lists the amendments AM-01 to AM-08).

Golden Path: TypeScript · CDK (region from config; the demo runs in `eu-north-1` because the demo AWS project is region-locked; company default `us-east-2`) · Turborepo · tRPC + Zod · Powertools + X-Ray · Vitest + Playwright in GitHub Actions. Five stacks: `CountyLensData` (S3 + CloudFront CID copy), `CountyLensApi` (Lambda + HTTP API), `CountyLensWeb` (Amplify), `CountyLensOps` (SNS, alarms, $10 budget), `CountyLensCert` (custom domain). CI does not deploy: the account's organisation policy denies the GitHub OIDC provider, so infrastructure deploys run from the operator's machine after an explicit approval (AM-08).

## Delivery process

| What | Where |
| --- | --- |
| Lifecycle, gates | Gate log in [`docs/traceability.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/traceability.md) |
| Story-by-story progress and git graph | [`docs/progress.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/progress.md), one `--no-ff` merge per story on `feature/oracle-pipeline` |
| Test cases and execution reports | [`testplans/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/testplans), [`docs/reports/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports) |
| Code review logs and defects | [`docs/reviews/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reviews), [`docs/defects/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/defects) |

## Kit usage

See [`docs/kit-usage.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/kit-usage.md): for each story, the agents and skills used and the reviewer scores.

## Reproduce

1. `pnpm install && pnpm test`, and `(cd pipeline/oracle-runtime && npm ci && npm test)`
2. `AWS_PROFILE=<profile> pnpm --filter @countylens/infra exec cdk deploy --all` (region from the profile)
3. `npx tsx scripts/verify-manifest.ts runs/travis-full-run2-20261024/manifest.json`

## Known gaps

| Gap | Why | Next step |
| --- | --- | --- |
| **Explorer filter search does not run on the full county** | One search joins all 441,961 properties inside the API Lambda: it ran out of memory at 1 GB, then times out at 29 s (HTTP 500). It worked on the 14-property slice (p95 817 ms). Demo lines for radius and roof age and for open permits therefore show an error on live data. PO-accepted exception: [`DEC-A-13-explore-full-county`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/DEC-A-13-explore-full-county.md) | A-16 item 1: a per-run Explore index |
| SQL panel first query takes about 97 s on the full county (limit 8 s) | The first query binds 225 table parts; after that queries are fast. `SELECT count(*) FROM v_property` returns 441,961 | A-16 item 2 |
| Page speed on five manifest-driven pages (LCP 2.7 to 3.4 s against 2.5 s) | Rendering 240 table rows and two manifests on a throttled phone profile | A-16 item 3 |
| Run 3 not published | A-11 closed with Runs 1 and 2; the incremental refresh and the immutability check across three runs move to A-16 | A-16 items 2 and 4 of its A-11 list |
| 29 hosted test cases are parked | Skipped with the A-16 gap named in the report, never counted as passed ([`docs/evidence/A-13.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-13.md)) | A-16 |
| Demo video | Recorded once the full county and the explorer are live | Release step R4 |
| Atlas registration | P0-4: not claimed; no Atlas access in this environment | Release |
| Agent and MCP | Not built yet | A-14 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
