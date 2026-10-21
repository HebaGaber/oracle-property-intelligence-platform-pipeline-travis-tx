// T048: the County data group for one TCAD property (build-county-transform custom-code
// mode, reference/output-contract.md). Writes `<pID>/data/`:
//   seed files + property.json (shared-seed.ts, byte-identical with the PI group)
//   geometry.json        ← TCAD `geometry` point        (property_has_parcel → parcel_has_geometry)
//   structure.json       ← roof_date only from a TCAD-sourced estimator anchor (the built year);
//                          a permit-anchored roof date is never written here (oracle F1): it is
//                          derived in the view from the published Austin permit rows
//                          (Roofing + Replacement, closed → completion_date / permit_close_date)
//   sales_history_N.json ← sales[] with a saleDt, oldest first (ownership_transfer_date only)
//   person_N / company_N + mailing_address_N ← current owners[], linked to the latest dated sale
//   <County schema CID>.json
// Rules: every entity carries source_http_request (the bulk export GET, no headers) and
// request_identifier (pID as printed); relationships are only {from, to} relative links;
// nothing unlinked is written. Confidential owners (P0-15, oracle R14, oracle F2): when any
// owner or sale carries a confidentialCode, any sale has a truthy/non-zero confidentialSale
// (PO decision: a sale-level flag hides the whole owner), or the record carries any other
// confid* key the transform does not model (fail closed), no owner name and no mailing
// address is written; the suppression and its basis are counted for the manifest. Sale
// prices are never written (Texas is a non-disclosure state and the pilot publishes no price).
import {
  TCAD_EXPORT_REQUEST,
  buildSharedFiles,
  jsonFile,
  link,
  pidOf,
  pointOf,
  type SeedRow,
  type TcadRecord,
} from "./shared-seed.js";
import type { DataGroupCids } from "./lexicon-manifest.js";

/** structure properties the lexicon lists as non-optional; written null (no TCAD source in A-02). */
const STRUCTURE_NULL_FIELDS = [
  "architectural_style_type",
  "attachment_type",
  "ceiling_condition",
  "ceiling_height_average",
  "ceiling_insulation_type",
  "ceiling_structure_material",
  "ceiling_surface_material",
  "exterior_door_material",
  "exterior_wall_condition",
  "exterior_wall_insulation_type",
  "exterior_wall_material_primary",
  "exterior_wall_material_secondary",
  "flooring_condition",
  "flooring_material_primary",
  "flooring_material_secondary",
  "foundation_condition",
  "foundation_material",
  "foundation_type",
  "foundation_waterproofing",
  "gutters_condition",
  "gutters_material",
  "interior_door_material",
  "interior_wall_condition",
  "interior_wall_finish_primary",
  "interior_wall_finish_secondary",
  "interior_wall_structure_material",
  "interior_wall_surface_material_primary",
  "interior_wall_surface_material_secondary",
  "primary_framing_material",
  "roof_age_years",
  "roof_condition",
  "roof_covering_material",
  "roof_design_type",
  "roof_material_type",
  "roof_structure_material",
  "roof_underlayment_type",
  "secondary_framing_material",
  "structural_damage_indicators",
  "subfloor_material",
  "window_frame_material",
  "window_glazing_type",
  "window_operation_type",
  "window_screen_material",
] as const;

/** Entity words that make an unsplit owner name a company (never a person guess). */
export const ENTITY_NAME =
  /\b(LLC|L\.L\.C\.?|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|L\.P\.|LTD|LLP|PLLC|TRUST|TRUSTEES?|PARTNERSHIP|PARTNERS|ASSOCIATION|ASSN|BANK|CHURCH|HOLDINGS|PROPERTIES|INVESTMENTS|FUND|FOUNDATION|ISD|CITY OF|COUNTY OF|STATE OF)\b/;

