# Oracle pipeline, Travis County TX: work in progress (stories A-01 to A-04, A-07, A-11 and A-13)

> **Draft.** This PR is open as a draft while the remaining stories are built. It is not ready for review. Stories A-01 to A-04, A-07, A-11 and A-13 are merged on `feature/oracle-pipeline`, each through gates G4–G7. Only A-14 (agent and MCP) and A-16 (cost and admin) remain.

## Outcome so far

The full Travis County dataset is published by CID in two runs: Run 1 (2026-10-23) and Run 2 (2026-10-24, which fixed the permit-to-parcel identity), 441,961 County property rows and 15,025 roofing permit rows, with a manifest and a run index. The thin slice below is the earlier walking skeleton.

One real month of City of Austin reroof permits goes from the public source, through the kit runtime and `elephant-cli`, onto IPFS as CIDv1 artifacts, and onto a hosted page that queries them in the browser with DuckDB-WASM. Proven at **https://countylens.aldarraj.com** on real data: 35 Austin reroof permits issued in September 2026 and their 14 TCAD parcels.

The hosted site now covers the full county: Hub, Runs and Compare (Runs 1 and 2), Coverage, Data · Manifest and Verify (the browser re-hashes each file from two public gateways), Data · Catalog (26 tables), Runs · Log, Legal, Help and an in-browser read-only SQL panel (`SELECT count(*) FROM v_property` = 441,961). Nothing on the site is sample data and every figure shows its source. **One thing does not work on the full county yet: the Explorer filter search** (radius, roof age, open permits). It works on the 14-property slice and is a PO-accepted exception carried to A-16; see Known gaps.

## Links

