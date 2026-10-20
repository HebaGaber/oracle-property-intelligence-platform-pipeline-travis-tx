// T047: the pilot seed CSV (county-seed-data contract): one row per matched TCAD parcel,
// `parcel_id` = pID exactly as printed, `source_identifier` = pID, the primary situs, and
// `geo_id` (the TCAD geoID that Austin prints as tcad_id) as an extra column. The request
// columns name the bulk export GET; no headers are carried (they would leak into
// source_http_request).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  COUNTY_NAME,
  TCAD_EXPORT_REQUEST,
  pidOf,
  pointOf,
  situsOf,
  type SeedRow,
  type TcadRecord,
} from "../transforms/shared-seed.js";

export type { SeedRow } from "../transforms/shared-seed.js";

export const SEED_COLUMNS = [
  "parcel_id",
  "source_identifier",
  "situs_address",
  "geo_id",
  "county",
  "latitude",
  "longitude",
  "method",
  "url",
] as const satisfies readonly (keyof SeedRow)[];

export function buildSeedRow(record: TcadRecord, geoId: string): SeedRow {
  const pID = pidOf(record);
  const point = pointOf(record);
  return {
    parcel_id: pID,
    source_identifier: pID,
    situs_address: situsOf(record) ?? "",
    geo_id: geoId,
    county: COUNTY_NAME,
    latitude: point ? String(point.latitude) : "",
    longitude: point ? String(point.longitude) : "",
    method: TCAD_EXPORT_REQUEST.method,
    url: TCAD_EXPORT_REQUEST.url,
  };
}

function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function seedCsv(rows: readonly SeedRow[]): string {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.parcel_id)) throw new Error(`seed: duplicate parcel_id ${r.parcel_id}`);
    seen.add(r.parcel_id);
  }
  const lines = [
    SEED_COLUMNS.join(","),
    ...rows.map((r) => SEED_COLUMNS.map((c) => cell(r[c])).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

/** Parses the CSV this module writes (RFC 4180 quoting). */
export function parseSeedCsv(text: string): SeedRow[] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  const [header, ...body] = records;
  if (!header || header.join(",") !== SEED_COLUMNS.join(",")) {
    throw new Error(`seed: header must be ${SEED_COLUMNS.join(",")}`);
  }
  return body.map((cells) => {
    if (cells.length !== SEED_COLUMNS.length)
      throw new Error(`seed: row has ${cells.length} cells`);
    return Object.fromEntries(
      SEED_COLUMNS.map((c, i) => [c, cells[i] as string]),
    ) as unknown as SeedRow;
  });
}

export function writeSeed(path: string, rows: readonly SeedRow[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, seedCsv(rows));
}

export function readSeed(path: string): SeedRow[] {
  return parseSeedCsv(readFileSync(path, "utf8"));
}
