// T021 (A-14, agent-design.md § 8 "ash", § 9 "same definitions, or separate thin adapters");
// data-model.md § "agent.ask contract"): four camelCase AI SDK tools, thin adapters wired to
// packages/query-core's real functions (T011/T011a, G-1) — all four real, never stubbed, per
// /speckit-analyze finding F1. These are agent-only concerns layered over the shared query-core
// schemas: a compact (<=25-row) projection carrying each row's citation index `n` (so the model
// cites `[n]`, never a CID it must invent), and registering every row the tools return this turn
// into the per-request citation registry (citations.ts, T019). The MCP server's six tools
// (apps/api/src/mcp/tools.ts, oracle's G-3) are a separate set of thin adapters over the same
// query-core functions/schemas — not these tool objects — because the MCP contract needs full
// (<=1,000-row) envelopes with snake_case names (AD-21), which would blow the agent's token
// budget.
import { tool } from "ai";
import { z } from "zod";
import {
  GetPropertyInput,
  ListPermitsInput,
  SearchPropertiesInput,
  geocodePlace as geocodePlaceFn,
  getProperty as getPropertyFn,
  listPermits as listPermitsFn,
  searchProperties as searchPropertiesFn,
  type BoundRun,
  type QueryEngine,
  type ResultEnvelope,
  type Row,
} from "@countylens/query-core";
import type { CitationRegistry } from "./citations.js";

/** Rows the model sees per tool call (agent-design.md § 5): a compact projection, never the full
 *  row and never more than this many per call, so three tool calls over 1,000-row envelopes stay
 *  inside the 1,500-output-token budget. `matches[]` in the final response still carries every
 *  row the tools returned that satisfied the filters (query-core's `ResultEnvelope.rows`), not
 *  only these — recall is measured on the server-built `matches[]`, not on what the model read. */
export const MAX_PROJECTED_ROWS_PER_CALL = 25;

export interface AgentToolsContext {
  readonly engine: QueryEngine;
  readonly bound: BoundRun;
  /** One registry per request (ask.ts creates it); every tool call in this turn shares it so a
   *  row returned twice keeps its first-seen citation index. */
  readonly registry: CitationRegistry;
}

function projectProperty(n: number, row: Row): Record<string, unknown> {
  return {
    n,
    property_cid: row.cid,
    dist_mi: row.dist_mi,
    roof_age_years: row.roof_age_years,
    roof_age_basis: row.roof_age_basis,
    roof_age_confidence: row.roof_age_confidence,
    tenure_years: row.tenure_years,
    owner_is_out_of_area: row.owner_is_out_of_area,
  };
}

function projectPermit(n: number, row: Row): Record<string, unknown> {
  return {
    n,
    property_cid: row.property_cid,
    permit_number: row.permit_number,
    status_class: row.status_class,
    open_days: row.open_days,
    open_years: row.open_years,
    dist_mi: row.dist_mi,
    contractor_resolution:
      typeof row.contractor === "object" && row.contractor !== null
        ? (row.contractor as Record<string, unknown>).resolution
        : undefined,
    bbb_status: row.bbb_status,
    bbb_status_reason: row.bbb_status_reason,
  };
}

/** Registers every row of `envelope.rows` (keyed by the row's own `cid`, T019) and returns the
 *  compact projection + envelope metadata the model sees — never the full rows. */
function projectEnvelope(
  envelope: ResultEnvelope<Row>,
  registry: CitationRegistry,
  project: (n: number, row: Row) => Record<string, unknown>,
): Record<string, unknown> {
  const matches = envelope.rows.slice(0, MAX_PROJECTED_ROWS_PER_CALL).map((row) => {
    const cid = String(row.cid);
    const n = registry.register({ ...row, cid });
    return project(n, row);
  });
  return {
    matches,
    returned: envelope.returned,
    total: envelope.total,
    truncated: envelope.truncated,
    empty_reason: envelope.empty_reason,
    unknown_excluded: envelope.unknown_excluded,
    area: envelope.area,
    applied: envelope.applied,
  };
}

/** Builds the four agent tools over one bound run + one citation registry (one per request). */
export function createAgentTools(ctx: AgentToolsContext) {
  const { engine, bound, registry } = ctx;

  const geocodePlace = tool({
    description:
      "Resolve a place name, ZIP/ZCTA or 7-digit GEOID to a point in or near Travis County, via " +
      "the Census 2024 Gazetteer. Exact match only -- a misspelling or anything outside Travis " +
      "County returns status 'out_of_scope', never a guessed point. searchProperties and " +
      "searchRoofingPermits accept an area place name directly and resolve it themselves, so " +
      "call this tool only to disambiguate a place or to check whether it is in scope.",
    inputSchema: z.object({ query: z.string().trim().min(1).max(100) }),
    execute: async ({ query }) => geocodePlaceFn({ query }),
  });

  const searchProperties = tool({
    description:
      "Search properties within a radius of a place or point, filtered by roof age, tenure, an " +
      "out-of-area owner mailing address, or an open/stalled roofing permit. Returns a compact " +
      "list of matches, each carrying a citation index n -- cite rows in the answer as [n], " +
      "never invent a CID. unknown_excluded counts rows left out because a filtered field is " +
      "null (say 'unknown', never 'none', when that count is non-zero); empty_reason explains a " +
      "zero-row result (out_of_scope, no_match, or field_not_published).",
    // manifest_cid stays in the schema (ListPermitsInput/GetPropertyInput carry a `.refine()`
    // Zod cannot `.omit()` from, zod/v4/core/util.js "omit() cannot be used on object schemas
    // containing refinements"); the agent pins one run per conversation, so every execute()
    // below drops any manifest_cid the model supplies rather than trusting it.
    inputSchema: SearchPropertiesInput,
    execute: async (input) => {
      const envelope = await searchPropertiesFn(engine, bound, { ...input, manifest_cid: undefined });
      return projectEnvelope(envelope, registry, projectProperty);
    },
  });

  const searchRoofingPermits = tool({
    description:
      "List roofing permits (replacement roofs), optionally within a radius of a place, " +
      "filtered by status (open, stalled, closed), minimum years open, or an exact permit " +
      "number (format 'YYYY-NNNNNN XX'). Omitting the area searches county-wide. Returns a " +
      "compact list of matches, each carrying a citation index n -- cite rows as [n].",
    inputSchema: ListPermitsInput,
    execute: async (input) => {
      const envelope = await listPermitsFn(engine, bound, { ...input, manifest_cid: undefined });
      return projectEnvelope(envelope, registry, projectPermit);
    },
  });

  const getProperty = tool({
    description:
      "Look up one property by its CID or by the TCAD parcel identifier exactly as printed, " +
      "including its roofing permits.",
    inputSchema: GetPropertyInput,
    execute: async (input) => {
      const envelope = await getPropertyFn(engine, bound, { ...input, manifest_cid: undefined });
      return projectEnvelope(envelope, registry, projectProperty);
    },
  });

  return { geocodePlace, searchProperties, searchRoofingPermits, getProperty };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
