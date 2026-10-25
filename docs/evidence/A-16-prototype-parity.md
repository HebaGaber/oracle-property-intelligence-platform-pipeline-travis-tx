# A-16 prototype parity (AC-12)

**Scope (PO, 2026-10-26): demo path first.** Shell/header, Explore workspace and drawer, Runs, Compare, Log, Coverage and Data are matched to their boards at 390/768/1440 (light theme). Board features with no data source or outside the architecture are recorded as Justified with their reason. Hub, Help MCP and Legal: structure and copy only.

## Baseline, before A-16 fixes (smeargle, production `cb0a4d2`, 2026-10-26)

Before images: `docs/evidence/img/A-16-parity-before/`. After-fix verdicts are added in the final section by the re-run (TZ04).

# AC-12 parity matrix: hosted CountyLens vs prototype boards

Hosted: https://countylens.aldarraj.com (light theme, production). Boards: `design/prototype/*.dc.html`, served over http from a local static server (file:// cannot load sibling boards). `ds/atlas/components/bundle.css` is missing from this repo, so the Atlas component CSS was taken read-only from `/Users/hebagaber/Github/roofing-crm/design/prototype/ds/atlas/components/bundle.css` (same tokens.css apart from one CRM-only token). Data values were not compared.
Images (board left, hosted right): `img/<cell>.png` in `/private/tmp/claude-501/-Users-hebagaber-Github-oracle-property-intelligence-platform-pipeline-travis-tx/2d0f647c-dca9-46ae-9b35-795965af8f06/scratchpad/parity/img/`. Raw captures: `board/`, `app/`, text dumps `txt/`.

Method notes
- One load per hosted page per width (Explore states at 1440 and 390 only; SQL/AI also 768). The hosted shell scrolls inside a container, so hosted screenshots show the first viewport only (about 900/1024/844 px); section order and copy for the rest were read from the page text dump (`txt/app-*.txt`). The AI answered state and SQL result state were not run (model and Filebase quotas); only the idle AI and SQL panels were captured.
- Boards with no width variant were compared at the nearest width (stated per row). Shell, drawer and state boards compare against the closest hosted page.
- Boards are wrappers: `Explore390/768`, `ExploreQ*`, `Hub390/768`, etc. import the 1440 component with `device`/`preset` props.

Legend: Match / Differs / Not built. "CJ" = candidate justified by architecture.

## Recurring differences (referenced by code below as R1..R9)
- R1 Header: board has a top bar with location chip (Travis County, TX), global Search box ("Search an address, place, ZIP or permit, or ask a question"), sync badge ("Run 3 · Oct 17", opens Runs), help (?) menu, "Ask" button, apps grid; at 390 location pin, help, bot, apps icons and a search pill. App has a bare "CountyLens" title bar only. Files: `components/AppShell.tsx`, `AppShell.module.css`, new `components/SearchBox.tsx`, `components/SyncBadge.tsx`.
- R2 Rail: board rail = Explore, Runs, Coverage, Data, Admin (Activity + Signed in when admin); app rail = Explore, Runs, Coverage, Data, More. Board 390 bottom nav = 4 items (Explore, Runs, Data, More; Coverage lives in More); app shows 5 (Coverage is its own tab). `AppShell.tsx`.
- R3 Board pages have a page title row with a Run picker ("Run 3 · current"), Download CSV buttons and a back arrow on sub-pages; app pages use a monospace "Data · Manifest" style heading and no run picker. Files: each `routes/*.tsx` header.
- R4 Board typography/layout uses Atlas cards, chips, tables and bars; app pages are mostly plain text blocks with monospace labels (`Run travis-full-run2-...`). Files: `routes/*.module.css`, `components/StatusPill.tsx`.
- R5 Board footer strip: Terms · Privacy · Data licences + "Street View: coming soon" at the bottom of every desktop page; app has links only on the Hub (and they are hidden under the 390 bottom nav). `AppShell.tsx`.
- R6 Board "Prototype" state-preview toggles are prototype chrome, not product. Not required.
- R7 Run identity: board hero says "Run 3 · Oct 17"; app shows `travis-full-run2-20261024` raw ids on Runs/Manifest/Catalog. Use "Run N · date" label plus the id as secondary. `data/runs-index.ts`, `Runs.shared.tsx`.
- R8 Hosted shows "Other counties and states · Coming soon" plus the three Coming soon links (Builder mode, Saved searches, Area matrix) as a text strip above the Explore tabs; board has none of these on Explore (Builder is a rail item, saved searches is "Save"). Likely justified by spec (coming-soon entries are required by A-13); keep but restyle as chips.
- R9 County selector is a native `<select>`; board is a location chip opening a menu (desktop) or bottom sheet (390) with Live / Coming soon rows. `components/CountySelect.tsx`.

