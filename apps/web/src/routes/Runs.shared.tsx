// Shared pieces of the run pages (A-13 T020/T021/T023: Runs, Compare, Coverage, Manifest,
// Verify). One load path: same-origin `/runs/index.json` → its latest entry → the manifest by CID
// through the CID copy with the labelled Filebase fallback (fetch-by-cid, FR-016). A failure is
// either the index (FR-021 "Run index unavailable · {reason}", with a link to the file) or the
// manifest ("Manifest unavailable · {cid} · {reason}", the full CID in `data-cid`). The reason is
// the A-03 text (RUN_INDEX_TEXTS, BOTH_HOSTS_DOWN_TEXT, a CID mismatch) as its own element, so
// both the A-03 checks and the A-13 sentence read exactly. Not a route module (no `Component`).
import { RUNS_TEXTS, sourceLabel } from "@countylens/shared";
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { readPathUrlsFromEnv } from "../data/config";
import { loadManifest, type LoadedManifest } from "../data/manifest";
import {
  RUN_STAGE_TEXTS,
  runErrorMessage,
  type LoadedRun,
  type RunStage,
} from "../data/run-loader";
import {
  RUNS_INDEX_PATH,
  RunIndexError,
  latestRun,
  loadRunsIndex,
  runIndexText,
} from "../data/runs-index";

export { RUN_STAGE_TEXTS };

export type RunLoadError =
  | { readonly kind: "index"; readonly reason: string }
  | { readonly kind: "manifest"; readonly cid: string; readonly reason: string };

export class RunLoadFailure extends Error {
  override readonly name = "RunLoadFailure";
  constructor(readonly failure: RunLoadError) {
    super(failure.reason);
  }
}

export type RunPageState =
  | { readonly kind: "loading"; readonly stage: RunStage }
  | { readonly kind: "ready"; readonly run: LoadedRun }
  | { readonly kind: "error"; readonly error: RunLoadError };

/** The manifest by CID through the configured read path (copy, then the Filebase fallback). */
export async function loadManifestByCid(
  cid: string,
  signal?: AbortSignal,
): Promise<LoadedManifest> {
  try {
    return await loadManifest(cid, {
      urls: readPathUrlsFromEnv(),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new RunLoadFailure({ kind: "manifest", cid, reason: runErrorMessage(error) });
  }
}

/** Index → latest entry → manifest; throws RunLoadFailure naming which read failed. */
export async function loadLatestRun(
  signal: AbortSignal,
  onStage?: (stage: RunStage) => void,
): Promise<LoadedRun> {
  onStage?.("index");
  let index: LoadedRun["index"];
  try {
    index = await loadRunsIndex({ signal });
  } catch (error) {
    if (signal.aborted) throw error;
    const reason = error instanceof RunIndexError ? runIndexText(error.reason) : String(error);
    throw new RunLoadFailure({ kind: "index", reason });
  }
  const entry = latestRun(index);
  onStage?.("manifest");
  const { manifest, manifestCid, read } = await loadManifestByCid(entry.manifestCid, signal);
  try {
    // An unmapped manifest source is a build gap: fail loudly, never a blank (A-03).
    for (const source of manifest.sources) sourceLabel(source.name);
  } catch (error) {
    throw new RunLoadFailure({
      kind: "manifest",
      cid: manifestCid,
      reason: runErrorMessage(error),
    });
  }
  return { index, entry, manifest, manifestCid, read };
}

export function toRunLoadError(error: unknown): RunLoadError {
  if (error instanceof RunLoadFailure) return error.failure;
  return { kind: "index", reason: runErrorMessage(error) };
}

/** The latest run for a page, with its loading stage, error and a retry. */
export function useLatestRun(): { readonly state: RunPageState; readonly retry: () => void } {
  const [state, setState] = useState<RunPageState>({ kind: "loading", stage: "index" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const live = (): boolean => !controller.signal.aborted;
    setState({ kind: "loading", stage: "index" });
    loadLatestRun(controller.signal, (stage) => {
      if (live()) setState({ kind: "loading", stage });
    }).then(
      (run) => {
        if (live()) setState({ kind: "ready", run });
      },
      (error: unknown) => {
        if (live()) setState({ kind: "error", error: toRunLoadError(error) });
      },
    );
    return () => controller.abort();
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

const MARK_A = "\u0000";
const MARK_B = "\u0001";

/** Fills a fixed text template from @countylens/shared with nodes, keeping its exact wording. */
function fill(template: string, a: ReactNode, b?: ReactNode): ReactNode[] {
  return template
    .split(new RegExp(`(${MARK_A}|${MARK_B})`))
    .map((part, i) =>
      part === MARK_A ? (
        <span key={i}>{a}</span>
      ) : part === MARK_B ? (
        <span key={i}>{b}</span>
      ) : (
        part
      ),
    );
}

/**
 * The ErrorBanner message for a run load error: the sentence keeps the reason, and for a manifest
 * the full CID, as separate elements.
 */
export function runErrorNode(error: RunLoadError): ReactNode {
  return (
    <>
      <span data-error-text="">
        {error.kind === "index"
          ? fill(RUNS_TEXTS.indexUnavailable(MARK_A), error.reason)
          : fill(
              RUNS_TEXTS.manifestUnavailable(MARK_A, MARK_B),
              <code data-cid={error.cid}>{error.cid}</code>,
              error.reason,
            )}
      </span>
      {error.kind === "index" ? (
        <>
          {" "}
          <a href={RUNS_INDEX_PATH}>{RUNS_INDEX_PATH}</a>
        </>
      ) : null}
    </>
  );
}

/** Per-source delta versus the previous run (FR-001c), or the first-run text. */
export function SourceDeltas({
  added,
  changed,
  removed,
  firstRun,
}: {
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly firstRun: boolean;
}): ReactElement {
  if (firstRun) return <span>{RUNS_TEXTS.firstRun}</span>;
  return (
    <span>
      vs previous run: added <span data-delta="added">{added}</span> · changed{" "}
      <span data-delta="changed">{changed}</span> · removed{" "}
      <span data-delta="removed">{removed}</span>
    </span>
  );
}
