# CountyLens: demo script

Oct 17, 2026 · HebaGaber · The evaluator follows this script in order on the hosted app at `https://countylens.aldarraj.com`. Every line needs a screen and a state. Section 1 maps each line to its screen. Section 2 is the README transcript, copied word for word from `README.md` at commit `e778d6f`. Context: [01-ux-context.md](01-ux-context.md). Prompts: [02-claude-design-prompts.md](02-claude-design-prompts.md).

## 1. Demo line → screen → evidence

| # | The presenter says | What must appear | Screen | Evidence file |
| --- | --- | --- | --- | --- |
| D-1 | "I will demonstrate that the Oracle pipeline has loaded the available dataset for Travis County…" | Opening context | App shell | — |
| D-2 | "First, I am opening the pipeline run summary." | Completed run, source list, county coverage, record counts, timestamps, documented source limitations | Runs | `docs/evidence/A-12-runs.md` |
| D-3 | "Show the total uploaded records by source." | Property, permit, ownership, contractor (with BBB where available), business and coordinate counts, with collection timestamps and provenance | Coverage | `docs/evidence/A-01-coverage.md` |
| D-4 | "Now I am opening the DuckDB-backed query layer." | Data is queryable with no Oracle-hosted database | SQL panel | `docs/evidence/A-13-duckdb.md` |
| D-5 | "Show the published artifact manifest for this run." | Every artifact with CID, size, name, codec and digest; gateway URLs derived from CIDs; IPNS name with its resolved CID | Data: manifest | `docs/evidence/A-11-manifest.md` |
| D-6 | "Retrieve one published artifact by CID from a public gateway…, then again from a second independent public gateway." | Both fetches succeed and the bytes match the manifest's size and digest | Data: Verify (gateway race) | `docs/evidence/A-11-gateways.md` |
| D-7 | "Show that a later incremental publish produced a new CID without mutating the previous one." | Prior CID still resolves, new run has a distinct CID, IPNS points at the new CID, both CIDs in run history, CAR for directories | Runs: compare | `docs/evidence/A-12-immutability.md` |
| D-8 | "Using the UI, show properties within a sample radius that have roofs older than 15 years." | Matches with roof-age basis, coordinates and source provenance | Explore map | `docs/evidence/A-13-roof-age.md` |
| D-9 | "Show properties in that area with open roofing permits…, including contractor and BBB rating where available." | Permit status and open duration, contractor identity, BBB score when present, clear source backing | Explore map + property detail | `docs/evidence/A-13-open-permits.md` |
| D-10 | Agent: "Which properties in Travis County within five miles of [city xyz] have roofs older than 15 years?" (demo city: Pflugerville) | Matches, reasoning, source-backed evidence | AI helper | `docs/evidence/A-14-agent.md` |
| D-11 | Agent: "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?" | Filtered list with open duration, contractor details, BBB when available, assumptions and missing data stated | AI helper | `docs/evidence/A-14-agent.md` |
| D-12 | "Finally, I will show that the system is MCP-ready." | MCP tool list and one query, through the MCP inspector or Claude Desktop; same views as the UI | Outside the app (Help links to MCP docs) | `docs/evidence/A-15-mcp.md` |

The video will run about 8–10 minutes because the transcript is long. Keep this order exactly.

## 2. README demo transcript (verbatim)

- Presenter: “I will demonstrate that the Oracle pipeline has loaded the available dataset for Travis County, Texas, that the data is queryable through DuckDB, that eligible artifacts are stored on IPFS as content-addressed snapshots, and that both the UI and agent can answer property intelligence questions that support roofing lead generation.”
- Presenter: “First, I am opening the pipeline run summary.”
  - Expected Result: The system displays the completed pipeline run, source list, county coverage, record counts, timestamps, and any documented source limitations.
- Presenter: “Show the total uploaded records by source.”
  - Expected Result: The system shows uploaded property, permit, ownership, contractor (with BBB rating where available), business, and coordinate records with collection timestamps and provenance.
- Presenter: “Now I am opening the DuckDB-backed query layer.”
  - Expected Result: The system confirms that the loaded data is available for structured querying without requiring Oracle-hosted database infrastructure.
- Presenter: “Show the published artifact manifest for this run.”
  - Expected Result: A JSON (or equivalent) listing every eligible artifact with CID, size, logical name, codec, and digest. Gateway URLs, if shown, are derived from those CIDs. An IPNS name, if used, is shown together with the resolved CID.
- Presenter: “Retrieve one published artifact by CID from a public gateway that this environment does not operate, then again from a second independent public gateway.”
  - Expected Result: Both fetches succeed and the bytes match the manifest size/digest. Serving the object only from a private, local, or authenticated gateway is a fail.
- Presenter: “Show that a later incremental publish produced a new CID without mutating the previous one.”
  - Expected Result: The prior CID still resolves; the new run has a distinct CID; IPNS (if used) now points at the new CID; both CIDs appear in run history. A CAR is available for any directory root.
- Presenter: “Using the UI, show properties within a sample radius that have roofs older than 15 years.”
  - Expected Result: Matching properties are returned with roof-age basis, coordinates, and source provenance.
- Presenter: “Show properties in that area with open roofing permits, prioritizing permits that have remained open for many years, including contractor and BBB rating where available.”
  - Expected Result: Results include permit status/open duration, contractor identity, BBB score when present, and clear source backing.
- Presenter: “Now I am asking the same type of questions through the agent.”
  - Agent Prompt: “Which properties in Travis County within five miles of [city xyz] have roofs older than 15 years?”
    - Expected Result: The agent returns matching properties, explains the reasoning, and includes source-backed evidence.
  - Agent Prompt: “Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?”
    - Expected Result: The agent returns a filtered list with permit age/open duration, contractor details, BBB rating when available, and clearly identifies any assumptions or missing data.
- Presenter: “Finally, I will show that the system is MCP-ready.”
  - Expected Result: The system demonstrates an MCP-ready interface or documented MCP-compatible query structure that agents and the roofing CRM can use without changing the data model.

