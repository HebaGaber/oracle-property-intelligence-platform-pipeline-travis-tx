# Kit Usage

Built with the [soofi-xyz team kit](https://github.com/soofi-xyz/soofi-xyz-team-kit), installed at project scope (see `.claude/settings.json`).

| Story | Primary agent | Skills loaded | Reviewer | What the kit decided or produced |
| --- | --- | --- | --- | --- |
| {A-01} | `oracle` | `onboard-county`, `county-discovery`, `county-readiness-preflight` | — | {sources YAML, readiness PASS} |

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
| No DuckDB skill | `metagross` with `build-frontend-backends` | `query-db-loading-matching` is not used, because the internal Query DB is never the public data source. |
| `ash` is a partial fit for A-14 | Kept as runtime co-builder | Its runtime and memory patterns are used; its Asana entry point is not. |

**Agents left out on purpose** (constitution XVII):

| Agent | Reason |
| --- | --- |
| `hoopa` | Requires Asana and a Hoothoot query per endpoint. Only the `unified-portal-smoke-testing` pattern is used. |
| `sylveon`, `chandelure`, `vivillon` | They work from Figma. The design is made in Claude Design. |
| `castform`, `braviary` | Google Tag Manager and marketing are not in the README. |
| `delibird` | A report catalog service, not needed here. |
| Prism product builders and configurers (`conkeldurr`, `uxie`, `celebi`, `zygarde`, …) | Task A uses no Prism products. |

## Reviewer scores before submission

| Agent | Score (0–100) | Main deviations fixed |
| --- | --- | --- |
| {oracle} | {n} | {…} |
