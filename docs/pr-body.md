# Oracle pipeline, Travis County TX: work in progress (stories A-01 to A-03)

> **Draft.** This PR is open as a draft while the remaining stories are built. It is not ready for review. Stories A-01 to A-03 are merged on `feature/oracle-pipeline`, each through gates G4–G7.

## Outcome so far

One real month of City of Austin reroof permits goes from the public source, through the kit runtime and `elephant-cli`, onto IPFS as CIDv1 artifacts, and onto a hosted page that queries them in the browser with DuckDB-WASM. Proven at **https://countylens.aldarraj.com** on real data: 35 Austin reroof permits issued in September 2026 and their 14 TCAD parcels.

## Links

| What | Where |
| --- | --- |
| Runtime | https://countylens.aldarraj.com (`/runs`, `/permits`) |
| Test credentials | Public, no login (admin sign-in comes in A-16) |
| Demo video | Not recorded yet (see Known gaps) |
| Latest run manifest | [`runs/travis-202609-permits-20261021t103516z/manifest.json`](runs/travis-202609-permits-20261021t103516z/manifest.json) · manifest CID `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` · no IPNS (AD-03); the run index is [`runs/index.json`](runs/index.json) |
| Independent verification | `npx tsx scripts/verify-manifest.ts runs/travis-202609-permits-20261021t103516z/manifest.json` prints `ALL ARTIFACTS VERIFIED` (Pinata and Filebase gateways; ipfs.io and dweb.link retired on 2026-09-21, see [`docs/decisions/0001-read-path.md`](docs/decisions/0001-read-path.md)) |

## Evaluation points covered so far

| Point | Where to see it | Evidence |
| --- | --- | --- |
| A4 IPFS publication, zero idle cost | `/runs`, the manifest CID, `verify-manifest` | [`docs/evidence/A-03.md`](docs/evidence/A-03.md) |
| A5 DuckDB query layer and UI | `/permits` (DuckDB-WASM in the browser, read-only) | [`docs/evidence/A-03.md`](docs/evidence/A-03.md), [`docs/decisions/0001-read-path.md`](docs/decisions/0001-read-path.md) |
| Data contract (views, columns, missing reasons) | [`contract/v1/README.md`](contract/v1/README.md) | [`docs/evidence/A-02.md`](docs/evidence/A-02.md) |
| Source discovery and readiness | [`pipeline/docs/travis-sources.yaml`](pipeline/docs/travis-sources.yaml) | [`docs/evidence/A-01.md`](docs/evidence/A-01.md) |

## Story status

| Story | Status | Evidence |
| --- | --- | --- |
| A-01 Discover Travis County sources | ✅ merged (G7) | [`docs/evidence/A-01.md`](docs/evidence/A-01.md) |
| A-02 Freeze the data contract | ✅ merged (G7) | [`docs/evidence/A-02.md`](docs/evidence/A-02.md) |
| A-03 Walking skeleton: one month by CID, hosted UI | ✅ merged (G7): 43/43 hosted test cases, CI green | [`docs/evidence/A-03.md`](docs/evidence/A-03.md), [`docs/reports/A-03-test-report.md`](docs/reports/A-03-test-report.md) |
| A-04 property backbone · A-07 enrich and reconcile · A-11 full publish and runs · A-13 explorer and pages · A-14 agent and MCP · A-16 cost and admin | not started | [`docs/progress.md`](docs/progress.md) |

## Architecture

Constitution and decisions: [`docs/architecture-constitution.md`](docs/architecture-constitution.md) (§ 16 lists the amendments AM-01 to AM-08 made during A-03).

Golden Path: TypeScript · CDK (region from config; the demo runs in `eu-north-1` because the demo AWS project is region-locked; company default `us-east-2`) · Turborepo · tRPC + Zod · Powertools + X-Ray · Vitest + Playwright in GitHub Actions. Five stacks: `CountyLensData` (S3 + CloudFront CID copy), `CountyLensApi` (Lambda + HTTP API), `CountyLensWeb` (Amplify), `CountyLensOps` (SNS, alarms, $10 budget), `CountyLensCert` (custom domain). CI does not deploy: the account's organisation policy denies the GitHub OIDC provider, so infrastructure deploys run from the operator's machine after an explicit approval (AM-08).

## Delivery process

| What | Where |
| --- | --- |
| Lifecycle, gates | Gate log in [`docs/traceability.md`](docs/traceability.md) |
| Story-by-story progress and git graph | [`docs/progress.md`](docs/progress.md), one `--no-ff` merge per story on `feature/oracle-pipeline` |
| Test cases and execution reports | `testplans/`, `docs/reports/` |
| Code review logs and defects | `docs/reviews/`, `docs/defects/` |

## Kit usage

See [`docs/kit-usage.md`](docs/kit-usage.md): for each story, the agents and skills used and the reviewer scores (A-03: oracle 90/100, metagross 86/100).

## Reproduce

1. `pnpm install && pnpm test`, and `(cd pipeline/oracle-runtime && npm ci && npm test)`
2. `AWS_PROFILE=<profile> pnpm --filter @countylens/infra exec cdk deploy --all` (region from the profile)
3. `npx tsx scripts/verify-manifest.ts runs/travis-202609-permits-20261021t103516z/manifest.json`

## Known gaps

| Gap | Why | Next step |
| --- | --- | --- |
| Full county (all properties and permits) | A-03 is the thin end-to-end slice: one month of Austin reroof permits | A-04, A-07, A-11 |
| Demo video | Recorded once the full county and the explorer are live | Release step R4 |
| Missing-data labels on the Permits page don't name their field | Presentation only; data and retrieval are correct ([`docs/defects/ERR-20.md`](docs/defects/ERR-20.md)) | A-13 |
| Atlas registration | P0-4: not claimed before the A-11 publication | A-11 |
| Agent and MCP | Not built yet | A-14 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
