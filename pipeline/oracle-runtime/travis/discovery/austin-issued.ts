// FR-004c: Austin-issued permits located in another jurisdiction stay Austin's. The Austin
// source row keeps them (`located_in_other_jurisdictions`); the matching city row gets an
// informational `austin_issued_located_here` count that never changes its own class.
//
// One matching rule, shared by the workflow and the checker: an Austin `jurisdiction` value
// (for example "LAKEWAY FULL PURPOSE" or "PFLUGERVILLE ETJ") belongs to a catalog row when
// it contains the row's name in upper case.
import type { Measurement } from "./catalog.schema.js";

export interface AustinLocatedEntry {
  jurisdiction: string;
  value: number;
  source_url: string;
  captured_at: string;
}

export function matchesJurisdiction(austinValue: string, rowName: string): boolean {
  const name = rowName.trim().toUpperCase();
  return name.length > 0 && austinValue.toUpperCase().includes(name);
}

export function austinEntriesFor<T extends AustinLocatedEntry>(
  rowName: string,
  located: readonly T[],
): T[] {
  return located.filter((e) => matchesJurisdiction(e.jurisdiction, rowName));
}

/** The summed Measurement for one city row, or null when Austin has no entry for it. */
export function austinIssuedMeasurement(
  rowName: string,
  located: readonly AustinLocatedEntry[],
): Measurement | null {
  const entries = austinEntriesFor(rowName, located);
  const first = entries[0];
  if (!first) return null;
  return {
    value: entries.reduce((sum, e) => sum + e.value, 0),
    source_url: first.source_url,
    captured_at: first.captured_at,
    method: `Austin-issued (3syk-w9eu jurisdiction group-by): ${entries
      .map((e) => `${e.jurisdiction}=${e.value}`)
      .join("; ")}`,
  };
}
