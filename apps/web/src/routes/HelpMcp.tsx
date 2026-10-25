// Help · MCP (`/help/mcp`; A-13 T031, FR-023, D-12; TC-042). The six fixed tools of the
// CountyLens MCP server (ARD AD-21: each ≤ 1,000 rows, no SQL tool; P0-13), each with one
// sentence on what it answers and its input. `search_properties` input is read from the bounds
// exported by @countylens/query-core (EXPLORE_BOUNDS, PERMIT_FILTERS, EXPLORE_SORTS, limits), never
// retyped; the other five tools' input schemas are not in query-core yet and say so. Setup snippets
// for Claude Desktop, Claude Code and MCP Inspector carry `Authorization: Bearer <token>` (the
// token is shared privately with reviewers). One "Try a tool" control answers with the A-14 text:
// no sample response is ever shown. Static text only. A react-router lazy route module.
import {
  EXPLORE_BOUNDS,
  EXPLORE_DEFAULT_LIMIT,
  EXPLORE_SORTS,
  MAX_ROWS,
  PERMIT_FILTERS,
} from "@countylens/query-core";
import { PAGE_TEXTS } from "@countylens/shared";
import { useState, type ReactElement } from "react";
import { StatusPill } from "../components/StatusPill";
import runStyles from "./Runs.module.css";
import styles from "./HelpMcp.module.css";

/** AD-21 tools (docs/architecture-constitution.md § AD-21), in the ARD's order. */
const MCP_TOOLS = Object.freeze([
  {
    name: "search_properties",
    what: "Properties in a radius of a place or point, with the Explore filters.",
  },
  {
    name: "list_permits",
    what: "Roofing permits of a property or an area, open or stalled first.",
  },
  { name: "get_property", what: "One property by CID, with provenance and missing reasons." },
  { name: "get_coverage", what: "The coverage section of a run's manifest." },
  { name: "list_runs", what: "The published runs, from runs/index.json." },
  { name: "get_schema", what: "The published views and their columns." },
]);

const range = ([min, max]: readonly [number, number]): string => `${min} to ${max}`;

/** `search_properties` parameters, every bound from query-core. */
const SEARCH_PARAMS: readonly { readonly name: string; readonly text: string }[] = [
  { name: "radius_mi", text: `radius in miles, ${range(EXPLORE_BOUNDS.radiusMi)}` },
  { name: "roof", text: `roof age at least this many years, ${range(EXPLORE_BOUNDS.roof)}` },
  { name: "permit", text: `permit filter: ${PERMIT_FILTERS.join(", ")}` },
  {
    name: "openYrs",
    text: `open or stalled at least this many years, ${range(EXPLORE_BOUNDS.openYrs)}`,
  },
  { name: "tenure", text: `owner tenure over this many years, ${range(EXPLORE_BOUNDS.tenure)}` },
  { name: "ooa", text: "out-of-area owner only, true or false" },
  { name: "sort", text: `sort: ${EXPLORE_SORTS.join(", ")}` },
  {
    name: "limit",
    text: `rows per call, 1 to ${MAX_ROWS}, default ${EXPLORE_DEFAULT_LIMIT}`,
  },
];

const BEARER = "Authorization: Bearer <token>";

const SNIPPETS = Object.freeze([
  {
    id: "claude-desktop",
    title: "Claude Desktop",
    code: `{\n  "mcpServers": {\n    "countylens": {\n      "command": "npx",\n      "args": ["mcp-remote", "<mcp-url>", "--header", "${BEARER}"]\n    }\n  }\n}`,
  },
  {
    id: "claude-code",
    title: "Claude Code",
    code: `claude mcp add --transport http countylens <mcp-url> \\\n  --header "${BEARER}"`,
  },
  {
    id: "mcp-inspector",
    title: "MCP Inspector",
    code: `npx @modelcontextprotocol/inspector\n# Transport: Streamable HTTP\n# URL: <mcp-url>\n# Header: ${BEARER}`,
  },
]);

export function Component(): ReactElement {
  const [tried, setTried] = useState(false);
  return (
    <section
      aria-label="Help · MCP"
      data-route="help-mcp"
      data-state="ready"
      className={runStyles.page}
    >
      <h2 className={runStyles.title}>Help · MCP</h2>
      <p className={runStyles.itemBody}>
        The CountyLens MCP server answers with fixed, typed tools over the same published views as
        Explore. Each tool returns at most {MAX_ROWS} rows; there is no free-form query tool
        (free-form queries run only in your browser, in Explore).
      </p>
      <ul className={runStyles.list} aria-label="MCP tools">
        {MCP_TOOLS.map((tool) => (
          <li key={tool.name} className={runStyles.item} data-tool={tool.name}>
            <span className={runStyles.itemTitle}>
              <code className={runStyles.mono}>{tool.name}</code>
            </span>
            <span className={runStyles.itemBody}>{tool.what}</span>
            {tool.name === "search_properties" ? (
              <ul className={runStyles.list} aria-label="search_properties input" data-schema="">
                {SEARCH_PARAMS.map((param) => (
                  <li key={param.name} className={runStyles.itemBody} data-param={param.name}>
                    <code className={runStyles.mono}>{param.name}</code> · {param.text}
                  </li>
                ))}
              </ul>
            ) : (
              <span className={runStyles.itemBody} data-schema-pending="">
                Input schema: published with the MCP server in story A-14.
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className={runStyles.card}>
        <h3 className={runStyles.sectionTitle}>Connect a client</h3>
        <p className={runStyles.itemBody}>Bearer token required, shared privately with reviewers</p>
        {SNIPPETS.map((snippet) => (
          <div key={snippet.id} className={styles.snippetBox}>
            <h4 className={runStyles.sectionTitle}>{snippet.title}</h4>
            <pre data-snippet={snippet.id} className={styles.snippet} tabIndex={0}>
              <code>{snippet.code}</code>
            </pre>
          </div>
        ))}
      </div>

      <div className={runStyles.card}>
        <h3 className={runStyles.sectionTitle}>Try a tool</h3>
        <span>
          <button
            type="button"
            className={runStyles.action}
            data-main-control=""
            onClick={() => setTried(true)}
          >
            Try a tool
          </button>
        </span>
        {tried ? (
          <span role="status">
            <StatusPill status="info" icon="schedule" text={PAGE_TEXTS.mcpNotAvailable} />
          </span>
        ) : null}
      </div>
    </section>
  );
}
