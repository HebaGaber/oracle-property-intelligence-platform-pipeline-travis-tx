// The record kinds of the Coverage page (A-13 T021, AC-2, FR-002; spec US1 "property, ownership,
// permit, contractor by its five states, BBB by status, business, places, coordinates"). Static
// text only: which manifest coverage-key prefixes belong to a kind, which manifest source
// collected it and which published table (elephant-cli group/table, matched against the
// manifest's artifact names) holds its rows. No count lives here: counts come only from the
// manifest's coverage section (AD-04). A key no kind claims is listed under "Other" (tolerated).
import { COVERAGE_TEXTS } from "@countylens/shared";

/** Shown for a record kind with no key in the manifest's coverage section (TC-017). */
export const COVERAGE_KIND_MISSING = COVERAGE_TEXTS.kindAbsent;
/** Shown when a kind's rows are in no published table of this run. */
export const COVERAGE_TABLE_MISSING = "no published table for this kind in this run";
/** Shown when the kind's source is not among the manifest's sources. */
export const COVERAGE_SOURCE_MISSING = "source not in this run's manifest";

export interface CoverageKind {
  readonly id: string;
  readonly title: string;
  readonly prefixes: readonly string[];
  /** Manifest `sources[].name` that collected the kind, when one source does. */
  readonly source: string | null;
  /** `{group}/{table}` under `tables/`, when the kind is published as a table. */
  readonly table: string | null;
}

export const COVERAGE_KINDS: readonly CoverageKind[] = Object.freeze([
  {
    id: "property",
    title: "Property",
    prefixes: ["parcels_"],
    source: "tcad-2026-certified-json",
    table: "county/property",
  },
  {
    id: "ownership",
    title: "Ownership",
    prefixes: ["owner_", "confidential_"],
    source: "tcad-2026-certified-json",
    table: "county/sales_history",
  },
  {
    id: "permit",
    title: "Permit",
    prefixes: ["permits_", "roof_age_"],
    source: "austin-3syk-w9eu",
    table: "property_improvement/property_improvement",
  },
  {
    id: "contractor",
    title: "Contractor · resolved, candidate, ambiguous, conflicting, unresolved",
    prefixes: ["contractor_"],
    source: "austin-3syk-w9eu",
    // The printed-name company links (Run 3 manifest limitation; data audit 2026-10-26, row 7).
    table: "property_improvement/property_improvement_has_contractor",
  },
  { id: "bbb", title: "BBB by status", prefixes: ["bbb_"], source: null, table: null },
  { id: "business", title: "Business", prefixes: ["business_"], source: null, table: null },
  { id: "places", title: "Places", prefixes: ["places_"], source: null, table: null },
  {
    id: "coordinates",
    title: "Coordinates",
    prefixes: ["coordinates_"],
    source: "tcad-2026-certified-json",
    table: "county/geometry",
  },
]);

export const OTHER_KIND: CoverageKind = Object.freeze({
  id: "other",
  title: "Other coverage keys",
  prefixes: [],
  source: null,
  table: null,
});

/** A key's label when COVERAGE_LABELS has none: its words ("contractor_resolved" → "contractor resolved"). */
export function keyWords(key: string): string {
  return key.replace(/[_:]+/g, " ").trim();
}

/** The kind a coverage key belongs to (OTHER_KIND when none claims it). */
export function kindOf(key: string): CoverageKind {
  return COVERAGE_KINDS.find((k) => k.prefixes.some((p) => key.startsWith(p))) ?? OTHER_KIND;
}
