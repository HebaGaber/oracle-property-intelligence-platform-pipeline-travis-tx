# A-14 agent: golden queries G1-G6 on the deployed agent

Run date: 2026-10-25 (16:55 local, one vitest run, strictly sequential, 20 s between requests).
Raw results (full responses and grader output): `docs/evidence/A-14-golden-results.json`.

## Setup

| Item | Value |
| --- | --- |
| Endpoint | `POST https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com/api/agent/ask` (Amplify branch preview of `014-agent-and-mcp`, HEAD a74fd89 plus the uncommitted test change) |
| Pinned run (`manifest_cid` on every request, and the oracle) | `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` (small published run `travis-202609-permits-20261021t103516z`; override with `GOLDEN_MANIFEST_CID`) |
| Provider / model | `AI_PROVIDER=bedrock`, `eu.anthropic.claude-sonnet-4-6` (as configured on the Lambda; the response does not echo it) |
| Gazetteer | `travis-places@1.0.0`, SHA-256 `0f4c08a8bda573737adecc7d62e84d629aadc5005b987f2f787e4fd31ab5d17f` (`packages/query-core/gazetteer/travis-places@1.0.0/DIGEST`). Every `how` string cites "Census 2024 Gazetteer" with the place's internal point; the response carries the name but not the version or hash. |
| Oracle | the real `searchProperties` / `listPermits` / `geocodePlace` of `@countylens/query-core`, over a local DuckDB bound to the same pinned run. Manifest and 24 parts fetched by CID and verified (`rawCid`) from `https://gateway.pinata.cloud/ipfs/<cid>` (`GOLDEN_CID_HOST`): the CloudFront CID copy `d2xsqoqv09bd0q.cloudfront.net` returned HTTP 403 for this manifest CID, i.e. this run is not on the CID copy (noted, not investigated). |
| Command | `AGENT_URL=https://014-agent-and-mcp.d2lx0utip89u18.amplifyapp.com/api GOLDEN_CID_HOST=https://gateway.pinata.cloud npx vitest run` in `tests/agent` |
| Result | 1 passed (G6), 5 failed (G1-G5), 281 s |

Not exposed by the response: model calls, output tokens, server duration, trace id. The response keys are only `answer, how, steps, matches, query, missing, outcome`. The "request id" below is the `x-amzn-requestid`/CloudFront header returned with the HTTP response. The budget check therefore only verifies tool steps (all within 6); the model-call and token ceilings are not verifiable from the hosted response (tracked in ERR-63).

## Results

| Case | Outcome | Wall clock | Tool steps | Groundedness | Correctness (precision) | Recall | Honesty | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | answered | 4917 ms | 2 | PASS (0 cids) | PASS (0 matches) | PASS (1.00, n=0) | FAIL | FAIL (empty_reason only) |
| G2 | answered | 6329 ms | 3 | PASS (0 cids) | PASS (0 matches) | PASS (1.00, n=0) | FAIL | FAIL (ERR-61) |
| G3 | answered | 3804 ms | 2 | PASS (0 cids) | PASS (0 matches) | PASS (1.00, n=0) | FAIL | FAIL (empty_reason only) |
| G4 | answered | 8492 ms | 3 | PASS (0 cids) | PASS (0 matches) | PASS (1.00, n=0) | FAIL | FAIL (ERR-62) |
| G5 | answered | 4402 ms | 2 | PASS (2 cids) | PASS (2 matches) | PASS (1.00, n=1) | FAIL | FAIL (ERR-63) |
| G6 | answered | 3280 ms | 2 | PASS (0 cids) | PASS (0 matches) | PASS (1.00, n=0) | PASS | PASS |

Both G5 and G6 were measured on the last (only) turn. G2 is two turns; its wall clock is the second turn, the first turn is the G1 question again.

## Honest reading: empty answers on a small run

The pinned run is the small permits slice (a few dozen rows). Within 5 miles of Pflugerville, Manor and Lakeway it holds no property that meets the G1/G3/G4 filters and no open or stalled permit; the oracle returns `total = 0`, `empty_reason = no_match` for G1-G4. So G1-G4 are all "empty-result answers": they prove that the agent calls the right tool with the right arguments, builds `how`/`query`/`missing[]` from the tool envelope and does not invent matches (groundedness, precision and recall are vacuously 100%). They do not prove the golden intents:

