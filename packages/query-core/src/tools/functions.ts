// T011/T011a (A-14, agent-design.md § 2-3, analyze finding F1): the six query-core tool
// functions plus geocodePlace and the shared area-resolution helper, built directly on
// gazetteer.lookup() (travis-places@1.0.0) and the existing builders.ts/permits.ts SQL
// primitives — not on A-13's exploreSearchSql/resolvePlace, which are not on this branch.
// Each function: validate (the caller already ran the matching Zod schema) -> build SQL from
// radiusSql/roofAgeSql/permitsSql -> engine.all -> map rows -> ResultEnvelope. Nothing here
// derives a value the views do not already carry; roof age, tenure and every provenance field
// come straight off v_property/v_roofing_permit.
//
// run_not_found: query-core binds one run per engine (bindManifest), so a function cannot itself
// rebind to a different manifest_cid. When a caller names one that is not the currently bound
// run's, the function returns an empty envelope with empty_reason "run_not_found" rather than
// silently answering from the wrong run; resolving *which* run to bind for a given manifest_cid
// is a layer above query-core (not built in this story).
import type { RunsIndexV1 } from "@countylens/contract";
import { COLUMN_ENUMS, UNCARRIED, VIEWS } from "@countylens/contract";
import { z } from "zod";
import type { BoundRun } from "../bind-manifest.js";
import { METRES_PER_MILE } from "../builders.js";
import type { QueryEngine, Row } from "../engine.js";
import { DAYS_PER_YEAR, geoFilter, permitsCountSql, permitsSql } from "../permits.js";
import * as gazetteer from "../../gazetteer/travis-places@1.0.0/index.js";
import type { Found } from "../../gazetteer/travis-places@1.0.0/index.js";
import {
  GetCoverageInput,
  GetPropertyInput,
  GetSchemaInput,
  ListPermitsInput,
  ListRunsInput,
  SearchPropertiesInput,
  type AreaEcho,
  type AreaInput,
  type EmptyReason,
  type ResultEnvelope,
  type RunEcho,
} from "./schemas.js";

// ---------------------------------------------------------------------------------------
// geocodePlace
// ---------------------------------------------------------------------------------------

export interface GeocodeFound {
  status: "found";
  id?: string;
  kind: "place" | "zcta";
  name: string;
  point: { lat: number; lon: number };
  label: string;
  partial_in_travis: boolean;
  counties: string[];
  source: Found["source"];
  gazetteer: Found["gazetteer"];
}
export interface GeocodeOutOfScope {
  status: "out_of_scope";
  query: string;
}
export type GeocodeResult = GeocodeFound | GeocodeOutOfScope;

/** The year of the Census Gazetteer vintage behind a found place's source stamp. */
function vintageYear(fileDate: string): number {
  return new Date(fileDate).getUTCFullYear();
}

function placeLabel(found: Found): string {
  return `${found.name} · Census ${vintageYear(found.source.file_date)} Gazetteer · ${found.point.lat}, ${found.point.lon}`;
}

/** geocodePlace: exact gazetteer match only (no fuzzy match is ever auto-applied, § 3). A
 *  misspelling or anything outside Travis County is out_of_scope, never a guessed point. */
export function geocodePlace(input: { query: string }): GeocodeResult {
  const found = gazetteer.lookup(input.query);
  if (found.status === "out_of_scope") return { status: "out_of_scope", query: found.query };
  const id = found.kind === "place" ? found.geoid : found.zcta;
  return {
    status: "found",
    id,
    kind: found.kind,
    name: found.name,
    point: found.point,
    label: placeLabel(found),
    partial_in_travis: found.partial_in_travis,
    counties: [...found.counties],
    source: found.source,
    gazetteer: found.gazetteer,
  };
}

// ---------------------------------------------------------------------------------------
// Shared area resolution (searchProperties / listPermits)
// ---------------------------------------------------------------------------------------

