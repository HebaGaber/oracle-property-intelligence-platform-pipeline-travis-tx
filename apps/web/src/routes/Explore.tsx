// Explore (`/tx/travis/explore`; A-13 T025/T029; contracts/ui-routes.md). Two tabs: Filters
// (server-side `explore.search`, ExploreFilters) and AI (`?mode=ai`, A-14: `agent.ask` through
// ExploreAi, a lazy chunk). The SQL tab was removed by PO decision (A-16, 2026-10-26): an old
// `?mode=sql` link is replaced by Filters (the `mode` parameter is dropped). The page is always
// the List view (`data-view="list"`; `view=map` falls back to it, FR-004a) and reports
// `data-state` loading | ready | error for the hosted tests. A react-router lazy route module.
import { lazy, Suspense, useCallback, useEffect, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router";
import { ComingSoonEntries } from "../components/ComingSoonEntry";
import { LinearProgress } from "../components/LinearProgress";
import { SearchBox } from "../components/SearchBox";
import { ExploreFilters, type ExplorePageState } from "./ExploreFilters";
import styles from "./Explore.module.css";

const ExploreAi = lazy(() => import("./ExploreAi").then((m) => ({ default: m.ExploreAi })));

type Mode = "filters" | "ai";
const TAB_LABELS: Readonly<Record<Mode, string>> = { filters: "Filters", ai: "AI" };

const LOADING_AI = "Loading the AI panel";

export function Component(): ReactElement {
  const [params, setParams] = useSearchParams();
  const requested = params.get("mode");
  const mode: Mode = requested === "ai" ? "ai" : "filters";
  // A removed mode (`sql`) or any unknown value: drop it from the URL and show Filters.
  useEffect(() => {
    if (requested === null || requested === "ai" || requested === "filters") return;
    setParams(
      (current) => {
        const p = new URLSearchParams(current);
        p.delete("mode");
        return p;
      },
      { replace: true },
    );
  }, [requested, setParams]);
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
      {/* Explore390/768 boards: the search box on the page below 1024 px (the app bar has it from there). */}
      <SearchBox className={styles.pageSearch} />
      <h2 className={styles.title}>Explore</h2>
      <div role="tablist" aria-label="Explore mode" className={styles.tabs}>
        {(["filters", "ai"] as const).map((tab) => (
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
      {mode === "ai" ? (
        <Suspense fallback={<LinearProgress label={LOADING_AI} stageText={LOADING_AI} />}>
          <ExploreAi onState={onState} />
        </Suspense>
      ) : (
        <ExploreFilters onState={onState} />
      )}
    </section>
  );
}