export const PERSON_NAME = /^[A-Z][a-z]*([ \-',.][A-Za-z][a-z]*)*$/;

export interface RoofAgeEntry {
  pID: string;
  roof_date: string | null;
  /** The estimator anchor type; only property_built_year (a TCAD field) is written. */
  anchor: "property_built_year" | "permit_terminal_date" | null;
}

/** The confid* keys the transform reads; any other one fails closed. */
const MODELED_CONFIDENTIAL = new Set([
  "owners[].confidentialCode",
  "sales[].confidentialCode",
  "sales[].confidentialSale",
]);

/** Every key matching /^confid/i anywhere in the record, as a path with [] for array items. */
function confidentialKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => confidentialKeys(v, `${path}[]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
    const p = path === "" ? k : `${path}.${k}`;
    return [...(/^confid/i.test(k) ? [p] : []), ...confidentialKeys(v, p)];
  });
}

/** A confidentialSale flag is set unless it is absent, null, false, 0, "0" or blank. */
function flagSet(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === 0) return false;
  if (typeof v === "string") return v.trim() !== "" && v.trim() !== "0";
  return true;
}

export interface CountyTransformInput {
  record: TcadRecord;
  seed: SeedRow;
  cids: DataGroupCids;
  /** The property's row from the roof-age ledger (kit estimator), or null. */
  roofAge: RoofAgeEntry | null;
  /**
   * A-04: the year built by the recorded rule (travis/tcad/year-built.ts); when absent the
   * A-02 reading of propertyProfile[0].imprvActualYearBuilt is kept.
   */
  yearBuilt?: number | null;
}

export type OwnerOutcome =
  "person" | "company" | "mixed" | "unparsed" | "suppressed" | "no_dated_sale" | "none";

export interface CountyTransformCounts {
  owner: OwnerOutcome;
  confidential: boolean;
  confidential_basis: string[];
  sales_dated: number;
  owners_unparsed: number;
  warnings: string[];
}

export interface CountyTransformOutput {
  pID: string;
  /** Directory relative to the group dir. */
  dir: string;
  files: Record<string, string>;
  counts: CountyTransformCounts;
}

const nonEmpty = (v: string | null | undefined): boolean =>
  typeof v === "string" && v.trim() !== "";

function titleCase(word: string): string {
  return word
    .toLowerCase()
    .replace(/(^|[ \-',.])([a-z])/g, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
}

function saleDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? (m[1] as string) : null;
}

type Owner = TcadRecord["owners"][number];

function mailingAddress(
  owner: Owner,
  base: Record<string, unknown>,
): Record<string, unknown> | null {
  const zip = (owner.addrZip ?? "").trim();
  const m = /^(\d{5})(?:-(\d{4}))?$/.exec(zip);
  if (!m && !nonEmpty(owner.addrState) && !nonEmpty(owner.addrCity)) return null;
  return {
    ...base,
    street_number: null,
    street_pre_directional_text: null,
    street_name: null,
    street_suffix_type: null,
    street_post_directional_text: null,
    unit_identifier: null,
    city_name: nonEmpty(owner.addrCity) ? (owner.addrCity as string).trim() : null,
    state_code: /^[A-Z]{2}$/.test((owner.addrState ?? "").trim())
      ? (owner.addrState as string).trim()
      : null,
    postal_code: m ? (m[1] as string) : null,
    plus_four_postal_code: m?.[2] ?? null,
    country_code: nonEmpty(owner.addrCountry) ? (owner.addrCountry as string).trim() : null,
    route_number: null,
    block: null,
    lot: null,
    section: null,
    township: null,
    range: null,
  };
}

export function transformTcadCounty(input: CountyTransformInput): CountyTransformOutput {
  const { record } = input;
  const pID = pidOf(record);
  if (input.roofAge && input.roofAge.pID !== pID) {
    throw new Error(`roof-age ledger row ${input.roofAge.pID} is not property ${pID}`);
  }
  const base = { source_http_request: { ...TCAD_EXPORT_REQUEST }, request_identifier: pID };
  const files: Record<string, string> = {
    ...buildSharedFiles({
      record,
      seed: input.seed,
      seedCid: input.cids.seed,
      ...(input.yearBuilt !== undefined ? { yearBuilt: input.yearBuilt } : {}),
    }),
  };
  const rel: Record<string, { "/": string } | { "/": string }[]> = {};
  const many = (key: string, name: string): void => {
    const list = (rel[key] as { "/": string }[] | undefined) ?? [];
    list.push(link(name));
    rel[key] = list;
  };
  const relationship = (name: string, from: string, to: string): string => {
    files[name] = jsonFile({ from: link(from), to: link(to) });
    return name;
  };

  rel.property_has_address = link(
    relationship("relationship_property_has_address.json", "property.json", "address.json"),
  );
  many(
    "property_has_parcel",
    relationship("relationship_property_has_parcel.json", "property.json", "parcel.json"),
  );

  const point = pointOf(record);
  if (point) {
    files["geometry.json"] = jsonFile({
      ...base,
      latitude: point.latitude,
      longitude: point.longitude,
      polygon: null,
    });
    many(
      "parcel_has_geometry",
      relationship("relationship_parcel_has_geometry.json", "parcel.json", "geometry.json"),
    );
  }

  const structure: Record<string, unknown> = { ...base };
  for (const field of STRUCTURE_NULL_FIELDS) structure[field] = null;
  // Only a TCAD-sourced anchor carries the TCAD request; a permit date is never stamped here.
  structure.roof_date =
    input.roofAge?.anchor === "property_built_year" ? input.roofAge.roof_date : null;
  files["structure.json"] = jsonFile(structure);
  rel.property_has_structure = link(
    relationship("relationship_property_has_structure.json", "property.json", "structure.json"),
  );

  const dated = record.sales
    .map((s) => ({ id: s.saleID ?? 0, date: saleDate(s.saleDt) }))
    .filter((s): s is { id: number; date: string } => s.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  dated.forEach((s, i) => {
    const name = `sales_history_${i + 1}.json`;
    files[name] = jsonFile({ ...base, ownership_transfer_date: s.date });
    many(
      "property_has_sales_history",
      relationship(`relationship_property_has_sales_history_${i + 1}.json`, "property.json", name),
    );
  });

  const basis: string[] = [];
  if (record.owners.some((o) => nonEmpty(o.confidentialCode)))
    basis.push("owners[].confidentialCode");
  if (record.sales.some((s) => nonEmpty(s.confidentialCode)))
    basis.push("sales[].confidentialCode");
  if (record.sales.some((s) => flagSet((s as Record<string, unknown>).confidentialSale)))
    basis.push("sales[].confidentialSale");
  for (const key of [...new Set(confidentialKeys(record))].sort())
    if (!MODELED_CONFIDENTIAL.has(key)) basis.push(`unmodeled:${key}`);
  const confidential = basis.length > 0;

  let owner: OwnerOutcome = "none";
  let unparsed = 0;
  if (confidential) owner = "suppressed";
  else if (record.owners.length > 0 && dated.length === 0) owner = "no_dated_sale";
  else if (record.owners.length > 0) {
    const latest = `sales_history_${dated.length}.json`;
    const kinds = new Set<"person" | "company">();
    let persons = 0;
    let companies = 0;
    for (const o of record.owners) {
      const first = titleCase((o.firstName ?? "").trim());
      const last = titleCase((o.lastName ?? "").trim());
      const name = (o.name ?? "").trim();
      let entity: string;
      if (
        nonEmpty(o.firstName) &&
        nonEmpty(o.lastName) &&
        PERSON_NAME.test(first) &&
        PERSON_NAME.test(last)
      ) {
        persons += 1;
        entity = `person_${persons}.json`;
        files[entity] = jsonFile({
          ...base,
          first_name: first,
          last_name: last,
          middle_name: null,
          prefix_name: null,
          suffix_name: null,
          birth_date: null,
          us_citizenship_status: null,
          veteran_status: null,
        });
        many(
          "sales_history_has_person",
          relationship(`relationship_sales_history_has_person_${persons}.json`, latest, entity),
        );
        kinds.add("person");
      } else if (name !== "" && ENTITY_NAME.test(name)) {
        companies += 1;
        entity = `company_${companies}.json`;
        files[entity] = jsonFile({ ...base, name, sunbiz_document_number: null });
        many(
          "sales_history_has_company",
          relationship(`relationship_sales_history_has_company_${companies}.json`, latest, entity),
        );
        kinds.add("company");
      } else {
        unparsed += 1;
        continue;
      }
      const mailing = mailingAddress(o, base);
      if (mailing) {
        const n = persons + companies;
        const addr = `mailing_address_${n}.json`;
        files[addr] = jsonFile(mailing);
        const kind = entity.startsWith("person_") ? "person" : "company";
        many(
          `${kind}_has_mailing_address`,
          relationship(`relationship_${kind}_has_mailing_address_${n}.json`, entity, addr),
        );
      }
    }
    owner =
      kinds.size === 0
        ? "unparsed"
        : kinds.size === 2
          ? "mixed"
          : ([...kinds][0] as "person" | "company");
  }

  const ordered = Object.fromEntries(
    Object.keys(rel)
      .sort()
      .map((k) => [k, rel[k]]),
  );
  files[`${input.cids.county}.json`] = jsonFile({ label: "County", relationships: ordered });

  const warnings: string[] = [];
  if (!point) warnings.push("no_geometry_point");
  if (!input.roofAge) warnings.push("no_roof_age_ledger_row");
  return {
    pID,
    dir: `${pID}/data`,
    files,
    counts: {
      owner,
      confidential,
      confidential_basis: basis,
      sales_dated: dated.length,
      owners_unparsed: unparsed,
      warnings,
    },
  };
}
