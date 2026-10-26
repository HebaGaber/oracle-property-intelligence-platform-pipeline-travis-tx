# Oracle pipeline, Travis County TX: full county published by CID, incremental runs, Explorer, agent and MCP

All nine stories (A-01 to A-04, A-07, A-11, A-13, A-14, A-16) are merged on `feature/oracle-pipeline`, each through gates G4 to G7. The full Travis County dataset is published to IPFS as CIDv1 artifacts in five immutable runs, explored on a hosted site, queried by a source-backed agent and an MCP server, and served with **$0.00 fixed monthly cost**.

## Links

| What | Where |
| --- | --- |
| Runtime | https://countylens.aldarraj.com |
| Test credentials | The demo path is public, no login. An admin test account (`/admin/sign-in`: run controls, Activity) is available to evaluators on request; its password is not posted here |
| Demo video | Not recorded yet (release step R7) |
| MCP server | `POST https://s7h96zfam0.execute-api.eu-north-1.amazonaws.com/mcp` with a bearer token; six read-only tools; connection guide and a live "Try a tool" at `/help/mcp` |
| Latest run | Run 3.1 `travis-full-run3-1-20261025`: [`runs/travis-full-run3-1-20261025/manifest.json`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/runs/travis-full-run3-1-20261025/manifest.json), manifest CID `bafkreidbqsav3rsbxqy5fx3li73uskfth254nz5zw34xwac5w3fd4tmbai`, previous (Run 3) `bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm` |
| Run history | [`runs/index.json`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/runs/index.json): pilot slice (2026-10-21), Run 1 (10-23), Run 2 (10-24), Run 3 (10-25), Run 3.1 (10-25, a correction of Run 3); each manifest names its predecessor (`previousManifestCid`) |
| Independent verification | `npx tsx scripts/verify-manifest.ts runs/travis-full-run3-1-20261025/manifest.json --sample` fetches by CID from Pinata and orbitor (public gateways this project does not operate) and checks size and SHA-256 |

## What the data holds (Run 3.1)

| Dataset | Published | Source |
| --- | --- | --- |
| Properties (TCAD real-property accounts) with coordinates, year built, roof age basis | 441,961 of the 493,246-parcel roll (R accounts; personal property and mobile homes out of scope) | TCAD 2026 certified export, Travis County GIS |
| Situs addresses | 441,940 of 441,961 properties | TCAD, City of Austin address points (466,149) |
| Ownership: owner names, last dated sale or deed, tenure, owner mailing ZIP (out-of-area) | mailing ZIP for 408,833 of 409,205 mailing addresses | TCAD |
| Roofing permits with status, issue/final dates, open duration, printed contractor | 15,025 roofing permits of 2,381,886 City of Austin permit records read | data.austintexas.gov `3syk-w9eu` |
| Contractor reconciliation against the Texas Comptroller registry | 342,333 registry rows; 130 candidate, 112 conflicting matches (run-level counts) | data.texas.gov `9cir-efmm` |
| BBB ratings | Not collected: bbb.org refuses automated access (HTTP 403); each permit carries a BBB search link instead | — |

Every row carries its source URL, capture time, table CID and run; every missing value carries a reason.

## Demo transcript, step by step

