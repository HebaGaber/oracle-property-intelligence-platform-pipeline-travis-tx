// The one run-numbering rule (PO 2026-10-26 06:55): UI run numbers match the run IDs and the docs.
// The pilot runs are listed, selectable and verifiable but never numbered ("Pilot slice"); every
// other run is numbered 1..n by finish time, so the full-county runs are Run 1-3 and later runs
// continue at 4, 5… No imports: the Hub and the header badge use this without the schema library;
// runs-index.ts re-exports it for the other pages.

/**
 * Runs shown as "Pilot slice", never numbered. A-03's 14-property walking-skeleton slice (the
 * story's first published run, before the full-county Run 1).
 */
export const PILOT_RUN_IDS: ReadonlySet<string> = new Set([
  "travis-202609-permits-20261021t103516z",
]);

export const PILOT_SLICE_LABEL = "Pilot slice";

/** A run's number, or `null` for a pilot run. */
export type RunNumber = number | null;

interface Finished {
  readonly runId: string;
  readonly finishedAt: string;
}

export function isPilotRun(runId: string): boolean {
  return PILOT_RUN_IDS.has(runId);
}

/** The runs oldest first by `finishedAt`. */
export function byFinish<T extends Finished>(runs: readonly T[]): T[] {
  return [...runs].sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
}

/** The numbered (non-pilot) runs oldest first: run N is entry N-1. */
export function numberedByFinish<T extends Finished>(runs: readonly T[]): T[] {
  return byFinish(runs).filter((run) => !isPilotRun(run.runId));
}

/** Each run's number by run ID: 1..n over the non-pilot runs, `null` for a pilot run. */
export function numberRuns(runs: readonly Finished[]): ReadonlyMap<string, RunNumber> {
  const numbers = new Map<string, RunNumber>();
  let n = 0;
  for (const run of byFinish(runs)) numbers.set(run.runId, isPilotRun(run.runId) ? null : ++n);
  return numbers;
}

/** "Run N", or "Pilot slice" for a pilot run. */
export function runName(number: RunNumber): string {
  return number === null ? PILOT_SLICE_LABEL : `Run ${number}`;
}
