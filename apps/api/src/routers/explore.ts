// A-13 T012 (contracts/explore-search.md): `explore.search`, the additive procedure behind every
// Explore · Filters search (research R1; ARD AM-04/AM-06: radius, roof age and COUNT run on the
// Lambda DuckDB at full scale). The input is Zod-bounded; the area is a gazetteer place id or an
// `at` point inside the Travis box; the run is the one the client read from runs/index.json
// (`manifestCid`, like runs.summary and query.*), so `as_of` always names the bound run. The SQL
// is exactly query-core `exploreSearchSql` (AD-19): summary first, then the page of rows, and
// the close-match statement only when nothing is inside the radius (FR-015). Rows are mapped
// with `toExploreRow` (provenance and a missing reason on every row) and capped at 1,000.
// Observability comes from the handler (src/handlers/trpc.ts → observeQuery): one Powertools log
// line with `procedure = explore.search` and `queryDurationMs` (returned here, summed over the
// statements), and the `duckdb.query` X-Ray subsegment. Engine failures become
// INTERNAL_SERVER_ERROR with a plain message: no stack, no SQL, no engine text.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { CidV1 } from "@countylens/contract";
import {
  EXPLORE_BOUNDS,
  EXPLORE_DEFAULT_LIMIT,
  EXPLORE_MAX_PAGE,
  EXPLORE_SORTS,
  MAX_ROWS,
  PERMIT_FILTERS,
  exploreSearchSql,
  milesOutside,
  resolvePlace,
  toExploreRow,
  viewsReadBy,
  type ExploreResult,
} from "@countylens/query-core";
import { bindOnce, timedQuery } from "../engine/duckdb-node.js";
import { publicProcedure, router } from "../trpc.js";

export const EXPLORE_ENGINE_ERROR = "The search could not run on the server; try again";
export const EXPLORE_PLACE_ERROR = "place is not in the Travis County gazetteer";

const { lat, lon, radiusMi, roof, openYrs, tenure } = EXPLORE_BOUNDS;

export const ExploreArea = z.union([
  z.object({ place: z.string().trim().min(1).max(100) }).strict(),
  z
    .object({
      at: z
        .object({
          lat: z.number().min(lat[0]).max(lat[1]),
          lon: z.number().min(lon[0]).max(lon[1]),
        })
        .strict(),
    })
    .strict(),
]);

export const ExploreSearchInput = z.object({
  manifestCid: CidV1,
  area: ExploreArea,
  radius_mi: z.number().min(radiusMi[0]).max(radiusMi[1]),
  roof: z.number().int().min(roof[0]).max(roof[1]).optional(),
  permit: z.enum(PERMIT_FILTERS).optional(),
  openYrs: z.number().min(openYrs[0]).max(openYrs[1]).optional(),
  tenure: z.number().int().min(tenure[0]).max(tenure[1]).optional(),
  ooa: z.boolean().optional(),
  sort: z.enum(EXPLORE_SORTS).default("nearest"),
  limit: z.number().int().min(1).max(MAX_ROWS).default(EXPLORE_DEFAULT_LIMIT),
  page: z.number().int().min(0).max(EXPLORE_MAX_PAGE).default(0),
});
export type ExploreSearchInput = z.infer<typeof ExploreSearchInput>;

/** The centre and its label: a gazetteer place (label from resolvePlace) or the `at` point. */
function resolveArea(area: ExploreSearchInput["area"]): ExploreResult["area"] {
  if ("at" in area) {
    return { label: `${area.at.lat}, ${area.at.lon}`, lat: area.at.lat, lon: area.at.lon };
  }
  const place = resolvePlace(area.place);
  if (place.status !== "found")
    throw new TRPCError({ code: "BAD_REQUEST", message: EXPLORE_PLACE_ERROR });
  return { label: place.label, lat: place.point.lat, lon: place.point.lon };
}

export const exploreRouter = router({
  search: publicProcedure
    .input(ExploreSearchInput)
    .query(async ({ input }): Promise<ExploreResult> => {
      const area = resolveArea(input.area);
      const centre = { lat: area.lat, lon: area.lon };
      const sql = exploreSearchSql({
        centre,
        radius_mi: input.radius_mi,
        roof: input.roof,
        permit: input.permit,
        openYrs: input.openYrs,
        tenure: input.tenure,
        ooa: input.ooa,
        sort: input.sort,
        limit: input.limit,
        page: input.page,
      });
      const meta = { name: "exploreSearchSql", manifestCid: input.manifestCid };
      try {
        const bound = await bindOnce(input.manifestCid, viewsReadBy(sql.rows)); // ERR-19: its views only
        const summary = await timedQuery(sql.summary, meta);
        const counts = summary.rows[0] ?? {};
        const total = Number(counts["total_within_r"] ?? 0);
        const tenureUnknown = Number(counts["tenure_unknown"] ?? 0);
        let queryDurationMs = summary.queryDurationMs;
        let rows: ExploreResult["rows"] = [];
        let closeMatches: ExploreResult["close_matches"] = [];
        if (total > 0) {
          const page = await timedQuery(sql.rows, meta);
          queryDurationMs += page.queryDurationMs;
          rows = page.rows.map((r) => toExploreRow(r, centre));
        } else {
          const close = await timedQuery(sql.close, meta);
          queryDurationMs += close.queryDurationMs;
          closeMatches = close.rows.map((r) => ({
            row: toExploreRow(r, centre),
            miles_outside: milesOutside(r, input.radius_mi),
          }));
        }
        return {
          total_within_r: total,
          tenure_unknown: tenureUnknown,
          rows,
          close_matches: closeMatches,
          as_of: { runId: bound.runId, manifestCid: bound.manifestCid, finishedAt: bound.asOf },
          area,
          engine: "server",
          queryDurationMs: Math.round(queryDurationMs * 1000) / 1000,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: EXPLORE_ENGINE_ERROR });
      }
    }),
});
