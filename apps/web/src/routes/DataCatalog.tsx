// Data · Catalog (`/data/catalog`; A-13 T037, US8, AC-10, FR-010, FR-019, FR-024): one card per
// table of the latest manifest's artifacts. Columns and "rows in the published file" come from the
// Parquet footers (hyparquet, read by HTTP Range from the host that served the manifest; this
// route chunk is the only importer of it), `published_rows` from a coverage key that maps to the
// table, and each part's CID links to Verify. While the manifest lists no tables-export.json the
// page says so. When the manifest or every footer is unreachable the page says "Catalog
// unavailable · {reason}" with a link to the manifest page: never a cached or sample list.
// A react-router lazy route module exporting `Component`.
import type { RunManifestV1 } from "@countylens/contract";
import { PROGRESS_LABELS } from "@countylens/shared";
import { PAGE_TEXTS } from "@countylens/shared/texts";
import { ROUTES, verifyPath } from "@countylens/shared/routes";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { DataTabs } from "../components/DataTabs";
import { ErrorBanner } from "../components/ErrorBanner";
import { FallbackChip } from "../components/FallbackChip";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { truncateCid } from "../components/CidDisplay";
import { coverageRows, type CoverageRow } from "../data/coverage-rows";
import { formatCount } from "../data/format";
import {
  catalogTables,
  readTableMeta,
  type CatalogTable,
  type ParquetColumn,
} from "../data/parquet-meta";
import type { LoadedRun } from "../data/run-loader";
import { COVERAGE_KINDS } from "./Coverage.kinds";
import { kindOf } from "./Coverage.kinds";
import { RUN_STAGE_TEXTS, useLatestRun } from "./Runs.shared";
import runsStyles from "./Runs.module.css";
import styles from "./DataCatalog.module.css";

const TABLES_EXPORT = "tables-export.json";
const CONCURRENCY = 2;
/** Shown on a row until its own Parquet footer has been read. */
const FOOTER_PENDING = "reading the Parquet footer…";

type TableResult =
  | { readonly kind: "ok"; readonly columns: readonly ParquetColumn[]; readonly rows: number }
  | { readonly kind: "fail"; readonly reason: string };

function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text === "" ? "the Parquet footer could not be read" : text;
}

async function readTable(
  table: CatalogTable,
  run: LoadedRun,
  signal: AbortSignal,
): Promise<TableResult> {
  try {
    const meta = await readTableMeta(
      table.parts.map((part) => ({ name: part.name, cid: part.cid, size: part.size })),
      (part) => run.read.partUrl({ name: part.name, cid: part.cid }),
      { signal },
    );
    return { kind: "ok", columns: meta.columns, rows: meta.rows };
  } catch (error) {
    return { kind: "fail", reason: reasonOf(error) };
  }
}

/** Coverage rows of `published_rows` derivation whose record kind is published in `table`. */
function publishedRowsFor(table: CatalogTable, manifest: RunManifestV1): CoverageRow[] {
  const path = table.table.replace(".", "/");
  const kinds = COVERAGE_KINDS.filter((kind) => kind.table === path).map((k) => k.id);
  return coverageRows(manifest).filter(
    (row) => row.derivation === "published_rows" && kinds.includes(kindOf(row.key).id),
  );
}

/** A13-7: why a part is not under a table row (missing data says why). */
const UNCLASSIFIED_REASON =
  "Their export batch has no known data group, so they are not listed as a table; each is still in the run manifest.";

/** Parquet table parts of the manifest that no catalog row lists (their batch group is unknown). */
function unclassifiedParts(manifest: RunManifestV1, tables: readonly CatalogTable[]): number {
  const listed = new Set(tables.flatMap((t) => t.parts.map((p) => p.name)));
  return manifest.artifacts.filter(
    (a) => a.kind === "table" && a.name.endsWith(".parquet") && !listed.has(a.name),
  ).length;
}

