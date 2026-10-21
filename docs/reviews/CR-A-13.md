---
id: CR-A-13
type: code-review-log
story: A-13
branch: 013-explorer-and-pages
reviewed_commit: 70561ec (all three reviews on the whole branch after wave 3); fixes in the commit that follows it
tools: [soofi-xyz-team-kit:metagross, soofi-xyz-team-kit:audino, /code-review]        # /code-review ultra once per repo before G8
created: 2026-10-22
---

# Code Review Log: A-13 Explorer UI with its hub, legal, catalog and Coming soon pages

One review round on the whole branch (light lane L5). Reviewers read the code and tests; they did not run the pages in a browser. No re-score was needed: both reviewers scored 75 or more before the fixes.

## Runs

| Run | Tool | Effort | Date | Commit | Findings | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/code-review` (whole branch, read-only) | medium | 2026-10-22 | `70561ec` | 8 (0 Critical, 3 correctness defects fixed, 5 Minor) | n/a (all fixed or deferred below) |
| 2 | `soofi-xyz-team-kit:metagross` (read-only reviewer) | n/a | 2026-10-22 | `70561ec` | 3 Major, 11 Minor | **77 / 100** (pass) |
| 3 | `soofi-xyz-team-kit:audino` (read-only reviewer, with frontend-bug-fix) | n/a | 2026-10-22 | `70561ec` | 2 Major, 5 Minor | **82 / 100** (pass) |

## Findings

CR-n = `/code-review`, MG-n = metagross, AU-n = audino.

| # | Severity | File:line | Finding | Resolution |
| --- | --- | --- | --- | --- |
| CR-1 | Major | `ExploreSql.engine.ts:83` | read-only guard stripped `--` and `/* */` before blanking strings, so `SELECT '--'; DROP TABLE v_property` reached the engine | Fixed: one tokenizer pass; 30 refuse and 13 allow cases; also refuses file/URL readers (`read_*`, `parquet_scan`, `glob`, `COPY`, `ATTACH`, `INSTALL`, `LOAD`) and allows `load`/`set` as identifiers (covers MG-12) |
| CR-2 | Major | `FilterSheet.tsx:74` | the Radius field could not be cleared; typing "3" after Backspace gave 53 and a silent 5 mi search | Fixed: local draft, clamped commit on valid input, optional fields clear to "no filter" |
| CR-3 | Major | `ExploreFilters.tsx:154` | the `answered` ref paired an older result with the new area name from the URL (header "37 within 5 mi of Pflugerville" for Austin rows) | Fixed: the place name is built into the request (`AskedSearch`); race test red → green |
| CR-4 | Minor | `ExploreFilters.tsx:100` | header template split with `.split(" · roof")` | Fixed: `EXPLORE_TEXTS.headerNoRoof` (covers MG-9) |
| CR-5 | Major | `ExploreSql.tsx:88` | unbounded SQL result materialised in React state | Fixed: `LIMIT 501` wrapper; caption "showing the first 500 rows" |
| CR-6 | Minor | `explore.ts:150` | the `perm` window CTE ranked every roofing permit in every statement | Fixed: ranking restricted to properties inside the bounding box (`explore-rank.test.ts`). Summary and rows stay separate statements (not merged): deferred, no measured need at today's data size, re-measure with A-11's full county |
| CR-7 | Minor | `DataVerify.tsx:85` | `findCid` loaded the whole chain before checking any manifest | Fixed: one link at a time, stops at the first hit |
| CR-8 | Minor | `RunsCompare.tsx:54` | empty or 0 run number treated as valid | Fixed: defaults; numbering contract shown on the page |
| CR-9 | Minor | `ExploreFilters.tsx:297` | only the first 200 rows reachable | Fixed: "Load more" (page+1, de-duplicated, announced) |
| MG-1 | Major | `Provenance.tsx:60` | `source_url` from published data rendered as `href` without a scheme check | Fixed: `safeHttpUrl()` (http/https only), plain text otherwise; also used for manifest `source.url` in Runs and Coverage |
| MG-2 | Minor | `contract manifest.ts:22` | `z.string().url()` accepts any scheme | Accepted: contract is frozen and shared with the pipeline; every rendering site now goes through `safeHttpUrl()` |
| MG-3 | Major | `parquet-meta.ts:49-50` | a host that ignores Range sends the whole part; parts fetched in parallel | Fixed: a 200, or a 206 larger than asked, is refused and the body cancelled ("footer unavailable · host ignored Range"); 4 MiB cap; one footer at a time per table, 2 tables at once; Catalog uses `readTableMeta` |
| MG-4 | Minor | `verify-lane.ts:130`, `run-chain.ts:76` | unbounded `arrayBuffer()` | Fixed: streamed read with a byte cap (size + 1; manifests 1 MB); oversize = mismatch, never ✓ |
| MG-5 | Major | `scripts/bundle-size.ts:88` | the bundle gate forbade only duckdb and `.wasm`; the zod / hyparquet / barrel guardrails were not enforced | Fixed: `checkPlacement` (Vite manifest + chunk-content markers) with passing and failing fixtures; real build: `/` holds no zod, hyparquet, DuckDB or query-core barrel |
| MG-6 | Minor | `ExploreFilters.tsx:10-16` | barrel import pulled bind-manifest, zod and gazetteer into the Explore chunk | Fixed: subpaths `@countylens/query-core/{places,explore}` |
| MG-7 | Minor | `ExploreFilters.tsx` | BAD_REQUEST showed a Zod JSON dump, no retry | Fixed: API sentence ("radius_mi must be at most 25") and page text `filtersOutOfRange` with Retry |
| MG-8 | Minor | `ExploreFilters.state.ts` | no paging | Fixed (CR-9) |
| MG-10 | Minor | `ExploreFilters.tsx` | "no open roofing permits…" shown when another filter excluded the rows | Fixed: only when the permit filter is the only active filter |
| MG-11 | Minor | `ExploreFilters.tsx` | `sel` outside the current results silently ignored | Fixed: "property not in these results" notice |
| MG-13 | Minor | `explore.search` | public, unthrottled? | Checked: `infra/src/api-stack.ts:300` sets stage throttle 10 req/s, burst 20 (applies to `/api/trpc`). No change |
| AU-1 | Major | `VerifyLane.tsx:~107-143` | final Verify states not announced (new `<p>`, no live region) | Fixed: one persistent `role="status" aria-live="polite"` paragraph; `role="alert"` for mismatch/failed |
| AU-2 | Major | `Hub.tsx:~56-66` | Hub chip loading and ready states silent to assistive technology | Fixed: chip row is a persistent `role="status"`; "Loading latest run" for AT while the fixed-size skeleton shows |
| AU-3 | Minor | `AppShell.tsx:~52-75` | More sheet `role="dialog"` with no modal behaviour | Fixed: `aria-modal`, scrim, focus moved in and trapped, background `inert`, Escape returns focus |
| AU-4 | Minor | `FilterSheet.tsx:~91-140` | combobox without keyboard support | Fixed: ArrowUp/Down, `aria-activedescendant`, `aria-selected`, Enter, Escape |
| AU-5 | Minor | `Hub.tsx:~60` | error chip styled differently from the ready chip | Fixed: named `StatusPill` with the reason and the index link |
| AU-6 | Minor | tests | CSS guarantees (48 px, no animation, CLS boxes) asserted only from CSS source in jsdom | Open by design: the hosted `A-13-scan`, `A-13-vitals` and responsive specs run at final HEAD in TZ03/TZ04 |
| AU-7 | Minor | CSS modules | `overflow-x: auto` on tables and code blocks | Open by design: confirmed by the hosted no-horizontal-scroll check at 390 (TC-080) |

## Known gaps carried forward (not review defects)

- Help · MCP shows an input schema for `search_properties` only; the other five tools say "published with the MCP server in story A-14" (no Zod schemas exist in query-core yet).
- The BBB terms page answers 403 from this network; recorded as such in `content/legal.ts`, not bypassed. The PO confirms the link in a browser at A-2.
- The published run holds one month of Austin permits (35 permits, 14 parcels, 0 stalled), so Pflugerville is empty and no permit is open for years. Demo area: PO decision D-11 (round R4).

## Constitution and architecture check

| Rule | Result | Note |
| --- | --- | --- |
| Zod on every tRPC input; no `any` | ✅ | `explore.search` input strict and bounded; published files parsed with Zod (Hub index by a dependency-free reader so the Hub stays small) |
| LLM calls only through the Vercel AI SDK | n/a | no LLM call in this story |
| Powertools logger, tracer and metrics in every Lambda | ✅ | `explore.search` reuses the A-03 handler: `procedure`, `queryDurationMs`, `duckdb.query` subsegment, `exploreSearchSql` builder label |
| No secrets or PII in code or logs | ✅ | none; link URLs are public config; gitleaks runs in CI |
| P0 rules in `docs/architecture-constitution.md` | ✅ | AD-01/02/03/04/05/07/08/18/19/24/25, AM-01/04/06/08 (see plan Constitution Check); Verify never uses the CID copy; SQL only in query-core |

**Open Critical findings:** 0. **Reviewer scores:** metagross 77, audino 82 (both ≥ 75).
