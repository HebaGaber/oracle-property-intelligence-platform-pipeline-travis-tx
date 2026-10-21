// T061 (A-02, FR-002 / FR-011): bind the four views to one run manifest and its export-tables
// output. Everything the views stamp on a row comes from here: as_of = finishedAt (never now()),
// captured_at from sources[], profile_version/profile_sha256 from profiles[], table_cid from the
// manifest's part artifacts, manifest_cid = the raw-leaves CIDv1 of the manifest bytes.
// Tables the export did not emit become empty typed relations (oracle R10). No engine import:
// SQL goes through the QueryEngine interface.
import { RunManifestV1 } from "@countylens/contract";
import { PROFILE, RULES } from "@countylens/profile-travis-austin";
import { GAZETTEER } from "../gazetteer/travis-places@1.0.0/index.js";
import { deriveMacrosSql, zctaAreaRows } from "./derive.js";
import type { QueryEngine } from "./engine.js";
import { rawCid } from "./raw-cid.js";
import { STATUS_MAP_SQL, VIEWS_SQL } from "./sql.js";

const V = "VARCHAR";
/** The manifest profiles[] name of the travis-places gazetteer (area_list_sha256). */
export const PLACES_PROFILE = "travis-places";
const ENTITY = { cid: V, property_cid: V, data_group_cid: V, request_identifier: V };
const EDGE = { relationship_cid: V, from_cid: V, to_cid: V, property_cid: V, data_group_cid: V };

export interface RequiredTable {
  group: "county" | "property_improvement";
  table: string;
  /** The columns views.sql reads, with the type export-tables gives them. */
  columns: Readonly<Record<string, string>>;
}

const edge = (group: RequiredTable["group"], table: string): RequiredTable => ({
  group,
  table,
  columns: EDGE,
});

/** Every relation views.sql reads. Emitted ones must carry these columns. */
export const REQUIRED_TABLES: readonly RequiredTable[] = [
  {
    group: "county",
    table: "property",
    columns: {
      ...ENTITY,
      parcel_identifier: V,
      property_type: V,
      property_usage_type: V,
      property_structure_built_year: "BIGINT",
      source_http_request: V,
    },
  },
  {
    group: "county",
    table: "geometry",
    columns: { ...ENTITY, latitude: "DOUBLE", longitude: "DOUBLE" },
  },
  { group: "county", table: "structure", columns: { ...ENTITY, roof_date: V } },
  { group: "county", table: "sales_history", columns: { ...ENTITY, ownership_transfer_date: V } },
  { group: "county", table: "person", columns: { ...ENTITY, first_name: V, last_name: V } },
  { group: "county", table: "company", columns: { ...ENTITY, name: V } },
  edge("county", "property_has_parcel"),
  edge("county", "parcel_has_geometry"),
  edge("county", "property_has_structure"),
  edge("county", "property_has_sales_history"),
  edge("county", "sales_history_has_person"),
  edge("county", "sales_history_has_company"),
  {
    group: "property_improvement",
    table: "property_improvement",
    columns: {
      ...ENTITY,
      permit_number: V,
      improvement_type: V,
      improvement_action: V,
      improvement_status: V,
      permit_issue_date: V,
      completion_date: V,
      permit_close_date: V,
      final_inspection_date: V,
      source_http_request: V,
    },
  },
  edge("property_improvement", "property_has_property_improvement"),
  edge("property_improvement", "property_improvement_has_contractor"),
  {
    group: "property_improvement",
    table: "company",
    columns: { ...ENTITY, name: V, source_http_request: V },
  },
];

/** The manifest source each data group's records were captured from (used when a record has no
 *  source_http_request, or one whose url is not a manifest source). */
export const TRAVIS_GROUP_SOURCES: Readonly<Record<string, string>> = {
  county: "tcad-2026-certified-json",
  property_improvement: "austin-3syk-w9eu",
};

export interface BindOptions {
  groupSources?: Readonly<Record<string, string>>;
  /**
   * Where the engine reads a part, from its manifest artifact `{name, cid}`: a local path or a
   * URL (the CID copy serves `/ipfs/<cid>`, a presigned S3 GET in the Lambda). Default:
   * `${tablesDir}/${group}/${table}/${part}`, the export-tables layout (A-03 T013, additive).
   */
  partUrl?: (artifact: { name: string; cid: string }) => string;
}

export interface BoundTable {
  group: string;
  table: string;
  emitted: boolean;
  parts: string[];
}

export interface BoundRun {
  runId: string;
  manifestCid: string;
  asOf: string;
  tables: BoundTable[];
}

const str = (s: string | null | undefined): string =>
  s === null || s === undefined ? "NULL" : `'${s.replace(/'/g, "''")}'`;