interface Centre {
  lat: number;
  lon: number;
}

type AreaResolution = { outOfScope: true; query: string } | { outOfScope: false; centre: Centre; echo: AreaEcho };

/** The shared helper T011a names: resolves AreaInput (a place name or a raw lat/lon) to a centre
 *  point and its citable echo, directly on gazetteer.lookup(). A raw lat/lon is always resolved
 *  (global bounds, AC-11); EXPLORE_BOUNDS-style out-of-Travis rejection for a bare point is not
 *  built in this story (A-13 territory) and is noted here, not silently assumed. */
function resolveArea(area: AreaInput): AreaResolution {
  if ("place" in area) {
    const found = gazetteer.lookup(area.place);
    if (found.status === "out_of_scope") return { outOfScope: true, query: area.place };
    const id = found.kind === "place" ? found.geoid : found.zcta;
    return {
      outOfScope: false,
      centre: found.point,
      echo: {
        label: placeLabel(found),
        point: found.point,
        kind: found.kind,
        id,
        partial_in_travis: found.partial_in_travis,
        source: found.source,
        gazetteer: found.gazetteer,
      },
    };
  }
  return {
    outOfScope: false,
    centre: { lat: area.lat, lon: area.lon },
    echo: {
      label: `${area.lat}, ${area.lon}`,
      point: { lat: area.lat, lon: area.lon },
      kind: "point",
      partial_in_travis: false,
      source: { url: "", file_date: "", sha256: "" },
      gazetteer: { version: gazetteer.GAZETTEER.version, sha256: gazetteer.GAZETTEER.sha256 },
    },
  };
}

// ---------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------

function runEcho(bound: BoundRun): RunEcho {
  return { run_id: bound.runId, manifest_cid: bound.manifestCid, as_of: bound.asOf };
}

/** True when the caller named a manifest_cid other than the currently bound run's (see the
 *  module header note on run_not_found). */
function wrongRun(bound: BoundRun, manifestCid?: string): boolean {
  return manifestCid !== undefined && manifestCid !== bound.manifestCid;
}

/** Builds a ResultEnvelope, handling `area`'s optionality the way `exactOptionalPropertyTypes`
 *  requires: the key is omitted entirely rather than ever set to `undefined`. */
function envelope<R>(params: {
  rows: R[];
  returned: number;
  total: number;
  emptyReason: EmptyReason | null;
  unknownExcluded?: Record<string, number> | undefined;
  area?: AreaEcho | undefined;
  run: RunEcho;
  applied: Record<string, unknown>;
}): ResultEnvelope<R> {
  const { rows, returned, total, emptyReason, unknownExcluded, area, run, applied } = params;
  return {
    rows,
    returned,
    total,
    truncated: total > returned,
    empty_reason: emptyReason,
    unknown_excluded: unknownExcluded ?? {},
    ...(area ? { area } : {}),
    run,
    applied,
  };
}

function emptyEnvelope<R>(
  run: RunEcho,
  reason: EmptyReason,
  applied: Record<string, unknown>,
  area?: AreaEcho,
): ResultEnvelope<R> {
  return envelope({ rows: [], returned: 0, total: 0, emptyReason: reason, area, run, applied });
}

async function countOf(engine: QueryEngine, sql: string): Promise<number> {
  const rows = await engine.all(sql);
  return Number((rows[0] as { n: number } | undefined)?.n ?? 0);
}

type PropertyStatusClass = NonNullable<SearchPropertiesInput["status_class"]>;
function statusClassesFor(statusClass: PropertyStatusClass | undefined): readonly string[] | undefined {
  if (statusClass === undefined) return undefined;
  if (statusClass === "open_or_stalled") return ["open", "stalled"];
  return [statusClass];
}

const sqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;

// ---------------------------------------------------------------------------------------
// searchProperties
// ---------------------------------------------------------------------------------------

