// Coverage (`/tx/travis/coverage`; A-13 T021, AC-2, FR-002, FR-007, FR-022; TC-003, TC-016,
// TC-017). One Atlas card per record kind (Coverage.kinds.ts): each manifest coverage key of the
// kind (`data-coverage-key`) with its count, derivation label and note, the collection time of
// the kind's source, the published table it comes from (with its part CIDs) and the § 8
// provenance line (manifest CID, run). A kind with no key, a missing table or source, and every
// denominator without a `source_total:{source}` key say why in words (data/coverage-rows). Every
// count comes from the manifest; nothing is computed here. A react-router lazy route module.
import type { ManifestArtifact, ManifestSource, RunManifestV1 } from "@countylens/contract";
import { COVERAGE_TEXTS, DERIVATION_LABELS, PROGRESS_LABELS } from "@countylens/shared";
import type { ReactElement } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { CidDisplay } from "../components/CidDisplay";
import { FallbackChip } from "../components/FallbackChip";
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
import { RUN_STAGE_TEXTS, runErrorNode, useLatestRun } from "./Runs.shared";
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
      <h2 className={styles.title}>Coverage</h2>
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="cards" count={3} />
        </>
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {state.kind === "ready" ? <CoverageCards run={state.run} /> : null}
    </section>
  );
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
  return (
    <>
      <div className={styles.header}>
        <span className={styles.itemBody}>Run {manifest.runId}</span>
        <FallbackChip source={read.source} />
      </div>
      {kinds.map((kind) => (
        <KindCard
          key={kind.id}
          kind={kind}
          rows={byKind.get(kind.id) ?? []}
          manifest={manifest}
          manifestCid={manifestCid}
        />
      ))}
      <Denominators manifest={manifest} />
    </>
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

function Denominators({ manifest }: { readonly manifest: RunManifestV1 }): ReactElement {
  return (
    <section className={styles.card} aria-labelledby="denominators-heading">
      <h3 id="denominators-heading" className={styles.sectionTitle}>
        Denominators
      </h3>
      <ul className={styles.list} aria-labelledby="denominators-heading">
        {denominatorRows(manifest).map((row) => (
          <li key={row.source} className={styles.coverageRow} data-denominator={row.source}>
            <span className={styles.coverageLabel}>
              <code className={styles.mono}>{row.source}</code>
            </span>
            {row.count === null ? (
              <span className={styles.helper}>
                <StatusPill status="unavailable" text={row.missingText ?? ""} />
              </span>
            ) : (
              <>
                <span className={styles.count} data-count={row.count}>
                  {formatCount(row.count)}
                </span>
                <span className={styles.helper}>
                  collected <time dateTime={row.capturedAt}>{formatUtc(row.capturedAt)}</time> UTC
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
