// Explore · Filters (A-13 T025/T027/T031; AC-4, AC-5, AC-7, AC-8, FR-004, FR-004a/b, FR-005,
// FR-006a, FR-007, FR-008, FR-015, FR-022; research R1). The run comes from `runs/index.json`
// (its latest manifest CID binds the search); every search is `explore.search` on the server
// through packages/api-client, 250 ms after the last control change (URL first, `replace`, no
// reload). The page shows the gazetteer label of the place, the header "{n} within {r} mi of
// {place} · roof ≥ {years} yrs" for the search that answered, "tenure unknown: {n}" with the
// tenure filter, the result cards (ResultRow) or, with zero results, the empty line and Close
// matches with "+{miles_outside} mi", the engine line, and the Property drawer for `sel`. A-16
// T050 (Explore1440/768/390 boards): Matches / Close tabs, the results table from 840 px (cards
// below), a pager over the server's pages instead of "Load more", "{n} properties match" in the
// filter panel and the first-visit "What can I ask?" card. Not a route module: Explore.tsx
// mounts it.
import type { ExploreResult, ExploreRow } from "@countylens/query-core/explore";
import { resolvePlace, searchPlaces, type ResolvedPlace } from "@countylens/query-core/places";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@countylens/api-client/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { useSearchParams } from "react-router";
import { ErrorBanner } from "../components/ErrorBanner";
import { FilterSheet, type FilterKey, type FilterPatch } from "../components/FilterSheet";
import { Icon } from "../components/Icon";
import { LinearProgress } from "../components/LinearProgress";
import { ResultRow } from "../components/ResultRow";
import { ResultTable } from "../components/ResultTable";
import { WelcomeCard } from "../components/WelcomeCard";
import { Skeleton } from "../components/Skeleton";
import { RunIndexError, latestRun, loadRunsIndex, runIndexText } from "../data/runs-index";
import {
  DEFAULT_RADIUS_MI,
  SEARCH_DEBOUNCE_MS,
  isOpenOrStalled,
  parseExploreQuery,
  patchParams,
  searchRequest,
  type ExploreQuery,
  type ExploreSearchRequest,
} from "./ExploreFilters.state";
import { PropertyDrawer } from "./PropertyDrawer";
import { runErrorNode, type RunLoadError } from "./Runs.shared";
import styles from "./Explore.module.css";

export type ExplorePageState = "loading" | "ready" | "error";

/** Shown when the place text is not a Travis County gazetteer entry. */
const PLACE_NOT_FOUND = "Not a Travis County place or ZIP in the Census gazetteer";
const SUGGESTION_LIMIT = 8;
const SEARCHING = "Searching";
const LSAD = /\s+(city|town|village|CDP)$/;

type IndexState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly manifestCid: string }
  | { readonly kind: "error"; readonly error: RunLoadError };

function useBoundRun(): IndexState {
  const [state, setState] = useState<IndexState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    loadRunsIndex({ signal: controller.signal }).then(
      (index) => {
        if (!controller.signal.aborted)
          setState({ kind: "ready", manifestCid: latestRun(index).manifestCid });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const reason = error instanceof RunIndexError ? runIndexText(error.reason) : String(error);
        setState({ kind: "error", error: { kind: "index", reason } });
      },
    );
    return () => controller.abort();
  }, []);
  return state;
}

function useDebounced<T>(value: T, ms: number): T {
  const key = JSON.stringify(value);
  const [settled, setSettled] = useState(value);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const timer = setTimeout(() => setSettled(latest.current), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);
  return settled;
}

/** The place as the header names it: the gazetteer name without its LSAD word, or the point. */
function areaName(query: ExploreQuery): string {
  if (query.place === null) return query.at === null ? "" : `${query.at.lat}, ${query.at.lon}`;
  const place = resolvePlace(query.place);
  return place.status === "found" ? place.name.replace(LSAD, "") : query.place;
}

/** Typing suggestions: prefix matches; a full name or GEOID that is not a prefix still resolves. */
function suggestPlaces(text: string): readonly ResolvedPlace[] {
  const found = searchPlaces(text, SUGGESTION_LIMIT);
  if (found.length > 0) return found;
  const exact = resolvePlace(text);
  return exact.status === "found" ? [exact] : [];
}

