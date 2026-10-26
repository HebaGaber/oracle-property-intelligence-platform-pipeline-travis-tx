# Oracle pipeline, Travis County TX: work in progress (stories A-01 to A-04, A-07, A-11, A-13 and A-14)

> **Draft.** This PR is open as a draft while the remaining stories are built. It is not ready for review. Stories A-01 to A-04, A-07, A-11, A-13 and A-14 are merged on `feature/oracle-pipeline`, each through gates G4–G7. Only A-16 (cost and admin) remains.

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
| A6 Source-backed agent and MCP server | `/tx/travis/explore?mode=ai` (the AI tab), `/help/mcp` (Try a tool), the MCP server `POST /mcp` with a bearer token; Inspector and `donphan` transcripts | [`docs/evidence/A-14.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-14.md), [`docs/evidence/A-14-mcp.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-14-mcp.md), [`docs/evidence/A-14-agent.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-14-agent.md) |
| Data contract (views, columns, missing reasons) | [`contract/v1/README.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/contract/v1/README.md) | [`docs/evidence/A-02.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-02.md) |
| Source discovery and readiness | [`pipeline/docs/travis-sources.yaml`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/pipeline/docs/travis-sources.yaml) | [`docs/evidence/A-01.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-01.md) |

## Story status

| Story | Status | Evidence |
| --- | --- | --- |
| A-01 Discover Travis County sources | ✅ merged `6c1383a`, 2026-10-20. G4 to G7 passed; G7 approved, CI green, oracle 83/100; C-04 and C-07 are accepted exceptions (project story) | [`docs/evidence/A-01.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-01.md) |
| A-02 Freeze the data contract | ✅ merged `e98c12e`, 2026-10-21. G4 to G7 passed; G7 approved, 33/33 tests, oracle 80, donphan 76 | [`docs/evidence/A-02.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-02.md) |
| A-03 Walking skeleton: one month by CID, hosted UI | ✅ merged `8ae1870`, 2026-10-21. G7 PASS 10/10: 43/43 hosted test cases, CI green, oracle 90, metagross 86 | [`docs/evidence/A-03.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-03.md), [`docs/reports/A-03-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-03-test-report.md) |
| A-04 County backbone | ✅ merged `01ee900`, 2026-10-22. G7 PASS 10/10, approved by the PO: ordinary land parcels 99.63% matched; two PO exceptions (permit match rate, coverage of ordinary parcels) | [`docs/evidence/A-04.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-04.md) |
| A-07 Enrich and reconcile | ✅ merged `5cb3090`, 2026-10-23. G7 PASS 10/10 after 8 pre-check rounds, approved: Tracks A and D built, 24/24 test cases, reviewers 90 and 92; BBB ratings (Track B, bbb.org blocks automated access) and the conditional Track C are documented gaps | [`docs/evidence/A-07.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-07.md) |
| A-11 Publish the full county and incremental runs | ✅ merged `50f9a10`, 2026-10-25. G7 PASS 10/10 with exceptions, approved: Runs 1 and 2 published, scheduler deployed disabled, CI green on 7 jobs; Run 3 and the three-run immutability check are a known gap carried to A-16 | [`docs/evidence/A-11.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-11.md), [`docs/reports/A-11-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-11-test-report.md) |
| A-13 Explorer UI and content pages | ✅ merged `c4b065e`, 2026-10-25. G7 PASS 10/10 with a PO exception, approved: 44 of 73 hosted cases pass, 0 fail, 29 parked as documented A-16 gaps; reviewers metagross 80, audino 80 on the post-merge delta; CI green on 7 hosted shards (main URL build `23221b6`) | [`docs/evidence/A-13.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-13.md), [`docs/reports/A-13-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-13-test-report.md), [`docs/decisions/DEC-A-13-explore-full-county.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/DEC-A-13-explore-full-county.md) |
| A-14 Roofing-lead agent, AI tab and MCP server | ✅ merged `283bf51`, 2026-10-25. G7 PASS with PO exceptions, approved: the agent, the Explore AI tab and the six-tool MCP server are deployed and answer on the hosted site on the small published run; golden queries G1 to G6 pass 6 of 6 (G1 to G4 on zero matching rows), MCP 12 passed, 1 accepted failure, 2 skipped, responsive 33 of 33; reviewers alakazam 80, ash 84, oracle 80, donphan 80; CI green on 7 hosted jobs. Not proven on the full county, 10 convergence tasks carried to A-16 | [`docs/evidence/A-14.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-14.md), [`docs/reports/A-14-test-report.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/reports/A-14-test-report.md), [`docs/decisions/DEC-A-14-agent-mcp-full-county.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/DEC-A-14-agent-mcp-full-county.md) |
| A-16 cost and admin | not merged yet | [`docs/progress.md`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/progress.md) |

Every pre-check and decision, gate by gate, is in the gate log: [`docs/traceability.md` § 3](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/traceability.md). "Accepted exception" means the PO approved a recorded departure from a criterion; each one is written down in `docs/decisions/` or the gate report.
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

Everything carried into A-16 is listed once in [`docs/evidence/A-16.md` § Closure](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/evidence/A-16.md), as Closed (with evidence) or Exception (with reason and PO decision). What stays open:

| Gap | Why | Next step |
| --- | --- | --- |
| Second independent pin and independent public gateway | Pinata's pin-by-CID needs a paid tier; the README's example gateways (ipfs.io, dweb.link) are retired. Filebase and the CloudFront CID copy serve every object | PO's separate session: Storacha CAR upload (CIDs unchanged) |
| MCP burst above 5 rps mostly answers 503, not 429 | API Gateway's throttle is approximate and the account allows 10 concurrent Lambdas; a WAF rate rule would bill while idle. PO kept $0 idle ([`DEC-A-14-mcp-burst-503`](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/blob/feature/oracle-pipeline/docs/decisions/DEC-A-14-mcp-burst-503.md)) | Lambda concurrency quota increase |
| Live admin Start through the laptop bridge | Built and unit-tested (fake queue, 36 tests); the live dry run waits until another session's Run 3.1 work releases the shared local Query DB (PO 2026-10-26) | One dry-run Start after Run 3.1 |
| County counts in the manifest coverage section | Run manifests are immutable; Run 3's coverage carries permit keys only. The Coverage page names the documented 441,961 | Written by the manifest builder from Run 4 |
| Out-of-area owner filter | Owner mailing location is not published in any run; the page and the agent say so instead of returning rows | A future run that publishes owner ZIP |
| Six-case golden grader on the full county | The grader re-binds the run locally and the CID copy refuses its unsigned fetch; the two README prompts were answered live on Run 3 instead | Grader reads parts through the signed path |
| SQL panel first query on the full county | The panel now binds only the views a query names and the tab renders, but the first full-county query still exceeds 4 min on the CI runner (TC-004, TC-023 parked, PO 2026-10-26) | Read one footer per table and only the queried columns |
| Page speed on Catalog and Manifest (Run 3) | LCP 3.1–3.3 s against 2.5 s; CLS 0.12–0.25 on Runs, Coverage, Manifest (TC-081 parked, PO 2026-10-26) | Reserve layout space; load the artifact table on demand |
| Run 3 size: Catalog footers and Filebase fallback | 255 parts, 983 MB (parked by the Run 3 session) | Footer-only Catalog read |
| Atlas registration | No Atlas access in this environment; an external dependency | — |
| Demo video | Recorded at release step R7 | R7 |

🤖 Generated with [Claude Code](https://claude.com/claude-code)