## 1. Shell + Hub + Welcome

| Board | Hosted route | Width | States | Verdict | What differs and fix (element: board / app / file) |
|---|---|---|---|---|---|
| Hub1440 | / | 1440 | loaded | Differs | Header "Apps" + MCP and API docs link (board) vs CountyLens shell with rail (app). Board hero "Open property data tools / Two apps built on the same published runs..." with Run chip, "Watch demo" and "Pull requests" buttons; app hero "Old roofs and long-open permits, from files you can verify". Board app cards have feature check lists (3 checks), status pills (Live · Travis County / Coming soon / Not deployed yet), "Open CountyLens" with arrow, "What can I ask?"; app cards have short sentence + Open / What can I ask? / Open CRM (disabled). Board "Shared by both apps" tiles (Runs and CIDs, Coverage, MCP and API, Data use and licences) are missing in app. Board counties line "Counties: Travis County, TX live · Williamson County, TX coming soon" missing. `routes/Hub.tsx`, `Hub.module.css`. Image `img/A-16-parity-before/hub-1440.jpg` |
| Hub768 | / | 768 | loaded | Differs | Same as 1440; cards stack in board (2 rows), side by side in app. `img/A-16-parity-before/hub-768.jpg` |
| Hub390 | / | 390 | loaded | Differs | Same content gaps; board has no bottom nav on Hub, app shows 5-tab bottom nav that also hides the Data sources / Privacy / Terms links (R5). `img/A-16-parity-before/hub-390.jpg` |
| Hub states (run status Loaded/Loading/Unavailable, CRM Not deployed/Live) | / | 1440 | loading, unavailable | Differs | Board Run chip has Loading and Unavailable variants and CRM Live variant. App chip only seen in loaded state; not triggerable on hosted. Check `Hub.tsx` renders chip for loading and error. |
| Shell1440 (help menu open over Explore) | /tx/travis/explore | 1440 | help menu open | Differs | No help (?) button or menu (What can I ask?, Glossary, MCP and API docs...). R1. `AppShell.tsx` |
| Shell390Location | /tx/travis/explore | 390 | location picker sheet | Differs (CJ in part) | Board bottom sheet "Choose a location" with Texas/Other states groups, Live and Coming soon pills, "Sample · illustrative list" note. App native select + "Other counties and states · Coming soon" link. CJ: states other than Texas are not in scope; the sheet itself is still buildable. R9. `components/CountySelect.tsx` |
| Shell390More | any | 390 | More sheet open | Differs | Not opened on hosted (nav code only). Board list: Coverage, SQL, What can I ask?, Glossary, MCP and API docs, Apps, Admin sign-in, Settings, footer links, "Street View: coming soon". App MORE_PAGES: Data catalog, Runs log, Runs compare, Help MCP, Legal x3 + Coming soon items. Align labels and items. `AppShell.tsx` (`MORE_PAGES` in `routes/route-list.ts`) |
| Shell390ComingSoon | /tx/williamson/explore | 390 | other-county | Differs (CJ) | Board: modal card "Williamson County, TX is coming soon", sentence, sample note, button "Stay on Travis County". App: full page "Other counties" + "CountyLens has data for Travis County, TX only" + link "Open Travis County Explore". Same message intent; make it a dialog from the county picker. CJ because there is no other-county data, but the modal and button copy differ. `routes/ComingSoon.tsx` |
| Shell coming soon 1440/768 (nearest: Shell390ComingSoon) | /tx/williamson/explore | 1440, 768 | other-county | Differs (CJ) | Same as above. `img/A-16-parity-before/soon-1440.jpg`, `soon-768.png` |
| ShellStates (sync badge: Loading, Populated, Partial data, Stale, Rate-limited, Error, Empty) | header | 1440 | 7 states | Not built | No sync badge exists in the header (only a Run chip on Hub). Build `SyncBadge` with the 7 states and copy ("Checking sync...", "Run 3 · Oct 17", "Run 3 · 3 of 4 sources", "Stale · synced 3 days ago", "Status check rate-limited, retrying in 4 s", "Sync status unavailable · Retry", "No runs yet for this county"). |
| Welcome1440 | /tx/travis/explore | 1440 | first visit | Differs | Board shows a "What can I ask?" card over Explore on first visit; app Explore shows no card (the "What can I ask?" button on Hub goes elsewhere). Add a dismissible first-visit card with the sample questions. `routes/Explore.tsx` |
| Welcome768 | same | 768 | first visit | Differs | Same. |
| Welcome390 | same | 390 | first visit | Differs | Same. |