export async function searchProperties(
  engine: QueryEngine,
  bound: BoundRun,
  rawInput: z.input<typeof SearchPropertiesInput>,
): Promise<ResultEnvelope<Row>> {
  const input = SearchPropertiesInput.parse(rawInput);
  const run = runEcho(bound);
  const applied: Record<string, unknown> = { ...input };
  if (wrongRun(bound, input.manifest_cid)) return emptyEnvelope(run, "run_not_found", applied);

  const resolved = resolveArea(input.area);
  if (resolved.outOfScope) return emptyEnvelope(run, "out_of_scope", applied);
  const { centre, echo } = resolved;

  const { bbox, distance, radiusM } = geoFilter(centre.lat, centre.lon, input.radius_mi);
  const radiusWhere = `p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND ${bbox} AND ${distance} < ${radiusM}`;
  const where: string[] = [radiusWhere];

  if (input.roof_age_years_min !== undefined)
    where.push(`(p.roof_age_years >= ${input.roof_age_years_min} OR p.roof_age_years IS NULL)`);
  if (input.tenure_years_min !== undefined)
    where.push(`(p.tenure_years >= ${input.tenure_years_min} OR p.tenure_years IS NULL)`);
  // Unlike the threshold filters above, owner_is_out_of_area is an exact boolean match: an
  // unknown value is excluded (counted in unknown_excluded), never kept as a possible match.
  if (input.owner_is_out_of_area === true) where.push(`p.owner_is_out_of_area = true`);

  const statusClasses = statusClassesFor(input.status_class);
  if (statusClasses !== undefined || input.open_years_min !== undefined) {
    const permitWhere = [
      "r.property_cid = p.property_cid",
      `r.status_class IN (${(statusClasses ?? ["open", "stalled"]).map(sqlStr).join(", ")})`,
    ];
    if (input.open_years_min !== undefined)
      permitWhere.push(`r.open_days >= ${(input.open_years_min * DAYS_PER_YEAR).toFixed(4)}`);
    where.push(`EXISTS (SELECT 1 FROM v_roofing_permit r WHERE ${permitWhere.join(" AND ")})`);
  }

  const order =
    input.sort === "open_desc"
      ? `EXISTS (SELECT 1 FROM v_roofing_permit r WHERE r.property_cid = p.property_cid AND r.is_open) DESC, ${distance}`
      : input.sort === "roof_desc"
        ? "(p.roof_age_years IS NULL), p.roof_age_years DESC"
        : distance;

  const whereSql = where.join(" AND ");
  const rowsSql = `SELECT p.*, ${distance} AS dist_m
FROM v_property p
WHERE ${whereSql}
ORDER BY ${order}, p.cid
LIMIT ${input.limit}`;
  const countSql = `SELECT count(*) AS n FROM v_property p WHERE ${whereSql}`;

  const [rawRows, total] = await Promise.all([engine.all(rowsSql), countOf(engine, countSql)]);
  const rows = rawRows.map((r) => ({ ...r, dist_mi: toMiles(r.dist_m) }));
  const returned = rows.length;

  const unknownExcluded: Record<string, number> = {};
  if (input.roof_age_years_min !== undefined)
    unknownExcluded.roof_age_years = await countOf(
      engine,
      `SELECT count(*) AS n FROM v_property p WHERE ${radiusWhere} AND p.roof_age_years IS NULL`,
    );
  if (input.tenure_years_min !== undefined)
    unknownExcluded.tenure_years = await countOf(
      engine,
      `SELECT count(*) AS n FROM v_property p WHERE ${radiusWhere} AND p.tenure_years IS NULL`,
    );
  if (input.owner_is_out_of_area === true)
    unknownExcluded.owner_is_out_of_area = await countOf(
      engine,
      `SELECT count(*) AS n FROM v_property p WHERE ${radiusWhere} AND p.owner_is_out_of_area IS NULL`,
    );

  let emptyReason: EmptyReason | null = null;
  if (returned === 0) {
    const radiusTotal = await countOf(engine, `SELECT count(*) AS n FROM v_property p WHERE ${radiusWhere}`);
    const allExcludedByUnknown = Object.values(unknownExcluded).some(
      (n) => radiusTotal > 0 && n === radiusTotal,
    );
    emptyReason = allExcludedByUnknown ? "field_not_published" : "no_match";
  }

  return envelope({ rows, returned, total, emptyReason, unknownExcluded, area: echo, run, applied });
}