- G1 (roof age): recall and correctness over real rows is untested.
- G2 (follow-up, "that area", contractor): the "that area" resolution worked (the second turn searched `Pflugerville`), but the contractor and BBB disclosures never had a row to attach to.
- G3 (sort order `open_desc`): the sort was requested correctly; ordering of real rows is untested.
- G4 (out-of-area owner): the `owner_is_out_of_area` field-not-published reason never surfaced, because the query is empty before it matters.
- G5 (single permit) and G6 (out of scope) are the only cases with a non-vacuous check: G5 returned the real permit `2026-116568 BP` (the first permit in the run, resolved from the bound run at test start) with 2 matching CIDs that exist in the run; G6 returned zero matches, an explicit out-of-scope sentence and no CID in the prose.

The walkthrough ("The honest answer for the demo area") expects the same for Pflugerville even on the full county: no open reroof permits within 5 miles, stalled ones offered with their label. On the full-county runs the agent times out (DEC-A-13-explore-full-county), so the non-vacuous versions of G1-G4 cannot be run until that limit is lifted.

The `empty_reason` failures of G1 and G3 are a mismatch between `golden.json` (which expects `empty_reason: null`, i.e. rows) and this data (`no_match`). The grader is unchanged and strict, so they are reported as failures of the golden set against this run, not as product defects.

## Per case detail

### G1

- Prompt: Which properties in Travis County within five miles of Pflugerville have roofs older than 15 years?
- Outcome: `answered`; wall clock 4917 ms; request id `TZ_e27hthBdsn42NrXO1oywRWlrLYloaedqS_dbcbTYPYkORzJE44g==`
- Tool steps (2): `searchProperties` {"area": {"place": "Pflugerville"}, "radius_mi": 5, "roof_age_years_min": 15, "sort": "roof_desc", "limit": 50}; `(final text step, no tool)` 
- Model calls / output tokens: not exposed by the response
- Oracle: total 0, empty_reason no_match
- Groundedness: PASS; correctness: PASS; recall: PASS; honesty: FAIL `{"pass": false, "missingMentions": [], "missingFlags": [], "emptyReasonMismatch": true}`
- `how`: Pflugerville city · Census 2024 Gazetteer · 30.447765, -97.602116; radius_mi: 5; roof_age_years_min: 15; sort: "roof_desc"; limit: 50
- `missing`: `[{"field": "result", "reason": "no_match"}]`
- Answer (verbatim):

  > The search returned **no matches** for properties within 5 miles of Pflugerville with roofs older than 15 years. Here's what that means:
  > 
  > - **Total matches found:** 0
  > - **Unknown excluded:** 0 — meaning no properties were left out due to a missing/unknown roof age value.
  > - **Reason:** `no_match` — the data is available and was searched, but no properties in that area currently meet both criteria (within 5 miles of Pflugerville **and** roof age > 15 years).
  > 
  > ### What you can try:
  > 1. **Expand the radius** — Try 10 or 15 miles to cast a wider net.
  > 2. **Lower the roof age threshold** — Try 10 or 12 years instead of 15.
  > 3. **Search a nearby area** — Try neighboring places like Austin, Round Rock, or Manor.
  > 
  > Would you like me to adjust any of these parameters and search again?

### G2

- Prompt: Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?
- Outcome: `answered`; wall clock 6329 ms; request id `Kn0EY32hZGQgHSAgIdcGt-Dt3Mc0nwOpvnWv6eVnVC8tJdmD7BQYQg==`
- Tool steps (3): `searchRoofingPermits` {"area": {"place": "Pflugerville"}, "radius_mi": 5, "status_class": "open_or_stalled", "open_years_min": 3, "sort": "open_desc", "limit": 20}; `searchRoofingPermits` {"area": {"place": "Pflugerville"}, "radius_mi": 5, "status_class": "open_or_stalled", "open_years_min": 1, "sort": "open_desc", "limit": 20}; `searchRoofingPermits` {"area": {"place": "Pflugerville"}, "radius_mi": 5, "status_class": "open_or_stalled", "sort": "open_desc", "limit": 20}
- Model calls / output tokens: not exposed by the response
- Oracle: total 0, empty_reason no_match
- Groundedness: PASS; correctness: PASS; recall: PASS; honesty: FAIL `{"pass": false, "missingMentions": ["\u2265\\s*5|at least 5|five", "contractor not printed|no_lexicon_carrier", "BBB.*not available|not available.*BBB"], "missingFlags": ["contractor.name_as_printed", "bbb_status"], "emptyReasonMismatch": true}`
- `how`: Pflugerville city · Census 2024 Gazetteer · 30.447765, -97.602116; radius_mi: 5; status_class: "open_or_stalled"; open_years_min: 1; sort: "open_desc"; limit: 20
- `missing`: `[{"field": "result", "reason": "no_match"}]`
- Answer (verbatim):

  > Let me also try without the open_years_min filter to see all open/stalled permits near Pflugerville.

