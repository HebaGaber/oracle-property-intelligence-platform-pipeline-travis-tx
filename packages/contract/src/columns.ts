// The single column list of contract/v1 (mew § B and C.7; data-model.md § Views with the
// D-4 adjustments). It generates the Zod row schemas (rows.ts), the README table and the
// view-shape test. Lexicon fields keep their exact names; the only aliases are in ALIASES.
// Change rule: adding a column or an enum member is additive; a rename, retype or change of
// meaning needs contract/v2.
import type { MissingReason } from "./provenance.js";

export type ColumnKind =
  | "cid"
  | "string"
  | "enum"
  | "integer"
  | "double"
  | "boolean"
  | "date"
  | "timestamptz"
  | "missing"
  | "json"
  | "list";

export interface Column {
  name: string;
  /** DuckDB type as DESCRIBE prints it. */
  type: string;
  kind: ColumnKind;
  /** False only for the "never null" columns. */
  nullable: boolean;
  enum?: readonly string[];
  meaning: string;
  /** Lexicon class.property, a relationship path, or the derivation rule. */
  source: string;
  /** The reason written to `missing` when the value is empty (null when never empty). */
  missingReason: MissingReason | null;
}

/** The AD-07 frozen aliases (mew C.2): the only names that are not exact lexicon names. */
export const ALIASES = {
  issue_date: "property_improvement.permit_issue_date",
  final_date: "property_improvement.completion_date",
} as const;

export const COLUMN_ENUMS = {
  roof_age_basis: ["permit", "new_construction", "built_year", "unknown"],
  roof_age_confidence: ["high", "medium", "low", "none"],
  bbb_status: ["rated", "not_found", "blocked", "not_checked"],
  status_class: ["open", "stalled", "closed"],
  owner_area_class: ["in_county", "regional", "out_of_area", "unknown"],
  coordinate_source: ["gis_centroid", "permit_point", "none"],
  tenure_basis: ["sale_date", "unknown"],
  contractor_resolution: ["resolved", "unresolved"],
  owner_kind: ["person", "company", "unknown"],
} as const satisfies Record<string, readonly string[]>;

type EnumName = keyof typeof COLUMN_ENUMS;

const V = "VARCHAR";
const MISSING_TYPE = "STRUCT(field VARCHAR, reason VARCHAR)[]";

function col(
  name: string,
  kind: Exclude<ColumnKind, "enum">,
  type: string,
  nullable: boolean,
  source: string,
  meaning: string,
  missingReason: MissingReason | null,
): Column {
  return { name, type, kind, nullable, meaning, source, missingReason };
}

function enumCol(
  name: EnumName,
  nullable: boolean,
  source: string,
  meaning: string,
  missingReason: MissingReason | null,
): Column {
  return {
    name,
    type: V,
    kind: "enum",
    nullable,
    enum: COLUMN_ENUMS[name],
    meaning,
    source,
    missingReason,
  };
}

/** mew § B.1: on every row of v_property, v_roofing_permit and v_contractor. */
export const PROVENANCE_COLUMNS: readonly Column[] = [
  col("cid", "cid", V, false, "export extra column `cid`", "The record's CID", null),
  col(
    "source_url",
    "string",
    V,
    true,
    "json_extract_string(source_http_request, '$.url')",
    "URL of the request that fetched the record's source page",
    "not_in_export",
  ),
  col(
    "captured_at",
    "timestamptz",
    "TIMESTAMP WITH TIME ZONE",
    false,
    "manifest sources[].captured_at",
    "When that source was captured",
    null,
  ),
  col(
    "table",
    "string",
    V,
    false,
    "export table name",
    "The export table the row's main record came from",
    null,
  ),
  col(
    "table_cid",
    "cid",
    V,
    false,
    "tables.car CountyTables part link → manifest artifacts[]",
    "CIDv1 of the Parquet part holding the row",
    null,
  ),
  col("run_id", "string", V, false, "manifest runId", "The run that produced the row", null),
  col(
    "manifest_cid",
    "cid",
    V,
    false,
    "CIDv1 of the manifest JCS bytes",
    "The run manifest's CID",
    null,
  ),
  col(
    "as_of",
    "timestamptz",
    "TIMESTAMP WITH TIME ZONE",
    false,
    "manifest finishedAt",
    "The run's finish time; every derivation uses it, never now()",
    null,
  ),
  col(
    "missing",
    "missing",
    MISSING_TYPE,
    false,
    "built per row",
    "One {field, reason} entry for every null or uncarried field in the row",
    null,
  ),
];

