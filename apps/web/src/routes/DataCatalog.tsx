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

export function Component(): ReactElement {
  const { state, retry } = useLatestRun();
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<ReadonlyMap<string, TableResult> | null>(null);
  const run = state.kind === "ready" ? state.run : null;

  useEffect(() => {
    if (run === null) return;
    const controller = new AbortController();
    setResults(null);
    const tables = catalogTables(run.manifest);
    const done = new Map<string, TableResult>();
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < tables.length && !controller.signal.aborted) {
        const table = tables[next++] as CatalogTable;
        done.set(table.table, await readTable(table, run, controller.signal));
      }
    };
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, tables.length) }, worker)).then(() => {
      if (!controller.signal.aborted) setResults(new Map(done));
    });
    return () => controller.abort();
  }, [run, attempt]);

  const retryAll = useCallback(() => {
    retry();
    setAttempt((n) => n + 1);
  }, [retry]);

  const tables = run === null ? [] : catalogTables(run.manifest);
  const failures =
    results === null
      ? []
      : [...results.values()].flatMap((r) => (r.kind === "fail" ? [r.reason] : []));
  const allFailed = results !== null && tables.length > 0 && failures.length === tables.length;
  let unavailable: string | null = null;
  if (state.kind === "error") unavailable = state.error.reason;
  else if (allFailed) unavailable = failures[0] ?? "the Parquet footers could not be read";
  const pageState = unavailable !== null ? "error" : results === null ? "loading" : "ready";

  return (
    <section
      aria-label="Data · Catalog"
      data-route="data-catalog"
      data-state={pageState}
      className={runsStyles.page}
    >
      <h2 className={runsStyles.title}>Data · Catalog</h2>
      {pageState === "loading" ? (
        <>
          <LinearProgress
            label={PROGRESS_LABELS.runs}
            stageText={
              state.kind === "loading" ? RUN_STAGE_TEXTS[state.stage] : "Reading the table footers"
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
      {pageState === "ready" && run !== null && results !== null ? (
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
          {tables.length === 0 ? (
            <StatusPill status="unavailable" text="no published table in this run's manifest" />
          ) : (
            <div className={styles.tables}>
              {tables.map((table) => (
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
        <div>
          Size{" "}
          <span data-size="" data-value={table.size}>
            {formatCount(table.size)} bytes
          </span>{" "}
          in {table.parts.length} {table.parts.length === 1 ? "file" : "files"}
        </div>
        {result?.kind === "ok" ? (
          <div>
            <span data-rows="" data-value={result.rows}>
              {formatCount(result.rows)}
            </span>{" "}
            rows in the published file
          </div>
        ) : null}
        {published.map((row) => (
          <div
            key={row.key}
            data-published-rows=""
            data-coverage-key={row.key}
            data-value={row.count}
          >
            published_rows · {row.label === row.key ? row.key : row.label}:{" "}
            <span data-count={row.count}>{formatCount(row.count)}</span>
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
      {result === undefined || result.kind === "fail" ? (
        <StatusPill
          status="unavailable"
          text={`columns unavailable · ${result?.kind === "fail" ? result.reason : "not read"}`}
        />
      ) : (
        <details>
          <summary className={styles.columnsSummary}>{result.columns.length} columns</summary>
          <ul className={styles.columns}>
            {result.columns.map((column) => (
              <li key={column.name} data-column="" data-name={column.name} data-type={column.type}>
                <span>{column.name}</span>
                <span className={styles.columnType}>{column.type}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
