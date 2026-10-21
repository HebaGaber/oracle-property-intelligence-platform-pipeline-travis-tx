// The Runs page (`/runs`; A-03 T042 + T060, G-C3; spec FR-002, FR-005(b), FR-009; plan
// § "Atlas element map" → Runs page). States (data-model § "Runs page state"): loading
// (linear progress `Loading run` + card skeleton) → ready (the run card) | error (index
// unreadable / empty, both hosts down, or a loud data error). The card shows the run ID, UTC
// start and finish, the § 8 provenance line (index origin + manifest CID), the publication-state
// pill, the sources in manifest order, the coverage rows with their derivation helper text, the
// data groups with their tables CIDs, and the "Server check" line as secondary text. Every
// count comes from the manifest; every fixed text from @countylens/shared. A react-router lazy
// route module: it exports `Component` and nothing else. No data or placeholder value lives here.
import type { ManifestArtifact, ManifestSource, RunManifestV1 } from "@countylens/contract";
import {
  COVERAGE_LABELS,
  DERIVATION_LABELS,
  PROGRESS_LABELS,
  PUBLICATION_STATE_TEXT,
  sourceLabel,
  type CoverageLabelKey,
} from "@countylens/shared";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { CidDisplay } from "../components/CidDisplay";
import { ErrorBanner } from "../components/ErrorBanner";
import { FallbackChip } from "../components/FallbackChip";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { readPathUrlsFromEnv } from "../data/config";
import { formatCount, utcTimestamp } from "../data/format";
import {
  RUN_STAGE_TEXTS,
  loadRun,
  runErrorMessage,
  type LoadedRun,
  type RunStage,
} from "../data/run-loader";
import { RUNS_INDEX_PATH } from "../data/runs-index";
import { serverCheckText, useServerCheck } from "../data/server-check";
import styles from "./Runs.module.css";

type RunState =
  | { readonly kind: "loading"; readonly stage: RunStage }
  | { readonly kind: "ready"; readonly run: LoadedRun }
  | { readonly kind: "error"; readonly message: string };

/** The coverage rows of the card, in display order (plan § Atlas element map → Coverage rows). */
const COVERAGE_ROWS: readonly CoverageLabelKey[] = ["permits_emitted", "permits_no_tcad_geoid"];

/** Helper text when the manifest carries no such coverage key (never a blank row). */
const COVERAGE_NOT_REPORTED = "Not reported in this run's manifest";

export function Component(): ReactElement {
  const [state, setState] = useState<RunState>({ kind: "loading", stage: "index" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const live = (): boolean => !controller.signal.aborted;
    setState({ kind: "loading", stage: "index" });
    void (async () => {
      try {
        const run = await loadRun({
          urls: readPathUrlsFromEnv(),
          signal: controller.signal,
          onStage: (stage) => {
            if (live()) setState({ kind: "loading", stage });
          },
        });
        if (live()) setState({ kind: "ready", run });
      } catch (error) {
        if (live()) setState({ kind: "error", message: runErrorMessage(error) });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <section aria-label="Runs" data-route="runs" className={styles.page}>
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="cards" count={1} />
        </>
      ) : null}
      {state.kind === "error" ? <ErrorBanner message={state.message} onRetry={retry} /> : null}
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
  const groups = manifest.artifacts.filter((artifact) => artifact.kind === "directory");
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

      <h3 id="sources-heading" className={styles.sectionTitle}>
        Sources
      </h3>
      <ul className={styles.list} aria-labelledby="sources-heading">
        {manifest.sources.map((source) => (
          <SourceItem key={source.name} source={source} />
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
        {groups.map((artifact) => (
          <GroupItem key={artifact.name} artifact={artifact} />
        ))}
      </ul>

      <ServerCheckLine manifestCid={manifestCid} />
    </article>
  );
}

/** § 7 List item, two lines: the display name (+ manifest id), then records · collected · link. */
function SourceItem({ source }: { readonly source: ManifestSource }): ReactElement {
  return (
    <li className={styles.item} data-source={source.name}>
      <span className={styles.itemTitle}>
        <span>{sourceLabel(source.name)}</span>
        <code className={styles.mono}>{source.name}</code>
      </span>
      <span className={styles.itemBody}>
        {formatCount(source.records)} records · collected {utcTimestamp(source.captured_at)} UTC ·{" "}
        <a className={styles.link} href={source.url} target="_blank" rel="noreferrer">
          {source.url}
        </a>
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

/** § 7 List item, two lines: the data group, then its tables directory CID (TC-013). */
function GroupItem({ artifact }: { readonly artifact: ManifestArtifact }): ReactElement {
  const group = artifact.name.replace(/^tables\//, "");
  return (
    <li className={styles.item} data-group={group}>
      <span className={styles.itemTitle}>
        <code className={styles.mono}>{group}</code>
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