const V_PROPERTY: readonly Column[] = [
  col(
    "property_cid",
    "cid",
    V,
    false,
    "property.property_cid (export extra; equals property.cid)",
    "The property's CID",
    null,
  ),
  col(
    "request_identifier",
    "string",
    V,
    false,
    "property.request_identifier",
    "TCAD pID exactly as printed (P0-5)",
    null,
  ),
  col(
    "parcel_identifier",
    "string",
    V,
    true,
    "property.parcel_identifier",
    "Parcel identifier",
    "source_missing",
  ),
  col(
    "property_type",
    "string",
    V,
    true,
    "property.property_type (lexicon enum)",
    "Property type",
    "source_missing",
  ),
  col(
    "property_usage_type",
    "string",
    V,
    true,
    "property.property_usage_type (lexicon enum)",
    "Usage type",
    "source_missing",
  ),
  col(
    "property_structure_built_year",
    "integer",
    "INTEGER",
    true,
    "property.property_structure_built_year",
    "Year the main structure was built",
    "source_missing",
  ),
  col(
    "unnormalized_address",
    "string",
    V,
    true,
    "address.unnormalized_address via property_has_address",
    "Situs address as printed",
    "source_missing",
  ),
  col(
    "city_name",
    "string",
    V,
    true,
    "address.city_name via property_has_address",
    "Situs city",
    "source_missing",
  ),
  col(
    "postal_code",
    "string",
    V,
    true,
    "address.postal_code via property_has_address",
    "Situs ZIP",
    "source_missing",
  ),
  col(
    "latitude",
    "double",
    "DOUBLE",
    true,
    "geometry.latitude via property_has_parcel → parcel_has_geometry; else the permit address",
    "Latitude",
    "no_coordinates",
  ),
  col(
    "longitude",
    "double",
    "DOUBLE",
    true,
    "geometry.longitude via property_has_parcel → parcel_has_geometry; else the permit address",
    "Longitude",
    "no_coordinates",
  ),
  enumCol(
    "coordinate_source",
    false,
    "derived: geometry → gis_centroid, permit address → permit_point, else none",
    "Where the coordinates came from",
    null,
  ),
  col(
    "roof_date",
    "string",
    V,
    true,
    "structure.roof_date via property_has_structure (kit estimator only)",
    "Roof date, YYYY[-MM[-DD]]",
    "no_roof_date",
  ),
  col(
    "roof_age_years",
    "integer",
    "INTEGER",
    true,
    "derived: whole years from roof_date to as_of (never structure.roof_age_years)",
    "Roof age in whole years; 0 allowed",
    "no_roof_date",
  ),
  enumCol("roof_age_basis", false, "derived (mew B.5)", "Evidence behind roof_date", null),
  enumCol("roof_age_confidence", false, "derived (mew B.5)", "Confidence of roof_age_years", null),
  col(
    "last_ownership_transfer_date",
    "date",
    "DATE",
    true,
    "max sales_history.ownership_transfer_date via property_has_sales_history",
    "Latest dated ownership transfer",
    "no_dated_sale",
  ),
  col(
    "tenure_years",
    "integer",
    "INTEGER",
    true,
    "derived: whole years from last_ownership_transfer_date to as_of",
    "Owner tenure",
    "no_dated_sale",
  ),
  enumCol(
    "tenure_basis",
    false,
    "derived: sale_date when dated, else unknown",
    "Evidence behind tenure_years",
    null,
  ),
  col(
    "is_long_tenure",
    "boolean",
    "BOOLEAN",
    true,
    "derived: tenure_years > 10; null when unknown",
    "Long tenure flag",
    "no_dated_sale",
  ),
  enumCol(
    "owner_kind",
    false,
    "derived from sales_history_has_person/_company on the latest sale",
    "Owner kind",
    null,
  ),
  col(
    "owner_name",
    "string",
    V,
    true,
    "person.first_name + last_name, or company.name",
    "Owner display name",
    "no_owner_record",
  ),
  col(
    "owner_mailing_postal_code",
    "string",
    V,
    true,
    "address.postal_code via person_has_mailing_address / company_has_mailing_address",
    "Owner mailing ZIP",
    "no_mailing_address",
  ),
  col(
    "owner_mailing_state_code",
    "string",
    V,
    true,
    "address.state_code via person_has_mailing_address / company_has_mailing_address",
    "Owner mailing state",
    "no_mailing_address",
  ),
  enumCol(
    "owner_area_class",
    false,
    "derived: mailing ZIP against the travis-places area lists",
    "Owner mailing area class",
    null,
  ),
  col(
    "owner_is_out_of_area",
    "boolean",
    "BOOLEAN",
    true,
    "derived: true for regional/out_of_area, false for in_county, null for unknown",
    "Owner mails from outside Travis",
    "no_mailing_address",
  ),
  col(
    "area_list_sha256",
    "string",
    V,
    false,
    "manifest profiles[] (travis-places)",
    "Digest of the ZIP and regional lists",
    null,
  ),
  ...PROVENANCE_COLUMNS,
];

