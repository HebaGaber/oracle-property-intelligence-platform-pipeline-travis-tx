// T011: Zod schema for pipeline/docs/travis-sources.yaml (contracts/catalog.md,
// data-model.md). Objects are strict so a typo fails loudly. Keys the kit validator reads
// keep the validator's types (for example `parcel.assessed_parcel_count` is a plain number);
// their provenance sits in a sibling `*_measurement` Measurement (A-01 extension).
//
// Presence rules that `check-catalog.ts` reports with numbered FAIL lines (decision when
// projected hours > 48, pages >= 3, the 9 keys all present, jurisdiction count, ...) are
// deliberately NOT enforced here, so a partial catalog can still be written and checked.
import { z } from "zod";
import { SPEC_CLASSES, VALIDATOR_STATUSES } from "./status-map.js";

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const UtcTimestamp = z
  .string()
  .regex(UTC_ISO, "must be UTC ISO-8601 ending in Z")
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be a real date-time");

export const DateString = z
  .string()
  .regex(DATE_ONLY, "must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be a real date");

const Text = z.string().trim().min(1);
const Url = z.url();

export const SOURCE_KEYS = [
  "tcad_certified",
  "tcad_supplemental",
  "tcad_gis",
  "austin_permits",
  "other_jurisdictions",
  "tx_comptroller",
  "bbb",
  "overture",
  "contractor_licensing",
] as const;
export const SourceKeySchema = z.enum(SOURCE_KEYS);
export type SourceKey = z.infer<typeof SourceKeySchema>;

export const DECISIONS = ["bulk download", "ingest", "runtime retrieval"] as const;
export const DecisionSchema = z.enum(DECISIONS);

export const MeasurementSchema = z
  .strictObject({
    value: z.number().nullable(),
    missing_reason: Text.optional(),
    source_url: Url,
    captured_at: UtcTimestamp,
    method: Text.optional(),
    query: Text.optional(),
  })
  .refine((m) => m.value !== null || m.missing_reason !== undefined, {
    message: "value null requires missing_reason",
    path: ["missing_reason"],
  });
export type Measurement = z.infer<typeof MeasurementSchema>;

export const ThroughputSchema = z.strictObject({
  rows_per_minute_median: z.number().nonnegative(),
  pages_read: z.int().nonnegative(),
  page_size: z.int().positive(),
  window_start: UtcTimestamp,
  window_end: UtcTimestamp,
  app_token_used: z.boolean(),
  rate_limits_observed: Text,
});

export const DownloadRateSchema = z.strictObject({
  megabytes_per_minute: z.number().nonnegative(),
  bytes: z.int().nonnegative(),
  seconds: z.number().nonnegative(),
  source_url: Url,
  captured_at: UtcTimestamp,
});

export const BlockedEvidenceSchema = z
  .strictObject({
    http_status: z.int().optional(),
    timeout_ms: z.int().nonnegative().optional(),
    /** Network or stream error (redacted); a network error has no status and no timeout_ms. */
    error: Text.optional(),
    captured_at: UtcTimestamp,
    url: Url,
    evidence_path: Text,
    body_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    attempts: z.int().positive(),
    user_agent: Text,
    outcome: z.enum(["blocked", "failed"]),
    geo_signal: Text,
  })
  .refine(
    (b) => b.http_status !== undefined || b.timeout_ms !== undefined || b.error !== undefined,
    { message: "blocked_evidence needs http_status, timeout_ms or error" },
  );

export const LocatedElsewhereSchema = z.strictObject({
  jurisdiction: Text,
  value: z.int().nonnegative(),
  source_url: Url,
  captured_at: UtcTimestamp,
});

export const RecordsRequestSchema = z
  .strictObject({
    recipient_office: Text,
    system_scope: Text,
    route: z.enum(["api-first", "records-first"]),
    request_portal_url: Url.optional(),
    request_email: z.email().optional(),
  })
  .refine((r) => r.request_portal_url !== undefined || r.request_email !== undefined, {
    message: "records_request needs request_portal_url or request_email",
  });
export type RecordsRequest = z.infer<typeof RecordsRequestSchema>;

export const SourceSchema = z
  .strictObject({
    key: SourceKeySchema,
    url: Url,
    status: z.enum(["available", "blocked"]),
    denominator: MeasurementSchema,
    travis_coded_rows: MeasurementSchema.optional(),
    statewide_rows: MeasurementSchema.optional(),
    throughput: ThroughputSchema.optional(),
    download_rate: DownloadRateSchema.optional(),
    anti_bot: Text.optional(),
    projected_full_capture_hours: z.number().nonnegative().nullable().optional(),
    decision: DecisionSchema.optional(),
    decision_reason: Text.optional(),
    captured_at: UtcTimestamp,
    blocked_evidence: BlockedEvidenceSchema.optional(),
    records_request: RecordsRequestSchema.optional(),
    next_step: Text.optional(),
    tcad_id_null_count: MeasurementSchema.optional(),
    located_in_other_jurisdictions: z.array(LocatedElsewhereSchema).optional(),
    notes: Text.optional(),
  })
  .refine((s) => s.status !== "blocked" || s.blocked_evidence !== undefined, {
    message: "a blocked source requires blocked_evidence",
    path: ["blocked_evidence"],
  });
export type Source = z.infer<typeof SourceSchema>;

export const JurisdictionStatusSchema = z.enum([...VALIDATOR_STATUSES, "needs-review"]);

