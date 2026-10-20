// T049: the Property Improvement data group for one TCAD property's Austin permits
// (build-county-transform custom-code mode, reference/output-contract.md). Writes
// `<pID>/data/`:
//   seed files + property.json (shared-seed.ts, byte-identical with the County group)
//   property_improvement_N.json ← one captured Austin permit (the per-permit GET)
//   relationship_property_has_property_improvement_N.json
//   <Property Improvement schema CID>.json
//
// Classification comes only from the profile (profiles/travis-austin@1.0.0, injected as
// ProfileApi): improvement_type / improvement_action from classifyPermit(),
// improvement_status from classifyStatus(). Expired is emitted with improvement_status
// null (D-4a). Status classes exclude and needs_review, and needs_review permits, are
// never emitted; they are counted and kept in the ledger. Trade sub-permits (non-BP)
// keep their trade type and are never Roofing (D-4b).
//
// Written fields are only lexicon properties of the live `property_improvement` class
// (additionalProperties false). The source description, work class, status word, expiry
// and contractor name have no carrier (ADR-0002) and are never written.
// `contractor_type` is required by the class and written null: the permit's category
// of contractor is not established here.
import {
  buildSharedFiles,
  jsonFile,
  link,
  pidOf,
  type SeedRow,
  type TcadRecord,
} from "./shared-seed.js";
import type { DataGroupCids } from "./lexicon-manifest.js";

export const AUSTIN_DATASET_URL = "https://data.austintexas.gov/resource/3syk-w9eu.json";

/** An Austin 3syk-w9eu row as captured (Socrata omits null fields). */
export type AustinRow = { permit_number: string } & Record<string, string | null | undefined>;

export interface AustinPermitReceipt {
  url: string;
  method: "GET";
  multiValueQueryString: { permit_number: string[] };
  status: number | null;
  sha256: string;
  captured_at: string;
}

export interface AustinPermitCapture {
  row: AustinRow;
  receipt: AustinPermitReceipt;
}

export type StatusClass = "open" | "stalled" | "closed" | "exclude" | "needs_review";
export type RoofingVerdict = "roofing" | "not_roofing" | "needs_review";

/** The profile contract (contracts/profile.md) as the transform uses it. */
export interface ProfileApi {
  PROFILE: { name: string; version: string; sha256: string };
  classifyPermit: (row: AustinRow) => {
    roofing: RoofingVerdict;
    reason: string;
    improvement_type: string | null;
    improvement_action: string | null;
    sha256: string;
  };
  /** The source status word as printed; an absent word is passed as "" (needs_review). */
  classifyStatus: (word: string) => {
    class: StatusClass;
    improvement_status: string | null;
    sha256: string;
  };
}

export type SkipReason =
  "status_exclude" | "status_needs_review" | "roofing_needs_review" | "no_improvement_type";

export interface ClassificationLedgerRow {
  pID: string | null;
  permit_number: string;
  emitted: boolean;
  status_class: StatusClass;
  roofing: RoofingVerdict;
  reason: string;
  improvement_type: string | null;
  improvement_action: string | null;
  improvement_status: string | null;
  skip_reason: SkipReason | null;
  issue_date: string | null;
  completed_date: string | null;
  source_sha256: string;
  profile_version: string;
  profile_sha256: string;
}

export const EMITTABLE_CLASSES: readonly StatusClass[] = ["open", "stalled", "closed"];

/** D-4a guard: every emitted permit's class must be open, stalled or closed. */
export function assertEmittedClasses(
  ledger: ReadonlyArray<
    Pick<ClassificationLedgerRow, "permit_number" | "emitted" | "status_class">
  >,
): void {
  const bad = ledger.filter((r) => r.emitted && !EMITTABLE_CLASSES.includes(r.status_class));
  if (bad.length > 0) {
    throw new Error(
      `emitted permits outside {open, stalled, closed}: ${bad.map((r) => `${r.permit_number}=${r.status_class}`).join(", ")}`,
    );
  }
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? (m[1] as string) : null;
}

