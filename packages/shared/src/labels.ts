// Human labels for the contract's closed list of missing reasons (spec.md § Missing-reason
// labels, FR-011; PO decision D-2, 2026-10-21). The contract defines no labels: these are the
// UI wording, one row per reason, and the UI shows them wherever a value is missing (XI).
//
// Adding a reason to contract/v1 is additive and must add a row here. `satisfies
// Record<MissingReason, string>` makes tsc fail on a missing or an unknown key, and
// test/missing-labels.test.ts walks MISSING_REASONS at run time (A-03-TC-027).
import { MISSING_REASONS, type MissingReason } from "@countylens/contract";

export const MISSING_REASON_LABELS = Object.freeze({
  no_lexicon_carrier: "No place for this field in the published data model",
  not_in_export: "Not included in the published tables",
  source_missing: "Not on the source record",
  no_coordinates: "No coordinates for this parcel",
  no_roof_date: "No roof date found",
  basis_unmatched: "No roof-age basis matched",
  no_dated_sale: "No dated sale to read the owner from",
  no_owner_record: "No owner on the latest sale",
  no_mailing_address: "No owner mailing address",
  zip_not_zcta: "ZIP is not a Census ZIP area",
  not_open: "Permit is not open",
  not_closed: "Permit is not closed",
  contractor_unresolved: "Contractor not matched to a company",
  bbb_blocked: "BBB blocked the lookup",
  bbb_not_found: "No BBB profile found",
  needs_review: "Needs review: could not be derived",
  first_run: "First run: no previous manifest",
  out_of_scope: "Outside Travis County",
  enum_lacks_value: "Status has no matching value (e.g. Expired)",
  owner_unparsed: "Owner name could not be parsed",
  owner_confidential: "Owner is confidential (TCAD)",
} satisfies Record<MissingReason, string>);

/**
 * D-2: a contractor field whose reason is `source_missing` means the source record printed no
 * contractor. This replaces the generic `source_missing` label for contractor fields only.
 */
export const CONTRACTOR_NOT_PRINTED_LABEL = "Contractor not printed on permit";

/**
 * Runs-page labels for manifest `coverage` counts. These are counts, not row reasons:
 * a permit without a TCAD id is never published, so no row can carry it (spec "Story labels").
 */
export const COVERAGE_LABELS = Object.freeze({
  permits_no_tcad_geoid: "No TCAD id on source record",
});
export type CoverageLabelKey = keyof typeof COVERAGE_LABELS;

/** A contractor field: any view column named `contractor_*` (contract/v1 columns). */
export function isContractorField(field: string): boolean {
  return field.startsWith("contractor_");
}

/**
 * The label the UI shows for one `{field, reason}` entry of a row's `missing` list.
 * Throws, naming the reason, when the reason has no label (a contract/UI gap, never blank).
 */
export function missingLabel(field: string, reason: MissingReason): string {
  if (reason === "source_missing" && isContractorField(field)) {
    return CONTRACTOR_NOT_PRINTED_LABEL;
  }
  return missingReasonLabel(reason);
}

/** The table label of one reason; throws, naming the reason, when it is not in the map. */
export function missingReasonLabel(reason: string): string {
  const label = (MISSING_REASON_LABELS as Readonly<Record<string, string | undefined>>)[reason];
  if (label === undefined || label === "") {
    throw new Error(`No label for missing reason "${reason}"`);
  }
  return label;
}

/**
 * FR-011 coverage check: every reason in `reasons` has a non-empty label, and the map has no
 * label for a reason outside `reasons`. Throws naming the first gap. Defaults to the contract's
 * closed list, so `assertMissingReasonLabels()` is the live check.
 */
export function assertMissingReasonLabels(reasons: readonly string[] = MISSING_REASONS): void {
  for (const reason of reasons) missingReasonLabel(reason);
  const orphans = Object.keys(MISSING_REASON_LABELS).filter((key) => !reasons.includes(key));
  if (orphans.length > 0) {
    throw new Error(
      `Labels for reasons outside the closed list: ${orphans.map((o) => `"${o}"`).join(", ")}`,
    );
  }
}