## 2. Explore + drawer + filters + Search

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| Explore1440 (Filters, Pflugerville, roof >= 15, 9 rows + Close 3) | /tx/travis/explore | 1440 | results | Differs | Board = workspace: left panel "Filters · query" with preset chips (Roof age at least 10/13/15/20/25), Roofing permit segmented Any/Open or stalled/Stalled, "Open >= any time" menu, Owner chips (Tenure > 10 yrs, Out-of-area), Suggestions, footer "128 properties match · Clear · Save"; centre = Matches 9 / Close 3 tabs, dense table (Address, Roof, Basis, Conf., Permit, Mi, Lat/lon, Source, Info) with row checkboxes, pager, radius slider; top toolbar "Area: Pflugerville" and "Sort: Oldest roof". App = single column: Explore h2, Filters/SQL/AI tabs, text inputs (Place, Radius number, Roof age number, Open or stalled checkbox, Open >=, Sort select, Tenure, Out-of-area), then property cards (grid of labelled fields). Fixes: replace number inputs with chip/segmented controls (`components/FilterSheet.tsx`), result table (`components/ResultRow.tsx`, `ExploreFilters.tsx Results`), Matches/Close tabs, pager instead of "Load more", radius slider, Clear/Save, suggestion chips. Map view: CJ (Coming soon). |
| Explore768 | same | 768 | results | Differs | Board 768 two panes (filters collapsed to a rail/sheet); app single column. Same fixes. |
| Explore390 | same | 390 | results | Differs | Board: search pill, "128 within 5 mi", place chip + radius slider, Filters and "roof >= 15 yrs" chips, bottom sheet list Matches 9 / Close 3, "Edit query" FAB, pager "1-2 of 9". App: County select, coming-soon links, Filters button, plain card list. |
| ExploreStates (results pane: loading, empty, close matches, error...) | /tx/travis/explore | 1440 | loading, zero, error | Differs | App has skeleton cards, zero-result line "No properties within 5 mi · N close matches just outside", "+0.605 mi" label, ErrorBanner with retry. Board uses table skeleton rows and a "Close 3" tab rather than inline list; copy to align per `txt/board-ExploreStates.txt`. `ExploreFilters.tsx` |
| EmptyHints | /tx/travis/explore | 1440 | empty | Differs | Board shows hint chips ("Try roof >= 15", "Open permits 5+ yrs") when no results; app only says "No properties within 5 mi". Add suggestion chips. `ExploreFilters.tsx` |
| HelperStates (helper text, tooltips, inline validation) | /tx/travis/explore | 1440 | helper | Differs | Board Owner help text ("= mailing address outside Travis County", "Tenure = years since last sale"); app has similar helper lines but also leaks a stray token "ooa78753" under Out-of-area owner (bug, `components/FilterSheet.tsx`). |
| ContractorBadge | drawer/row | 1440 | resolved, candidate, ambiguous, conflicting, unresolved | Differs | App shows "Contractor unresolved" chip and BBB line; verify all five identity states render with the board labels. `components/ContractorBadge.tsx` |
| SearchStates / SearchBox (header search, suggestions, recent, no match, permit and CID results) | none | 1440, 390 | all | Not built | Board search box lives in the header (and as a 390 pill) with place, address, ZIP, permit number, "ask a question" modes and suggestion groups. App has no global search; only a Place field inside Filters. |
| Property1440 (drawer over Explore) | /tx/travis/explore?sel=... | 1440 | open | Differs | Board drawer: address title, Sample/TCAD id, chips (Roof 23 yrs · High, Stalled 6.4 yrs, Out-of-area owner), Street View coming-soon box, "Open the area in Google Maps", buttons Show in the list / Ask about this property / Open in CRM (CJ: CRM not deployed), Roof section with evidence chain (Reroof permit -> Austin permits -> CID), warning when permit not counted. App drawer: "Property bagu...jkdq" title + Close, field grid, missing-reason pills, Source line. Fixes: title by address, chip row, evidence chain, "Ask about this property" (opens AI), keep CID display. `routes/PropertyDrawer.tsx`, `components/ResultRow.tsx` |
| Property768 | same | 768 | open | Differs | Board full page beside rail; app inline card. Same fixes. |
| Property390 | same | 390 | open sheet | Differs | Board bottom sheet with grabber, address title, copy-link and close, chips, buttons; app inline card with Close (no grabber, no address). Missing-reason pills are good (Match for that element). |
| Property390Full | same | 390 | full length | Differs | Sections after Roof: Permit, Owner, Contractor, Sources/provenance (see board). App has one field list + "Not included in the published tables" + Source line. |
| Property390NoImagery | same | 390 | no street view | Differs (CJ) | Board "Street View: coming soon" dashed box; app only links Street View under Coming soon. CJ because imagery is out of scope, but the box and copy "No street photo yet. The property data below is unaffected." should still show. |
| PropertyStates | drawer | 1440 | loading, missing fields, not in results | Differs | App has "not in results" status text and per-field reasons (Match); no loading skeleton for the drawer; board grouped "What is missing" panel. `PropertyDrawer.tsx` |