### G3

- Prompt: Show me open roofing permits older than five years within five miles of Manor
- Outcome: `answered`; wall clock 3804 ms; request id `j54NBV7FuufM0V42F-FBjVf8gIU7xGkLHRafpfGnheWKxqDEZNCV_w==`
- Tool steps (2): `searchRoofingPermits` {"area": {"place": "Manor"}, "radius_mi": 5, "status_class": "open", "open_years_min": 5, "sort": "open_desc", "limit": 50}; `(final text step, no tool)` 
- Model calls / output tokens: not exposed by the response
- Oracle: total 0, empty_reason no_match
- Groundedness: PASS; correctness: PASS; recall: PASS; honesty: FAIL `{"pass": false, "missingMentions": [], "missingFlags": [], "emptyReasonMismatch": true}`
- `how`: Manor city · Census 2024 Gazetteer · 30.354228, -97.558259; radius_mi: 5; status_class: "open"; open_years_min: 5; sort: "open_desc"; limit: 50
- `missing`: `[{"field": "result", "reason": "no_match"}]`
- Answer (verbatim):

  > No open roofing permits older than five years were found within five miles of **Manor**. There are zero matches — no results were excluded due to unknown data either.
  > 
  > This could mean:
  > - All permits in that area have been **closed out** within the past five years, or
  > - There simply aren't any long-running open permits in this radius.
  > 
  > Would you like me to try a **wider radius**, a **shorter age threshold**, or check for **stalled** permits in the same area instead?

### G4

- Prompt: Which homes near Lakeway haven't changed owners in 10+ years and have owners outside the area?
- Outcome: `answered`; wall clock 8492 ms; request id `Ywhoi8FIy5Iqahas5uOfYE7-p31WIuxACwQ1a757j1LHahvVXb8NbA==`
- Tool steps (3): `searchProperties` {"area": {"place": "Lakeway"}, "radius_mi": 5, "tenure_years_min": 10, "owner_is_out_of_area": true, "sort": "nearest", "limit": 50}; `searchProperties` {"area": {"place": "Lakeway"}, "radius_mi": 10, "tenure_years_min": 10, "owner_is_out_of_area": true, "sort": "nearest", "limit": 50}; `(final text step, no tool)` 
- Model calls / output tokens: not exposed by the response
- Oracle: total 0, empty_reason no_match
- Groundedness: PASS; correctness: PASS; recall: PASS; honesty: FAIL `{"pass": false, "missingMentions": ["outside the area", "not_in_export|not in the published export"], "missingFlags": ["owner_is_out_of_area"], "emptyReasonMismatch": true}`
- `how`: Lakeway city · Census 2024 Gazetteer · 30.354982, -97.986269; radius_mi: 10; tenure_years_min: 10; owner_is_out_of_area: true; sort: "nearest"; limit: 50
- `missing`: `[{"field": "result", "reason": "no_match"}]`
- Answer (verbatim):

  > Unfortunately, even after expanding the search radius to **10 miles around Lakeway**, **no properties matched** both criteria simultaneously:
  > 
  > - ✅ **Owner tenure of 10+ years** (long-term owners)
  > - ✅ **Out-of-area owner mailing address**
  > 
  > A few things to note:
  > 
  > - **0 properties were excluded** due to unknown tenure or unknown owner location — meaning the dataset had good coverage, and this combination genuinely yielded no matches in that area.
  > - Lakeway is noted as only **partially within Travis County**, so some surrounding properties may fall outside the dataset's coverage.
  > 
  > ### Suggestions to find leads:
  > 1. **Relax one filter** — e.g., search for *only* out-of-area owners, or *only* long-tenure owners near Lakeway.
  > 2. **Try a nearby Travis County hub** like **Bee Cave** or **Austin** for broader coverage.
  > 3. **Add a roof age filter** — if you're targeting roofing leads specifically, combining roof age (e.g., 15+ years) with out-of-area ownership may surface more actionable prospects.
  > 
  > Would you like me to run any of these alternative searches?

### G5

