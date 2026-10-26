// Coverage (`/tx/travis/coverage`; A-13 T021, AC-2, FR-002, FR-007, FR-022; TC-003, TC-016,
// TC-017). One Atlas card per record kind (Coverage.kinds.ts): each manifest coverage key of the
// kind (`data-coverage-key`) with its count, derivation label and note, the collection time of
// the kind's source, the published table it comes from (with its part CIDs) and the § 8
// provenance line (manifest CID, run). A kind with no key, a missing table or source, and every
// denominator without a `source_total:{source}` key say why in words (data/coverage-rows). Every
// count comes from the manifest; nothing is computed here but sums and shares of manifest numbers.
//
// A-16 (T041, T046; boards Coverage1440/768/390, CoverageStates): header with the run chip and
// Download CSV, four KPI tiles, "Loaded vs each source's own total", the per-kind cards, Known
// limitations, then "Source speed and constraints" and "Cost" (CoverageCostLimits, which do not
// depend on the run, so they still show when the manifest cannot load, as the Error state says).
// Justified differences: "Coverage by area" (heatmap), the trend column and the Reconciliation
// section are not drawn because the published manifest has no per-area, per-run-history or merge
// counts; the area card and the Areas tile say so. The board's "Gaps only" filter and "Complete /
// Partial" kind statuses are not built: a kind's own total exists only where the manifest has a
// `source_total:` key, so completeness is shown as a share where there is a total and as a
// missing reason where there is not. A react-router lazy route module.
import type { ManifestArtifact, ManifestSource, RunManifestV1 } from "@countylens/contract";
import {
  COVERAGE_TEXTS,
  DERIVATION_LABELS,
  PROGRESS_LABELS,
  ROUTES,
  verifyPath,
} from "@countylens/shared";
import { resolveBatchGroups } from "@countylens/query-core";
import type { ReactElement } from "react";
import { Link, useSearchParams } from "react-router";
import { RunSelect } from "../components/RunSelect";
import { ErrorBanner } from "../components/ErrorBanner";
import { CidDisplay } from "../components/CidDisplay";
import { FallbackChip } from "../components/FallbackChip";
import { Icon } from "../components/Icon";
import { LinearProgress } from "../components/LinearProgress";
import { Provenance, formatUtc } from "../components/Provenance";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import {
  SOURCE_TOTAL_PREFIX,
  coverageRows,
  denominatorRows,
  type CoverageRow,
} from "../data/coverage-rows";

import type { LoadedRun } from "../data/run-loader";
import { runNumbers, type RunNumber } from "../data/runs-index";
import {
  COVERAGE_KINDS,
  COVERAGE_KIND_MISSING,
  COVERAGE_SOURCE_MISSING,
  COVERAGE_TABLE_MISSING,
  OTHER_KIND,
  kindOf,
  keyWords,
  type CoverageKind,
} from "./Coverage.kinds";
import { CostSection, SourceSpeed } from "./CoverageCostLimits";
import costStyles from "./CoverageCostLimits.module.css";
import { RUN_STAGE_TEXTS, ShareBar, runErrorNode, runLabel, useRun } from "./Runs.shared";
import styles from "./Runs.module.css";

/** Coverage counts with en-US thousands separators (review 2026-10-26; the tests parse grouping). */
const groupedCount = (count: number): string => count.toLocaleString("en-US");

export function Component(): ReactElement {
  // The shared run dropdown (PO rule): `?run=` picks a run, none means the latest.
  const [params, setParams] = useSearchParams();
  const { state, retry } = useRun(params.get("run"));
  const choose = (runId: string | null): void => setParams(runId === null ? {} : { run: runId });
  return (
    <section
      aria-label="Coverage"
      data-route="coverage"
      data-state={state.kind}
      className={styles.page}
    >
      {/* Board Coverage1440: title and intro on the left, the run and Download CSV on the right. */}
      <div className={costStyles.head}>
        <div className={styles.pageHead}>
          <h2 className={styles.pageTitle}>Coverage</h2>
          <p className={styles.intro}>
            How much of each source is loaded, measured against that source&apos;s own total, and
            where in the county it reaches. Every count has its date and run.
          </p>
        </div>
        {state.kind === "ready" ? <HeadActions run={state.run} onRun={choose} /> : null}
      </div>
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="cards" count={3} />
        </>
      ) : null}
      {state.kind === "error" ? (
        <>
          <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
          <p className={styles.helperText}>
            Nothing is wrong with the data. Source speed and Cost below do not depend on the run.
          </p>
        </>
      ) : null}
      {state.kind === "ready" ? <CoverageCards run={state.run} /> : null}
      <SourceSpeed />
      <CostSection />
    </section>
  );
}