function headerText(n: number, request: ExploreSearchRequest, name: string): string {
  return request.roof === undefined
    ? EXPLORE_TEXTS.headerNoRoof(n, request.radius_mi, name)
    : EXPLORE_TEXTS.header(n, request.radius_mi, name, request.roof);
}

/** A search request with the place name it was built for, so a header never borrows a newer URL's name. */
interface AskedSearch {
  readonly request: ExploreSearchRequest;
  readonly name: string;
}

/** The Explore1440 board's data table from this width; cards below. */
export const RESULTS_TABLE_QUERY = "(min-width: 840px)";

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** "Showing {first}–{last} of {total}" under the results (board pager). */
export const showingText = (first: number, last: number, total: number): string =>
  `Showing ${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;

function isBadRequest(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { data?: { code?: unknown } }).data?.code === "BAD_REQUEST"
  );
}

/**
 * A-16 AC-13 (frozen interfaces "Index errors"): explore.search answers PRECONDITION_FAILED with a
 * message ending "(index_not_built)" or "(index_stale)" when the run's Explore index cannot be
 * read. The banner says what that means and what still works, never a raw server message.
 */
export const INDEX_ERROR_TEXTS = Object.freeze({
  index_not_built:
    "The search index for this run is not built yet, so Filters cannot search it. The run's published files and the Data pages still work.",
  index_stale:
    "The search index for this run is out of date (built from other view definitions), so Filters cannot search it. The run's published files and the Data pages still work.",
});

/** The banner text of a failed explore.search: index, out-of-range or the server's message. */
export function exploreErrorText(error: unknown): string {
  if (isBadRequest(error)) return EXPLORE_TEXTS.filtersOutOfRange;
  const message = error instanceof Error ? error.message : String(error);
  const code = /\((index_not_built|index_stale)\)\s*$/.exec(message)?.[1];
  if (code === "index_not_built" || code === "index_stale") return INDEX_ERROR_TEXTS[code];
  return message;
}

/** explore.search's notice when `ooa` was asked on a run that publishes no owner area (G4). */
function ownerAreaNotice(data: unknown): string | null {
  const notice = (data as { owner_area?: { status?: unknown; message?: unknown } } | undefined)
    ?.owner_area;
  return notice?.status === "not_published" && typeof notice.message === "string"
    ? notice.message
    : null;
}

export function ExploreFilters({
  onState,
}: {
  readonly onState: (state: ExplorePageState) => void;
}): ReactElement {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseExploreQuery(params), [params]);
  const bound = useBoundRun();
  const place = query.place === null ? null : resolvePlace(query.place);
  const placeOk = place === null || place.status === "found";
  const asked: AskedSearch | null =
    bound.kind === "ready" && placeOk
      ? { request: searchRequest(query, bound.manifestCid), name: areaName(query) }
      : null;
  const debounced = useDebounced(asked, SEARCH_DEBOUNCE_MS);
  const trpc = useTRPC();
  const search = useQuery({
    ...trpc.explore.search.queryOptions(debounced?.request ?? skipToken),
    // No automatic retry: a search the server could not finish already took up to 29 s, and a second
    // attempt would double the wait before the error shows (the page offers its own retry).
    retry: false,
    placeholderData: keepPreviousData,
  });

  // The header describes the search that answered, with the place name built into that request.
  const answered = useRef<AskedSearch | null>(null);
  if (search.isSuccess && !search.isPlaceholderData && debounced !== null) {
    answered.current = debounced;
  }
  const answeredKey = answered.current === null ? "" : JSON.stringify(answered.current.request);
  // The pager: page 0 is the main search; a later page is its own explore.search call.
  const [pager, setPager] = useState<{ key: string; page: number }>({ key: "", page: 0 });
  const page = pager.key === answeredKey ? pager.page : 0;
  const pageSearch = useQuery({
    ...trpc.explore.search.queryOptions(
      page > 0 && answered.current !== null ? { ...answered.current.request, page } : skipToken,
    ),
    retry: false,
  });
  const goTo = (next: number): void => setPager({ key: answeredKey, page: next });

  const pageState: ExplorePageState =
    bound.kind === "error" || search.isError
      ? "error"
      : bound.kind === "loading" || (asked !== null && search.data === undefined)
        ? "loading"
        : "ready";
  useEffect(() => onState(pageState), [pageState, onState]);

  const patch = (values: FilterPatch, replace = true): void => {
    setParams((current) => patchParams(current, values), { replace });
  };
  const value = (key: FilterKey): string => {
    if (key === "r") return params.get("r") ?? String(DEFAULT_RADIUS_MI);
    if (key === "sort") return query.sort;
    if (key === "place") return query.place ?? "";
    return params.get(key) ?? "";
  };

  const data: ExploreResult | undefined = search.data;
  const pageRows: readonly ExploreRow[] =
    page === 0 ? (data?.rows ?? []) : (pageSearch.data?.rows ?? []);
  const all: readonly ExploreRow[] = data
    ? [...pageRows, ...data.close_matches.map((c) => c.row)]
    : [];
  const selected = query.sel === null ? undefined : all.find((r) => r.property_cid === query.sel);
  // A `sel` that the answered results do not hold is said so, never silently ignored.
  const selMissing =
    query.sel !== null &&
    selected === undefined &&
    data !== undefined &&
    answered.current !== null &&
    !search.isPlaceholderData;
  const select = (cid: string): void => patch({ sel: cid }, false);

  return (
    <div className={styles.layout}>
      <div className={styles.filters}>
        <FilterSheet
          value={value}
          openOrStalled={isOpenOrStalled(query.permit)}
          ooa={query.ooa}
          onPatch={(v) => patch(v)}
          suggest={suggestPlaces}
          notFoundText={PLACE_NOT_FOUND}
          matchCount={data === undefined ? null : data.total_within_r}
        />
      </div>
      <div className={styles.results}>
        <WelcomeCard />
        <p className={styles.area} data-area="">
          {place === null ? (
            query.at === null ? null : (
              `Point ${query.at.lat}, ${query.at.lon}`
            )
          ) : place.status === "found" ? (
            place.label
          ) : (
            <span role="alert">{PLACE_NOT_FOUND}</span>
          )}
        </p>
        <p className={styles.engine} data-engine-line="">
          <Icon name="memory" size="small" />
          <span>{EXPLORE_TEXTS.engineServer}</span>
        </p>
        {bound.kind === "error" ? <ErrorBanner message={runErrorNode(bound.error)} /> : null}
        {search.isFetching ? <LinearProgress label={SEARCHING} stageText={SEARCHING} /> : null}
        {search.isError ? (
          <ErrorBanner
            message={exploreErrorText(search.error)}
            onRetry={() => void search.refetch()}
          />
        ) : null}
        {data === undefined && pageState === "loading" ? (
          <Skeleton variant="cards" count={3} />
        ) : null}
        {selMissing ? (
          <p className={styles.engine} role="status" data-sel-missing="">
            {EXPLORE_TEXTS.propertyNotInResults}
          </p>
        ) : null}
        {selected === undefined ? null : (
          <PropertyDrawer row={selected} onClose={() => patch({ sel: null }, false)} />
        )}
        {data !== undefined && answered.current !== null ? (
          <Results
            key={answeredKey}
            data={data}
            header={headerText(
              data.total_within_r,
              answered.current.request,
              answered.current.name,
            )}
            request={answered.current.request}
            page={page}
            pageRows={pageRows}
            pageState={
              page === 0
                ? "ready"
                : pageSearch.isError
                  ? "error"
                  : pageSearch.data
                    ? "ready"
                    : "loading"
            }
            onPage={goTo}
            onSelect={select}
            selected={query.sel}
          />
        ) : null}
      </div>
    </div>
  );
}

type ResultsTab = "matches" | "close";

function Results({
  data,
  header,
  request,
  page,
  pageRows,
  pageState,
  onPage,
  onSelect,
  selected,
}: {
  readonly data: ExploreResult;
  readonly header: string;
  readonly request: ExploreSearchRequest;
  readonly page: number;
  readonly pageRows: readonly ExploreRow[];
  readonly pageState: "loading" | "ready" | "error";
  readonly onPage: (page: number) => void;
  readonly onSelect: (cid: string) => void;
  readonly selected: string | null;
}): ReactElement {
  const zero = data.total_within_r === 0;
  const table = useMediaQuery(RESULTS_TABLE_QUERY);
  const [chosen, setChosen] = useState<ResultsTab | null>(null);
  // With no match the Close tab opens (the board's "Close 3"); a choice sticks until the next search.
  const tab: ResultsTab = chosen ?? (zero ? "close" : "matches");
  const showTenureUnknown = request.tenure !== undefined;
  // AC-5 / D-9: with the open-or-stalled filter active and no rows, say so in the fixed words.
  const permitFilter = request.permit !== undefined;
  const pageSize = data.rows.length;
  const first = page * pageSize + 1;
  const last = Math.min(data.total_within_r, page * pageSize + pageRows.length);
  const pages = pageSize === 0 ? 1 : Math.ceil(data.total_within_r / pageSize);
  const tabs: readonly { readonly id: ResultsTab; readonly label: string; readonly n: number }[] = [
    { id: "matches", label: "Matches", n: data.total_within_r },
    { id: "close", label: "Close", n: data.close_matches.length },
  ];
  return (
    <>
      <p className={styles.header} data-explore-header="" aria-live="polite">
        {header}
      </p>
      {request.ooa === true && ownerAreaNotice(data) !== null ? (
        <p className={styles.empty} role="status" data-owner-area-notice="">
          Out-of-area owner: {ownerAreaNotice(data)}. That is why this filter finds no properties
          here; it does not mean every owner lives in Travis County.
        </p>
      ) : null}
      {showTenureUnknown ? (
        <p className={styles.engine} data-tenure-unknown="">
          {EXPLORE_TEXTS.tenureUnknownCount(data.tenure_unknown)}
        </p>
      ) : null}
      {/* Toggle buttons, not tabs: the A-13 contract (TC-073 scan, a13-vitals) reads the page's
          tabs as the three Explore modes only, and SQL mode unmounts this view. */}
      <div role="group" aria-label="Results view" className={styles.resultTabs}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            className={`${styles.resultTab} ${tab === t.id ? styles.resultTabOn : ""}`}
            onClick={() => setChosen(t.id)}
          >
            {t.label} <span className={styles.tabCount}>{t.n.toLocaleString("en-US")}</span>
          </button>
        ))}
      </div>
      {zero ? (
        <>
          {permitFilter ? <p className={styles.empty}>{EXPLORE_TEXTS.noOpenPermits}</p> : null}
          <p className={styles.empty}>
            {EXPLORE_TEXTS.zeroResults(request.radius_mi, data.close_matches.length)}
          </p>
        </>
      ) : null}
      {tab === "close" ? (
        data.close_matches.length === 0 ? (
          <p className={styles.engine}>No close matches just outside {request.radius_mi} mi.</p>
        ) : (
          <ul className={styles.list} aria-label="Close matches">
            {data.close_matches.map((match) => (
              <li key={match.row.property_cid} className={styles.item} data-close-match="">
                <span
                  className={styles.outside}
                  data-miles-outside=""
                  data-value={match.miles_outside}
                >
                  {EXPLORE_TEXTS.milesOutside(match.miles_outside)}
                </span>
                <ResultRow
                  row={match.row}
                  inRadius={false}
                  onSelect={onSelect}
                  selected={selected === match.row.property_cid}
                />
              </li>
            ))}
          </ul>
        )
      ) : zero ? null : (
        <>
          {pageState === "loading" ? <Skeleton variant="cards" count={3} /> : null}
          {pageState === "error" ? (
            <ErrorBanner message={EXPLORE_TEXTS.loadMoreFailed} onRetry={() => onPage(page)} />
          ) : null}
          {pageState !== "ready" ? null : table ? (
            <ResultTable rows={pageRows} first={first} onSelect={onSelect} selected={selected} />
          ) : (
            <ul className={styles.list} aria-label="Results">
              {pageRows.map((row) => (
                <li key={row.property_cid} className={styles.item}>
                  <ResultRow
                    row={row}
                    onSelect={onSelect}
                    selected={selected === row.property_cid}
                  />
                </li>
              ))}
            </ul>
          )}
          <nav className={styles.pager} aria-label="Result pages">
            <span className={styles.engine} data-showing="" aria-live="polite">
              {pageState === "ready" && pageRows.length > 0
                ? showingText(first, last, data.total_within_r)
                : null}
            </span>
            <button
              type="button"
              className={styles.pageButton}
              aria-label="Previous page"
              disabled={page <= 0}
              onClick={() => onPage(page - 1)}
            >
              <Icon name="chevron_left" />
            </button>
            <span className={styles.pageNumber} aria-current="page">
              {page + 1}
            </span>
            <button
              type="button"
              className={styles.pageButton}
              aria-label="Next page"
              disabled={page >= pages - 1}
              onClick={() => onPage(page + 1)}
            >
              <Icon name="chevron_right" />
            </button>
          </nav>
        </>
      )}
    </>
  );
}