- Prompt: What's the BBB rating of the contractor on permit {real permit number}?
- Outcome: `answered`; wall clock 4402 ms; request id `28C0gy0F8EcqfKrZRxEqE7HdTFHJvhXtRbEbIiKgOy_cvrO9Yw5d3Q==`
- Tool steps (2): `searchRoofingPermits` {"permit_number": "2026-116568 BP", "sort": "open_desc", "limit": 50}; `(final text step, no tool)` 
- Model calls / output tokens: not exposed by the response
- Oracle: total 1, empty_reason None
- Groundedness: PASS; correctness: PASS; recall: PASS; honesty: FAIL `{"pass": false, "missingMentions": ["BBB.*not available|rating.*not available|missing"], "missingFlags": ["bbb_status"], "emptyReasonMismatch": false}`
- `how`: permit_number: "2026-116568 BP"; sort: "open_desc"; limit: 50
- `missing`: `[{"field": "status_raw", "reason": "no_lexicon_carrier"}, {"field": "expiry_date", "reason": "no_lexicon_carrier"}, {"field": "final_date", "reason": "not_closed"}, {"field": "permit_close_date", "reason": "source_missing"}, {"field": "final_inspection_date", "reason": "source_missing"}, {"field": "contractor_company_cid", "reason": "contractor_unresolved"}, {"field": "contractor_name_raw", "reason": "no_lexicon_carrier"}, {"field": "bbb_rating", "reason": "no_lexicon_carrier"}, {"field": "bbb_url", "reason": "no_lexicon_carrier"}, {"field": "description", "reason": "no_lexicon_carrier"}, {"field": "work_class_raw", "reason": "no_lexicon_carrier"}]`
- Answer (verbatim):

  > I found permit **2026-116568 BP** [1], but a BBB rating isn't available for it. Here's why:
  > 
  > - **Contractor status:** Unresolved — the contractor on this permit could not be identified [1].
  > - **BBB status:** Not checked, specifically because the contractor is unresolved [1].
  > 
  > Since the contractor hasn't been resolved, there's no BBB lookup possible for this permit. If you have additional contractor details (like a name or license number), you'd need to check the [BBB website](https://www.bbb.org) directly.

### G6

- Prompt: How many properties have roofs older than 40 years in ZIP 99999?
- Outcome: `answered`; wall clock 3280 ms; request id `tHLsKkQtqPPRAiZYeFkBRPGVArCRvxZKoCrfKtUnKqdvtXqM5fzlsA==`
- Tool steps (2): `searchProperties` {"area": {"place": "99999"}, "radius_mi": 25, "roof_age_years_min": 40, "sort": "nearest", "limit": 50}; `(final text step, no tool)` 
- Model calls / output tokens: not exposed by the response
- Oracle: total None, empty_reason None
- Groundedness: PASS; correctness: PASS; recall: PASS; honesty: PASS `{"pass": true, "missingMentions": [], "missingFlags": [], "emptyReasonMismatch": false}`
- `how`: radius_mi: 25; roof_age_years_min: 40; sort: "nearest"; limit: 50
- `missing`: `[{"field": "result", "reason": "out_of_scope"}]`
- Answer (verbatim):

  > ZIP code **99999** is **out of scope** — it falls outside Travis County, which is the only area covered by this tool. No results can be returned for that ZIP.
  > 
  > If you meant a different ZIP code within Travis County (e.g., 78701, 78745, 78759, etc.), please provide it and I'll pull up those properties with roofs older than 40 years right away! 🏠

## Defects found

- ERR-61: G2 returns an unfinished sentence as the answer with `outcome: answered` (loop budget exhausted).
- ERR-62: G4 silently widens the radius 5 to 10 mi and asserts "good coverage" and "0 excluded" without support; never says the owner-location field is unavailable.
- ERR-63: `missing[]` names do not match the contract (`bbb_rating` instead of `bbb_status`), the answer does not use the contract wording, and model calls/tokens/duration/trace id are not exposed.

## Test file change

`tests/agent/golden.test.ts` now posts to `<AGENT_URL>/agent/ask` with `{prompt, turns:[{prompt,outcome}], manifest_cid}` (the real `AgentAskInput`; the contract text says `outcome`, not `role/content`), unwraps the tRPC `result.data`, binds the pinned run locally for the oracle and for the groundedness check, waits 20 s between requests (`GOLDEN_SPACING_MS`), substitutes the G5 permit number from the bound run, writes `docs/evidence/A-14-golden-results.json`, and asserts the outcome is `answered` in addition to every original check. `grader.ts` and `golden.json` are unchanged.
