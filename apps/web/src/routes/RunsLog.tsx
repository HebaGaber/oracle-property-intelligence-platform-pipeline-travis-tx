// Runs · Log (`/runs/log`; A-13 T040, US9, AC-12, FR-012): every event of every run in
// runs/index.json, ascending by time, each with its run ID. Events come only from manifest
// timestamps (data/run-events): a run's start, each source's capture, and its finish with the
// run's limitations. An unreadable index is one banner; an unreadable manifest is a banner naming
// its CID while the other runs still list. A react-router lazy route module.
import type { RunManifestV1 } from "@countylens/contract";
import { PROGRESS_LABELS, RUNS_TEXTS, SOURCE_LABELS, isSourceName } from "@countylens/shared";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { formatUtc } from "../components/Provenance";
import { RunIndexError, loadRunsIndex, runIndexText } from "../data/runs-index";
import { runEvents, type RunEvent } from "../data/run-events";
import { RUN_STAGE_TEXTS, loadManifestByCid, runErrorNode, toRunLoadError } from "./Runs.shared";
import type { RunLoadError } from "./Runs.shared";
import runsStyles from "./Runs.module.css";
import styles from "./RunsLog.module.css";

type LogState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly manifests: readonly RunManifestV1[];
      readonly failures: readonly RunLoadError[];
    }
  | { readonly kind: "error"; readonly error: RunLoadError };

async function loadAll(signal: AbortSignal): Promise<LogState> {
  let index;
  try {
    index = await loadRunsIndex({ signal });
  } catch (error) {
    if (signal.aborted) throw error;
    const reason = error instanceof RunIndexError ? runIndexText(error.reason) : String(error);
    return { kind: "error", error: { kind: "index", reason } };
  }
  const settled = await Promise.allSettled(
    index.runs.map((run) => loadManifestByCid(run.manifestCid, signal)),
  );
  const manifests: RunManifestV1[] = [];
  const failures: RunLoadError[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") manifests.push(result.value.manifest);
    else failures.push(toRunLoadError(result.reason));
  }
  return { kind: "ready", manifests, failures };
}

function eventLabel(event: RunEvent): string {
  if (event.kind === "started") return "Run started";
  if (event.kind === "finished") return "Run finished";
  const name = isSourceName(event.source) ? SOURCE_LABELS[event.source] : event.source;
  return `Captured ${name}`;
}

export function Component(): ReactElement {
  const [state, setState] = useState<LogState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    loadAll(controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) setState(next);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", error: toRunLoadError(error) });
      },
    );
    return () => controller.abort();
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <section
      aria-label="Runs · Log"
      data-route="runs-log"
      data-state={state.kind}
      className={runsStyles.page}
    >
      <h2 className={runsStyles.title}>Runs · Log</h2>
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS.manifest} />
          <Skeleton variant="cards" count={3} />
        </>
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {state.kind === "ready" ? (
        <>
          {state.failures.map((failure, i) => (
            <ErrorBanner key={i} message={runErrorNode(failure)} onRetry={retry} />
          ))}
          <div className={runsStyles.card}>
            <p className={runsStyles.itemBody}>{RUNS_TEXTS.nextSync}</p>
            <ul className={styles.events} aria-label="Run events">
              {runEvents(state.manifests).map((event, i) => (
                <li
                  key={i}
                  className={styles.event}
                  data-event={event.kind}
                  data-time={event.time}
                  data-run-id={event.runId}
                >
                  <time className={styles.time} dateTime={event.time}>
                    {formatUtc(event.time)} UTC
                  </time>
                  <span className={styles.what}>{eventLabel(event)}</span>
                  <span className={styles.runId}>{event.runId}</span>
                  {event.kind === "finished" && event.limitations.length > 0 ? (
                    <ul className={styles.notes} aria-label="Limitations">
                      {event.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
