// A-11 T017 (US2, G-RUN wave 1): per-source watermark + content-digest delta computation for
// the three sources D-2(c) re-checks on an incremental run — Austin permits, the TCAD
// supplemental export, and the BBB harvest. Every other source keeps its previous CID untouched
// and is never re-checked here.
//
// Reuses (imports, never reimplements) A-04's existing re-stamp detector and content-digest
// function from pipeline/oracle-runtime/travis/permits/{restamp,content-digest}.ts, per the
// module-boundary table (docs/architecture-constitution.md § 9: "pipeline/oracle-runtime must
// not ... be reimplemented"). pnpm-workspace.yaml deliberately keeps pipeline/oracle-runtime out
// of the Turborepo/pnpm workspace graph ("its own npm project ... as provided"), so this is a
// plain relative-path import, not a package dependency — no new dependency entry is added
// anywhere. Both imported files have zero third-party dependencies (restamp.ts has none;
// content-digest.ts imports only `node:crypto`), so no cross-project `node_modules` resolution
// is ever needed to run this file or its tests. This cross-directory import is unusual enough
// that it is called out explicitly in this builder's handback for the integration check /
// reviewers to confirm, in case the team would rather promote these two functions to a shared
// package instead.
//
// FR-006: a source's delta (`added`/`changed`/`removed`) is always computed by comparing
// content digests, never by trusting a `:updated_at`-style timestamp field. The bulk-re-stamp
// rule (restamp.ts, unchanged): the incremental window is a re-stamp when it is >= 50% of the
// source's total row count, or >= 90% of the window falls inside one 6h span. When the detector
// fires, the caller is expected to have paged the FULL dataset by key (never by the timestamp
// filter) and passed every row here — exactly as A-04's workflow.ts does for Austin. This module
// does not page or fetch a source itself; it only turns rows + previous digests into a verdict.
//
// --- Shape for wave 2 (manifest.ts's ManifestSourceInput/source() wiring, T018) ---
// `computeSourceDelta(input: ComputeSourceDeltaInput): SourceDeltaResult`
//   `SourceDeltaResult` carries exactly the fields data-model.md's `SourceDelta` needs:
//   `name`, `watermark`, `records`, `delta: { added, changed, removed }`, `limitations[]` — plus
//   `restamp` (the full verdict, in case the caller wants its `reasons`/shares for evidence).
//   Wave 2 maps this 1:1 onto `ManifestSourceInput`'s new explicit `added`/`changed`/`removed`
//   fields instead of the current hardcoded "first run: everything is new" in `manifest.ts`.
//   `toSourceRecord(row, opts)` and the re-exported `contentDigest`/`jcs` let a wave-2 caller (or
//   whatever builds `windowRows`) compute each row's digest without re-deriving A-04's content-
//   digest logic either.

import {
  contentDigest,
  isSystemField,
  jcs,
} from "../../../oracle-runtime/travis/permits/content-digest.js";
import {
  detectRestamp,
  RESTAMP_LIMITATION,
  RESTAMP_LIMITATION_CODE,
  type HourCount,
  type RestampVerdict,
} from "../../../oracle-runtime/travis/permits/restamp.js";

export { contentDigest, isSystemField, jcs, detectRestamp, RESTAMP_LIMITATION, RESTAMP_LIMITATION_CODE };
export type { HourCount, RestampVerdict };

/** The only three sources an incremental run re-checks (D-2(c), data-model.md's SourceDelta.name). */
export const INCREMENTAL_SOURCES = ["austin_permits", "tcad_supplemental", "bbb_harvest"] as const;
export type IncrementalSource = (typeof INCREMENTAL_SOURCES)[number];

/** The reason text for a zero-delta source with no re-stamp involved (research.md's zero-delta-with-reason pattern). */
export const NO_NEWER_EXPORT = "no newer export";

/** One row as seen by this run's window/page-through, keyed and digested by the caller. */
export interface SourceRecord {
  /** The row's natural key (permit_number, parcel geoid, BBB business id, ...) — never the source's own transient `:id`. */
  key: string;
  /** Content digest of the row's non-volatile fields (A-04's `contentDigest` pattern) — never a digest of a timestamp field. */
  digest: string;
  /** The row's own update timestamp. Used ONLY to bucket it for the re-stamp window/hour check — never compared to decide "changed". */
  updatedAt: string | null;
}

export interface ComputeSourceDeltaInput {
  source: IncrementalSource;
  /** Total row count of the full dataset right now — the re-stamp window-share denominator. */
  total: number;
  /** The rows this run's window (or, if a re-stamp, full page-through) returned. */
  windowRows: readonly SourceRecord[];
  /** Hourly histogram of `windowRows`' `updatedAt` (restamp.ts's bucket shape) — the re-stamp concentration check. */
  hours: readonly HourCount[];
  /** Content digest of each key as of the last published run. A key absent here was never seen before (→ added). */
  previousDigests: ReadonlyMap<string, string>;
  /**
   * The full current key set — pass this ONLY when `windowRows` is itself a full page-through
   * (re-stamp or backfill mode); it lets `removed` be computed the way A-04's `diffKeySets`
   * does. Omit it for a normal narrow incremental window, where a key missing from the window
   * means "outside this window," not "removed" — removal detection needs a full keyset read.
   */
  currentKeys?: ReadonlySet<string>;
  /** The watermark value to record if this run commits (Socrata `:updated_at`, export date, or harvest date). */
  newWatermark: string | null;
}

export interface SourceDeltaResult {
  name: IncrementalSource;
  watermark: string | null;
  records: number;
  delta: { added: number; changed: number; removed: number };
  limitations: string[];
  /** The full re-stamp verdict (detected, reasons, shares) for evidence/logging. */
  restamp: RestampVerdict;
}

/**
 * Per-source watermark + content-digest delta (FR-006, data-model.md's SourceDelta). Never
 * trusts a timestamp field for "changed": every added/changed/removed count comes from
 * comparing `digest` values. Reuses A-04's `detectRestamp` (imported above) to decide whether
 * the window is a genuine incremental slice or a bulk re-stamp that happens to carry new
 * timestamps on unchanged content.
 */
export function computeSourceDelta(input: ComputeSourceDeltaInput): SourceDeltaResult {
  const restamp = detectRestamp({
    total: input.total,
    windowCount: input.windowRows.length,
    hours: input.hours,
  });

  let added = 0;
  let changed = 0;
  for (const row of input.windowRows) {
    const previous = input.previousDigests.get(row.key);
    if (previous === undefined) added += 1;
    else if (previous !== row.digest) changed += 1;
  }

  let removed = 0;
  if (input.currentKeys) {
    for (const key of input.previousDigests.keys()) {
      if (!input.currentKeys.has(key)) removed += 1;
    }
  }

  const limitations: string[] = [];
  if (restamp.detected) limitations.push(RESTAMP_LIMITATION);
  if (added === 0 && changed === 0 && removed === 0) limitations.push(NO_NEWER_EXPORT);

  return {
    name: input.source,
    watermark: input.newWatermark,
    records: input.windowRows.length,
    delta: { added, changed, removed },
    limitations,
    restamp,
  };
}

/** Build one `SourceRecord` from a raw row using A-04's `contentDigest` (never reimplemented here). */
export function toSourceRecord(
  row: Readonly<Record<string, unknown>>,
  opts: { key: string; updatedAt: string | null; volatileFields: readonly string[] },
): SourceRecord {
  return {
    key: opts.key,
    digest: contentDigest(row, opts.volatileFields),
    updatedAt: opts.updatedAt,
  };
}
