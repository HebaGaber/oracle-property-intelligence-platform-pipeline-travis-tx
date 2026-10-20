// T047: the one builder for the files both data groups carry (oracle § A.2, R11): the Seed
// data group (address.json, parcel.json, address_has_parcel.json, its root) and
// property.json. The County and Property Improvement transforms both call
// buildSharedFiles(), so these files are byte-identical in both archives and `hash` derives
// the same property CID from the same seed root.
//
// TCAD fields read here (2026 certified JSON, keys as printed): pID, propType, geometry
// ("[lat, lon]"), propertyIdentification[].geoID, situses[] (primarySitus), propertyProfile[]
// (stateCd, imprvActualYearBuilt), propertyLegalDescription[].legalDescription.
import { z } from "zod";

/** The bulk export GET every TCAD entity comes from (A-01 sources catalog). Headers: none. */
export const TCAD_EXPORT_REQUEST = {
  method: "GET",
  url: "https://traviscad.org/wp-content/largefiles/2026%20Certified%20JSON%20SUPP%200%2007182026.zip",
} as const;

export const COUNTY_NAME = "Travis";

const Nullable = <T extends z.ZodType>(s: T) => s.nullable().optional();

export const TcadRecord = z
  .object({
    pID: z.union([z.number().int(), z.string().min(1)]),
    propType: z.string(),
    geometry: Nullable(z.string()),
    propertyIdentification: z.array(z.object({ geoID: z.string().nullable() }).loose()).default([]),
    propertyLegalDescription: z
      .array(z.object({ legalDescription: Nullable(z.string()) }).loose())
      .default([]),
    propertyProfile: z
      .array(
        z
          .object({ stateCd: Nullable(z.string()), imprvActualYearBuilt: Nullable(z.number()) })
          .loose(),
      )
      .default([]),
    situses: z
      .array(
        z
          .object({
            primarySitus: Nullable(z.number()),
            streetNum: Nullable(z.string()),
            streetPrefix: Nullable(z.string()),
            streetName: Nullable(z.string()),
            streetSuffix: Nullable(z.string()),
            streetSecondary: Nullable(z.string()),
            city: Nullable(z.string()),
            state: Nullable(z.string()),
            zip: Nullable(z.string()),
          })
          .loose(),
      )
      .default([]),
    owners: z
      .array(
        z
          .object({
            name: Nullable(z.string()),
            firstName: Nullable(z.string()),
            lastName: Nullable(z.string()),
            addrDeliveryLine: Nullable(z.string()),
            addrCity: Nullable(z.string()),
            addrZip: Nullable(z.string()),
            addrState: Nullable(z.string()),
            addrCountry: Nullable(z.string()),
            confidentialCode: Nullable(z.string()),
          })
          .loose(),
      )
      .default([]),
    sales: z
      .array(
        z
          .object({
            saleID: Nullable(z.number()),
            saleDt: Nullable(z.string()),
            confidentialCode: Nullable(z.string()),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();
export type TcadRecord = z.infer<typeof TcadRecord>;

export function parseTcadRecord(value: unknown): TcadRecord {
  return TcadRecord.parse(value);
}

/** pID exactly as printed (P0-5). */
export function pidOf(record: TcadRecord): string {
  return String(record.pID);
}

/** The `[lat, lon]` point TCAD prints, or null. */
export function pointOf(record: TcadRecord): { latitude: number; longitude: number } | null {
  if (!record.geometry) return null;
  const m = /^\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]$/.exec(record.geometry.trim());
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** The primary situs as printed: "<num> <prefix> <name> <suffix> <secondary>, <city>, TX <zip>". */
export function situsOf(record: TcadRecord): string | null {
  const s = record.situses.find((x) => x.primarySitus === 1) ?? record.situses[0];
  if (!s) return null;
  const street = [s.streetNum, s.streetPrefix, s.streetName, s.streetSuffix, s.streetSecondary]
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "")
    .join(" ");
  const stateZip = [s.state, s.zip]
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "")
    .join(" ");
  const parts = [street, (s.city ?? "").trim(), stateZip].filter((p) => p !== "");
  return street === "" ? null : parts.join(", ");
}

/** Texas PTD state codes (propertyProfile[].stateCd) → lexicon property_type / property_usage_type. */
const STATE_CODES: Record<string, { property_type: string; property_usage_type: string | null }> = {
  A1: { property_type: "SingleFamily", property_usage_type: "Residential" },
  A2: { property_type: "MobileHome", property_usage_type: "Residential" },
  A3: { property_type: "Condominium", property_usage_type: "Residential" },
  A4: { property_type: "Townhouse", property_usage_type: "Residential" },
  B1: { property_type: "MultipleFamily", property_usage_type: "Residential" },
  B2: { property_type: "Duplex", property_usage_type: "Residential" },
  B3: { property_type: "3Units", property_usage_type: "Residential" },
  B4: { property_type: "4Units", property_usage_type: "Residential" },
  C1: { property_type: "VacantLand", property_usage_type: null },
  F1: { property_type: "Building", property_usage_type: "Commercial" },
  F2: { property_type: "Building", property_usage_type: "Industrial" },
};

export interface PropertyFields {
  parcel_identifier: string;
  property_type: string | null;
  property_usage_type: string | null;
  property_structure_built_year: number | null;
  property_legal_description_text: string | null;
  /** Unmapped source codes (kept out of the record, reported in the findings). */
  warnings: string[];
}

export function propertyFields(record: TcadRecord): PropertyFields {
  const profile = record.propertyProfile[0];
  const code = (profile?.stateCd ?? "").trim();
  const mapped = STATE_CODES[code];
  const warnings = mapped ? [] : [`unmapped_state_code:${code || "(empty)"}`];
  const year = profile?.imprvActualYearBuilt ?? null;
  const legal = (record.propertyLegalDescription[0]?.legalDescription ?? "").trim();
  return {
    parcel_identifier: pidOf(record),
    property_type: mapped?.property_type ?? null,
    property_usage_type: mapped?.property_usage_type ?? null,
    property_structure_built_year:
      year !== null && Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null,
    property_legal_description_text: legal === "" ? null : legal,
    warnings,
  };
}

/** One seed row per parcel (county-seed-data contract; written by travis/pilot/build-seed.ts). */
export interface SeedRow {
  parcel_id: string;
  source_identifier: string;
  situs_address: string;
  geo_id: string;
  county: string;
  latitude: string;
  longitude: string;
  method: string;
  url: string;
}

export function jsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const link = (name: string): { "/": string } => ({ "/": `./${name}` });

export interface SharedFilesInput {
  record: TcadRecord;
  seed: SeedRow;
  /** Seed data-group schema CID from the live lexicon manifest. */
  seedCid: string;
}

/** The seed files and property.json, as file name → exact text. */
export function buildSharedFiles(input: SharedFilesInput): Record<string, string> {
  const { record, seed } = input;
  const pID = pidOf(record);
  if (seed.parcel_id !== pID) throw new Error(`seed row ${seed.parcel_id} is not TCAD pID ${pID}`);
  const request = { ...TCAD_EXPORT_REQUEST };
  const point = pointOf(record);
  const fields = propertyFields(record);
  const property: Record<string, unknown> = {
    source_http_request: request,
    request_identifier: pID,
    parcel_identifier: fields.parcel_identifier,
    property_type: fields.property_type,
    property_structure_built_year: fields.property_structure_built_year,
    property_legal_description_text: fields.property_legal_description_text,
  };
  if (fields.property_usage_type !== null)
    property.property_usage_type = fields.property_usage_type;
  return {
    "address.json": jsonFile({
      source_http_request: request,
      request_identifier: pID,
      county_name: COUNTY_NAME,
      unnormalized_address: seed.situs_address === "" ? null : seed.situs_address,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
    }),
    "parcel.json": jsonFile({
      source_http_request: request,
      request_identifier: pID,
      parcel_identifier: pID,
    }),
    "address_has_parcel.json": jsonFile({ from: link("address.json"), to: link("parcel.json") }),
    [`${input.seedCid}.json`]: jsonFile({
      label: "Seed",
      relationships: { address_has_parcel: link("address_has_parcel.json") },
    }),
    "property.json": jsonFile(property),
  };
}
