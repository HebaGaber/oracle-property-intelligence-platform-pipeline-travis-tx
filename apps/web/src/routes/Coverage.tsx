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
import type { ReactElement } from "react";
import { Link } from "react-router";
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
import { formatCount } from "../data/format";
import type { LoadedRun } from "../data/run-loader";
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
import { RUN_STAGE_TEXTS, ShareBar, runErrorNode, runLabel, useLatestRun } from "./Runs.shared";
import styles from "./Runs.module.css";

export function Component(): ReactElement {
  const { state, retry } = useLatestRun();
  return (
    <section
      aria-label="Coverage"
      data-route="coverage"
      data-state={state.kind}
      className={styles.page}
    >
      <div className={styles.pageHead}>
        <h2 className={styles.pageTitle}>Coverage</h2>
        <p className={styles.intro}>
          How much of each source is loaded, measured against that source&apos;s own total, and
          where in the county it reaches. Every count has its date and run.
        </p>
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

function runNumber(run: LoadedRun): number {
  const sorted = [...run.index.runs].sort(
    (a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt),
  );
  const at = sorted.findIndex((r) => r.manifestCid === run.manifestCid);
  return at === -1 ? sorted.length : at + 1;
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

function CoverageCards({ run }: { readonly run: LoadedRun }): ReactElement {
  const { manifest, manifestCid, read } = run;
  const rows = coverageRows(manifest);
  const byKind = new Map<string, CoverageRow[]>();
  for (const row of rows) {
    const id = kindOf(row.key).id;
    byKind.set(id, [...(byKind.get(id) ?? []), row]);
  }
  const kinds = [...COVERAGE_KINDS, ...(byKind.has(OTHER_KIND.id) ? [OTHER_KIND] : [])];
  const number = runNumber(run);
  const download = (): void => {
    const blob = new Blob([coverageCsv(rows, manifest.runId)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "coverage.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className={styles.header}>
        <Link className={styles.chip} to={ROUTES.runs}>
          {runLabel(number, manifest.finishedAt)} · current
        </Link>
        <span className={styles.itemBody}>Run {manifest.runId}</span>
        <FallbackChip source={read.source} />
        <button type="button" className={styles.chip} onClick={download}>
          <Icon name="download" size="small" />
          Download CSV
        </button>
      </div>
      <KpiTiles run={run} kinds={kinds} byKind={byKind} number={number} />
      <LoadedVsTotal manifest={manifest} manifestCid={manifestCid} />
      <h3 className={styles.sectionTitle}>Counts by record kind</h3>
      {/* A-16 PO note: the kind cards sit two per row from 1024 px and stack below. */}
      <div className={styles.cardGrid}>
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
  readonly number: number;
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
        <b className={styles.tileBig}>{formatCount(loaded)}</b>
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
              {formatCount(loadedOfTotals)} of {formatCount(totalSum)} in the sources&apos; own
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
        <StatusPill status="info" icon="cloud_done" text="Published" />
        <Link className={styles.textLink} to={ROUTES.runs}>
          Open the run
        </Link>
      </div>
    </div>
  );
}

function tableParts(manifest: RunManifestV1, table: string): ManifestArtifact[] {
  const prefix = `tables/${table}/`;
  return manifest.artifacts.filter((a) => a.kind === "table" && a.name.startsWith(prefix));
}

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
  return (
    <article className={styles.card} aria-labelledby={titleId} data-kind={kind.id}>
      <h3 id={titleId} className={styles.sectionTitle}>
        {kind.title}
      </h3>
      {rows.length === 0 ? (
        <StatusPill status="unavailable" text={COVERAGE_KIND_MISSING} />
      ) : (
        <ul className={styles.list} aria-labelledby={titleId}>
          {rows.map((row) => (
            <li key={row.key} className={styles.coverageRow} data-coverage-key={row.key}>
              <span className={styles.coverageLabel}>
                {row.label === row.key ? keyWords(row.key) : row.label}
              </span>
              <span className={styles.count} data-count={row.count}>
                {formatCount(row.count)}
              </span>
              <span className={styles.helper}>
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
        <>
          <p className={styles.itemBody} data-kind-denominator={kind.source ?? "none"}>
            {denominatorNode(kind, manifest, source)}
          </p>
          <p className={styles.itemBody}>
            {source === undefined ? (
              <StatusPill status="unavailable" text={COVERAGE_SOURCE_MISSING} />
            ) : (
              <>
                Collected <time dateTime={source.captured_at}>{formatUtc(source.captured_at)}</time>{" "}
                UTC · <code className={styles.mono}>{source.name}</code>
              </>
            )}
          </p>
          <div className={styles.itemBody}>
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
        </>
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
      Denominator <span data-denominator-value={total.count}>{formatCount(total.count)}</span> ·{" "}
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
          className={`${styles.table} ${costStyles.stack}`}
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
                    <code className={styles.mono}>{row.source}</code>
                  </td>
                  <td data-label="Loaded" className={styles.num} data-loaded={loaded}>
                    {formatCount(loaded)}
                  </td>
                  <td data-label="Out of the source's own total">
                    {row.count === null ? (
                      <StatusPill status="unavailable" text={row.missingText ?? ""} />
                    ) : (
                      <>
                        <span className={styles.count} data-count={row.count}>
                          {formatCount(row.count)}
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
                  </td>
                  <td data-label="Collected">
                    <time dateTime={row.capturedAt}>{formatUtc(row.capturedAt)}</time> UTC
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
      <h3 id="area-heading" className={styles.sectionTitle}>
        Coverage by area
      </h3>
      <StatusPill
        status="unavailable"
        text="Not available · the run manifest carries no per-area counts, so the area grid is not drawn"
      />
    </section>
  );
}

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
    </section>
  );
}
