// The Runs page (`/runs`; A-03 T042 + T060, G-C3; spec FR-002, FR-005(b), FR-009; plan
// § "Atlas element map" → Runs page). States (data-model § "Runs page state"): loading
// (linear progress `Loading run` + card skeleton) → ready (the run card) | error (index
// unreadable / empty, both hosts down, or a loud data error). The card shows the run ID, UTC
// start and finish, the § 8 provenance line (index origin + manifest CID), the publication-state
// pill, the sources in manifest order, the coverage rows with their derivation helper text, the
// data groups with their tables CIDs, and the "Server check" line as secondary text. Every
// count comes from the manifest; every fixed text from @countylens/shared. A react-router lazy
// route module: it exports `Component` and nothing else. No data or placeholder value lives here.
import type { ManifestSource, RunManifestV1 } from "@countylens/contract";
import {
  COVERAGE_LABELS,
  DERIVATION_LABELS,
  PROGRESS_LABELS,
  PUBLICATION_STATE_TEXT,
  ROUTES,
  RUNS_TEXTS,
  sourceLabel,
  type CoverageLabelKey,
} from "@countylens/shared";
import type { ReactElement } from "react";
import { Link } from "react-router";
import { ComingSoonEntries } from "../components/ComingSoonEntry";
import { ErrorBanner } from "../components/ErrorBanner";
import { CidDisplay } from "../components/CidDisplay";
import { FallbackChip } from "../components/FallbackChip";
import { SourceLink } from "../components/Provenance";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { formatCount, utcTimestamp } from "../data/format";
import { RUN_STAGE_TEXTS, type LoadedRun } from "../data/run-loader";
import { dataGroupItems, type DataGroupItem } from "../data/data-groups";
import { RUNS_INDEX_PATH } from "../data/runs-index";
import { serverCheckText, useServerCheck } from "../data/server-check";
import { runErrorNode, SourceDeltas, useLatestRun } from "./Runs.shared";
import styles from "./Runs.module.css";

/** The coverage rows of the card, in display order (plan § Atlas element map → Coverage rows). */
const COVERAGE_ROWS: readonly CoverageLabelKey[] = ["permits_emitted", "permits_no_tcad_geoid"];

/** Helper text when the manifest carries no such coverage key (never a blank row). */
const COVERAGE_NOT_REPORTED = "Not reported in this run's manifest";

export function Component(): ReactElement {
  const { state, retry } = useLatestRun();

  return (
    <section aria-label="Runs" data-route="runs" data-state={state.kind} className={styles.page}>
      <ComingSoonEntries ids={["pipeline-diagram", "timeline-scrubber"]} />
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="cards" count={1} />
        </>
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {state.kind === "ready" ? <RunCard run={state.run} /> : null}
    </section>
  );
}

function Icon({ name }: { readonly name: string }): ReactElement {
  return (
    <span className={`material-symbols-rounded ${styles.icon}`} aria-hidden="true">
      {name}
    </span>
  );
}

function RunCard({ run }: { readonly run: LoadedRun }): ReactElement {
  const { manifest, manifestCid, read } = run;
  const groups = dataGroupItems(manifest);
  return (
    <article className={styles.card} aria-labelledby="run-title">
      <header className={styles.header}>
        <h2 id="run-title" className={styles.title}>
          {manifest.runId}
        </h2>
        <FallbackChip source={read.source} />
      </header>
      <p className={styles.provenance}>
        <Icon name="description" />
        <span>
          Index: this site ({RUNS_INDEX_PATH}) · Manifest: <CidDisplay cid={manifestCid} />
        </span>
      </p>
      <p className={styles.times}>
        Started {utcTimestamp(manifest.startedAt)} UTC · Finished{" "}
        {utcTimestamp(manifest.finishedAt)} UTC
      </p>
      <div className={styles.state}>
        <StatusPill status="info" icon="schedule" text={PUBLICATION_STATE_TEXT} />
      </div>
      <p className={styles.times}>{RUNS_TEXTS.nextSync}</p>
      <p className={styles.itemBody}>
        <Link className={styles.link} to={ROUTES.runsCompare}>
          Compare with the previous run
        </Link>
      </p>

      <h3 id="sources-heading" className={styles.sectionTitle}>
        Sources
      </h3>
      <ul className={styles.list} aria-labelledby="sources-heading">
        {manifest.sources.map((source) => (
          <SourceItem
            key={source.name}
            source={source}
            firstRun={manifest.previousManifestCid === null}
          />
        ))}
      </ul>

      <h3 id="coverage-heading" className={styles.sectionTitle}>
        Coverage
      </h3>
      <ul className={styles.list} aria-labelledby="coverage-heading">
        {COVERAGE_ROWS.map((key) => (
          <CoverageRow key={key} coverageKey={key} coverage={manifest.coverage} />
        ))}
      </ul>

      <h3 id="groups-heading" className={styles.sectionTitle}>
        Data groups
      </h3>
      <ul className={styles.list} aria-labelledby="groups-heading">
        {groups.map((item) => (
          <GroupItem key={item.artifact.name} item={item} />
        ))}
      </ul>

      <h3 id="limitations-heading" className={styles.sectionTitle}>
        Limitations
      </h3>
      <ul className={styles.list} aria-labelledby="limitations-heading">
        {manifest.limitations.map((text) => (
          <li key={`run:${text}`} className={`${styles.item} ${styles.itemBody}`}>
            {text}
          </li>
        ))}
        {manifest.sources.flatMap((source) =>
          source.limitations.map((text) => (
            <li
              key={`${source.name}:${text}`}
              className={`${styles.item} ${styles.itemBody}`}
              data-limitation-source={source.name}
            >
              <span>{text}</span> · <code className={styles.mono}>{source.name}</code>
            </li>
          )),
        )}
      </ul>

      <ServerCheckLine manifestCid={manifestCid} />
    </article>
  );
}

