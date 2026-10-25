// Explore · SQL (`?mode=sql`; A-13 T029; AC-6, FR-006, FR-006a, FR-017; TC-004, TC-038 … TC-040).
// A lazy chunk of Explore. On mount it opens the in-browser engine (ExploreSql.engine.ts) with a
// progress bar and its stage text; then a read-only editor (textbox "SQL"), "Run" and the result
// grid (`table[aria-label="Query result"]`, first RESULT_ROWS rows). A write is refused with the
// fixed read-only text before the engine sees it; an engine error is one line with a fix
// (`[data-sql-error]`), never a stack. The engine line reads "DuckDB-WASM in your browser ·
// read-only"; the fallback chip names Filebase when it served the run. Not a route module.
import type { Row } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { useEffect, useId, useState, type ReactElement } from "react";
import { ComingSoonEntries } from "../components/ComingSoonEntry";
import { Icon } from "../components/Icon";
import { LinearProgress } from "../components/LinearProgress";
import { StatusPill } from "../components/StatusPill";
import { ErrorBanner } from "../components/ErrorBanner";
import type { ExplorePageState } from "./ExploreFilters";
import {
  openSqlSession,
  readOnlyRefusal,
  SQL_RESULT_ROWS,
  sqlErrorLine,
  type SqlSession,
} from "./ExploreSql.engine";
import styles from "./Explore.module.css";

const LOADING_ENGINE = "Loading the query engine";
/** A13-7 (audino finding 5): why the first query on a view waits (it binds that view's tables). */
export const SQL_BIND_NOTE =
  "First query on this view: the engine reads its published tables before it answers. On the full county this can take a minute; later queries on the same view are fast.";
const DEFAULT_SQL = "SELECT count(*) FROM v_property";

type EngineState =
  | { readonly kind: "loading"; readonly stage: string }
  | { readonly kind: "ready"; readonly session: SqlSession }
  | { readonly kind: "error"; readonly message: string };

type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly binding: boolean }
  | { readonly kind: "rows"; readonly rows: Row[]; readonly ms: number }
  | { readonly kind: "error"; readonly text: string };

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ExploreSql({
  onState,
}: {
  readonly onState: (state: ExplorePageState) => void;
}): ReactElement {
  const id = useId();
  const [engine, setEngine] = useState<EngineState>({ kind: "loading", stage: LOADING_ENGINE });
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let opened: SqlSession | null = null;
    openSqlSession((stage) => {
      if (!controller.signal.aborted) setEngine({ kind: "loading", stage });
    }, controller.signal).then(
      (session) => {
        opened = session;
        if (controller.signal.aborted) void session.close().catch(() => undefined);
        else setEngine({ kind: "ready", session });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setEngine({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      controller.abort();
      void opened?.close().catch(() => undefined);
    };
  }, [attempt]);

  const retryEngine = (): void => {
    setRun({ kind: "idle" });
    setEngine({ kind: "loading", stage: LOADING_ENGINE });
    setAttempt((n) => n + 1);
  };

  useEffect(() => onState(engine.kind), [engine.kind, onState]);

  const execute = async (): Promise<void> => {
    if (engine.kind !== "ready") return;
    const refusal = readOnlyRefusal(sql);
    if (refusal !== null) {
      setRun({ kind: "error", text: refusal });
      return;
    }
    setRun({ kind: "running", binding: engine.session.needsBind(sql) });
    const start = performance.now();
    try {
      const rows = await engine.session.query(sql);
      setRun({ kind: "rows", rows, ms: performance.now() - start });
    } catch (error) {
      setRun({ kind: "error", text: sqlErrorLine(error) });
    }
  };

  const columns = run.kind === "rows" ? Object.keys(run.rows[0] ?? {}) : [];
  return (
    <div className={styles.sql}>
      <ComingSoonEntries ids={["sql-checks"]} />
      <p className={styles.engine} data-engine-line="">
        <Icon name="memory" size="small" />
        <span>{EXPLORE_TEXTS.engineBrowser}</span>
        {engine.kind === "ready" && engine.session.fallbackLabel !== null ? (
          <StatusPill status="warning" text={engine.session.fallbackLabel} />
        ) : null}
      </p>
      {engine.kind === "loading" ? (
        <LinearProgress label={LOADING_ENGINE} stageText={engine.stage} />
      ) : null}
      {engine.kind === "error" ? (
        <ErrorBanner message={engine.message} onRetry={retryEngine} />
      ) : null}
      {engine.kind === "ready" ? (
        <>
          <p className={styles.engine}>
            Run {engine.session.runId} · the contract views over its published tables
          </p>
          <label className={styles.sqlLabel} htmlFor={`${id}-sql`}>
            SQL
          </label>
          <textarea
            id={`${id}-sql`}
            className={styles.editor}
            spellCheck={false}
            rows={5}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
          />
          <div>
            <button
              type="button"
              className={styles.run}
              onClick={() => void execute()}
              disabled={run.kind === "running"}
            >
              Run
            </button>
          </div>
        </>
      ) : null}
      {run.kind === "running" && run.binding ? (
        <>
          <LinearProgress label="Running the query" stageText="Binding the published tables" />
          <p className={styles.engine} role="status" data-sql-bind-note="">
            {SQL_BIND_NOTE}
          </p>
        </>
      ) : null}
      {run.kind === "error" ? (
        <p className={styles.sqlError} role="alert" data-sql-error="">
          {run.text}
        </p>
      ) : null}
      {run.kind === "rows" ? (
        <>
          <p className={styles.engine}>
            {EXPLORE_TEXTS.sqlRows(
              Math.min(run.rows.length, SQL_RESULT_ROWS),
              run.rows.length > SQL_RESULT_ROWS,
              Math.round(run.ms),
            )}
          </p>
          <div className={styles.scroll}>
            <table className={styles.grid} aria-label="Query result">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.rows.slice(0, SQL_RESULT_ROWS).map((row, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c}>{cellText(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