export function Component(): ReactElement {
  const { state, retry } = useLatestRun();
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<ReadonlyMap<string, TableResult>>(new Map());
  const run = state.kind === "ready" ? state.run : null;

  // Each table's footer fills in on arrival (pending → ok | fail); the list paints before any read.
  useEffect(() => {
    if (run === null) return;
    const controller = new AbortController();
    setResults(new Map());
    const tables = catalogTables(run.manifest);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < tables.length && !controller.signal.aborted) {
        const table = tables[next++] as CatalogTable;
        const result = await readTable(table, run, controller.signal);
        if (controller.signal.aborted) return;
        setResults((previous) => new Map(previous).set(table.table, result));
      }
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, tables.length) }, worker));
    return () => controller.abort();
  }, [run, attempt]);

  const retryAll = useCallback(() => {
    retry();
    setAttempt((n) => n + 1);
  }, [retry]);

  const tables = run === null ? [] : catalogTables(run.manifest);
  const unclassified = run === null ? 0 : unclassifiedParts(run.manifest, tables);
  const [find, setFind] = useState("");
  const needle = find.trim().toLowerCase();
  const shownTables =
    needle === ""
      ? tables
      : tables.filter((t) => {
          if (t.table.toLowerCase().includes(needle)) return true;
          const r = results.get(t.table);
          return r?.kind === "ok" && r.columns.some((c) => c.name.toLowerCase().includes(needle));
        });
  const failures = [...results.values()].flatMap((r) => (r.kind === "fail" ? [r.reason] : []));
  const allFailed = tables.length > 0 && failures.length === tables.length;
  let unavailable: string | null = null;
  if (state.kind === "error") unavailable = state.error.reason;
  else if (allFailed) unavailable = failures[0] ?? "the Parquet footers could not be read";
  const pageState = unavailable !== null ? "error" : run === null ? "loading" : "ready";

  return (
    <section
      aria-label="Data · Catalog"
      data-route="data-catalog"
      data-state={pageState}
      className={runsStyles.page}
    >
      <h2 className={runsStyles.title}>Data · Catalog</h2>
      <DataTabs current="catalog" verifyCid={run === null ? null : run.manifestCid} />
      {pageState === "loading" ? (
        <>
          <LinearProgress
            label={PROGRESS_LABELS.runs}
            stageText={
              state.kind === "loading" ? RUN_STAGE_TEXTS[state.stage] : "Reading the run manifest"
            }
          />
          <Skeleton variant="cards" count={3} />
        </>
      ) : null}
      {unavailable !== null ? (
        <ErrorBanner
          message={
            <>
              <span data-error-text="">{PAGE_TEXTS.catalogUnavailable(unavailable)}</span>{" "}
              <Link to={ROUTES.dataManifest}>Run manifest</Link>
            </>
          }
          onRetry={retryAll}
        />
      ) : null}
      {pageState === "ready" && run !== null ? (
        <>
          <div className={runsStyles.header}>
            <span className={runsStyles.itemBody}>Run {run.manifest.runId}</span>
            <FallbackChip source={run.read.source} />
          </div>
          {run.manifest.artifacts.some((a) => a.name === TABLES_EXPORT) ? null : (
            <p className={runsStyles.itemBody} data-export-notice="">
              {PAGE_TEXTS.tableExportMissing}
            </p>
          )}
          {unclassified > 0 ? (
            <p className={runsStyles.itemBody} data-unclassified-parts={unclassified}>
              <StatusPill
                status="unavailable"
                text={`unclassified table parts (${unclassified})`}
              />{" "}
              {UNCLASSIFIED_REASON}
            </p>
          ) : null}
          <div className={styles.searchRow}>
            <label className={styles.searchLabel} htmlFor="catalog-find">
              Find a table or field
            </label>
            <input
              id="catalog-find"
              className={styles.search}
              type="search"
              placeholder="e.g. property, roof_age_years"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
            <Link className={styles.exploreLink} to={ROUTES.explore}>
              Search in Explore
            </Link>
          </div>
          <p className={runsStyles.itemBody} data-views-note="">
            In MCP use the views (v_property, v_roofing_permit, v_contractor, v_run); these are the
            published tables they read.
          </p>
          {shownTables.length === 0 && tables.length > 0 ? (
            <p className={runsStyles.itemBody} role="status">
              No table or field matches “{find.trim()}”.
            </p>
          ) : null}
          {tables.length === 0 ? (
            <StatusPill status="unavailable" text="no published table in this run's manifest" />
          ) : (
            <div className={styles.tables}>
              {shownTables.map((table) => (
                <TableCard
                  key={table.table}
                  table={table}
                  result={results.get(table.table)}
                  published={publishedRowsFor(table, run.manifest)}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function TableCard({
  table,
  result,
  published,
}: {
  readonly table: CatalogTable;
  readonly result: TableResult | undefined;
  readonly published: readonly CoverageRow[];
}): ReactElement {
  const titleId = `table-${table.table}`;
  return (
    <article
      className={styles.table}
      aria-labelledby={titleId}
      data-table={table.table}
      data-catalog-row={`tables/${table.table.replace(".", "/")}`}
    >
      <h3 id={titleId} className={styles.name}>
        {table.table}
      </h3>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Size</dt>
          <dd>
            <span data-size="" data-value={table.size}>
              {formatCount(table.size)} bytes
            </span>{" "}
            in {table.parts.length} {table.parts.length === 1 ? "file" : "files"}
          </dd>
        </div>
        {result?.kind === "ok" ? (
          <div className={styles.fact}>
            <dt>Rows</dt>
            <dd>
              <span data-rows="" data-value={result.rows}>
                {formatCount(result.rows)}
              </span>{" "}
              rows in the published file
            </dd>
          </div>
        ) : result === undefined ? (
          <div className={styles.fact}>
            <dt>Rows</dt>
            <dd data-footer-status="pending">rows in the published file: {FOOTER_PENDING}</dd>
          </div>
        ) : null}
        {published.map((row) => (
          <div
            key={row.key}
            className={styles.fact}
            data-published-rows=""
            data-coverage-key={row.key}
            data-value={row.count}
          >
            <dt>published_rows · {row.label === row.key ? row.key : row.label}</dt>
            <dd data-count={row.count}>{formatCount(row.count)}</dd>
          </div>
        ))}
      </dl>
      <ul className={styles.parts} aria-label="Files">
        {table.parts.map((part) => (
          <li key={part.cid}>
            <Link to={verifyPath(part.cid)} className={styles.link} data-cid={part.cid}>
              {truncateCid(part.cid)}
            </Link>
          </li>
        ))}
      </ul>
      <div className={styles.columnsSlot} data-columns-slot="">
        {result === undefined ? (
          <p className={styles.pending} data-footer-status="pending">
            columns: {FOOTER_PENDING}
          </p>
        ) : result.kind === "fail" ? (
          <StatusPill status="unavailable" text={`columns unavailable · ${result.reason}`} />
        ) : (
          <details>
            <summary className={styles.columnsSummary}>{result.columns.length} columns</summary>
            <table className={styles.fieldTable} aria-label={`Fields of ${table.table}`}>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Type</th>
                </tr>
              </thead>
              <tbody>
                {result.columns.map((column) => (
                  <tr
                    key={column.name}
                    data-column=""
                    data-name={column.name}
                    data-type={column.type}
                  >
                    <td>{column.name}</td>
                    <td className={styles.columnType}>{column.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    </article>
  );
}