function toMiles(distM: unknown): number | undefined {
  return typeof distM === "number" ? Number((distM / METRES_PER_MILE).toFixed(3)) : undefined;
}

// ---------------------------------------------------------------------------------------
// listPermits
// ---------------------------------------------------------------------------------------

function mapPermitRow(row: Row): Row {
  const openDays = row.open_days;
  const distM = row.dist_m;
  return {
    ...row,
    status_raw: null,
    contractor: {
      name_as_printed: null,
      resolution: row.contractor_resolution,
      company_cid: row.contractor_company_cid,
    },
    open_years: typeof openDays === "number" ? Number((openDays / DAYS_PER_YEAR).toFixed(2)) : null,
    dist_mi: toMiles(distM),
  };
}

export async function listPermits(
  engine: QueryEngine,
  bound: BoundRun,
  rawInput: z.input<typeof ListPermitsInput>,
): Promise<ResultEnvelope<Row>> {
  const input = ListPermitsInput.parse(rawInput);
  const run = runEcho(bound);
  const applied: Record<string, unknown> = { ...input };
  if (wrongRun(bound, input.manifest_cid)) return emptyEnvelope(run, "run_not_found", applied);

  let areaEcho: AreaEcho | undefined;
  let centre: Centre | undefined;
  if (input.area !== undefined) {
    const resolved = resolveArea(input.area);
    if (resolved.outOfScope) return emptyEnvelope(run, "out_of_scope", applied);
    centre = resolved.centre;
    areaEcho = resolved.echo;
  }

  if (input.permit_number !== undefined) {
    const rows = await engine.all(permitsSql({ permitNumber: input.permit_number, limit: 1 }));
    if (rows.length === 0) return emptyEnvelope(run, "not_found", applied, areaEcho);
    return envelope({
      rows: rows.map((r) => mapPermitRow(r)),
      returned: 1,
      total: 1,
      emptyReason: null,
      area: areaEcho,
      run,
      applied,
    });
  }

  const filter = {
    ...(centre ? { centre: { ...centre, miles: input.radius_mi as number } } : {}),
    statusClass: statusClassesFor(input.status_class as PropertyStatusClass | undefined),
    openYearsMin: input.open_years_min,
    sort: input.sort,
    limit: input.limit,
  };
  const [rawRows, total] = await Promise.all([
    engine.all(permitsSql(filter)),
    countOf(engine, permitsCountSql(filter)),
  ]);
  const rows = rawRows.map((r) => mapPermitRow(r));
  const returned = rows.length;
  return envelope({
    rows,
    returned,
    total,
    emptyReason: returned === 0 ? "no_match" : null,
    area: areaEcho,
    run,
    applied,
  });
}

// ---------------------------------------------------------------------------------------
// getProperty
// ---------------------------------------------------------------------------------------

