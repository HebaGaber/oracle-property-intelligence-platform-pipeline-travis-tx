// T059 (A-02, mew § B.5, data-model.md § Derivation rules): one function per derived column.
// Each rule exists twice, side by side: a TypeScript function (unit-tested, used by tools and the
// UI) and the SQL macro that views.sql calls. test/derive.test.ts runs the same table of cases
// through both. No macro matches text: only enum equality, date arithmetic and prefix equality of
// ISO dates at the roof date's own precision. `as_of` is always the manifest finishedAt.
import { RULES } from "@countylens/profile-travis-austin";
import { ownerArea } from "../gazetteer/travis-places@1.0.0/index.js";
import { decodeZctaBitmap } from "../gazetteer/travis-places@1.0.0/schema.js";
import ownerAreaJson from "../gazetteer/travis-places@1.0.0/owner-area.json" with { type: "json" };

export type RoofAgeBasis = "permit" | "new_construction" | "built_year" | "unknown";
export type RoofAgeConfidence = "high" | "medium" | "low" | "none";
export type StatusClass = "open" | "stalled" | "closed";
export type AreaClass = "in_county" | "regional" | "out_of_area" | "unknown";

/** The UTC calendar date of an ISO instant, as [year, month, day]. */
function utcDate(iso: string): [number, number, number] {
  const d = new Date(iso);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

function ymd(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

/** Completed years from a full date to the as_of date. */
function completedYears(date: string, asOf: string): number {
  const [y, m, d] = ymd(date);
  const [ay, am, ad] = utcDate(asOf);
  return ay - y - (am < m || (am === m && ad < d) ? 1 : 0);
}

/** Whole years from structure.roof_date (YYYY, YYYY-MM or YYYY-MM-DD) to as_of; 0 allowed. */
export function roofAgeYears(roofDate: string | null, asOf: string): number | null {
  if (roofDate === null) return null;
  const [ay, am] = utcDate(asOf);
  if (roofDate.length === 4) return ay - Number(roofDate);
  if (roofDate.length === 7) {
    const months = ay * 12 + am - (Number(roofDate.slice(0, 4)) * 12 + Number(roofDate.slice(5)));
    return Math.floor(months / 12);
  }
  if (roofDate.length === 10) return completedYears(roofDate, asOf);
  return null;
}

/** True when `date` (an ISO date) equals `roofDate` at the roof date's own precision. */
export function dateMatchesAtPrecision(roofDate: string | null, date: string | null): boolean {
  return roofDate !== null && date !== null && date.slice(0, roofDate.length) === roofDate;
}

/**
 * mew B.5. `replacementMatch`: a linked Roofing/Replacement permit's completion_date or
 * permit_close_date matches roof_date; `newMatch`: the same with improvement_action New.
 */
export function roofAgeBasis(
  roofDate: string | null,
  replacementMatch: boolean,
  newMatch: boolean,
  builtYear: number | null,
): RoofAgeBasis {
  if (roofDate === null) return "unknown";
  if (replacementMatch) return "permit";
  if (newMatch) return "new_construction";
  if (roofDate.length === 4 && Number(roofDate) === builtYear) return "built_year";
  return "unknown";
}

const CONFIDENCE: Record<RoofAgeBasis, RoofAgeConfidence> = {
  permit: "high",
  new_construction: "medium",
  built_year: "low",
  unknown: "none",
};

export const roofAgeConfidence = (basis: RoofAgeBasis): RoofAgeConfidence => CONFIDENCE[basis];

/** Why an unknown basis is unknown. */
export const roofBasisReason = (roofDate: string | null): "no_roof_date" | "basis_unmatched" =>
  roofDate === null ? "no_roof_date" : "basis_unmatched";

/** Whole years from the latest ownership_transfer_date to as_of. */
export const tenureYears = (date: string | null, asOf: string): number | null =>
  date === null ? null : completedYears(date, asOf);

export const tenureBasis = (date: string | null): "sale_date" | "unknown" =>
  date === null ? "unknown" : "sale_date";

/** More than 10 years; null (never "long") when the tenure is unknown. */
export const isLongTenure = (years: number | null): boolean | null =>
  years === null ? null : years > 10;

/** The owner's mailing ZIP against the travis-places lists (gazetteer ownerArea()). */
export const ownerAreaClass = (zip: string | null): AreaClass => ownerArea(zip).class;

export const ownerIsOutOfArea = (cls: AreaClass): boolean | null =>
  cls === "unknown" ? null : cls !== "in_county";

/** Every US ZCTA with its area class, the lookup bindManifest() loads as meta.zcta_area. */
export function zctaAreaRows(): { zcta: string; area_class: Exclude<AreaClass, "unknown"> }[] {
  return decodeZctaBitmap(ownerAreaJson.all_us_zctas.bitmap_base64).map((zcta) => {
    const area = ownerArea(zcta);
    if (area.class === "unknown") throw new Error(`zcta ${zcta} has no area class`);
    return { zcta, area_class: area.class };
  });
}

export function coordinateSource(
  lat: number | null,
  lon: number | null,
  permitLat: number | null,
  permitLon: number | null,
): "gis_centroid" | "permit_point" | "none" {
  if (lat !== null && lon !== null) return "gis_centroid";
  if (permitLat !== null && permitLon !== null) return "permit_point";
  return "none";
}

/** improvement_status → status_class, from the profile's status_map + published_encoding. */
const STATUS_TO_CLASS = (() => {
  const map = new Map<string | null, StatusClass>();
  for (const cls of ["open", "stalled", "closed"] as const) {
    for (const word of RULES.status_map[cls]) {
      map.set(RULES.published_encoding.by_word[word] ?? null, cls);
    }
  }
  return map;
})();

/** D-4a: a null status is stalled only when the permit has an issue date. */
export function statusClass(status: string | null, issueDate: string | null): StatusClass | null {
  if (status === null && issueDate === null) return null;
  return STATUS_TO_CLASS.get(status) ?? null;
}

export const isOpen = (cls: StatusClass | null): boolean => cls === "open";

/** final_date is empty because the permit is not closed, or (closed) the source lacks it. */
export const finalDateReason = (cls: StatusClass | null): "not_closed" | "source_missing" =>
  cls === "closed" ? "source_missing" : "not_closed";

/** as_of − issue_date in days for open and stalled permits (≥ 0); otherwise null. */
export function openDays(
  cls: StatusClass | null,
  issueDate: string | null,
  asOf: string,
): number | null {
  if ((cls !== "open" && cls !== "stalled") || issueDate === null) return null;
  const [y, m, d] = utcDate(asOf);
  const days = (Date.UTC(y, m - 1, d) - Date.parse(`${issueDate}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, days);
}

export const contractorResolution = (companyCid: string | null): "resolved" | "unresolved" =>
  companyCid === null ? "unresolved" : "resolved";

/** v1 never looks up BBB (no lexicon carrier for a rating). */
export const bbbStatus = (): "not_checked" => "not_checked";

export const bbbStatusReason = (
  resolution: "resolved" | "unresolved",
): "no_lexicon_carrier" | "contractor_unresolved" =>
  resolution === "resolved" ? "no_lexicon_carrier" : "contractor_unresolved";

interface HttpRequest {
  url?: string;
  multiValueQueryString?: Record<string, string[]>;
}

/** The record's request URL with its query string (as fetched), from source_http_request. */
export function sourceUrl(request: string | null): string | null {
  if (request === null) return null;
  const r = JSON.parse(request) as HttpRequest;
  if (r.url === undefined) return null;
  const query = Object.entries(r.multiValueQueryString ?? {}).flatMap(([k, values]) =>
    values.map((v) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`),
  );
  return query.length > 0 ? `${r.url}?${query.join("&")}` : r.url;
}

export const urlHost = (url: string | null): string | null =>
  url === null ? null : new URL(url).host;

/** The SQL macros views.sql calls, keyed by name. */
export const DERIVE_MACROS: Readonly<Record<string, string>> = {
  as_of_date: "(ts) AS CAST(timezone('UTC', ts) AS DATE)",
  miss: "(f, r) AS struct_pack(field := CAST(f AS VARCHAR), reason := CAST(r AS VARCHAR))",
  roof_age_years: `(roof_date, as_of) AS CAST(CASE length(roof_date)
      WHEN 4 THEN year(as_of_date(as_of)) - TRY_CAST(roof_date AS INTEGER)
      WHEN 7 THEN (year(as_of_date(as_of)) * 12 + month(as_of_date(as_of))
        - (TRY_CAST(left(roof_date, 4) AS INTEGER) * 12 + TRY_CAST(right(roof_date, 2) AS INTEGER))) // 12
      WHEN 10 THEN date_sub('year', TRY_CAST(roof_date AS DATE), as_of_date(as_of))
    END AS INTEGER)`,
  date_matches_at_precision:
    "(roof_date, d) AS coalesce(left(d, length(roof_date)) = roof_date, false)",
  roof_age_basis: `(roof_date, replacement_match, new_match, built_year) AS CASE
      WHEN roof_date IS NULL THEN 'unknown'
      WHEN replacement_match THEN 'permit'
      WHEN new_match THEN 'new_construction'
      WHEN length(roof_date) = 4 AND TRY_CAST(roof_date AS BIGINT) = built_year THEN 'built_year'
      ELSE 'unknown'
    END`,
  roof_age_confidence: `(basis) AS CASE basis
      WHEN 'permit' THEN 'high' WHEN 'new_construction' THEN 'medium'
      WHEN 'built_year' THEN 'low' ELSE 'none' END`,
  roof_basis_reason:
    "(roof_date) AS CASE WHEN roof_date IS NULL THEN 'no_roof_date' ELSE 'basis_unmatched' END",
  tenure_years: "(d, as_of) AS CAST(date_sub('year', d, as_of_date(as_of)) AS INTEGER)",
  tenure_basis: "(d) AS CASE WHEN d IS NULL THEN 'unknown' ELSE 'sale_date' END",
  is_long_tenure: "(years) AS years > 10",
  owner_area_class: "(zcta_class) AS coalesce(zcta_class, 'unknown')",
  owner_is_out_of_area: `(cls) AS CASE cls
      WHEN 'in_county' THEN false WHEN 'regional' THEN true WHEN 'out_of_area' THEN true END`,
  coordinate_source: `(lat, lon, permit_lat, permit_lon) AS CASE
      WHEN lat IS NOT NULL AND lon IS NOT NULL THEN 'gis_centroid'
      WHEN permit_lat IS NOT NULL AND permit_lon IS NOT NULL THEN 'permit_point'
      ELSE 'none' END`,
  status_class_of: `(status, issue_date) AS (
      SELECT sm.status_class FROM travis_austin_status_map sm
      WHERE sm.improvement_status IS NOT DISTINCT FROM status
        AND (status IS NOT NULL OR issue_date IS NOT NULL))`,
  is_open: "(cls) AS coalesce(cls = 'open', false)",
  final_date_reason:
    "(cls) AS CASE WHEN cls = 'closed' THEN 'source_missing' ELSE 'not_closed' END",
  open_days: `(cls, issue_date, as_of) AS CASE
      WHEN cls IN ('open', 'stalled') AND issue_date IS NOT NULL
      THEN CAST(greatest(as_of_date(as_of) - issue_date, 0) AS INTEGER) END`,
  contractor_resolution:
    "(company_cid) AS CASE WHEN company_cid IS NULL THEN 'unresolved' ELSE 'resolved' END",
  bbb_status: "() AS 'not_checked'",
  bbb_status_reason:
    "(resolution) AS CASE WHEN resolution = 'resolved' THEN 'no_lexicon_carrier' ELSE 'contractor_unresolved' END",
  source_url: `(req) AS json_extract_string(req, '$.url') || coalesce('?' || nullif(array_to_string(
      flatten(list_transform(
        coalesce(json_keys(req, '$.multiValueQueryString'), []::VARCHAR[]),
        lambda k: list_transform(
          CAST(json_extract(req, '$.multiValueQueryString."' || k || '"') AS VARCHAR[]),
          lambda v: url_encode(k) || '=' || url_encode(v)))), '&'), ''), '')`,
  url_host: "(u) AS split_part(u, '/', 3)",
};

/** CREATE OR REPLACE MACRO statements for every derivation. */
export const deriveMacrosSql = (): string =>
  Object.entries(DERIVE_MACROS)
    .map(([name, body]) => `CREATE OR REPLACE MACRO ${name}${body};`)
    .join("\n");