/** The shown run's number by the one rule (runNumbers; `null` for the pilot slice). */
function runNumber(run: LoadedRun): RunNumber {
  return runNumbers(run.index).get(run.entry.runId) ?? null;
}

const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;

function coverageCsv(rows: readonly CoverageRow[], runId: string): string {
  const head = ["Run", "Key", "Label", "Count", "Derivation", "Note"].map(csvCell).join(",");
  const lines = rows.map((r) =>
    [runId, r.key, r.label, String(r.count), r.derivationLabel, r.note ?? ""]
      .map(csvCell)
      .join(","),
  );
  return [head, ...lines].join("\n");
}

function HeadActions({
  run,
  onRun,
}: {
  readonly run: LoadedRun;
  readonly onRun: (runId: string | null) => void;
}): ReactElement {
  const { manifest, read } = run;
  const download = (): void => {
    const blob = new Blob([coverageCsv(coverageRows(manifest), manifest.runId)], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coverage.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className={costStyles.headActions}>
      <FallbackChip source={read.source} />
      <RunSelect
        runs={run.index.runs}
        value={run.entry.runId}
        onChange={onRun}
        label="Run"
        hideLabel
      />
      <button type="button" className={costStyles.outlined} onClick={download}>
        <Icon name="download" size="medium" />
        Download CSV
      </button>
    </div>
  );
}

function CoverageCards({ run }: { readonly run: LoadedRun }): ReactElement {
  const { manifest, manifestCid } = run;
  const rows = coverageRows(manifest);
  const byKind = new Map<string, CoverageRow[]>();
  for (const row of rows) {
    const id = kindOf(row.key).id;
    byKind.set(id, [...(byKind.get(id) ?? []), row]);
  }
  const kinds = [...COVERAGE_KINDS, ...(byKind.has(OTHER_KIND.id) ? [OTHER_KIND] : [])];
  const number = runNumber(run);
  return (
    <>
      <KpiTiles run={run} kinds={kinds} byKind={byKind} number={number} />
      <LoadedVsTotal manifest={manifest} manifestCid={manifestCid} />
      <h3 className={styles.sectionTitle}>Counts by record kind</h3>
      {/* A-16 PO notes: the kind cards fill the width (three per row at 1440, one at 390). */}
      <div className={costStyles.kindGrid}>
        {kinds.map((kind) => (
          <KindCard
            key={kind.id}
            kind={kind}
            rows={byKind.get(kind.id) ?? []}
            manifest={manifest}
            manifestCid={manifestCid}
          />
        ))}
      </div>
      <div className={styles.cardGrid}>
        <AreaCard />
        <KnownLimitations manifest={manifest} />
      </div>
    </>
  );
}

function KpiTiles({
  run,
  kinds,
  byKind,
  number,
}: {
  readonly run: LoadedRun;
  readonly kinds: readonly CoverageKind[];
  readonly byKind: ReadonlyMap<string, readonly CoverageRow[]>;
  readonly number: RunNumber;
}): ReactElement {
  const { manifest } = run;
  const listed = kinds.filter((k) => k.id !== OTHER_KIND.id);
  const withCounts = listed.filter((k) => (byKind.get(k.id)?.length ?? 0) > 0).length;
  const loaded = manifest.sources.reduce((sum, s) => sum + s.records, 0);
  const withTotal = manifest.sources.filter(
    (s) => manifest.coverage[`${SOURCE_TOTAL_PREFIX}${s.name}`] !== undefined,
  );
  const totalSum = withTotal.reduce(
    (sum, s) => sum + (manifest.coverage[`${SOURCE_TOTAL_PREFIX}${s.name}`]?.count ?? 0),
    0,
  );
  const loadedOfTotals = withTotal.reduce((sum, s) => sum + s.records, 0);
  const share = totalSum > 0 ? (loadedOfTotals / totalSum) * 100 : null;
  return (
    <div className={styles.tiles} data-kpi-tiles="">
      <div className={styles.tile} data-tile="kinds">
        <span className={styles.tileLabel}>Record kinds with counts</span>
        <b className={styles.tileBig}>
          {withCounts} of {listed.length}
        </b>
        <ShareBar
          value={withCounts}
          max={listed.length}
          label={`${withCounts} of ${listed.length} kinds have counts`}
        />
        <span className={styles.tileLabel}>
          {listed.length - withCounts} not in this run&apos;s coverage section
        </span>
      </div>
      <div className={styles.tile} data-tile="loaded">
        <span className={styles.tileLabel}>Records loaded</span>
        <b className={styles.tileBig}>{groupedCount(loaded)}</b>
        {share === null ? (
          <StatusPill
            status="unavailable"
            text="Not available · the manifest has no source totals to measure against"
          />
        ) : (
          <>
            <ShareBar
              value={share}
              max={100}
              label={`${share.toFixed(1)} percent of the sources' own totals`}
            />
            <span className={styles.tileLabel}>
              {groupedCount(loadedOfTotals)} of {groupedCount(totalSum)} in the sources&apos; own
              totals · {share.toFixed(1)}% ({withTotal.length} of {manifest.sources.length} sources
              have a total)
            </span>
          </>
        )}
      </div>
      <div className={styles.tile} data-tile="areas">
        <span className={styles.tileLabel}>Areas with permit data</span>
        <StatusPill
          status="unavailable"
          text="Not available · the manifest has no per-area counts"
        />
        <span className={styles.tileLabel}>Austin publishes permits for the city only</span>
      </div>
      <div className={styles.tile} data-tile="counted-from">
        <span className={styles.tileLabel}>Counted from</span>
        <b className={styles.tileBig}>{runLabel(number, manifest.finishedAt)}</b>
        <span className={costStyles.pillLine}>
          <StatusPill status="info" icon="cloud_done" text="Published" />
          <span className={styles.tileLabel}>
            <code className={styles.mono}>{manifest.runId}</code>
          </span>
        </span>
        <Link className={styles.textLink} to={ROUTES.runs}>
          Open the run
        </Link>
      </div>
    </div>
  );
}

/**
 * The parts of `{group}/{table}`. A part's table is its parent folder and its group the one
 * query-core resolves for its export batch (the rule parquet-meta's `catalogTables` and
 * data-groups use), so the pilot's `tables/<group>/<table>/<part>` and a full-county run's
 * `…/tables/<bNN>/<table>/<part>` both match (data audit 2026-10-26, row 6).
 */
function tableParts(manifest: RunManifestV1, table: string): ManifestArtifact[] {
  const parts = manifest.artifacts.filter((a) => a.kind === "table");
  const groups = resolveBatchGroups(parts.map((a) => a.name));
  return parts.filter((a) => {
    const segs = a.name.split("/");
    const group = groups.get(segs.slice(0, -2).join("/"));
    return group !== undefined && group !== null && `${group}/${segs.at(-2) ?? ""}` === table;
  });
}

// A-16 PO note 2026-10-26: one compact card per kind. Each coverage key is one line (label and
// count), its derivation, collection time and note below, the note clamped to two lines until
// "Details" opens the card; the kind's denominator, source and table are short fact lines.
function KindCard({
  kind,
  rows,
  manifest,
  manifestCid,
}: {
  readonly kind: CoverageKind;
  readonly rows: readonly CoverageRow[];
  readonly manifest: RunManifestV1;
  readonly manifestCid: string;
}): ReactElement {
  const titleId = `kind-${kind.id}`;
  const source =
    kind.source === null ? undefined : manifest.sources.find((s) => s.name === kind.source);
  const parts = kind.table === null ? [] : tableParts(manifest, kind.table);
  const long = rows.some((row) => row.note !== null) || parts.length > 2;
  return (
    <article className={styles.card} aria-labelledby={titleId} data-kind={kind.id}>
      <div>
        <h3 id={titleId} className={styles.sectionTitle}>
          {kind.title}
        </h3>
        {long ? (
          <details>
            <summary>Details</summary>
          </details>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <StatusPill status="unavailable" text={COVERAGE_KIND_MISSING} />
      ) : (
        <ul aria-labelledby={titleId}>
          {rows.map((row) => (
            <li key={row.key} data-coverage-key={row.key}>
              <span>{row.label === row.key ? keyWords(row.key) : row.label}</span>
              <span className={styles.count} data-count={row.count}>
                {groupedCount(row.count)}
              </span>
              <span>
                <span>{row.derivationLabel}</span>
                {source === undefined ? null : (
                  <>
                    {" · collected "}
                    <time dateTime={source.captured_at}>{formatUtc(source.captured_at)}</time> UTC
                  </>
                )}
                {row.note === null ? null : (
                  <>
                    {" · "}
                    <span>{row.note}</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {kind.id === OTHER_KIND.id ? null : (
        <div className={costStyles.facts}>
          <div data-kind-denominator={kind.source ?? "none"}>
            {denominatorNode(kind, manifest, source)}
          </div>
          <div>
            {source === undefined ? (
              <StatusPill status="unavailable" text={COVERAGE_SOURCE_MISSING} />
            ) : (
              <span>
                Collected <time dateTime={source.captured_at}>{formatUtc(source.captured_at)}</time>{" "}
                UTC · <code className={styles.mono}>{source.name}</code>
              </span>
            )}
          </div>
          <div>
            {kind.table === null || parts.length === 0 ? (
              <StatusPill status="unavailable" text={COVERAGE_TABLE_MISSING} />
            ) : (
              <span data-table={kind.table}>
                Table <code className={styles.mono}>{kind.table}</code>
                {parts.map((part) => (
                  <span key={part.cid}>
                    {" · "}
                    <CidDisplay cid={part.cid} />
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      )}
      <Provenance>
        Manifest <CidDisplay cid={manifestCid} /> · run {manifest.runId}
      </Provenance>
    </article>
  );
}

// The kind's own denominator (FR-002): the manifest's `source_total:{source}` key of the kind's
// source with its derivation label and collection time, else the exact "not in this run's
// manifest" reason (naming the A-01 source when the kind has one). Never a typed number.
function denominatorNode(
  kind: CoverageKind,
  manifest: RunManifestV1,
  source: ManifestSource | undefined,
): ReactElement {
  const total =
    kind.source === null ? undefined : manifest.coverage[`${SOURCE_TOTAL_PREFIX}${kind.source}`];
  if (total === undefined) {
    return (
      <StatusPill
        status="unavailable"
        text={
          kind.source === null
            ? COVERAGE_TEXTS.denominatorMissing
            : COVERAGE_TEXTS.denominatorMissingFor(kind.source)
        }
      />
    );
  }
  return (
    <>
      Denominator <span data-denominator-value={total.count}>{groupedCount(total.count)}</span> ·{" "}
      {DERIVATION_LABELS[total.derivation]}
      {source === undefined ? null : (
        <>
          {" · collected "}
          <time dateTime={source.captured_at}>{formatUtc(source.captured_at)}</time> UTC
        </>
      )}
    </>
  );
}

function LoadedVsTotal({
  manifest,
  manifestCid,
}: {
  readonly manifest: RunManifestV1;
  readonly manifestCid: string;
}): ReactElement {
  const records = new Map(manifest.sources.map((s) => [s.name, s.records]));
  return (
    <section
      className={styles.card}
      aria-labelledby="denominators-heading"
      data-section="loaded-vs-total"
    >
      <div>
        <h3 id="denominators-heading" className={styles.sectionTitle}>
          Loaded vs each source&apos;s own total
        </h3>
        <p className={styles.helperText}>
          The total is the source&apos;s own count recorded at capture (manifest key{" "}
          <code className={styles.mono}>source_total:…</code>). Where the manifest has none, the row
          says so and shows no percentage.
        </p>
      </div>
      <div className={styles.tableWrap}>
        <table
          className={`${styles.table} ${costStyles.stack} ${costStyles.flat}`}
          aria-label="Loaded vs source total"
        >
          <thead>
            <tr>
              <th>Data</th>
              <th className={styles.num}>Loaded</th>
              <th>Out of the source&apos;s own total</th>
              <th>Collected</th>
              <th>Provenance</th>
            </tr>
          </thead>
          <tbody>
            {denominatorRows(manifest).map((row) => {
              const loaded = records.get(row.source) ?? 0;
              const share =
                row.count === null || row.count === 0 ? null : (loaded / row.count) * 100;
              return (
                <tr key={row.source} data-denominator={row.source}>
                  <td data-label="Data">
                    <span className={costStyles.dataCell}>
                      <Icon
                        name={
                          share === null
                            ? "do_not_disturb_on"
                            : share >= 100
                              ? "check_circle"
                              : "warning"
                        }
                        size="medium"
                      />
                      <b>{row.source}</b>
                    </span>
                  </td>
                  <td data-label="Loaded" className={styles.num} data-loaded={loaded}>
                    {groupedCount(loaded)}
                  </td>
                  <td data-label="Out of the source's own total">
                    <div className={costStyles.totalCell}>
                      {row.count === null ? (
                        <>
                          {/* Board "Missing" swatch: a hatched, empty bar, never a 0 %. */}
                          <span className={costStyles.hatchBar} aria-hidden="true" />
                          <StatusPill status="unavailable" text={row.missingText ?? ""} />
                        </>
                      ) : (
                        <>
                          <span className={styles.count} data-count={row.count}>
                            {groupedCount(row.count)}
                          </span>
                          {share === null ? null : (
                            <ShareBar
                              value={Math.min(100, share)}
                              max={100}
                              label={`${share.toFixed(1)} percent loaded`}
                            />
                          )}
                          <span className={styles.helper}>
                            {share === null ? "" : `${share.toFixed(1)}% · `}
                            {row.derivation === null ? "" : DERIVATION_LABELS[row.derivation]}
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                  <td data-label="Collected">
                    <span>
                      <time dateTime={row.capturedAt}>{formatUtc(row.capturedAt)}</time> UTC
                    </span>
                  </td>
                  <td data-label="Provenance">
                    <Link className={styles.link} to={verifyPath(manifestCid)}>
                      Run manifest · coverage section
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AreaCard(): ReactElement {
  return (
    <section className={styles.card} aria-labelledby="area-heading" data-section="by-area">
      <div>
        <h3 id="area-heading" className={styles.sectionTitle}>
          Coverage by area
        </h3>
        <p className={styles.helperText}>
          Share of each area&apos;s parcels or records that have the data.
        </p>
      </div>
      {/* Board "No source" cell treatment: a hatched panel holding the reason; no grid is drawn. */}
      <div className={costStyles.hatchPanel}>
        <StatusPill
          status="unavailable"
          text="Not available · the run manifest carries no per-area counts, so the area grid is not drawn"
        />
      </div>
    </section>
  );
}

/** Known limitations show the first five; CSS shows the rest when "Show all" is open (A-16). */
const LIMITATIONS_SHOWN = 5;

function KnownLimitations({ manifest }: { readonly manifest: RunManifestV1 }): ReactElement {
  const items: { key: string; text: string; source: string | null }[] = [
    ...manifest.limitations.map((text) => ({ key: `run:${text}`, text, source: null })),
    ...manifest.sources.flatMap((s) =>
      s.limitations.map((text) => ({ key: `${s.name}:${text}`, text, source: s.name })),
    ),
  ];
  return (
    <section className={styles.card} aria-labelledby="limits-heading" data-section="limitations">
      <h3 id="limits-heading" className={styles.sectionTitle}>
        Known limitations
      </h3>
      {items.length === 0 ? (
        <StatusPill status="unavailable" text="No limitation is recorded in this run's manifest" />
      ) : (
        <ul className={styles.limitations}>
          {items.map((item) => (
            <li key={item.key} className={styles.itemBody}>
              {item.text}
              {item.source === null ? null : (
                <>
                  {" · "}
                  <code className={styles.mono}>{item.source}</code>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length > LIMITATIONS_SHOWN ? (
        <details>
          <summary>Show all {items.length} limitations</summary>
        </details>
      ) : null}
    </section>
  );
}