## 3. ExploreQ states (Filters, AI, SQL)

Boards are `ExploreQ-*` (1440), `ExploreQ390-*`, `ExploreQ768-*`. Hosted comparisons use `x-roof15`, `x-permits5`, `x-ooa78753`, `x-stalled78753`, `x-sql`, `x-ai` captures.

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| ExploreQ-roof15 / 390-roof15 | ?place=Pflugerville&roof=15&r=5 | 1440, 390 | results | Differs | Same as Explore1440/390 (table + chip panel). App header "N within 5 mi of Pflugerville · roof >= 15 yrs" matches the board's header sentence (Match for that string). |
| ExploreQ-permits5 / 390-permits5 | ?permit=open_stalled&openYrs=5 | 1440, 390 | results (D-9) | Differs | Board "57 within 5 mi ... open permits 5+ yrs" with Roofing permit segmented "Open or stalled" and "Open >= 5 yrs" menu; app checkbox + number. Header text not shown with the permit filter on app. |
| ExploreQ-ooa78753 / 390 | ?place=78753&ooa=1 | 1440, 390 | results | Differs | Board chip "Out-of-area" selected plus table with "Out-of-area owner" blue badge; app checkbox and cards. |
| ExploreQ-stalled78753 / 390 | ?place=78753&permit=stalled | 1440, 390 | results | Differs | Board Stalled segment active and Stalled N yrs chips; app select/checkbox. |
| ExploreQ-builder / 390 | none (Coming soon) | 1440, 390 | empty builder | Not built (CJ) | Board query-builder empty start; app shows "Builder mode · Coming soon" link and `/soon/builder-mode` page. CJ: coming-soon is required by A-13. |
| ExploreQ-crmmap | none | 1440 | map view | Not built (CJ) | Prototype-only CRM map preview; app falls back `view=map` to list by design. CJ. |
| ExploreQ-sql / 390-sql | ?mode=sql | 1440, 390 | empty start | Differs | Board SQL panel: "SQL · query" editor with Schema and Run, sample query, "DuckDB-WASM in your browser · read-only" line, Suggestions, table with Matches/Close. App: tab + "SQL checks · Coming soon", "DuckDB-WASM in your browser · read-only", progress "Reading the run manifest", then editor (not shown in capture). Editor chrome (Schema button, Run, suggestions) to verify at idle; `routes/ExploreSql.tsx` |
| ExploreQ-sqlperm / 390-sqlperm | ?mode=sql | 1440, 390 | query run | Differs | Result renders as a plain grid (`table[aria-label="Query result"]`) not as the Explore results table with Matches/Close tabs and row badges. Not run (Filebase quota). |
| SqlStates (loading, running, empty, rate-limited, partial, errors in plain words) | ?mode=sql | 1440 | 6+ | Differs | Board copy e.g. "Starting DuckDB in your browser...", "There is no column called 'roof_age'. Did you mean roof_age_years?", "This panel is read-only." Verify each string in `ExploreSql.tsx` / `ExploreSql.engine.ts` and `packages/shared/src/texts.ts`; only the loading text was seen. |
| ExploreQ-ai / 390-ai | ?mode=ai | 1440, 390 | answered | Differs | Board AI panel: left "Ask in plain English" textarea with "10 of 10 AI questions left this session" + Find button, Suggestions, "Read as - tap to change, x to drop" assumption chips (Centre, Within 5 mi, Roof age); centre Answer/Close tabs, "How I read this" steps, numbered sources, warning band; right results table. App: "Ask about roofing leads in Travis County" textarea + disabled Ask + "0 of 10 questions used this session"; answered layout (How I read this, What is missing, Sources) exists in code but not run. Fixes: suggestions, assumption chips, split layout. `routes/ExploreAi.tsx` |
| ExploreQ-aiworking / 390 / 768 | ?mode=ai | all | working | Differs | Board "Working... (one response, no streaming)" with elapsed counter and Cancel; app has "Working... N s" + progress bar (copy Match); layout differs. |
| ExploreQ-aislow / 390 / 768 | ?mode=ai | all | 25 s timeout | Differs | Board: "Took too long. The answer stopped at the 25 s limit. Nothing was counted, and your question is kept." App: "Took too long · try again, or use Filters instead" (`AI_TEXTS.timedOut`, `packages/shared/src/texts.ts`). |
| ExploreQ-ailimit | ?mode=ai | 1440 | free questions used | Differs | Board dedicated limit card with "Sign in to keep asking" (user sign-in CJ: Coming soon); app ErrorBanner "Question limit reached · 10 questions per session · ..." |
| ExploreQ-aipaused | ?mode=ai | 1440 | paused | Differs | Board title "AI is paused for today" + "Today's AI budget is used up, so AI mode is paused until 00:00 UTC. Filters and SQL still work."; app one-line banner "AI answers are paused for today · the daily budget is used up and resets at 00:00 UTC". Align copy. |
| ExploreQ-aiooa / aicontractor | ?mode=ai | 1440, 390 | answered (out-of-area, contractor) | Differs | As ExploreQ-ai; contractor variant shows resolution badge in table and "Candidate" note. Not run. |

