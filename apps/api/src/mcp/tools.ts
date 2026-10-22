// T025 (A-14/A-15 G-3, AD-21): the six MCP tool adapters, each a thin wrapper over one
// query-core function (agent-design.md § oracle "The six tool adapters"; contracts/mcp-tools.md).
// Every `inputSchema` IS the matching query-core Zod schema object, not a re-derivation: the SDK
// (`server.registerTool`) validates the call's arguments against that exact schema and hands the
// handler the parsed, defaulted value, so a client's `tools/list` sees the real AD-07-named shape
// and a client's `tools/call` is validated the same way `agent.ask`'s tools would validate the
// same input (FR-011's cross-surface agreement starts here: one schema object, two registrations).
// The output is the function's ResultEnvelope **unchanged** (no renaming, no dropping a field):
// it is both the tool's `structuredContent` and a JSON text block, so a client that only reads
// `content[0].text` still gets the full envelope.
//
// None of the six adapters import a database engine directly (ARD § 4): they take an injected
// `McpToolDeps` that resolves/binds "the run to read" (apps/api/src/handlers/mcp.ts wires the real
// one over apps/api/src/engine/duckdb-node.ts; apps/api/src/mcp/stdio.ts, tests, wire a different
// one). Resolution failure (an unknown manifest_cid, or no runs published at all when none is
// given) is this layer's job to turn into the typed `run_not_found` envelope — never a thrown 500
// and never a silently empty "success".
import type { BoundRun, QueryEngine, Row } from "@countylens/query-core";
import {
  GetCoverageInput,
  GetPropertyInput,
  GetSchemaInput,
  ListPermitsInput,
  ListRunsInput,
  SearchPropertiesInput,
  getCoverage,
  getProperty,
  getSchema,
  listPermits,
  listRuns,
  searchProperties,
  type EmptyReason,
  type ResultEnvelope,
  type RunEcho,
} from "@countylens/query-core";
import type { RunsIndexV1 } from "@countylens/contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** One bound run, ready for query-core's functions: the engine they run SQL through, and the
 *  BoundRun those functions stamp onto every row/envelope. */
export interface McpRunContext {
  readonly engine: QueryEngine;
  readonly bound: BoundRun;
}

export interface McpToolDeps {
  /** Resolves and binds the run a call should read: the named `manifestCid`, or the latest
   *  published run when omitted. `undefined` means resolution failed (unknown CID, or no runs
   *  published) — the adapter's cue to answer `run_not_found` itself, never to call the
   *  query-core function against a run that was never actually bound. */
  resolveRun(manifestCid?: string): Promise<McpRunContext | undefined>;
  /** The committed runs index (`runs/index.json`'s schema), for `list_runs`. */
  runsIndex(): Promise<Pick<RunsIndexV1, "runs">>;
}

const FAKE_RUN_ECHO: RunEcho = { run_id: "", manifest_cid: "", as_of: "" };

/** The `run_not_found` envelope for a tool that needs a bound run but couldn't get one. Echoes
 *  the requested `manifestCid` (when the caller named one) rather than inventing a run identity. */
function runNotFoundEnvelope<R>(
  manifestCid: string | undefined,
  applied: Record<string, unknown>,
): ResultEnvelope<R> {
  const reason: EmptyReason = "run_not_found";
  return {
    rows: [],
    returned: 0,
    total: 0,
    truncated: false,
    empty_reason: reason,
    unknown_excluded: {},
    run: manifestCid === undefined ? FAKE_RUN_ECHO : { ...FAKE_RUN_ECHO, manifest_cid: manifestCid },
    applied,
  };
}

/** Every row-returning tool's output doubles as a JSON text block (for a client that only reads
 *  `content`) and `structuredContent` (the envelope/object, unchanged). */
function toolResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

/** Every query-core envelope/`{coverage,...}` shape handed to `toolResult` is already a plain
 *  object; this only widens the TS view to `Record<string, unknown>` so `toolResult` has one
 *  parameter type. It copies, drops, and renames nothing. */
function asRecord<T extends object>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------
// search_properties
// ---------------------------------------------------------------------------------------

export async function searchPropertiesTool(
  deps: McpToolDeps,
  input: SearchPropertiesInput,
): Promise<CallToolResult> {
  const ctx = await deps.resolveRun(input.manifest_cid);
  if (ctx === undefined)
    return toolResult(asRecord(runNotFoundEnvelope<Row>(input.manifest_cid, { ...input })));
  const envelope = await searchProperties(ctx.engine, ctx.bound, input);
  return toolResult(asRecord(envelope));
}

// ---------------------------------------------------------------------------------------
// list_permits
// ---------------------------------------------------------------------------------------

export async function listPermitsTool(
  deps: McpToolDeps,
  input: ListPermitsInput,
): Promise<CallToolResult> {
  const ctx = await deps.resolveRun(input.manifest_cid);
  if (ctx === undefined)
    return toolResult(asRecord(runNotFoundEnvelope<Row>(input.manifest_cid, { ...input })));
  const envelope = await listPermits(ctx.engine, ctx.bound, input);
  return toolResult(asRecord(envelope));
}

