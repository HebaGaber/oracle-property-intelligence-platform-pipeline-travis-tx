// A-03 T007 stub (interface fixed for T042/T048, G-C3/G-C5): the committed run index, served
// same-origin from `/runs/index.json` (copied into apps/web/public at build, T044) and checked
// against `RunsIndexV1`. Missing, non-JSON or schema mismatch → `unreadable`; `runs: []` →
// `empty` (FR-002, TC-014); the page maps both to RUN_INDEX_TEXTS. The latest entry is the run
// the pages show. No value here is a fixture: the file is written by the publish step only.
import type { RunsIndexV1 } from "@countylens/contract";

export const RUNS_INDEX_PATH = "/runs/index.json";

export type RunsIndexEntry = RunsIndexV1["runs"][number];

export type RunIndexFailure = "unreadable" | "empty";

export class RunIndexError extends Error {
  override readonly name = "RunIndexError";

  constructor(
    readonly reason: RunIndexFailure,
    options?: { readonly cause?: unknown },
  ) {
    super(`run index ${reason}`, options);
  }
}

export interface LoadRunsIndexOptions {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

/** GET RUNS_INDEX_PATH; throws RunIndexError("unreadable") or RunIndexError("empty"). */
export function loadRunsIndex(_options?: LoadRunsIndexOptions): Promise<RunsIndexV1> {
  throw new Error("not implemented");
}

/** The entry with the greatest `finishedAt` (the index is ordered; the last one). */
export function latestRun(_index: RunsIndexV1): RunsIndexEntry {
  throw new Error("not implemented");
}