const BBB_SOURCE = "always not_checked in v1";

const V_ROOFING_PERMIT: readonly Column[] = [
  col("permit_cid", "cid", V, false, "property_improvement.cid", "The permit's CID", null),
  col(
    "property_cid",
    "cid",
    V,
    false,
    "from_cid of property_has_property_improvement",
    "The permit's property",
    null,
  ),
  col(
    "jurisdiction",
    "string",
    V,
    true,
    "derived: source_http_request host → profile jurisdiction map",
    "Issuing jurisdiction",
    "needs_review",
  ),
  col(
    "permit_number",
    "string",
    V,
    true,
    "property_improvement.permit_number",
    "Permit number as printed",
    "source_missing",
  ),
  col(
    "improvement_type",
    "string",
    V,
    false,
    "property_improvement.improvement_type (set only by the profile)",
    "Lexicon improvement type",
    null,
  ),
  col(
    "improvement_action",
    "string",
    V,
    false,
    "property_improvement.improvement_action (set only by the profile)",
    "Lexicon improvement action",
    null,
  ),
  col(
    "improvement_status",
    "string",
    V,
    true,
    "property_improvement.improvement_status",
    "Lexicon status; null for Expired (D-4a)",
    "no_lexicon_carrier",
  ),
  enumCol(
    "status_class",
    false,
    "generated status map: Permitted/Planned/OnHold → open, Completed → closed, null status + issue date → stalled (D-4a)",
    "Open, stalled or closed",
    null,
  ),
  col("is_open", "boolean", "BOOLEAN", false, "derived: status_class = 'open'", "Open flag", null),
  col(
    "issue_date",
    "date",
    "DATE",
    true,
    ALIASES.issue_date,
    "Issue date (frozen alias)",
    "source_missing",
  ),
  col(
    "final_date",
    "date",
    "DATE",
    true,
    ALIASES.final_date,
    "Final date (frozen alias)",
    "not_closed",
  ),
  col(
    "permit_close_date",
    "date",
    "DATE",
    true,
    "property_improvement.permit_close_date",
    "Close date",
    "source_missing",
  ),
  col(
    "final_inspection_date",
    "date",
    "DATE",
    true,
    "property_improvement.final_inspection_date",
    "Final inspection date",
    "source_missing",
  ),
  col(
    "open_days",
    "integer",
    "INTEGER",
    true,
    "derived: as_of − issue_date for open and stalled",
    "Days open",
    "not_open",
  ),
  enumCol(
    "contractor_resolution",
    false,
    "derived: resolved iff a property_improvement_has_contractor edge exists",
    "Contractor identity state (AD-24)",
    null,
  ),
  col(
    "contractor_company_cid",
    "cid",
    V,
    true,
    "to_cid of property_improvement_has_contractor",
    "Resolved contractor company",
    "contractor_unresolved",
  ),
  enumCol("bbb_status", false, BBB_SOURCE, "BBB lookup state", null),
  col(
    "bbb_status_reason",
    "string",
    V,
    true,
    "contractor_unresolved if unresolved, else no_lexicon_carrier",
    "Why there is no BBB rating",
    null,
  ),
  col(
    "profile_version",
    "string",
    V,
    false,
    "manifest profiles[] (travis-austin)",
    "Classification profile version",
    null,
  ),
  col(
    "profile_sha256",
    "string",
    V,
    false,
    "manifest profiles[] (travis-austin)",
    "Classification profile digest",
    null,
  ),
  ...PROVENANCE_COLUMNS,
];

