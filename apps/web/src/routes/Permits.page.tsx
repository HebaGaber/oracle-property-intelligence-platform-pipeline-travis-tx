// The Permits list page (A-03 T056; plan § "Atlas element map" → Permits list, § States;
// data-model.md § Permits page state). State machine `loading → ready | empty | error`:
// `loading` = linear progress (`Loading permits`, stage text) + skeletons in a role="status"
// aria-busy container; the table (≥ 600 px) or cards (< 600 px) mount only in `ready`, so no
// empty table ever flashes (FR-008); `empty` only when the manifest count and the row count are
// both 0 (TC-029); any other difference is the count-mismatch error (FR-009); an engine failure
// is the fixed engine text. One page ordered by permit_number: no pagination, sorting, sticky
// header or column controls (A-13). Every absent value shows its Missing-reason label; every row
// ends with the § 8 provenance line. Texts come from @countylens/shared, never retyped here.
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Missing } from "@countylens/contract";
import {
  PERMITS_TEXTS,
  PROGRESS_LABELS,
  RUN_INDEX_TEXTS,
  isContractorField,
} from "@countylens/shared";
import { CidDisplay } from "../components/CidDisplay";
import { EmptyState } from "../components/EmptyState";
import { EngineLine } from "../components/EngineLine";
import { ErrorBanner } from "../components/ErrorBanner";
import { LinearProgress } from "../components/LinearProgress";
import { MissingReason } from "../components/MissingReason";
import { Provenance } from "../components/Provenance";
import { Skeleton } from "../components/Skeleton";
import { StatusPill, type StatusKind } from "../components/StatusPill";
import { BothHostsDownError } from "../data/fetch-by-cid";
import { RunIndexError } from "../data/runs-index";
import { EngineStartError, PermitRowsError } from "../engine/errors";
import type { PermitsLoaded, PermitsLoader } from "../engine/load-permits";
import type { PermitListRow } from "../engine/permit-list";
import { STAGE_TEXTS } from "../engine/stages";
import styles from "./Permits.module.css";

export { STAGE_TEXTS };
export type { PermitsLoaded, PermitsLoader };

/** The Atlas compact bound: cards below it, the data table from it (FR-003, NFR-003). */
export const TABLE_MEDIA_QUERY = "(min-width: 600px)";

export type PermitsState =
  | { readonly kind: "loading"; readonly stage: string }
  | { readonly kind: "ready"; readonly data: PermitsLoaded }
  | { readonly kind: "empty"; readonly runId: string; readonly manifestCid: string }
  | { readonly kind: "error"; readonly message: string };

/** FR-008 / FR-009: empty only for a true manifest 0; any other mismatch is the fixed error. */
export function resolvePermitsState(loaded: PermitsLoaded): PermitsState {
  const rows = loaded.rows.length;
  if (rows === 0 && loaded.permitsEmitted === 0) {
    return { kind: "empty", runId: loaded.runId, manifestCid: loaded.manifestCid };
  }
  if (rows !== loaded.permitsEmitted) {
    return { kind: "error", message: PERMITS_TEXTS.countMismatch(rows, loaded.permitsEmitted) };
  }
  return { kind: "ready", data: loaded };
}

/** The banner text of a failed load: the fixed texts where one applies, else the error's own message. */
export function errorText(error: unknown): string {
  if (error instanceof EngineStartError) return PERMITS_TEXTS.engineFailure;
  if (error instanceof PermitRowsError) return PERMITS_TEXTS.rowsUnreadable;
  if (error instanceof RunIndexError) return RUN_INDEX_TEXTS[error.reason];
  if (error instanceof BothHostsDownError) return error.message;
  if (error instanceof Error && error.message !== "") return error.message;
  const text = String(error);
  return text === "" ? "Unknown error" : text;
}

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

const DISPLAYED_FIELDS: ReadonlySet<string> = new Set([
  "permit_number",
  "improvement_status",
  "status_class",
  "issue_date",
  "source_url",
]);

const entriesFor = (row: PermitListRow, field: string): Missing[] =>
  row.missing.filter((m) => m.field === field);
const contractorEntries = (row: PermitListRow): Missing[] =>
  row.missing.filter((m) => isContractorField(m.field));
const otherEntries = (row: PermitListRow): Missing[] =>
  row.missing.filter((m) => !DISPLAYED_FIELDS.has(m.field) && !isContractorField(m.field));

function Reasons({ entries }: { readonly entries: readonly Missing[] }): ReactElement {
  return (
    <>
      {entries.map((m, i) => (
        <MissingReason key={`${i}-${m.field}`} field={m.field} reason={m.reason} />
      ))}
    </>
  );
}

type ValueField = "permit_number" | "improvement_status" | "status_class" | "issue_date";

/** The value of a displayed column, or the Missing-reason label(s) of its `missing` entries. */
function FieldValue({
  row,
  field,
  className,
}: {
  readonly row: PermitListRow;
  readonly field: ValueField;
  readonly className?: string | undefined;
}): ReactElement {
  const value = row[field];
  return (
    <span className={styles.value}>
      {value === null ? null : <span className={className}>{value}</span>}
      <Reasons entries={entriesFor(row, field)} />
    </span>
  );
}