## 4. Data catalog / manifest / verify

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| DataManifest1440 | /data/manifest | 1440 | loaded | Differs | Board: tabs Manifest / Verify / Catalog, Run picker, "manifest.json" download, Run chain as 3 cards (Run 3 this run, Run 2, Run 1) with Verify + copy, summary strip, files table with Name, CID, Codec, Size (KB/MB), SHA-256 (short), Verify column, pager "1-7 of 13". App: "Data · Manifest" text heading, no tabs, chain as vertical text list, 255-row artifact table of full paths with raw byte sizes and full SHA-256. Fixes: tab bar (`routes/Data*.tsx` shared header), run chain cards, human sizes, short hashes, pager. `routes/DataManifest.tsx` |
| DataManifest768 | same | 768 | loaded | Differs | Same. |
| Data390 (manifest, nearest) | same | 390 | loaded | Differs | Board stacked cards, sheet-like file rows; app table (check overflow). `img/A-16-parity-before/data-390.jpg` |
| DataVerify1440 | /data/verify/{cid} | 1440 | loaded | Differs | Board: file picker chips, big "Verify" button, "Checking on 2 public gateways...", Lane A ipfs.io and Lane B dweb.link cards with URL, byte progress, retry countdown, explanatory note. App: "Run manifest" card, two result cards named "Pinata" and "Filebase" (gateway names differ), "Gateway race · Coming soon" link, verified pills. Board states that lane A/B are ipfs.io and dweb.link, not Filebase/Pinata (copy decision to confirm vs constitution). `routes/DataVerify.tsx`, `components/VerifyLane.tsx` |
| DataVerify768 | same | 768 | loaded | Differs | Same. |
| Data390 (verify, nearest) | same | 390 | loaded | Differs | Same. `img/A-16-parity-before/verify-390.jpg` |
| DataCatalog1440 | /data/catalog | 1440 | loaded | Differs | Board: tabs, "Find a table or field" search, left list of tables with row counts and icons (properties, property_improvement...), right detail with field table (Field, Type, Meaning, Source, Licence), "Query in SQL" + "Copy schema" buttons, "In SQL and MCP use the views" note, "v_roofing_permit reads this table and adds" box. App: grid of cards "county.address ... Size ... Rows ... 4 columns" with CID chips; no search, no field table, no Query in SQL. `routes/DataCatalog.tsx` |
| DataCatalog768 | same | 768 | loaded | Differs | Same. |
| Data390 (catalog, nearest) | same | 390 | loaded | Differs | Same. `img/A-16-parity-before/catalog-390.jpg` |
| DataStates (lane and screen states: loading, partial, CAR-only, mismatch, error) | /data/* | 1440 | many | Differs | App has verified, "no CAR listed" and "Verify via CAR" states; verify the mismatch and gateway-failed copy against `txt/board-DataStates.txt`. |

## 5. Runs / Compare / Log

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| Runs1440 | /runs | 1440 | completed | Differs | Board: "Pipeline runs" title, Run menu "Run 3 · latest ... Completed", Sync status card (Fresh, Last sync, Next sync, County coverage, "Admin sign-in" link), Pipeline diagram (Fetch sources list + Check and join/Derive/Publish/Verify steps), selected-source strip, Gantt timeline with "Show as table", Latest events, "What Run 3 changed" bars + manifest CIDs + Verify. App: two "Coming soon" links (Pipeline diagram and Gantt, Timeline scrubber), run id header, sources list, coverage, data groups, limitations text. Pipeline/Gantt/timeline are CJ (Coming soon in A-13 spec) but Sync status, Latest events, "What changed" and Run picker are buildable. `routes/Runs.tsx`, `Runs.shared.tsx` |
| Runs768 | same | 768 | completed | Differs | Same. |
| Runs390 | same | 390 | stacked | Differs | Board stacked cards, charts as tables (timeline rows "Start / End / Took"). App stacked text. |
| RunsStates (running, partial, stale, rate-limited, failed, no runs) | /runs | 1440 | 6 | Differs | App shows run/limitations text; no state preview or equivalent badges. Verify the "Stale" and "Failed" copy exists. |
| RunChain (component on Runs/Data) | /data/manifest | 1440 | chain | Differs | See manifest row. |
| RunsCompare1440 | /runs/compare | 1440 | Run 3 vs Run 2 | Differs | Board: back arrow, "Run 3 vs Run 2" with Run pickers, 3 summary cards (Run 2 previous, Run 3 current, CAR available), per-source change table (Run 2, Run 3, Added, Changed, Removed, CID change), Immutability checks chips, buttons "Directory CAR, Run 3" and "Verify both on gateways". App: two stacked run blocks with finished date, previous manifest, artifacts count, per-source records; no pickers, no added/changed/removed table (shows "first run, nothing to compare against" for each), no immutability chips. `routes/RunsCompare.tsx` |
| RunsCompare768 | same | 768 | | Differs | Same. |
| RunsCompare390 | same | 390 | | Differs | Same; board has its own 390 board with stacked cards. |
| RunsLog1440 | /runs/log | 1440 | loaded | Differs | Board "Pipeline history log": filter chips (All events, Run started 3, Source fetched 15, ...), run chips, table (Time UTC, Run, Event, Source, Count, Status pill), pager, Download CSV. App: vertical list of events with ISO timestamp, event text and run id, no filters, no table, no status pills, no pager. `routes/RunsLog.tsx` |
| RunsLog768 | same | 768 | | Differs | Same. |
| RunsAdmin1440 | none | 1440 | admin | Not built | Runs page for admins: Admin chip in header, Sync status card with "Start run" button (instead of "Admin sign-in" link), state preview, "Signed in" rail item. Needs admin auth and run control. |
| Activity1440/768/390, ActivityStates | none | all | admin only | Not built | Admin-only Activity page: "Last week" stat tiles (events, median response, p95, failure rate), Top areas / Top questions and tools / Top failure reasons bars, "Most searched this week" re-run list, Query log table with type filters (AI, MCP, Try a tool, Search, Failed), time range menu, Download CSV, pager. States: not enough activity. |

## 6. Coverage

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| Coverage1440 | /tx/travis/coverage | 1440 | loaded | Differs | Board: title + Run picker + Download CSV; 4 KPI tiles (Record kinds complete 3 of 7, Records loaded, Areas with permit data, Counted from Run 3); "Loaded vs each source's own total" table with bars, status pills (Complete/Partial/Blocked), trend and provenance links; "Coverage by area" heatmap (Austin, Pflugerville, Manor, Unincorp.); Known limitations; Reconciliation (duplicates merged); Source speed and constraints table; Cost with Last bill and Budget alert. App: heading "Coverage" + run id and one card per kind (Property, Ownership...) showing missing reasons ("not in this run's coverage section", "denominator not in this run's manifest") because Run 2's manifest has no coverage section. Missing-reason handling is a Match with the board's Blocked/No source idea; everything else needs building. `routes/Coverage.tsx`, `Coverage.kinds.ts` |
| Coverage768 | same | 768 | | Differs | Same. |
| Coverage390 | same | 390 | stacked, charts as tables | Differs | Same; board uses stacked tables. `img/A-16-parity-before/coverage-390.jpg` |
| CoverageStates (Loaded, Loading, Gaps only, Rate-limited, Error, Empty) | same | 1440 | 6 | Differs | App has only the missing-reason form; no Gaps-only filter or loading/empty variants. |

## 7. Help MCP

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| HelpMcp1440 | /help/mcp | 1440 | loaded | Differs | Board: back arrow header "CountyLens · Help", "MCP and API" title, 3 cards (Endpoint with copy, Access with tools/list and tools/call pills, "Connect a client" with Claude Desktop / Claude Code / MCP Inspector tabs + config JSON + Copy), Tools list (6) with search_properties detail (input schema table, Example request, Response), "Try a tool" form (Latitude, Longitude, Radius, Roof age, Run, Error 401 / Throttled 429 states). App: "Help · MCP" heading, intro, vertical list of tool names with parameter lines, "Connect a client" paragraph, Try a tool further down. Fixes: card layout, client tabs, schema tables, side-by-side Try a tool. `routes/HelpMcp.tsx` |
| HelpMcp768 | same | 768 | | Differs | Same. |
| HelpMcp390 | same | 390 | | Differs | Same; board stacks cards. |

## 8. Legal

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| LegalData1440 | /legal/data | 1440 | loaded | Differs | Board: "On this page" side TOC (Your rights, Sources and licences, How to cite, Corrections), "Data use and licences", sample-text info banner, "Your rights", Sources table (Source, Provides, Licence or terms, Use notes), "How to cite" with example. App: "Legal · Data sources", list of 7 source cards with disclaimer links and "Page requested ... HTTP 200"; no licence table, no TOC, no How to cite, no Corrections. `routes/LegalData.tsx` |
| LegalData768 | same | 768 | | Differs | Same. |
| LegalData390 | same | 390 | | Differs | Same. |
| LegalPrivacy1440 | /legal/privacy | 1440 | loaded | Differs | Board sections: In short, What we record, What stays in your browser, Admin accounts, Other services, Your choices, with TOC + banner. App: 3 short cards (What CountyLens asks of you, Where your browser connects, What the records contain). Content differs materially (board describes the query log and admin accounts). `routes/LegalPrivacy.tsx`, `content/legal.ts` |
| LegalPrivacy768 | same | 768 | | Differs | Same. |
| LegalTerms1440 | /legal/terms | 1440 | loaded | Differs | Same structure as Privacy (TOC, banner, sections); app uses cards. `routes/LegalTerms.tsx` |
| LegalTerms768 | same | 768 | | Differs | Same. |

## 9. Coming soon / UserSignIn

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| UserSignIn1440/768/390 | none (`/soon/ai-user-sign-in` is an unlinked item and returns "Page not found") | all | Email, Sending, Code, Wrong code, Expired, Too many attempts | Not built (CJ) | Board: centred card, sparkle icon, "Sign in to keep asking", text about the 10-question limit, info banner "Coming soon: AI-user sign-in is not in the first release...", Email field, "Email me a code" button, Cognito note. CJ: user sign-in is planned as Coming soon; if AC-12 needs a visible screen, add a static `/soon/ai-user-sign-in` page using this board's layout (the item exists in `content/coming-soon.ts` with `linked: false`). |
| Coming soon pages (/soon/...) | /soon/other-counties etc. | all | | Match? | No board for item pages (title, "Coming soon" label, sentence, skeleton). Nothing to compare; not scored. |

## 10. Admin

| Board | Hosted route | Width | States | Verdict | What differs and fix |
|---|---|---|---|---|---|
| AdminSignIn1440/768/390 | none | all | Email, Sending, Code, Wrong code, Expired, Too many attempts | Not built | Admin sign-in card: shield icon, "Admin sign-in", "Admins can start, stop and retry runs and see Activity. Every other page is public and needs no sign-in.", info banner "The demo needs no admin access...", Admin email field, "Email me a code", Cognito note. No route, no auth. |
| RunsAdmin1440 | none | 1440 | | Not built | See section 5. |
| Activity1440/768/390/States | none | all | | Not built | See section 5. |

## Not compared (not page boards)
`ProtoBar`, `canvas.json`, `Flows`, `A11yAudit`, `Extensions`, `Main` (site map), `Pager` and `SearchBox`/`RunChain`/`PropertyDetail` components (covered through the pages that use them).