export async function getProperty(
  engine: QueryEngine,
  bound: BoundRun,
  rawInput: z.input<typeof GetPropertyInput>,
): Promise<ResultEnvelope<Row>> {
  const input = GetPropertyInput.parse(rawInput);
  const run = runEcho(bound);
  const applied: Record<string, unknown> = { ...input };
  if (wrongRun(bound, input.manifest_cid)) return emptyEnvelope(run, "run_not_found", applied);

  const whereClause =
    input.property_cid !== undefined
      ? `property_cid = ${sqlStr(input.property_cid)}`
      : `request_identifier = ${sqlStr(input.request_identifier as string)}`;
  const rows = await engine.all(`SELECT * FROM v_property WHERE ${whereClause} LIMIT 1`);
  if (rows.length === 0) return emptyEnvelope(run, "not_found", applied);

  const propertyCid = String(rows[0]?.property_cid);
  const permits = await engine.all(permitsSql({ propertyCid, limit: 100 }));
  const detail: Row = { ...rows[0], permits: permits.map((p) => mapPermitRow(p)) };
  return envelope({ rows: [detail], returned: 1, total: 1, emptyReason: null, run, applied });
}

// ---------------------------------------------------------------------------------------
// getCoverage
// ---------------------------------------------------------------------------------------

export async function getCoverage(
  engine: QueryEngine,
  bound: BoundRun,
  rawInput: z.input<typeof GetCoverageInput> = {},
): Promise<{ coverage: unknown; run: RunEcho; empty_reason?: EmptyReason }> {
  const input = GetCoverageInput.parse(rawInput);
  const run = runEcho(bound);
  if (wrongRun(bound, input.manifest_cid)) return { coverage: {}, run, empty_reason: "run_not_found" };
  const rows = await engine.all("SELECT coverage FROM v_run");
  const raw = rows[0]?.coverage;
  // DuckDB's JSON column comes back as JSON text, not a parsed object (scripts/duckdb-engine.ts
  // does not special-case the JSON type); parse it so AC-9's deep-equal is against real objects.
  const coverage = typeof raw === "string" ? JSON.parse(raw) : raw ?? {};
  return { coverage, run };
}

// ---------------------------------------------------------------------------------------
// listRuns
// ---------------------------------------------------------------------------------------

export function listRuns(
  index: Pick<RunsIndexV1, "runs">,
  rawInput: z.input<typeof ListRunsInput> = {},
): { runs: { run_id: string; manifest_cid: string; finished_at: string }[]; latest: { run_id: string; manifest_cid: string; finished_at: string } | null } {
  const input = ListRunsInput.parse(rawInput);
  const sorted = [...index.runs].sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
  const runs = sorted
    .slice(0, input.limit)
    .map((r) => ({ run_id: r.runId, manifest_cid: r.manifestCid, finished_at: r.finishedAt }));
  return { runs, latest: runs[0] ?? null };
}

// ---------------------------------------------------------------------------------------
// getSchema
// ---------------------------------------------------------------------------------------

const TOOL_SCHEMAS = {
  searchProperties: SearchPropertiesInput,
  listPermits: ListPermitsInput,
  getProperty: GetPropertyInput,
  getCoverage: GetCoverageInput,
  listRuns: ListRunsInput,
  getSchema: GetSchemaInput,
} as const;

export function getSchema(rawInput: z.input<typeof GetSchemaInput> = {}): {
  views: { name: string; columns: unknown[] }[];
  uncarried: unknown;
  enums: typeof COLUMN_ENUMS;
  tool_inputs: Record<string, unknown>;
} {
  const input = GetSchemaInput.parse(rawInput);
  const viewNames = input.view ? [input.view] : (Object.keys(VIEWS) as (keyof typeof VIEWS)[]);
  const views = viewNames.map((name) => ({
    name,
    columns: VIEWS[name].map((c) => ({
      name: c.name,
      type: c.type,
      enum: c.enum,
      nullable: c.nullable,
      meaning: c.meaning,
      missingReason: c.missingReason,
    })),
  }));
  const uncarried = input.view
    ? { [input.view]: (UNCARRIED as Record<string, unknown>)[input.view] ?? [] }
    : UNCARRIED;
  const tool_inputs = Object.fromEntries(
    Object.entries(TOOL_SCHEMAS).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
  );
  return { views, uncarried, enums: COLUMN_ENUMS, tool_inputs };
}
