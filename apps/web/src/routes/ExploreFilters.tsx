// Explore · Filters (A-13 T025/T027/T031; AC-4, AC-5, AC-7, AC-8, FR-004, FR-004a/b, FR-005,
// FR-006a, FR-007, FR-008, FR-015, FR-022; research R1). The run comes from `runs/index.json`
// (its latest manifest CID binds the search); every search is `explore.search` on the server
// through packages/api-client, 250 ms after the last control change (URL first, `replace`, no
// reload). The page shows the gazetteer label of the place, the header "{n} within {r} mi of
// {place} · roof ≥ {years} yrs" for the search that answered, "tenure unknown: {n}" with the
// tenure filter, the result cards (ResultRow) or, with zero results, the empty line and Close
// matches with "+{miles_outside} mi", the engine line, and the Property drawer for `sel`. Not a
// route module: Explore.tsx mounts it.
import type { ExploreResult, ExploreRow } from "@countylens/query-core/explore";
import { resolvePlace, searchPlaces, type ResolvedPlace } from "@countylens/query-core/places";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { keepPreviousData, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@countylens/api-client/react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router";
import { ErrorBanner } from "../components/ErrorBanner";
import { FilterSheet, type FilterKey, type FilterPatch } from "../components/FilterSheet";
import { Icon } from "../components/Icon";
import { LinearProgress } from "../components/LinearProgress";
import { ResultRow } from "../components/ResultRow";
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

/** What "Load more" has fetched for one request: the extra pages' rows and the last page fetched. */
interface MoreRows {
  readonly key: string;
  readonly rows: readonly ExploreRow[];
  readonly page: number;
  readonly busy: boolean;
  readonly failed: boolean;
}
const NO_MORE: MoreRows = { key: "", rows: [], page: 0, busy: false, failed: false };

function isBadRequest(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { data?: { code?: unknown } }).data?.code === "BAD_REQUEST"
  );
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
  const queryClient = useQueryClient();
  const search = useQuery({
    ...trpc.explore.search.queryOptions(debounced?.request ?? skipToken),
    placeholderData: keepPreviousData,
  });

  // The header describes the search that answered, with the place name built into that request.
  const answered = useRef<AskedSearch | null>(null);
  if (search.isSuccess && !search.isPlaceholderData && debounced !== null) {
    answered.current = debounced;
  }
  const answeredKey = answered.current === null ? "" : JSON.stringify(answered.current.request);
  const [moreState, setMore] = useState<MoreRows>(NO_MORE);
  const more = moreState.key === answeredKey ? moreState : NO_MORE;
  const loadMore = async (): Promise<void> => {
    const current = answered.current;
    if (current === null || more.busy) return;
    const key = answeredKey;
    const page = more.page + 1;
    setMore({ ...more, key, busy: true, failed: false });
    try {
      const next = await queryClient.fetchQuery(
        trpc.explore.search.queryOptions({ ...current.request, page }),
      );
      setMore((prev) => {
        if (prev.key !== key) return prev;
        const seen = new Set(prev.rows.map((r) => r.property_cid));
        return {
          key,
          page,
          busy: false,
          failed: false,
          rows: [...prev.rows, ...next.rows.filter((r) => !seen.has(r.property_cid))],
        };
      });
    } catch {
      setMore((prev) => (prev.key === key ? { ...prev, busy: false, failed: true } : prev));
    }
  };

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
  const extraRows = more.rows.filter(
    (r) => !(data?.rows ?? []).some((d) => d.property_cid === r.property_cid),
  );
  const all: readonly ExploreRow[] = data
    ? [...data.rows, ...extraRows, ...data.close_matches.map((c) => c.row)]
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
        />
      </div>
      <div className={styles.results}>
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
            message={
              isBadRequest(search.error) ? EXPLORE_TEXTS.filtersOutOfRange : search.error.message
            }
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
            data={data}
            header={headerText(
              data.total_within_r,
              answered.current.request,
              answered.current.name,
            )}
            request={answered.current.request}
            more={more}
            extraRows={extraRows}
            onLoadMore={() => void loadMore()}
            onSelect={select}
            selected={query.sel}
          />
        ) : null}
      </div>
    </div>
  );
}

function Results({
  data,
  header,
  request,
  more,
  extraRows,
  onLoadMore,
  onSelect,
  selected,
}: {
  readonly data: ExploreResult;
  readonly header: string;
  readonly request: ExploreSearchRequest;
  readonly more: MoreRows;
  readonly extraRows: readonly ExploreRow[];
  readonly onLoadMore: () => void;
  readonly onSelect: (cid: string) => void;
  readonly selected: string | null;
}): ReactElement {
  const zero = data.total_within_r === 0;
  const showTenureUnknown = request.tenure !== undefined;
  // AC-5 / D-9: with the open-or-stalled filter active and no rows, say so in the fixed words.
  const permitFilter = request.permit !== undefined;
  const shown = data.rows.length + extraRows.length;
  return (
    <>
      <p className={styles.header} data-explore-header="" aria-live="polite">
        {header}
      </p>
      {showTenureUnknown ? (
        <p className={styles.engine} data-tenure-unknown="">
          {EXPLORE_TEXTS.tenureUnknownCount(data.tenure_unknown)}
        </p>
      ) : null}
      {zero ? (
        <>
          {permitFilter ? <p className={styles.empty}>{EXPLORE_TEXTS.noOpenPermits}</p> : null}
          <p className={styles.empty}>
            {EXPLORE_TEXTS.zeroResults(request.radius_mi, data.close_matches.length)}
          </p>
          {data.close_matches.length === 0 ? null : (
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
          )}
        </>
      ) : (
        <>
          <ul className={styles.list} aria-label="Results">
            {[...data.rows, ...extraRows].map((row) => (
              <li key={row.property_cid} className={styles.item}>
                <ResultRow row={row} onSelect={onSelect} selected={selected === row.property_cid} />
              </li>
            ))}
          </ul>
          <div className={styles.engine} data-showing="" aria-live="polite">
            {data.total_within_r > shown
              ? EXPLORE_TEXTS.showingFirst(shown, data.total_within_r)
              : more.page > 0
                ? EXPLORE_TEXTS.showingAll(data.total_within_r)
                : null}
          </div>
          {more.failed ? <ErrorBanner message={EXPLORE_TEXTS.loadMoreFailed} /> : null}
          {data.total_within_r > shown ? (
            <div>
              <button
                type="button"
                className={styles.run}
                disabled={more.busy}
                onClick={onLoadMore}
              >
                {EXPLORE_TEXTS.loadMore}
              </button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
