# Kit Usage

Built with the [soofi-xyz team kit](https://github.com/soofi-xyz/soofi-xyz-team-kit), installed at project scope (see `.claude/settings.json`).

| Story | Primary agent | Skills loaded | Reviewer | What the kit decided or produced |
| --- | --- | --- | --- | --- |
| A-01 | `oracle` (designed: read-only consult in `specs/001-discover-sources/agent-design.md`; built: every task group and review fix as the `soofi-xyz-team-kit:oracle` builder) | `onboard-county`, `county-discovery`, `county-readiness-preflight`, `bootstrap-oracle-infra`, `apply-engineering-guidelines` | `oracle` (read-only): 72/100 at run 1, **83/100** at run 2; `/code-review` 3 runs (`docs/reviews/CR-A-01.md`) | Source catalog `pipeline/docs/travis-sources.yaml` (9 sources, 23 jurisdictions) and `docs/sources.md`; **verified by the kit readiness validator** `validate-county-readiness.py` (vendored, unmodified): exit 0, overall PASS (parcel gate by PO-approved exception) |
| A-02 | `mew` + `oracle` (designed: read-only consults in `specs/002-data-contract/agent-design.md`); `oracle` (built: every task group and review fix as the `soofi-xyz-team-kit:oracle` builder, three tracks in parallel) | `use-neutral-lexicon` (run by the PO), `use-oracle`, `build-county-transform`, `county-seed-data`, `county-permit-adapter`, `apply-engineering-guidelines` | `oracle` (read-only) **80/100**, `donphan` (read-only) **76/100**; `/code-review` (`docs/reviews/CR-A-02.md`) | Lexicon carrier record ADR-0002 (8 of 9 fields no carrier), local pilot through the four elephant-cli steps (no upload), `contract/v1` (four views, Zod schemas, 20-row sample), profile `travis-austin@1.0.0`, gazetteer `travis-places@1.0.0`; **verified by Vitest on the views over the pilot tables and `duckdb count(*) = 20` on `contract/v1/sample.parquet`** |

## Kit routing decisions (P1)

On 2026-10-17, `arceus` (kit 0.99.1) routed the README's eight build areas. Its full output is in [01-intent.md § 13](01-intent.md#13-kit-routing-arceus-output-pasted). These are the decisions on every difference between that output and the assessment agent map. The product owner approved them on 2026-10-17.

**Agents.** `arceus` named 11 agents: `oracle`, `mew`, `donphan`, `porygon`, `metagross`, `audino`, `smeargle`, `alakazam`, `ash`, `machamp`, `slowking`. The agent map uses all of them, and `arceus` gave each the same role. It named no agent that the map leaves out.

| Difference | Decision | Reason |
| --- | --- | --- |
| `arceus` not named by itself | Used only for planning step P1 | It is the router; it owns no story. |
| `espeon` not named | Not used in Task A | Its role in the map is Task B only (RAG backfill and live ingestion). |
| `babysit-release`: the map uses it for PR readiness, `arceus` says avoid it | **Left out** | It drives a PR through merge, and this repo never merges its PR. PR readiness is checked by the G8 pre-check and `slowking` instead. |
| Skills `arceus` added: `bootstrap-oracle-infra`, `monitoring-oracle-ingestion`, `durable-workflow-builder` (A-12), `unify-metrics` (via `porygon`), `responsive-design-tests` (via `smeargle`), `slowking`'s evaluation skills | Adopted | Each is added to the front matter of the matching story when it is written (P8). |
| No Texas business-registry or contractor-licence skill | `oracle` with `county-permit-adapter` | The kit's registry skills cover Florida only. Any limits are recorded as source constraints. |
| No DuckDB skill | `metagross` with `build-frontend-backends` | DuckDB reads only the published `elephant-cli` tables. `query-db-loading-matching` **is used** (A-05, A-07, A-10) for private reconciliation in the internal Query DB: folio identity, watermarks, tombstones, identity links and roof age. It is never the public data source (constitution A2). *Corrected 2026-10-19; the earlier text said it was not used.* |
| `ash` is a partial fit for A-14 | Kept as runtime co-builder | Its runtime and memory patterns are used; its Asana entry point is not. |

**Agents left out on purpose** (constitution XVII):

| Agent | Reason |
| --- | --- |
| `hoopa` | Requires Asana and a Hoothoot query per endpoint. Only the `unified-portal-smoke-testing` pattern is used. |
| `sylveon`, `chandelure`, `vivillon` | They work from Figma. The design is made in Claude Design. |
| `castform`, `braviary` | Google Tag Manager and marketing are not in the README. |
| `delibird` | A report catalog service, not needed here. |
| Prism product builders and configurers (`conkeldurr`, `uxie`, `celebi`, `zygarde`, …) | Task A uses no Prism products. |

## Architecture design consults (G3)

The design agents were consulted read-only before Gate G3, first on 2026-10-18 and again on 2026-10-19. Their answers, word for word, are in [decisions/0000-agent-architecture.md](decisions/0000-agent-architecture.md) (appendix). Their decisions are in [architecture-constitution.md](architecture-constitution.md) § 3 (AD-01 to AD-30).

| Agent | Area | Skills loaded | Result |
| --- | --- | --- | --- |
| `oracle` | Ingestion, reconciliation, publication, MCP | `use-oracle`, `onboard-county`, `query-db-loading-matching`, `deploy-open-data-mcp`, `apply-engineering-guidelines` | Its P0 rules decide every publication question (AD-01, AD-04, AD-05, AD-24 to AD-26) |
| `metagross` | Monorepo, app, API, hosting, CI | `build-frontend-backends`, `integrate-ci-cd`, `apply-engineering-guidelines` | Decides hosting, read path, timeouts and layout (AD-02, AD-09, AD-11, AD-23, AD-27) |
| `mew` | Lexicon classes and field names | `apply-engineering-guidelines` (`use-neutral-lexicon` can be started only by the user; the PO runs it in A-02) | Decides names and derivations (AD-07, AD-08, AD-25) |

## Golden Path gaps (known, documented)

| Gap | What we do instead | Recorded in |
| --- | --- | --- |
| PagerDuty Events API v2 (constitution IX) | One SNS email subscriber per alarm, the documented substitute | ARD D-04 |
| Company shared CI workflows and API domain mapping are not reachable from the fork | The same justfile recipes and stage order in local GitHub Actions workflows, deploying through a GitHub OIDC role | ARD D-05 |
| Lexicon / Main Dashboard metric registration | Business metrics emitted under the `CountyLens` namespace; registration listed as a gap in the PR | ARD D-05 |
| Kit runtime files are `.mjs` | Kept as provided; all new code is TypeScript | ARD D-03 |
| CDK in top-level `infra/` instead of `apps/api/cdk/` | Five stacks in `infra/` | ARD D-02 |
| Texas `company` has no lexicon ID field; no lexicon carrier yet for BBB, raw permit status or printed contractor name | Lexicon extension requests filed in A-02; missing fields show their reason | ARD AD-06, AD-25 |

## Reviewer scores before submission

| Agent | Score (0–100) | Main deviations fixed |
| --- | --- | --- |
| oracle (A-01) | 83 | Stale-run guard and terminal errors; honest deviation record (DEC-A-01-source-access D-1, D-3); WAF detection and no re-probe of 403/challenge sources (T056); parcel exception bound to its values; download robustness; amendments trail (`docs/reviews/CR-A-01.md`) |