// ---------------------------------------------------------------------------------------
// get_property
// ---------------------------------------------------------------------------------------

export async function getPropertyTool(
  deps: McpToolDeps,
  input: GetPropertyInput,
): Promise<CallToolResult> {
  const ctx = await deps.resolveRun(input.manifest_cid);
  if (ctx === undefined)
    return toolResult(asRecord(runNotFoundEnvelope<Row>(input.manifest_cid, { ...input })));
  const envelope = await getProperty(ctx.engine, ctx.bound, input);
  return toolResult(asRecord(envelope));
}

// ---------------------------------------------------------------------------------------
// get_coverage
// ---------------------------------------------------------------------------------------

export async function getCoverageTool(
  deps: McpToolDeps,
  input: GetCoverageInput,
): Promise<CallToolResult> {
  const ctx = await deps.resolveRun(input.manifest_cid);
  if (ctx === undefined) {
    return toolResult({
      coverage: {},
      run: input.manifest_cid === undefined ? FAKE_RUN_ECHO : { ...FAKE_RUN_ECHO, manifest_cid: input.manifest_cid },
      empty_reason: "run_not_found",
    });
  }
  const result = await getCoverage(ctx.engine, ctx.bound, input);
  return toolResult(asRecord(result));
}

// ---------------------------------------------------------------------------------------
// list_runs
// ---------------------------------------------------------------------------------------

export async function listRunsTool(deps: McpToolDeps, input: ListRunsInput): Promise<CallToolResult> {
  const index = await deps.runsIndex();
  const result = listRuns(index, input);
  return toolResult(asRecord(result));
}

// ---------------------------------------------------------------------------------------
// get_schema
// ---------------------------------------------------------------------------------------

export function getSchemaTool(input: GetSchemaInput): CallToolResult {
  const result = getSchema(input);
  return toolResult(asRecord(result));
}

// ---------------------------------------------------------------------------------------
// Registration (AD-21 fixed names; inputSchema is the query-core schema object, unchanged)
// ---------------------------------------------------------------------------------------

export function registerMcpTools(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "search_properties",
    {
      title: "Search properties",
      description:
        "Properties in or near an area, filtered by roof age, tenure, out-of-area owner, or an " +
        "open/stalled roofing permit. AD-07 column names; returns the published Provenance on " +
        "every row.",
      inputSchema: SearchPropertiesInput,
    },
    async (input) => searchPropertiesTool(deps, input),
  );

  server.registerTool(
    "list_permits",
    {
      title: "List roofing permits",
      description:
        "Roofing permits, county-wide by default or inside an area/radius, filtered by status " +
        "class, minimum open years, or an exact permit number.",
      inputSchema: ListPermitsInput,
    },
    async (input) => listPermitsTool(deps, input),
  );

  server.registerTool(
    "get_property",
    {
      title: "Get property",
      description: "One property by its CID or TCAD request identifier, with its roofing permits.",
      inputSchema: GetPropertyInput,
    },
    async (input) => getPropertyTool(deps, input),
  );

  server.registerTool(
    "get_coverage",
    {
      title: "Get run coverage",
      description: "The published run's coverage figures, unchanged, for the latest run or a named manifest_cid.",
      inputSchema: GetCoverageInput,
    },
    async (input) => getCoverageTool(deps, input),
  );

  server.registerTool(
    "list_runs",
    {
      title: "List runs",
      description: "The committed runs index: every published run, newest first.",
      inputSchema: ListRunsInput,
    },
    async (input) => listRunsTool(deps, input),
  );

  server.registerTool(
    "get_schema",
    {
      title: "Get schema",
      description:
        "The four contract views' column catalogs (AD-07 names, enums, nullability, missing-" +
        "reason), the uncarried-field list, and the six tools' own JSON Schemas.",
      inputSchema: GetSchemaInput,
    },
    (input) => getSchemaTool(input),
  );
}

/** Re-exported so callers (handlers/mcp.ts, stdio.ts, tests) never need a second import from
 *  @countylens/query-core just to compare "is this the same schema object" (T024). */
export {
  GetCoverageInput,
  GetPropertyInput,
  GetSchemaInput,
  ListPermitsInput,
  ListRunsInput,
  SearchPropertiesInput,
};

/** Exactly the schema object each `registerTool` call above passes as `inputSchema`, by AD-21
 *  tool name — the single source T024's "inputSchema IS the matching query-core Zod schema
 *  object" assertion compares against (`=== ` on this map's values, not a re-derivation). */
export const MCP_TOOL_SCHEMAS = {
  search_properties: SearchPropertiesInput,
  list_permits: ListPermitsInput,
  get_property: GetPropertyInput,
  get_coverage: GetCoverageInput,
  list_runs: ListRunsInput,
  get_schema: GetSchemaInput,
} as const;
