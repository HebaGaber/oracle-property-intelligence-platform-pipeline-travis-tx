// Explore (`/tx/travis/explore`; A-13 T025/T029; contracts/ui-routes.md). Two tabs: Filters
// (server-side `explore.search`, ExploreFilters) and SQL (`?mode=sql`, the in-browser engine).
// The SQL panel is a lazy chunk, and only it imports the DuckDB-WASM adapter (through
// ExploreSql.engine.ts), so Filters never downloads the engine (research R2). The page is always
// the List view (`data-view="list"`; `view=map` falls back to it, FR-004a) and reports
// `data-state` loading | ready | error for the hosted tests. A react-router lazy route module.
import { lazy, Suspense, useCallback, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router";
import { ComingSoonEntries } from "../components/ComingSoonEntry";
import { LinearProgress } from "../components/LinearProgress";
import { ExploreFilters, type ExplorePageState } from "./ExploreFilters";
import styles from "./Explore.module.css";

const ExploreSql = lazy(() => import("./ExploreSql").then((m) => ({ default: m.ExploreSql })));

const LOADING_PANEL = "Loading the SQL panel";

export function Component(): ReactElement {
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "sql" ? "sql" : "filters";
  const [state, setState] = useState<ExplorePageState>("loading");
  const onState = useCallback((next: ExplorePageState) => setState(next), []);
  const switchTo = (next: "filters" | "sql"): void => {
    if (next === mode) return;
    setState("loading");
    setParams((current) => {
      const p = new URLSearchParams(current);
      if (next === "sql") p.set("mode", "sql");
      else p.set("mode", "filters");
      if (p.get("view") === "map") p.set("view", "list");
      return p;
    });
  };
  return (
    <section
      aria-label="Explore"
      data-route="explore"
      data-state={state}
      data-view="list"
      className={styles.page}
    >
      <h2 className={styles.title}>Explore</h2>
      <div role="tablist" aria-label="Explore mode" className={styles.tabs}>
        {(["filters", "sql"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={mode === tab}
            className={`${styles.tab} ${mode === tab ? styles.tabActive : ""}`}
            onClick={() => switchTo(tab)}
          >
            {tab === "sql" ? "SQL" : "Filters"}
          </button>
        ))}
      </div>
      <ComingSoonEntries ids={["builder-mode", "saved-searches", "area-matrix"]} />
      {mode === "sql" ? (
        <Suspense fallback={<LinearProgress label={LOADING_PANEL} stageText={LOADING_PANEL} />}>
          <ExploreSql onState={onState} />
        </Suspense>
      ) : (
        <ExploreFilters onState={onState} />
      )}
    </section>
  );
}