export const JurisdictionSchema = z.strictObject({
  jurisdiction: Text,
  key: Text,
  /** Census PLACEFP of the place; absent for the unincorporated county row. */
  census_placefp: z
    .string()
    .regex(/^\d{5}$/)
    .optional(),
  spec_class: z.enum(SPEC_CLASSES),
  status: JurisdictionStatusSchema,
  historical_records: z.boolean(),
  portal_kind: Text.optional(),
  portal: Url.optional(),
  vendor: Text.optional(),
  evidence_url: Url,
  evidence_captured_at: UtcTimestamp,
  evidence_http_status: z.int().optional(),
  earliest_record_date: DateString.optional(),
  records_request: RecordsRequestSchema.optional(),
  issued_by: Text.optional(),
  austin_issued_located_here: MeasurementSchema.optional(),
  blocked_evidence: BlockedEvidenceSchema.optional(),
  notes: Text.optional(),
});
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

/** Receipt of the one TCAD export download (data-model: Parcel.export_receipt). */
export const ExportReceiptSchema = z.strictObject({
  url: Url,
  method: z.enum(["GET", "HEAD"]),
  status: z.int(),
  bytes: z.int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  captured_at: UtcTimestamp,
  user_agent: Text,
  attempts: z.int().positive(),
  outcome: z.enum(["ok", "throttled-then-ok"]),
  /** HTTP Range resumes after a part-way drop (FR-003, 0..5); absent on older catalogs. */
  resumes: z.int().min(0).max(5).optional(),
  /** Repository-relative path of the gitignored file, e.g. pipeline/data/raw/tcad/<name>. */
  file_path: z.string().regex(/^pipeline\/data\/raw\/tcad\/[^/]+$/),
  seconds: z.number().nonnegative(),
  megabytes_per_minute: z.number().nonnegative(),
  roll_year: z.int(),
  certification_date: DateString.optional(),
});
export type ExportReceipt = z.infer<typeof ExportReceiptSchema>;

export const ParcelSchema = z
  .strictObject({
    canonical_source: Text,
    assessed_parcel_count: z.number().nullable(),
    assessed_parcel_count_measurement: MeasurementSchema,
    roll_year: z.int(),
    certification_date: DateString.optional(),
    gis_feature_count: z.number().nullable(),
    gis_feature_count_measurement: MeasurementSchema,
    gap_pct: z.union([z.number().nonnegative(), z.literal("unknown")]),
    gap_reason: Text.optional(),
    discrepancy_threshold_pct: z.number().positive(),
    discrepancy_explanation: Text.optional(),
    separately_assessed_without_geometry: z.enum(["acknowledged", "none"]).optional(),
    identifier_name: Text.optional(),
    identifier_proven: z.boolean(),
    identifier_format: Text.optional(),
    deed_or_sale_dates_present: z.boolean().optional(),
    export_receipt: ExportReceiptSchema.optional(),
  })
  .refine((p) => p.assessed_parcel_count === p.assessed_parcel_count_measurement.value, {
    message: "assessed_parcel_count must equal its measurement value",
    path: ["assessed_parcel_count"],
  })
  .refine((p) => p.gis_feature_count === p.gis_feature_count_measurement.value, {
    message: "gis_feature_count must equal its measurement value",
    path: ["gis_feature_count"],
  });

export const PermitsSchema = z.strictObject({
  expected_jurisdiction_count: z.int().nonnegative(),
  assumes_unified_countywide_history: z.literal(false),
  jurisdictions: z.array(JurisdictionSchema),
});

export const DestinationSchema = z
  .strictObject({
    writes_in_scope: z.boolean(),
    proven: z.boolean(),
    /** T044: Docker-side and SQL-side identities (research R9); absent when not proven. */
    independent_identity_sources: z.array(Text).optional(),
    /** Why the destination is not proven (the validator then blocks the gate). */
    missing_reason: Text.optional(),
    captured_at: UtcTimestamp.optional(),
    project: Text.optional(),
    environment: Text.optional(),
  })
  .refine((d) => !d.proven || (d.independent_identity_sources?.length ?? 0) >= 2, {
    message: "a proven destination needs two independent identity sources",
    path: ["independent_identity_sources"],
  })
  .refine((d) => d.proven || d.missing_reason !== undefined, {
    message: "an unproven destination needs missing_reason",
    path: ["missing_reason"],
  });

export const BbbSchema = z.strictObject({
  status: Text,
  evidence_url: Url.optional(),
  evidence_captured_at: UtcTimestamp.optional(),
  evidence_path: Text.optional(),
  advertised_listing_count: z.int().nonnegative().optional(),
  expected_count: z.int().nonnegative().optional(),
  listing_page_cap: z.boolean().optional(),
  cap_acknowledged: z.boolean().optional(),
  next_step: Text.optional(),
});

export const EnrichmentSchema = z.strictObject({ bbb: BbbSchema });

export const CensusReferenceSchema = z.strictObject({
  dataset: Text,
  vintage: Text,
  source_url: Url,
  captured_at: UtcTimestamp,
  place_count: z.int().nonnegative(),
  /** How the place list was filtered (for example whether a land-area column existed). */
  notes: Text.optional(),
});

export const ApprovedExceptionSchema = z.strictObject({ gate: Text, reason: Text });

export const CatalogSchema = z.strictObject({
  county: Text,
  state: z.string().regex(/^[A-Z]{2}$/),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  fips: z.string().regex(/^\d{5}$/, "fips must be the 5-digit string"),
  snapshot_time: UtcTimestamp,
  waiting_human_hours: z.number().nonnegative(),
  parcel: ParcelSchema.optional(),
  permits: PermitsSchema.optional(),
  destination: DestinationSchema.optional(),
  enrichment: EnrichmentSchema.optional(),
  census_reference: CensusReferenceSchema.optional(),
  approved_exceptions: z.array(ApprovedExceptionSchema).optional(),
  sources: z.array(SourceSchema),
});
export type Catalog = z.infer<typeof CatalogSchema>;
