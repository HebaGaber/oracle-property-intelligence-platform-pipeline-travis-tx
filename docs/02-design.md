---
id: DES-A
type: design-map
title: "CountyLens: demo line → screen → state"
parent: FL-A
status: Draft            # Draft → Approved at the Design Checkpoint (PO sign-off)
version: 1.1             # final, after seven review rounds (88 log rows; 10 Blocking, all resolved), 2026-10-18
created: 2026-10-18
sources: README.md (Demo Transcript), docs/01-intent.md, design/HANDOFF.md (97 boards), design/design-review-log.md
---

# CountyLens: demo line → screen → state

**Scope rule.** CountyLens (Task A) is what gets built. CountyLens has no view switcher. Every board below is read with the prototype "Map view (CRM preview)" toggle **off**. The map, and everything that appears only with the toggle on, is a Roofing CRM prototype and is **not Task A scope** (§ 3).

## 1. Demo map

`#n` points to a row in [design-review-log.md](../design/design-review-log.md). "—" means the board covers the line as drawn.

| Demo line (README) | Screen · route | Board | State to show | Open items |
| --- | --- | --- | --- | --- |
| D-1 Opening: data loaded, DuckDB, IPFS, UI and agent | App shell on Explore · `/tx/travis/explore` | `Explore1440`, `ShellStates` | Populated. Badge "Run 3 · {date}" opens Runs | — |
| D-2 Pipeline run summary | Runs · `/runs` (public) | `Runs1440` | Completed: 8 sources, counts, timestamps, "99.4% of roll", limitations (BBB blocked, 403) | Run 4 and Running are sample data, cut in the build (#29) |
| D-3 Records by source with timestamps and provenance | Coverage · `/tx/travis/coverage` | `Coverage1440` | Loaded: one row per record kind (BBB as a Contractor sub-row), collected time, provenance link | — |
| D-4 DuckDB-backed query layer | Explore · SQL · `?mode=sql` | `ExploreQ-sql`, `ExploreQ-sqlperm`, `SqlStates` | Success with the engine line (DuckDB in your browser, CID copy); one typo error with its fix; "Run it yourself" command | — |
| D-5 Artifact manifest | Data · Manifest · `/data/manifest` | `DataManifest1440` | IPNS name → resolved CID; 13 artifacts (CID, name, size, codec, SHA-256, CAR); no `tiles/` | — |
| D-6 Fetch from two public gateways | Data · Verify · `/data/verify/{cid}` | `DataVerify1440`, `DataStates` | 38.2 MB `bafybei…` file; ipfs.io and dweb.link lanes Verified, with exact URLs and operator; size and digest match | Gateway test early in A-02 (#69) |
| D-7 New CID; old one intact; IPNS moved; CAR | Runs · Compare · `/runs/compare?a=2&b=3` | `RunsCompare1440` | Two CIDs; "Resolves on ipfs.io and dweb.link" pill; IPNS now and was; CAR link | CAR link and run window wired at implementation (#52) |
| D-8 Radius + roof > 15 yrs, basis, coordinates, source | Explore · Filters · `?r=5&roof=15`, List view | `ExploreQ-roof15` | Area + radius block; header "128 within 5 mi of Pflugerville city hall · roof ≥ 15 yrs"; columns Address · Roof · Basis · Conf. · Mi + bearing · Permit · Lat, lon · Source; Sort Nearest; change 5 → 3 mi live; Close matches; Why view | — |
| D-9 Open roofing permits, longest open, contractor, BBB | Explore · Filters in the D-8 area → Property drawer | `ExploreQ-permits5`, `Property1440` | Roof ≥ 15, open or stalled, open ≥ 5 yrs, sorted by open longest; permits table with open years, contractor, "BBB: Blocked · 403 · where available" | — |
| D-10 Agent: roofs > 15 yrs within 5 mi of {city} | Explore · AI · `?mode=ai`, Answer tab | `ExploreQ-ai`, `HelperStates` | "How I read this", streamed steps, editable chips, citations [n] ↔ numbered rows; "n of 10 AI questions left this session" | Check permit density in the Pflugerville ring in A-02 (#38) |
| D-11 Agent: long-open permits near that area, contractor | Explore · AI, second turn | `ExploreQ-aicontractor` | "Earlier in this conversation"; "that area" reused; "Open ≥ 5 yrs" chip (editable to 3); BBB missing-data note | #38 |
| D-12 MCP-ready | Help · MCP · `/help/mcp`, then MCP Inspector | `HelpMcp1440` | Six tools with schemas; Try a tool (public, throttled); `mcp-remote`, Claude Code and Inspector configs | Sample Try response must not ship (#44) |
| SC-2 Duplicates merged (no demo line) | Coverage · Reconciliation; Property · "Merged from" | `Coverage1440`, `PropertyDetail` | "Owner merged from 2 records"; contractor from 3 spellings | — |
| SC-4 Zero idle cost (no demo line) | Coverage · Cost | `Coverage1440` | 15 resources with idle cost: $0.51 a month when idle (the Route 53 zone), last bill explained, budget alert | — |
| SC-5 Tenure > 10 yrs, out-of-area owners (no demo line) | Explore · Filters | `ExploreQ-ooa78753` | Out-of-area and tenure > 10 both on (`ooa78753` preset), with the definitions shown | — |

## 2. Screens → tRPC procedures → data

Proposed by `metagross` over six rounds; G3 decides. **W** = runs in the browser (DuckDB-WASM), **L** = Lambda (tRPC, plus MCP's own handler), **D** = direct fetch of an immutable CID artifact. All call the same `query-core` functions.

| Screen | Procedures | Engine | Data |
| --- | --- | --- | --- |
| Shell, Hub status chip | `meta.latest` | L (cached) or D | IPNS → `manifest.json`, `runs/index.json` |
| Search box | `search.suggest` (places, addresses, permits) | L | places gazetteer, `v_property.address`, `v_roofing_permit` |
| Explore · Filters (Builder later) | `explore.search {area, radius_mi, roof, permit, openYrs, tenure, ooa, sort: nearest \| open_desc \| roof_desc, page}` → `{total_within_r, rows[{index, id, address, dist_mi, bearing, lat, lon, roof, basis, conf, permit, source_url, run, cid}]}`; `explore.closeMatches` → `[{row, miles_outside}]` | W (L for agent and MCP) | `v_property` ⋈ `v_roofing_permit` ⋈ `v_contractor`, slim geo-sorted serving Parquet |
| Explore · SQL | `sql.run` | **W only** | the views + `dist_mi()` |
| Explore · AI | `agent.ask`, streamed → `{answer, how, steps[], matches[] (citation n → row n), query {area, radius_mi, roof, permit, openYrs}, missing[], outcome: answered \| failed \| paused \| throttled}`; client sends the last 4 turns + context | L + Vercel AI SDK, provider set by `AI_PROVIDER` (confirm quota before A-14) | query-core tools |
| Explore · AI status | `ai.status` → `{paused, resetsAt}`. The 10-per-session count lives in `sessionStorage`; only `answered` counts | L | daily spend counter |
| Property detail | `property.get` (adds `mergedFrom[]`); `property.similar` (rule defined in implementation, #63) | W or L | views + `v_lineage` |
| Runs, Compare, Log | `runs.list`, `runs.get`, `runs.compare`, `cid.check`, `runs.events`, `runs.live` | D (+ live gateway checks) | `runs/index.json`, manifests, `events.json`, `runs/live.json` |
| Runs · admin | `admin.me`, `admin.runs.start / stop / retry` → SQS (15 min expiry, cancel by command ID) → local bridge next to Restate → `runs/live.json` | L (Cognito JWT, admin group) | SQS queue, one S3 status object |
| Coverage | `coverage.get` (with `merge`, `cost`) | D | `coverage.json`, `merge_stats.json`, `cost.json` (built at release) |
| Data · Manifest, Verify, Catalog | `manifest.get`, `ipns.resolve`, `verify.fetch` (labelled fallback), `schema.get` | D; L for IPNS and fallback | `manifest.json`, ipfs.io and dweb.link (plain file URLs), `schema.json` |
| Help · MCP | Own handler `POST /mcp` (stateless Streamable HTTP, public read-only, throttled, CORS + Origin check); Try a tool calls it directly | L | query-core Zod schemas |
| Activity (admin) | `admin.activity.summary`, `admin.activity.list` | L, Logs Insights cached 5 min | `/countylens/query-log` (server events only) |
| Publication (pipeline) | IPNS publisher (key in SSM SecureString) | pipeline | IPNS name → latest `manifest.json` |

**Data path.** W and L read the slim serving Parquet from an immutable copy named by its CID (Amplify or S3, checked against the CID at release), with a public gateway as fallback. Verify (D-6) always uses the public gateways. No map library, basemap, tiles or OSM attribution.

**View columns to confirm in A-02.** `v_property`: `last_sale_date` / `tenure_yrs`, `owner_out_of_area`, `centroid`. `v_roofing_permit`: `status`, `issue_date`, `expiry_date`, `final_date`, `open_days` (stalled = open and past its expiry date).

**URL state.** `area` in the procedures = `place` or `at` in the URL. Parameters: `at`, `r`, `roof`, `permit`, `openYrs`, `tenure`, `ooa`, `sort`, `sel`, `mode`, `place`, `view=list`. There is no `z` (zoom), and `view=map` falls back to List.

**Limits (G3).** Stage throttle and reserved concurrency on `/mcp` and `agent.ask` (a Function URL bypasses the stage throttle, #71). Model budget cap, about 6 steps and 1.5k output tokens per answer, alarm at 80%. No per-IP limits.

**Hosted state, all at $0 idle except the $0.50 a month DNS zone.** Cognito (admin sign-in only), the SQS run-command queue and `runs/live.json`, CloudWatch Logs, and one on-demand DynamoDB counter item per UTC day for AI spend. There is no query database.

**Cost traps (G3).** SSM SecureString, not Secrets Manager. No customer KMS key or WAF. 7–14 day log retention (30 days for the query log). No provisioned concurrency. No metric filters.

## 3. Scope decisions

Principle: build what proves a demo line, polish what the evaluator touches, and show the rest as **Coming soon**, so the extra ideas are visible without being faked. Build D-1 to D-12 before any "Build, light" item.

| Item | Decision | Effort | User benefit |
| --- | --- | --- | --- |
| Runs, Compare, Manifest, Verify, Coverage, Explore Filters + SQL + AI, Property, Why view, Help · MCP | **Build** | L | High |
| List view with the Area + radius block, live "n within r mi" header, Mi + bearing, Lat, lon, Sort Nearest, Close matches | **Build** | S–M | High |
| Agent Answer tab (How I read this, steps, citations ↔ rows, follow-up) | **Build** | M | High |
| Run timeline scrubber, gateway race | **Build** | M | High |
| SQL checks, pipeline diagram + Gantt (real `events.json` only), area matrix, Runs log, Catalog, Legal, saved searches, "Open in OpenStreetMap" link | **Build, light** | S–M each | Med |
| Activity (admin only, CloudWatch server events) | **Build, light** (#18) | S | Low |
| Start / Stop / Retry run (admin only) | **Build, light** (#19) | M | Med |
| Hub landing page (CRM card "Coming soon"; the "Preview Explore with the map" link is prototype only, #87) | **Build, light** (#15); wire Watch demo and PR links at release | S | Low |
| Similar properties | **Keep**, last in the build order (#63) | M | Low |
| AI quota: 10 per session, server spend caps, paused state | **Build** (#66, #79) | S | Med |
| Builder mode | **Coming soon** (#21) | – | Low |
| Other counties, Street View | **Coming soon** (#17, #20) | – | Low |
| AI-user sign-in | **Coming soon**, not linked (#66) | – | Low |
| Owner and contractor name search, welcome tour | **Cut** (#33, #47) | – | – |
| Simulated Running run, Run 4 sample, fake Try response, "not wired" toasts, ProtoBar | **Prototype only, must not ship** (#29) | – | – |

**Not Task A scope (do not build, do not mark as missing).** The map view and everything that appears only with the prototype "Map view (CRM preview)" toggle on: map, markers, ring and handle, map count chip, legend, Layers, hexagons, coverage-gap hatch, map controls and keyboard, map accessibility rules (A-4 to A-7), OSM credits, `tiles/`, the `ExploreQ-crmmap` board, and the toggle itself. CountyLens has no view switcher and no "Soon" marker for any map item (PO, round 5, #74). Story specs, `smeargle` responsive tests, G4–G7 checks and reviewers must not count any of these as missing scope.

**Presenting the breadth.** 97 boards, admin sign-in, the Hub and Activity are each light, but together they are a lot. In the PR and the demo video, present the app as **Must vs Coming soon**, so the extra ideas read as a deliberate roadmap and not as unfinished work.

**Decision:** ☐ Approved ☐ Approved with changes · HebaGaber · {date}