const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** "tables/<group>/<table>/<part>" → its pieces, or null for any other artifact name. */
function partOf(name: string): { group: string; table: string; part: string } | null {
  const [root, group, table, part, ...rest] = name.split("/");
  if (root !== "tables" || !group || !table || !part || rest.length > 0) return null;
  return { group, table, part };
}

/**
 * Creates schema `meta` (run, sources, parts, lookups), one relation per export table under the
 * schema of its data group (`county.property`, `property_improvement.property_improvement`, …,
 * each with a `_part` column naming its part artifact), the derivation macros, the status map and
 * the four views. `tablesDir` holds `<group>/<table>/part-*.parquet` (export-tables output) unless
 * `options.partUrl` maps each part to its own path or URL.
 */
export async function bindManifest(
  manifestBytes: Uint8Array,
  tablesDir: string,
  engine: QueryEngine,
  options: BindOptions = {},
): Promise<BoundRun> {
  const manifest = RunManifestV1.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
  const manifestCid = await rawCid(manifestBytes);
  const profile = manifest.profiles.find((p) => p.name === RULES.name);
  if (!profile) throw new Error(`bindManifest: manifest has no ${RULES.name} profile`);
  // The status map below is generated from the in-repo profile: a run classified by another
  // digest must not be read through it (oracle F5).
  if (profile.sha256 !== PROFILE.sha256 || profile.version !== PROFILE.version)
    throw new Error(
      `bindManifest: manifest ${RULES.name}@${profile.version} sha256 ${profile.sha256} is not the in-repo profile DIGEST ${PROFILE.version} ${PROFILE.sha256}`,
    );
  // area_list_sha256 comes from the manifest only (code-review #8); the ZCTA lookup is the
  // in-repo gazetteer, so its digest must be the one the run recorded.
  const places = manifest.profiles.find((p) => p.name === PLACES_PROFILE);
  if (!places) throw new Error(`bindManifest: manifest has no ${PLACES_PROFILE} profile`);
  if (places.sha256 !== GAZETTEER.sha256)
    throw new Error(
      `bindManifest: manifest ${PLACES_PROFILE} sha256 ${places.sha256} is not the in-repo gazetteer DIGEST ${GAZETTEER.sha256}`,
    );
  const areaList = places.sha256;
  const groupSources = options.groupSources ?? TRAVIS_GROUP_SOURCES;

  // A warm engine may hold another run: emitted tables are VIEWs and absent required ones are
  // empty TABLEs, and DuckDB cannot CREATE OR REPLACE across the two kinds; the previous run's
  // extra views (over presigned URLs that expire) must not survive either. The three run schemas
  // are dropped whole; the main-schema views and macros are replaced below (code-review Major 4).
  const sql: string[] = [
    "DROP SCHEMA IF EXISTS meta CASCADE",
    "DROP SCHEMA IF EXISTS county CASCADE",
    "DROP SCHEMA IF EXISTS property_improvement CASCADE",
    "CREATE SCHEMA IF NOT EXISTS meta",
    "CREATE SCHEMA IF NOT EXISTS county",
    "CREATE SCHEMA IF NOT EXISTS property_improvement",
  ];

  const roots = manifest.artifacts
    .filter((a) => a.kind === "directory")
    .map((a) => ({ data_group: a.name.replace(/^tables\//, ""), cid: a.cid }));
  sql.push(`CREATE OR REPLACE TABLE meta.run AS SELECT
    ${str(manifest.runId)} AS run_id,
    ${str(manifest.fips)} AS county_fips,
    CAST(${str(manifest.startedAt)} AS TIMESTAMPTZ) AS started_at,
    CAST(${str(manifest.finishedAt)} AS TIMESTAMPTZ) AS finished_at,
    CAST(${str(manifest.finishedAt)} AS TIMESTAMPTZ) AS as_of,
    ${str(manifestCid)} AS manifest_cid,
    ${str(manifest.previousManifestCid)}::VARCHAR AS previous_manifest_cid,
    ${str(`${profile.name}@${profile.version}`)} AS profile_version,
    ${str(profile.sha256)} AS profile_sha256,
    ${str(areaList)} AS area_list_sha256,
    CAST(${str(JSON.stringify(roots))} AS JSON) AS tables_root_cids,
    CAST(${str(JSON.stringify(manifest.sources))} AS JSON) AS sources,
    CAST(${str(JSON.stringify(manifest.coverage))} AS JSON) AS coverage,
    CAST(${str(JSON.stringify(manifest.limitations))} AS JSON) AS limitations`);

  const sources = manifest.sources.map(
    (s) => `(${str(s.name)}, ${str(s.url)}, CAST(${str(s.captured_at)} AS TIMESTAMPTZ))`,
  );
  sql.push(
    `CREATE OR REPLACE TABLE meta.source (name VARCHAR, url VARCHAR, captured_at TIMESTAMPTZ)`,
  );
  if (sources.length > 0) sql.push(`INSERT INTO meta.source VALUES ${sources.join(", ")}`);

  sql.push("CREATE OR REPLACE TABLE meta.group_source (data_group VARCHAR, source_name VARCHAR)");
  for (const [group, name] of Object.entries(groupSources)) {
    if (!manifest.sources.some((s) => s.name === name))
      throw new Error(`bindManifest: group ${group} source ${name} is not in the manifest`);
    sql.push(`INSERT INTO meta.group_source VALUES (${str(group)}, ${str(name)})`);
  }

  const parts = manifest.artifacts.filter((a) => a.kind === "table");
  sql.push("CREATE OR REPLACE TABLE meta.part (name VARCHAR, table_cid VARCHAR)");
  if (parts.length > 0)
    sql.push(
      `INSERT INTO meta.part VALUES ${parts.map((p) => `(${str(p.name)}, ${str(p.cid)})`).join(", ")}`,
    );

  const hosts = Object.entries(RULES.jurisdictions).flatMap(([id, j]) =>
    j.hosts.map((h) => `(${str(h)}, ${str(id)})`),
  );
  sql.push("CREATE OR REPLACE TABLE meta.jurisdiction_host (host VARCHAR, jurisdiction VARCHAR)");
  if (hosts.length > 0) sql.push(`INSERT INTO meta.jurisdiction_host VALUES ${hosts.join(", ")}`);

  const byClass = new Map<string, string[]>();
  // Push, never re-spread: ~33k ZCTAs made the copy-per-row form O(n²) (≈1.9 s CPU per bind).
  for (const r of zctaAreaRows()) {
    const codes = byClass.get(r.area_class);
    if (codes === undefined) byClass.set(r.area_class, [r.zcta]);
    else codes.push(r.zcta);
  }
  sql.push(
    `CREATE OR REPLACE TABLE meta.zcta_area AS ${[...byClass.entries()]
      .map(
        ([cls, codes]) =>
          `SELECT unnest(string_split(${str(codes.join(","))}, ',')) AS zcta, ${str(cls)} AS area_class`,
      )
      .join(" UNION ALL ")}`,
  );
  await engine.run(sql.join(";\n"));

  // One relation per emitted table, then empty typed relations for the required absent ones.
  const emitted = new Map<string, BoundTable>();
  const cidOf = new Map(parts.map((a) => [a.name, a.cid]));
  for (const a of parts) {
    const p = partOf(a.name);
    if (!p) continue;
    const key = `${p.group}.${p.table}`;
    const t = emitted.get(key) ?? { group: p.group, table: p.table, emitted: true, parts: [] };
    t.parts.push(a.name);
    emitted.set(key, t);
  }
  const partUrl =
    options.partUrl ??
    (({ name }: { name: string; cid: string }): string => {
      const p = partOf(name);
      return `${tablesDir}/${p?.group}/${p?.table}/${p?.part}`;
    });
  for (const t of emitted.values()) {
    const selects = t.parts.map((name) => {
      const file = partUrl({ name, cid: cidOf.get(name) ?? "" });
      return `SELECT *, ${str(name)} AS _part FROM read_parquet(${str(file)})`;
    });
    await engine.run(
      `CREATE SCHEMA IF NOT EXISTS ${ident(t.group)}; CREATE OR REPLACE VIEW ${ident(t.group)}.${ident(t.table)} AS ${selects.join(" UNION ALL BY NAME ")}`,
    );
  }

  const tables: BoundTable[] = [...emitted.values()];
  for (const r of REQUIRED_TABLES) {
    const t = emitted.get(`${r.group}.${r.table}`);
    if (t) {
      const described = await engine.all(`DESCRIBE SELECT * FROM ${r.group}.${r.table}`);
      const have = new Map(described.map((d) => [String(d.column_name), String(d.column_type)]));
      const lacking = Object.entries(r.columns)
        .filter(([c, type]) => have.get(c) !== type)
        .map(([c, type]) => `${c} ${type}`);
      if (lacking.length > 0)
        throw new Error(
          `bindManifest: ${r.group}.${r.table} lacks column(s) views.sql reads: ${lacking.join(", ")}`,
        );
      continue;
    }
    const cols = Object.entries(r.columns).map(([c, type]) => `${ident(c)} ${type}`);
    await engine.run(
      `CREATE OR REPLACE TABLE ${r.group}.${r.table} (${[...cols, "_part VARCHAR"].join(", ")})`,
    );
    tables.push({ group: r.group, table: r.table, emitted: false, parts: [] });
  }

  await engine.run(`${STATUS_MAP_SQL}\n${deriveMacrosSql()}\n${VIEWS_SQL}`);
  return { runId: manifest.runId, manifestCid, asOf: manifest.finishedAt, tables };
}