| What | Where |
| --- | --- |
| Runtime | https://countylens.aldarraj.com (`/`, `/runs`, `/tx/travis/coverage`, `/data/manifest`, `/data/catalog`, `/permits`) |
| Test credentials | Public, no login (admin sign-in comes in A-16) |
| Demo video | Not recorded yet (see Known gaps) |
| Latest run manifest | Run 2: [`runs/travis-full-run2-20261024/manifest.json`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/runs/travis-full-run2-20261024/manifest.json) · manifest CID `bafkreife3vk3cgcod3v6tue2xes3hvl2vndqoshbhrhsnjtriskihpcute` · Run 1 CID `bafkreiddef7ssybq6m4wpmah7adposaxbiawaxcmqndzk36wyhd7k4h6gu` · no IPNS (AD-03); the run index is [`runs/index.json`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/runs/index.json) |
| Independent verification | `npx tsx scripts/verify-manifest.ts runs/travis-202609-permits-20261021t103516z/manifest.json` prints `ALL ARTIFACTS VERIFIED` for the walking-skeleton run; the full-county runs are not fully verified yet (see Known gaps) (Pinata and Filebase gateways; ipfs.io and dweb.link retired on 2026-09-21, see [`docs/decisions/0001-read-path.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/0001-read-path.md)) |

## Evaluation points covered so far

| Point | Where to see it | Evidence |
| --- | --- | --- |
| A4 IPFS publication, zero idle cost | `/runs`, the manifest CID, `verify-manifest` | [`docs/evidence/A-03.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-03.md) |
| A5 DuckDB query layer and UI | `/permits`, `/tx/travis/explore?mode=sql` (DuckDB-WASM in the browser, read-only), `/data/catalog` | [`docs/evidence/A-03.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-03.md), [`docs/decisions/0001-read-path.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/0001-read-path.md) |
| A5 Explorer, hub, catalog and content pages | the hosted site (see Story status for what is proven) | [`docs/evidence/A-13.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-13.md) |
| Data contract (views, columns, missing reasons) | [`contract/v1/README.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/contract/v1/README.md) | [`docs/evidence/A-02.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-02.md) |
| Source discovery and readiness | [`pipeline/docs/travis-sources.yaml`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/pipeline/docs/travis-sources.yaml) | [`docs/evidence/A-01.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-01.md) |

## Story status

| Story | Status | Evidence |
| --- | --- | --- |
| A-01 Discover Travis County sources | ✅ merged (G7) | [`docs/evidence/A-01.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-01.md) |
| A-02 Freeze the data contract | ✅ merged (G7) | [`docs/evidence/A-02.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-02.md) |
| A-03 Walking skeleton: one month by CID, hosted UI | ✅ merged (G7): 43/43 hosted test cases, CI green | [`docs/evidence/A-03.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-03.md), [`docs/reports/A-03-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-03-test-report.md) |
| A-04 County backbone | ✅ merged (G7 PASS 10/10): ordinary land parcels 99.63% matched | [`docs/evidence/A-04.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-04.md) |
| A-07 Enrich and reconcile | ✅ merged (G7 PASS 10/10); BBB ratings and the conditional track are documented gaps | [`docs/evidence/A-07.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-07.md) |
| A-11 Publish the full county and incremental runs | ✅ merged (G7 PASS 10/10): Runs 1 and 2 published, scheduler deployed disabled; Run 3 is a known gap | [`docs/evidence/A-11.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-11.md), [`docs/reports/A-11-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-11-test-report.md) |
| A-13 Explorer UI and content pages | ✅ merged (G7, with a PO exception): 44 of 73 hosted cases pass, 0 fail, 29 parked as documented A-16 gaps; CI green on 7 hosted shards | [`docs/evidence/A-13.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-13.md), [`docs/reports/A-13-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-13-test-report.md), [`docs/decisions/DEC-A-13-explore-full-county.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/DEC-A-13-explore-full-county.md) |
| A-14 agent and MCP · A-16 cost and admin | not merged yet | [`docs/progress.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/progress.md) |

## Architecture

Constitution and decisions: [`docs/architecture-constitution.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/architecture-constitution.md) (§ 16 lists the amendments AM-01 to AM-08 made during A-03).

Golden Path: TypeScript · CDK (region from config; the demo runs in `eu-north-1` because the demo AWS project is region-locked; company default `us-east-2`) · Turborepo · tRPC + Zod · Powertools + X-Ray · Vitest + Playwright in GitHub Actions. Five stacks: `CountyLensData` (S3 + CloudFront CID copy), `CountyLensApi` (Lambda + HTTP API), `CountyLensWeb` (Amplify), `CountyLensOps` (SNS, alarms, $10 budget), `CountyLensCert` (custom domain). CI does not deploy: the account's organisation policy denies the GitHub OIDC provider, so infrastructure deploys run from the operator's machine after an explicit approval (AM-08).

## Delivery process

| What | Where |
| --- | --- |
| Lifecycle, gates | Gate log in [`docs/traceability.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/traceability.md) |
| Story-by-story progress and git graph | [`docs/progress.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/progress.md), one `--no-ff` merge per story on `feature/oracle-pipeline` |
| Test cases and execution reports | [`testplans/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/testplans), [`docs/reports/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports) |
| Code review logs and defects | [`docs/reviews/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reviews), [`docs/defects/`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/defects) |

## Kit usage

See [`docs/kit-usage.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/kit-usage.md): for each story, the agents and skills used and the reviewer scores (A-03: oracle 90/100, metagross 86/100; A-07: 90 and 92; A-11: donphan 92, oracle 82, machamp 80, porygon 80; A-13: metagross 77 then 80, audino 82 then 80).

## Reproduce

1. `pnpm install && pnpm test`, and `(cd pipeline/oracle-runtime && npm ci && npm test)`
2. `AWS_PROFILE=<profile> pnpm --filter @countylens/infra exec cdk deploy --all` (region from the profile)
3. `npx tsx scripts/verify-manifest.ts runs/travis-202609-permits-20261021t103516z/manifest.json`

## Known gaps

| Gap | Why | Next step |
| --- | --- | --- |
| Run 3 and the three-run immutability check | A-11 closed with Runs 1 and 2; Run 3 needs a later UTC date and pending data fixes (owner names, roof date) | A-16 |
| Full gateway verification of the full-county runs | Public gateways rate-limit the 456-artifact check; not complete at merge | A-16 |
| Demo video | Recorded once the full county and the explorer are live | Release step R4 |
| **Explorer filter search does not run on the full county** | One search joins all 441,961 properties inside the API Lambda: it ran out of memory at 1 GB, then times out at 29 s (HTTP 500). It worked on the 14-property slice (p95 817 ms). Demo lines for radius and roof age and for open permits show an error on live data. PO-accepted exception: [`DEC-A-13-explore-full-county`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/DEC-A-13-explore-full-county.md) | A-16 item 1: a per-run Explore index |
| SQL panel first query takes about 97 s on the full county (limit 8 s) | The first query binds 225 table parts; after that queries are fast | A-16 item 2 |
| Page speed on five manifest-driven pages (LCP 2.7 to 3.4 s against 2.5 s) | Rendering 240 table rows and two manifests on a throttled phone profile | A-16 item 3 |
| 29 hosted test cases are parked | Skipped with the A-16 gap named in the report, never counted as passed ([`docs/evidence/A-13.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-13.md)) | A-16 |
| Atlas registration | No Atlas access in this environment; an external dependency, not blocking | A-16 |
| Agent and MCP | Not built yet | A-14 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)