/** § 7 List item, two lines: the display name (+ manifest id), then records · collected · link. */
function SourceItem({
  source,
  firstRun,
}: {
  readonly source: ManifestSource;
  readonly firstRun: boolean;
}): ReactElement {
  return (
    <li className={styles.item} data-source={source.name}>
      <span className={styles.itemTitle}>
        <span>{sourceLabel(source.name)}</span>
        <code className={styles.mono}>{source.name}</code>
      </span>
      <span className={styles.itemBody}>
        {formatCount(source.records)} records · collected {utcTimestamp(source.captured_at)} UTC ·{" "}
        {source.watermark === null ? null : <>watermark {source.watermark} · </>}
        <SourceLink url={source.url} className={styles.link} />
      </span>
      <span className={styles.itemBody}>
        <SourceDeltas
          added={source.added}
          changed={source.changed}
          removed={source.removed}
          firstRun={firstRun}
        />
      </span>
      <span className={styles.itemBody} data-source-delta={source.name}>
        Since the previous run: {formatCount(source.added)} added · {formatCount(source.changed)}{" "}
        changed · {formatCount(source.removed)} removed
        {/* A null watermark is not invented (TC-011): no "watermark" label then. */}
        {source.watermark === null ? null : (
          <>
            {" "}
            · watermark <code className={styles.mono}>{source.watermark}</code>
          </>
        )}
      </span>
    </li>
  );
}

/** Label · count · derivation helper text (visible, not a tooltip; FR-009, TC-031). */
function CoverageRow({
  coverageKey,
  coverage,
}: {
  readonly coverageKey: CoverageLabelKey;
  readonly coverage: RunManifestV1["coverage"];
}): ReactElement {
  const value = coverage[coverageKey];
  return (
    <li className={styles.coverageRow} data-coverage={coverageKey}>
      <span className={styles.coverageLabel}>{COVERAGE_LABELS[coverageKey]}</span>
      {value === undefined ? (
        <span className={styles.helper}>{COVERAGE_NOT_REPORTED}</span>
      ) : (
        <>
          <span className={styles.count}>{formatCount(value.count)}</span>
          <span className={styles.helper}>{DERIVATION_LABELS[value.derivation]}</span>
        </>
      )}
    </li>
  );
}

/** § 7 List item, two lines: the data group (and its batch), then its tables directory CID (TC-013). */
function GroupItem({ item }: { readonly item: DataGroupItem }): ReactElement {
  const { artifact, batch, batches } = item;
  const group = item.group ?? artifact.name;
  return (
    <li className={styles.item} data-group={group}>
      <span className={styles.itemTitle}>
        <code className={styles.mono}>{group}</code>
        {batches > 1 ? (
          <span className={styles.helper}>
            batch {batch} of {batches}
          </span>
        ) : null}
      </span>
      <span className={styles.itemBody}>
        tables <CidDisplay cid={artifact.cid} />
      </span>
    </li>
  );
}

/** Secondary text with its own provenance; the counts above come only from the manifest. */
function ServerCheckLine({ manifestCid }: { readonly manifestCid: string }): ReactElement {
  const check = useServerCheck(manifestCid);
  return (
    <p className={styles.serverCheck}>
      <Icon name="cloud_done" />
      <span>{serverCheckText(check)}</span>
    </p>
  );
}