function ContractorCell({ row }: { readonly row: PermitListRow }): ReactElement {
  const status: StatusKind = row.contractor_resolution === "resolved" ? "verified" : "unavailable";
  return (
    <span className={styles.value}>
      <StatusPill status={status} text={row.contractor_resolution} />
      <Reasons entries={contractorEntries(row)} />
    </span>
  );
}

function RowProvenance({ row }: { readonly row: PermitListRow }): ReactElement {
  const sourceUrlMissing = entriesFor(row, "source_url")[0];
  return (
    <Provenance
      sourceUrl={row.source_url}
      {...(sourceUrlMissing === undefined ? {} : { sourceUrlMissing })}
      capturedAt={row.captured_at}
      tableCid={row.table_cid}
      runId={row.run_id}
    />
  );
}

const COLUMNS = [
  "Permit number",
  "Improvement status",
  "Status class",
  "Issue date",
  "Contractor",
  "Missing data",
  "Provenance",
] as const;

function PermitsTable({ rows }: { readonly rows: readonly PermitListRow[] }): ReactElement {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label="Permits">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.cid} data-missing={JSON.stringify(row.missing)}>
              <td>
                <FieldValue row={row} field="permit_number" className={styles.mono} />
              </td>
              <td>
                <FieldValue row={row} field="improvement_status" />
              </td>
              <td>
                <FieldValue row={row} field="status_class" />
              </td>
              <td>
                <FieldValue row={row} field="issue_date" className={styles.num} />
              </td>
              <td>
                <ContractorCell row={row} />
              </td>
              <td>
                <span className={styles.value}>
                  <Reasons entries={otherEntries(row)} />
                </span>
              </td>
              <td className={styles.provenanceCell}>
                <RowProvenance row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={styles.cardRow}>
      <dt className={styles.cardLabel}>{label}</dt>
      <dd className={styles.cardValue}>{children}</dd>
    </div>
  );
}

function PermitCards({ rows }: { readonly rows: readonly PermitListRow[] }): ReactElement {
  return (
    <ul className={styles.cards} aria-label="Permits">
      {rows.map((row) => (
        <li key={row.cid}>
          <article className={styles.card} data-missing={JSON.stringify(row.missing)}>
            <h3 className={styles.cardTitle}>
              <FieldValue row={row} field="permit_number" />
            </h3>
            <dl className={styles.cardRows}>
              <CardRow label={COLUMNS[1]}>
                <FieldValue row={row} field="improvement_status" />
              </CardRow>
              <CardRow label={COLUMNS[2]}>
                <FieldValue row={row} field="status_class" />
              </CardRow>
              <CardRow label={COLUMNS[3]}>
                <FieldValue row={row} field="issue_date" className={styles.num} />
              </CardRow>
              <CardRow label={COLUMNS[4]}>
                <ContractorCell row={row} />
              </CardRow>
              <CardRow label={COLUMNS[5]}>
                <span className={styles.value}>
                  <Reasons entries={otherEntries(row)} />
                </span>
              </CardRow>
            </dl>
            <RowProvenance row={row} />
          </article>
        </li>
      ))}
    </ul>
  );
}

export interface PermitsPageProps {
  readonly load: PermitsLoader;
}

export function PermitsPage({ load }: PermitsPageProps): ReactElement {
  const [state, setState] = useState<PermitsState>({ kind: "loading", stage: STAGE_TEXTS.engine });
  const [attempt, setAttempt] = useState(0);
  const table = useMediaQuery(TABLE_MEDIA_QUERY);

  const retry = useCallback(() => {
    setState({ kind: "loading", stage: STAGE_TEXTS.engine });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const report = (stage: string): void => {
      if (!signal.aborted) setState({ kind: "loading", stage });
    };
    load(report, signal).then(
      (loaded) => {
        if (!signal.aborted) setState(resolvePermitsState(loaded));
      },
      (error: unknown) => {
        if (signal.aborted) return;
        // The banner shows a fixed text; the detail (schema message, cause) is for the console only.
        console.error(
          "Permits load failed",
          error instanceof PermitRowsError ? error.detail : "",
          error,
        );
        setState({ kind: "error", message: errorText(error) });
      },
    );
    return () => controller.abort();
  }, [load, attempt]);

  return (
    <section
      className={styles.page}
      aria-label="Permits"
      data-route="permits"
      data-state={state.kind}
    >
      <h2 className={styles.title}>Permits</h2>
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.permits} stageText={state.stage} />
          <Skeleton variant={table ? "rows" : "cards"} />
        </>
      ) : null}
      {state.kind === "error" ? <ErrorBanner message={state.message} onRetry={retry} /> : null}
      {state.kind === "empty" ? (
        <EmptyState title={PERMITS_TEXTS.empty}>
          Run <span className={styles.mono}>{state.runId}</span> · manifest{" "}
          <CidDisplay cid={state.manifestCid} />
        </EmptyState>
      ) : null}
      {state.kind === "ready" ? (
        <>
          <EngineLine>
            {state.data.fallbackLabel === null ? null : (
              <StatusPill status="warning" text={state.data.fallbackLabel} />
            )}
          </EngineLine>
          {table ? <PermitsTable rows={state.data.rows} /> : <PermitCards rows={state.data.rows} />}
        </>
      ) : null}
    </section>
  );
}
