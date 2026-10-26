// The committed run index (A-03 T042, G-C3; interface fixed by T007 for T048): served
// same-origin from `/runs/index.json` (copied into apps/web/public at build, T044) and checked
// against `RunsIndexV1`. Missing, non-JSON or schema mismatch → `unreadable`; `runs: []` →
// `empty` (FR-002, TC-014); the page maps both to RUN_INDEX_TEXTS. The latest entry is the run
// the pages show. No value here is a fixture: the file is written by the publish step only.
import { RunsIndexV1 } from "@countylens/contract";
import { RUN_INDEX_TEXTS } from "@countylens/shared";
import { browserFetch, requestInit, throwIfAborted } from "./http";

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
export async function loadRunsIndex(options: LoadRunsIndexOptions = {}): Promise<RunsIndexV1> {
  const fetchImpl = options.fetch ?? browserFetch;
  let response: Response;
  try {
    response = await fetchImpl(RUNS_INDEX_PATH, requestInit(options.signal));
  } catch (error) {
    throwIfAborted(options.signal);
    throw new RunIndexError("unreadable", { cause: error });
  }
  if (response.status !== 200) {
    throw new RunIndexError("unreadable", {
      cause: new Error(`${RUNS_INDEX_PATH} answered ${response.status}`),
    });
  }
  let data: unknown;
  try {
    data = JSON.parse(await response.text());
  } catch (error) {
    throw new RunIndexError("unreadable", { cause: error });
  }
  const parsed = RunsIndexV1.safeParse(data);
  if (!parsed.success) throw new RunIndexError("unreadable", { cause: parsed.error });
  if (parsed.data.runs.length === 0) throw new RunIndexError("empty");
  return parsed.data;
}

/** The entry with the greatest `finishedAt` (the index is ordered; the last one). */
export function latestRun(index: RunsIndexV1): RunsIndexEntry {
  let latest: RunsIndexEntry | undefined;
  for (const run of index.runs) {
    if (latest === undefined || Date.parse(run.finishedAt) >= Date.parse(latest.finishedAt)) {
      latest = run;
    }
  }
  if (latest === undefined) throw new RunIndexError("empty");
  return latest;
}

/** The fixed banner text for a RunIndexError (plan § "Fixed texts"; the only source is shared). */
export function runIndexText(reason: RunIndexFailure): string {
  return RUN_INDEX_TEXTS[reason];
}

/** The index's runs oldest first (by `finishedAt`): the order every page numbers runs in. */
export function runsByFinish(index: RunsIndexV1): RunsIndexEntry[] {
  return [...index.runs].sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
}

/**
 * Each run's 1-based number by run ID (RUNS_TEXTS.numbering): its place in `runsByFinish`, the
 * same "Run N" the header badge, Runs, Compare, Log and the Manifest chain show.
 */
export function runNumbers(index: RunsIndexV1): ReadonlyMap<string, number> {
  return new Map(runsByFinish(index).map((run, i) => [run.runId, i + 1]));
}
