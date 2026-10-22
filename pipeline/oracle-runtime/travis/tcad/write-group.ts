// A-04 T027: the County data group for the coverage SQL (D-5, local only, never uploaded).
// R accounts only (P / MH / MN are listed `out_of_scope`, not emitted); one `<pID>.zip` per
// property (elephant-cli `validate` / `hash` take a directory of .zip children,
// utils/batch-input.js), each holding `data/<file>` from transformTcadCounty.
// Geometry (oracle disagreements #2, #7; plan CT-8): written only when the assembled
// `coordinate_source = gis_centroid` (GIS feature, export point or condo building point);
// a permit point is never written as geometry (it would read `gis_centroid` publicly). Before
// the coordinates are assembled (pilot), the `real` TCAD export point stands in, rule
// `unassembled_pilot_export_point`. Every input record is the redacted one (redact.ts): a
// confidential owner never reaches a zip.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { buildSeedRow } from "../pilot/build-seed.js";
import type { DataGroupCids } from "../transforms/lexicon-manifest.js";
import { parseTcadRecord } from "../transforms/shared-seed.js";
import { transformTcadCounty } from "../transforms/tcad-county.js";
import type { PropType } from "./account-class.js";
import type { ExportPointKind } from "./export-point.js";

export interface GroupInput {
  pID: string;
  geoId: string | null;
  propType: PropType;
  /** The redacted export record. */
  record: Record<string, unknown>;
  yearBuilt: number | null;
  exportPoint: { lat: number; lon: number; kind: ExportPointKind } | null;
  /** The assembled coordinate (parcels.coordinate_*), absent before `coords`. */
  coordinate?: {
    latitude: number | null;
    longitude: number | null;
    source: "gis_centroid" | "permit_point" | "none";
  };
}

export type GeometryRule = "gis_centroid" | "unassembled_pilot_export_point" | "none";

export interface CountyGroup {
  pID: string;
  /** Directory of the property inside the group (`<pID>/data`). */
  dir: string;
  files: Record<string, string>;
  geometry_rule: GeometryRule;
  /** Mailing addresses written in the `unnormalized_address` form (tcad-county.ts). */
  mailing_address_fallback: number;
}

export interface GroupPlan {
  groups: CountyGroup[];
  out_of_scope: Array<{ pID: string; prop_type: PropType }>;
}

const PID = /^[1-9][0-9]*$/;

/**
 * `--pids` value: a comma / whitespace separated list of pIDs, or the path of a file holding
 * one. Duplicates are dropped; a value that is not a pID is an error (nothing is guessed).
 */
export function parsePidList(
  value: string,
  readFile: (path: string) => string | null = (path) =>
    existsSync(path) ? readFileSync(path, "utf8") : null,
): string[] {
  const text = readFile(value) ?? value;
  const pids = [...new Set(text.split(/[\s,]+/).filter((t) => t !== ""))];
  const bad = pids.find((t) => !PID.test(t));
  if (bad !== undefined) throw new Error(`--pids: "${bad}" is not a pID`);
  if (pids.length === 0) throw new Error("--pids: no pIDs given");
  return pids;
}

function geometryFor(input: GroupInput): {
  point: { lat: number; lon: number } | null;
  rule: GeometryRule;
} {
  const c = input.coordinate;
  if (c !== undefined) {
    if (c.source === "gis_centroid" && c.latitude !== null && c.longitude !== null) {
      return { point: { lat: c.latitude, lon: c.longitude }, rule: "gis_centroid" };
    }
    return { point: null, rule: "none" };
  }
  if (input.exportPoint !== null && input.exportPoint.kind === "real") {
    return {
      point: { lat: input.exportPoint.lat, lon: input.exportPoint.lon },
      rule: "unassembled_pilot_export_point",
    };
  }
  return { point: null, rule: "none" };
}

