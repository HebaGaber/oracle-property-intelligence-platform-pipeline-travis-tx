// Help · MCP (`/help/mcp`; A-13 T031, FR-023; TC-042). The six fixed tools of the CountyLens MCP
// server (ARD AD-21: each ≤ 1,000 rows, no SQL tool; P0-13), each with one sentence on what it
// answers, and how the server is reached once it ships. "Try a tool" says "Not available yet ·
// the agent and MCP server arrive with story A-14": no sample response is ever shown. Static
// text only. A react-router lazy route module.
import { PAGE_TEXTS } from "@countylens/shared";
import { useState, type ReactElement } from "react";
import { StatusPill } from "../components/StatusPill";
import runStyles from "./Runs.module.css";

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

export function Component(): ReactElement {
  const [tried, setTried] = useState<string | null>(null);
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
        Explore. Each tool returns at most 1,000 rows; there is no SQL tool (free-form SQL runs only
        in your browser, in Explore · SQL).
      </p>
      <ul className={runStyles.list} aria-label="MCP tools">
        {MCP_TOOLS.map((tool) => (
          <li key={tool.name} className={runStyles.item} data-tool={tool.name}>
            <span className={runStyles.itemTitle}>
              <code className={runStyles.mono}>{tool.name}</code>
            </span>
            <span className={runStyles.itemBody}>{tool.what}</span>
            <span>
              <button
                type="button"
                className={runStyles.action}
                onClick={() => setTried(tool.name)}
                aria-describedby={tried === tool.name ? `tried-${tool.name}` : undefined}
              >
                Try {tool.name}
              </button>
            </span>
            {tried === tool.name ? (
              <span id={`tried-${tool.name}`} role="status">
                <StatusPill status="info" icon="schedule" text={PAGE_TEXTS.mcpNotAvailable} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