const V_CONTRACTOR: readonly Column[] = [
  col("contractor_company_cid", "cid", V, false, "company.cid", "The company's CID", null),
  col("name", "string", V, true, "company.name", "Company name", "source_missing"),
  enumCol(
    "contractor_resolution",
    false,
    "always resolved (reached through property_improvement_has_contractor)",
    "Contractor identity state",
    null,
  ),
  col(
    "identity_source",
    "string",
    V,
    true,
    "derived: company.source_http_request host",
    "Official identity source",
    "needs_review",
  ),
  enumCol("bbb_status", false, BBB_SOURCE, "BBB lookup state", null),
  col(
    "bbb_status_reason",
    "string",
    V,
    true,
    "as v_roofing_permit",
    "Why there is no BBB rating",
    null,
  ),
  col(
    "permit_count",
    "integer",
    "INTEGER",
    false,
    "count of property_improvement_has_contractor rows",
    "Permits",
    null,
  ),
  col(
    "roofing_permit_count",
    "integer",
    "INTEGER",
    false,
    "the same count limited to v_roofing_permit",
    "Roofing permits",
    null,
  ),
  ...PROVENANCE_COLUMNS,
];

const V_RUN: readonly Column[] = [
  col("run_id", "string", V, false, "manifest runId", "Run ID", null),
  col("county_fips", "string", V, false, "manifest fips", "County FIPS", null),
  col(
    "started_at",
    "timestamptz",
    "TIMESTAMP WITH TIME ZONE",
    false,
    "manifest startedAt",
    "Run start",
    null,
  ),
  col(
    "finished_at",
    "timestamptz",
    "TIMESTAMP WITH TIME ZONE",
    false,
    "manifest finishedAt (= as_of)",
    "Run finish",
    null,
  ),
  col("manifest_cid", "cid", V, false, "CIDv1 of the manifest", "Manifest CID", null),
  col(
    "previous_manifest_cid",
    "cid",
    V,
    true,
    "manifest previousManifestCid",
    "Previous run's manifest",
    "first_run",
  ),
  col(
    "tables_root_cids",
    "list",
    "STRUCT(data_group VARCHAR, cid VARCHAR)[]",
    false,
    "manifest artifacts[] kind=directory",
    "export-tables roots per data group",
    null,
  ),
  col(
    "sources",
    "list",
    'STRUCT("name" VARCHAR, watermark VARCHAR, captured_at VARCHAR, records BIGINT, added BIGINT, changed BIGINT, removed BIGINT, limitations VARCHAR[])[]',
    false,
    "manifest sources[]",
    "Sources with counts and deltas",
    null,
  ),
  col(
    "coverage",
    "json",
    "JSON",
    false,
    "manifest coverage",
    "Coverage counts with derivations (AD-04, AD-28)",
    null,
  ),
  col(
    "profile_version",
    "string",
    V,
    false,
    "manifest profiles[] (travis-austin)",
    "Classification profile version",
    null,
  ),
  col(
    "profile_sha256",
    "string",
    V,
    false,
    "manifest profiles[] (travis-austin)",
    "Classification profile digest",
    null,
  ),
  col(
    "area_list_sha256",
    "string",
    V,
    false,
    "manifest profiles[] (travis-places)",
    "Area list digest",
    null,
  ),
];

export const VIEWS = {
  v_property: V_PROPERTY,
  v_roofing_permit: V_ROOFING_PERMIT,
  v_contractor: V_CONTRACTOR,
  v_run: V_RUN,
} as const satisfies Record<string, readonly Column[]>;

export type ViewName = keyof typeof VIEWS;

export function columnNames(view: ViewName): string[] {
  return VIEWS[view].map((c) => c.name);
}
