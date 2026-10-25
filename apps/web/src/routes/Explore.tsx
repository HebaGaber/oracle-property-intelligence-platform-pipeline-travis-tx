// Explore (`/tx/travis/explore`; A-13 T025/T029; contracts/ui-routes.md). Three tabs: Filters
// (server-side `explore.search`, ExploreFilters), SQL (`?mode=sql`, the in-browser engine) and
// AI (`?mode=ai`, A-14: `agent.ask` through ExploreAi, also a lazy chunk).
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

const ExploreAi = lazy(() => import("./ExploreAi").then((m) => ({ default: m.ExploreAi })));

type Mode = "filters" | "sql" | "ai";
const TAB_LABELS: Readonly<Record<Mode, string>> = { filters: "Filters", sql: "SQL", ai: "AI" };

const LOADING_PANEL = "Loading the SQL panel";
const LOADING_AI = "Loading the AI panel";

export function Component(): ReactElement {
  const [params, setParams] = useSearchParams();
  const requested = params.get("mode");
  const mode: Mode = requested === "sql" || requested === "ai" ? requested : "filters";
  const [state, setState] = useState<ExplorePageState>("loading");
  const onState = useCallback((next: ExplorePageState) => setState(next), []);
  const switchTo = (next: Mode): void => {
    if (next === mode) return;
    setState("loading");
    setParams((current) => {
      const p = new URLSearchParams(current);
      p.set("mode", next);
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
        {(["filters", "sql", "ai"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={mode === tab}
            className={`${styles.tab} ${mode === tab ? styles.tabActive : ""}`}
            onClick={() => switchTo(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      <ComingSoonEntries ids={["builder-mode", "saved-searches", "area-matrix"]} />
      {mode === "sql" ? (
        <Suspense fallback={<LinearProgress label={LOADING_PANEL} stageText={LOADING_PANEL} />}>
          <ExploreSql onState={onState} />
        </Suspense>
      ) : mode === "ai" ? (
        <Suspense fallback={<LinearProgress label={LOADING_AI} stageText={LOADING_AI} />}>
          <ExploreAi onState={onState} />
        </Suspense>
      ) : (
        <ExploreFilters onState={onState} />
      )}
    </section>
  );
}