/** One permit through the profile: the ledger row (internal; never published). */
export function classifyCapture(
  capture: AustinPermitCapture,
  profile: ProfileApi,
  pID: string | null,
): ClassificationLedgerRow {
  const row = capture.row;
  const permit = profile.classifyPermit(row);
  const status = profile.classifyStatus(row.status_current ?? "");
  if (permit.sha256 !== profile.PROFILE.sha256 || status.sha256 !== profile.PROFILE.sha256) {
    throw new Error(`profile digest mismatch on ${row.permit_number}`);
  }
  let skip: SkipReason | null = null;
  if (status.class === "exclude") skip = "status_exclude";
  else if (status.class === "needs_review") skip = "status_needs_review";
  else if (permit.roofing === "needs_review") skip = "roofing_needs_review";
  else if (permit.improvement_type === null) skip = "no_improvement_type";
  if (permit.roofing !== "roofing" && permit.improvement_type === "Roofing") {
    throw new Error(`${row.permit_number}: a non-roofing verdict carries Roofing`);
  }
  return {
    pID,
    permit_number: row.permit_number,
    emitted: skip === null,
    status_class: status.class,
    roofing: permit.roofing,
    reason: permit.reason,
    improvement_type: permit.improvement_type,
    improvement_action: permit.improvement_action,
    improvement_status: skip === null ? status.improvement_status : null,
    skip_reason: skip,
    issue_date: isoDate(row.issue_date),
    completed_date: isoDate(row.completed_date),
    source_sha256: capture.receipt.sha256,
    profile_version: `${profile.PROFILE.name}@${profile.PROFILE.version}`,
    profile_sha256: profile.PROFILE.sha256,
  };
}

export interface PropertyImprovementInput {
  record: TcadRecord;
  seed: SeedRow;
  cids: DataGroupCids;
  /** The property's captured permits, in the order they are numbered. */
  permits: AustinPermitCapture[];
  profile: ProfileApi;
}

export interface PropertyImprovementCounts {
  emitted: number;
  excluded: number;
  needs_review: number;
  by_class: Partial<Record<StatusClass, number>>;
  by_skip: Partial<Record<SkipReason, number>>;
}

export interface PropertyImprovementOutput {
  pID: string;
  dir: string;
  /** Empty when no permit of the property is emitted (the property is left out of the group). */
  files: Record<string, string>;
  counts: PropertyImprovementCounts;
  ledger: ClassificationLedgerRow[];
}

export function transformAustinPropertyImprovement(
  input: PropertyImprovementInput,
): PropertyImprovementOutput {
  const pID = pidOf(input.record);
  const ledger = input.permits.map((p) => classifyCapture(p, input.profile, pID));
  assertEmittedClasses(ledger);

  const counts: PropertyImprovementCounts = {
    emitted: 0,
    excluded: 0,
    needs_review: 0,
    by_class: {},
    by_skip: {},
  };
  const permitFiles: Record<string, string> = {};
  const links: { "/": string }[] = [];
  input.permits.forEach((capture, i) => {
    const l = ledger[i] as ClassificationLedgerRow;
    if (!l.emitted) {
      const skip = l.skip_reason as SkipReason;
      counts.by_skip[skip] = (counts.by_skip[skip] ?? 0) + 1;
      if (skip === "status_exclude" || skip === "no_improvement_type") counts.excluded += 1;
      else counts.needs_review += 1;
      return;
    }
    counts.emitted += 1;
    counts.by_class[l.status_class] = (counts.by_class[l.status_class] ?? 0) + 1;
    const n = counts.emitted;
    const name = `property_improvement_${n}.json`;
    const multi = capture.receipt.multiValueQueryString;
    if (capture.receipt.method !== "GET" || multi.permit_number?.[0] !== l.permit_number) {
      throw new Error(`${l.permit_number}: receipt is not the per-permit GET`);
    }
    permitFiles[name] = jsonFile({
      source_http_request: {
        method: "GET",
        url: AUSTIN_DATASET_URL,
        multiValueQueryString: { permit_number: [l.permit_number] },
      },
      request_identifier: l.permit_number,
      permit_number: l.permit_number,
      improvement_type: l.improvement_type,
      improvement_action: l.improvement_action,
      improvement_status: l.improvement_status,
      contractor_type: null,
      permit_issue_date: l.issue_date,
      completion_date: l.completed_date,
    });
    const rel = `relationship_property_has_property_improvement_${n}.json`;
    permitFiles[rel] = jsonFile({ from: link("property.json"), to: link(name) });
    links.push(link(rel));
  });

  const files: Record<string, string> =
    counts.emitted === 0
      ? {}
      : {
          ...buildSharedFiles({ record: input.record, seed: input.seed, seedCid: input.cids.seed }),
          ...permitFiles,
          [`${input.cids.propertyImprovement}.json`]: jsonFile({
            label: "Property Improvement",
            relationships: { property_has_property_improvement: links },
          }),
        };
  return { pID, dir: `${pID}/data`, files, counts, ledger };
}