| Step | Where |
| --- | --- |
| Pipeline run summary, sources, coverage, timestamps, limitations | `/runs` (Sync status, pipeline, per-source records and deltas, limitations), `/runs/log` |
| Uploaded records by source with provenance | `/tx/travis/coverage` (loaded vs each source's own total, counts by record kind, cost and limits) |
| DuckDB-backed query layer without Oracle-hosted database | Explore runs DuckDB over the published Parquet on a Lambda that scales to zero; `/data/catalog` lists the tables |
| Artifact manifest (CID, size, name, codec, digest) | `/data/manifest`; the JSON in `runs/<runId>/manifest.json` |
| Retrieve one artifact from two independent public gateways | `/data/verify/<cid>`: the browser fetches from Pinata and orbitor and re-hashes the bytes |
| Later incremental publish produced a new CID | `/runs/compare` (Run 3 vs Run 3.1: unchanged files keep their CID, changed ones get new CIDs; the old manifest still resolves) |
| UI: roofs older than 15 years within a radius | `/tx/travis/explore` (Filters: place Austin, 5 mi, roof ≥ 15): 75,432 properties with roof-age basis, coordinates, source |
| UI: open roofing permits, longest open first, contractor and BBB | same page, Roofing permit "Open or stalled", Open ≥ 5 yrs, sort "Open longest" |
| Agent: the two README prompts | `/tx/travis/explore?mode=ai`, the first two suggestions (Austin). Live answers on 2026-10-26: 75,432 properties (top 10 with addresses); 298 roofing permits open ≥ 5 years within 5 mi, longest 1982-009789 BP (~44.7 yrs), contractors as printed (e.g. Steve Moore), BBB not available with the reason |
| MCP-ready | `/help/mcp` (endpoint, access, tools, client set-up, Try a tool) |

## Zero idle cost

`docs/cost.md`: **$0.00 fixed per month**. Gross usage $9.25 over 2026-10-20 to 2026-10-24 (Amplify hosting and builds, Bedrock calls), offset by credits and shown apart. Scheduler deployed disabled, no provisioned concurrency, a $10 budget alarm; CDK assertions in `infra/test/idle-cost.test.ts`.

## Story status

| Story | Status |
| --- | --- |
| A-01 Discover sources and readiness | Merged, G7 approved |
| A-02 Data contract (now v1.2) | Merged, G7 approved |
| A-03 Walking skeleton | Merged, G7 approved |
| A-04 County backbone | Merged, G7 approved (PO exceptions: permit match rate, ordinary-parcel coverage) |
| A-07 Enrich and reconcile | Merged, G7 approved (BBB not collectable) |
| A-11 Full county by CID, incremental runs | Merged, G7 approved |
| A-13 Explorer UI and pages | Merged, G7 approved |
| A-14 Agent and MCP server | Merged, G7 approved |
| A-16 Zero idle cost, admin, prototype parity, full-county index | Merged 2026-10-26, G7 approved; demo polish (Explore drawer and results table, rail and footer, Coverage, data-binding audit fixes) on `016c-demo-polish` |

Gate log: [`docs/traceability.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/traceability.md). Progress board and git graph: [`docs/progress.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/progress.md). Every carried item with its outcome: [`docs/evidence/A-16.md` § Closure](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-16.md).

## Gaps closed since the last update

| Gap | Closed by |
| --- | --- |
| Explorer filter search on the full county | Per-run Explore index; hosted searches 0.5–1.9 s |
| Agent and MCP on the full county | README prompts answered on Run 3.1 with real rows; MCP `search_properties` 0.8–2.4 s |
| Second independent pin and independent public gateways | Pinata holds all 5 run manifests and 201 of Run 3.1's 255 table files with identical CIDs; Pinata and orbitor verify by CID; CARs on GitHub Releases |
| Out-of-area owner filter | Run 3.1 publishes owner mailing ZIP; 7,056 out-of-area owners with roofs ≥ 20 yrs within 5 mi of Austin |
| Street addresses | Run 3.1 publishes situs text; Explore, the drawer and the agent show it |
| SQL panel first query | The SQL tab was removed by PO decision; the Catalog and the MCP tools cover structured queries |
| "Open" permits | An open permit includes stalled ones (open past expiry, never closed), PO decision 2026-10-26 |

## Known gaps

| Gap | Why | Next step |
| --- | --- | --- |
| Demo video | Recorded at release | R7 |
| 54 Run 3.1 table files and the CARs only on Filebase + GitHub Releases | Pinata free plan is full (1 GB); CARs are 4.0 GB | Paid pin or another free pin |
| MCP burst above 5 rps answers 503 | A WAF rate rule bills while idle; PO kept $0 idle | Lambda concurrency quota increase |
| Six-case golden grader on the full county | The grader binds runs locally and the CID copy refuses its unsigned fetch | Read parts through the signed path |
| Page speed on Catalog and Manifest | LCP 3.1–3.3 s against 2.5 s on Run 3 | Footer-only Catalog read; load the artifact table on demand |
| BBB ratings | bbb.org blocks automated access (403) | Licensed BBB data feed |
| Atlas registration | No Atlas access in this environment | — |

## Architecture

Constitution and decisions: [`docs/architecture-constitution.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/architecture-constitution.md). TypeScript, CDK (region from config; `eu-north-1` because the demo AWS project is region-locked), Turborepo, tRPC + Zod, Vercel AI SDK on Bedrock, Powertools + X-Ray, Vitest + Playwright on the hosted URL in GitHub Actions. Six stacks: `CountyLensData` (S3 + CloudFront CID copy), `CountyLensApi` (Lambdas + HTTP API: Explore, agent, MCP, admin), `CountyLensWeb` (Amplify), `CountyLensOps` (SNS, alarms, budget), `CountyLensCert`, `CountyLensScheduler` (disabled by default). The pipeline runs on the kit runtime with `elephant-cli` publication; only `elephant-cli` output is published.

## Reproduce

1. `pnpm install && pnpm check`
2. `AWS_PROFILE=<profile> pnpm --filter @countylens/infra exec cdk deploy --all` (region from the profile; `OPERATOR_EMAIL` set in your shell)
3. `npx tsx scripts/verify-manifest.ts runs/travis-full-run3-1-20261025/manifest.json --sample`

## Kit usage

[`docs/kit-usage.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/kit-usage.md): the agents and skills used per story, and the reviewer scores.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