/** County files for every R input; non-R inputs are listed out_of_scope. */
export function planCountyGroup(inputs: readonly GroupInput[], cids: DataGroupCids): GroupPlan {
  const groups: CountyGroup[] = [];
  const out: GroupPlan["out_of_scope"] = [];
  for (const input of inputs) {
    if (input.propType !== "R") {
      out.push({ pID: input.pID, prop_type: input.propType });
      continue;
    }
    const { point, rule } = geometryFor(input);
    const raw = {
      ...input.record,
      geometry: point === null ? null : `[${point.lat}, ${point.lon}]`,
    };
    const record = parseTcadRecord(raw);
    const seed = buildSeedRow(record, input.geoId ?? "");
    const t = transformTcadCounty({
      record,
      seed,
      cids,
      roofAge: null,
      yearBuilt: input.yearBuilt,
    });
    groups.push({
      pID: t.pID,
      dir: t.dir,
      files: t.files,
      geometry_rule: rule,
      mailing_address_fallback: t.counts.mailing_address_fallback,
    });
  }
  return { groups, out_of_scope: out };
}

// ---------- coverage report (build-county-transform: every mapped field extracted) ----------

/** Export fields the County transform maps, and where each lands in the group files. */
export const COUNTY_FIELD_MAP: Readonly<
  Record<string, { source: string; present: (files: Record<string, string>) => boolean }>
> = {
  owner_name: {
    source: "owners[].name / firstName / lastName",
    present: (f) => Object.keys(f).some((n) => /^(person|company)_\d+\.json$/.test(n)),
  },
  mailing_address: {
    source: "owners[].addrCity / addrState / addrZip / addrCountry",
    present: (f) => Object.keys(f).some((n) => /^mailing_address_\d+\.json$/.test(n)),
  },
  situs: {
    source: "situses[] (primarySitus)",
    present: (f) => /"unnormalized_address": "/.test(f["address.json"] ?? ""),
  },
  year_built: {
    source: "propertyProfile[0].imprvActualYearBuilt, else the largest main improvement",
    present: (f) => /"property_structure_built_year": \d{4}/.test(f["property.json"] ?? ""),
  },
  improvements: {
    source: 'valuations[].details["cost-local"].improvements[]',
    present: (f) => "structure.json" in f,
  },
  sale_date: {
    source: "sales[].saleDt",
    present: (f) => Object.keys(f).some((n) => /^sales_history_\d+\.json$/.test(n)),
  },
  geometry: {
    source: 'geometry "[lat, lon]" (or the assembled GIS point)',
    present: (f) => "geometry.json" in f,
  },
};

export const REQUIRED_COUNTY_FIELDS = [
  "owner_name",
  "mailing_address",
  "situs",
  "year_built",
  "improvements",
  "sale_date",
  "geometry",
] as const;

export interface CoverageRow {
  field: string;
  source: string;
  extracted: boolean;
  properties: number;
}

export function coverageReport(
  groups: readonly CountyGroup[],
  map: typeof COUNTY_FIELD_MAP = COUNTY_FIELD_MAP,
): CoverageRow[] {
  return REQUIRED_COUNTY_FIELDS.map((field) => {
    const entry = map[field];
    if (entry === undefined) {
      throw new Error(`coverage: mapped export field ${field} is missing from the field map`);
    }
    const properties = groups.filter((g) => entry.present(g.files)).length;
    return { field, source: entry.source, extracted: properties > 0, properties };
  });
}

/** Throws naming the first mapped field no property carries. */
export function assertCoverage(rows: readonly CoverageRow[]): void {
  const missing = rows.filter((r) => !r.extracted).map((r) => r.field);
  if (missing.length > 0)
    throw new Error(`coverage: mapped field not extracted: ${missing.join(", ")}`);
}

// ---------- one stored ZIP per property ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A deflated ZIP (no ZIP64; one property is far below 4 GiB) with fixed timestamps. */
export function zipFiles(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const names = Object.keys(files).sort();
  for (const n of names) {
    const name = Buffer.from(n, "utf8");
    const data = Buffer.from(files[n] as string, "utf8");
    const payload = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01: byte-stable archives
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, payload);
    centrals.push(central, name);
    offset += 30 + name.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Writes `<dir>/<pID>.zip` (entries `data/<file>`) for every group; returns the paths. */
export function writeCountyZips(dir: string, groups: readonly CountyGroup[]): string[] {
  mkdirSync(dir, { recursive: true });
  return groups.map((g) => {
    const files = Object.fromEntries(
      Object.entries(g.files).map(([n, body]) => [`data/${n}`, body]),
    );
    const path = join(dir, `${g.pID}.zip`);
    writeFileSync(path, zipFiles(files));
    return path;
  });
}
