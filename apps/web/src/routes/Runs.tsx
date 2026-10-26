// The Runs page (`/runs`; A-03 T042 + T060, G-C3; A-16 T043/T045/T046, boards Runs1440/768/390,
// RunsStates, RunsAdmin1440; spec FR-002, FR-005(b), FR-009, AC-6..AC-9, AC-12). Board order:
// title "Pipeline runs" and the run list; Sync status (last sync, next sync, county coverage,
// "Admin sign-in" or the admin controls); the pipeline steps; Latest events; "What Run N changed";
// then the run card (A-03: run ID, times, state pill, sources, coverage, data groups, limitations,
// server check), which keeps its place as the page's one `article`.
//
// LCP (A-16 T045, A13-3): the run list and the Sync status card come from `runs/index.json` alone
// and paint as soon as the index is read; the manifest-backed sections fill in after it.
//
// Every count comes from the manifest, every time from the manifest or the index. Justified
// differences from the boards (parity matrix):
// - The Gantt timeline and the selected-source strip: the manifest carries only a start, one
//   capture time per source and a finish, no step timings, so the chart is not drawn; the
//   timeline stays a Coming soon item and Latest events lists the times that exist.
// - Fresh / Stale / Rate-limited / Failed pills: no freshness threshold is defined for the product
//   (the board's 8 days is a sample value) and a published run is by definition complete, so the
//   pill reads "Published". Running / failed / stopped come live from the bridge (admin only).
// - Choosing an earlier run in the Run menu: the list shows every run with its manifest CID and
//   the Verify and Compare links; viewing an earlier run's full card is not built.
// A react-router lazy route module: it exports `Component` and nothing else.
import type { ManifestSource, RunManifestV1 } from "@countylens/contract";
import {
  COVERAGE_LABELS,
  DERIVATION_LABELS,
  PROGRESS_LABELS,
  PUBLICATION_STATE_TEXT,
  ROUTES,
  RUNS_TEXTS,
  sourceLabel,
  verifyPath,
  type CoverageLabelKey,
} from "@countylens/shared";
import type { ReactElement } from "react";
import { Link } from "react-router";
import { ComingSoonEntries } from "../components/ComingSoonEntry";
import { ErrorBanner } from "../components/ErrorBanner";
import { CidDisplay } from "../components/CidDisplay";
import { FallbackChip } from "../components/FallbackChip";
import { Icon } from "../components/Icon";
import { SourceLink, formatUtc } from "../components/Provenance";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { useAdminAccess, useLiveRun } from "../auth/useAdmin";
import { formatCount, utcTimestamp } from "../data/format";
import { RUN_STAGE_TEXTS, type LoadedRun } from "../data/run-loader";
import { dataGroupItems, type DataGroupItem } from "../data/data-groups";
import { runEvents } from "../data/run-events";
import { RUNS_INDEX_PATH, runsByFinish, type RunsIndexEntry } from "../data/runs-index";
import { serverCheckText, useServerCheck } from "../data/server-check";
import { AdminActions, NotAdminNote } from "./RunsAdmin";
import {
  eventLabel,
  runErrorNode,
  runLabel,
  ShareBar,
  SourceDeltas,
  useLatestRun,
  type RunPageState,
} from "./Runs.shared";
import styles from "./Runs.module.css";

/** The coverage rows of the card, in display order (plan § Atlas element map → Coverage rows). */
const COVERAGE_ROWS: readonly CoverageLabelKey[] = ["permits_emitted", "permits_no_tcad_geoid"];

/** Helper text when the manifest carries no such coverage key (never a blank row). */
const COVERAGE_NOT_REPORTED = "Not reported in this run's manifest";

const DAY_MS = 86_400_000;

export function Component(): ReactElement {
  const { state, retry, index } = useLatestRun();
  const access = useAdminAccess();
  const live = useLiveRun(access.kind === "admin");
  const run = state.kind === "ready" ? state.run : undefined;
  const entries = index === undefined ? [] : runsByFinish(index);
  const latest = entries[entries.length - 1];

  return (
    <section aria-label="Runs" data-route="runs" data-state={state.kind} className={styles.page}>
      <div className={styles.pageHead}>
        <h2 className={styles.pageTitle}>Pipeline runs</h2>
        <p className={styles.intro}>
          Each run fetches every source, checks and joins them, derives roof age and contractors,
          then publishes a new manifest CID. A run never changes an earlier one. Every count comes
          from the run&apos;s manifest.
        </p>
      </div>
      {state.kind === "loading" ? (
        <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {entries.length > 0 ? <RunList entries={entries} /> : null}
      {latest === undefined ? null : (
        <SyncStatus
          latest={latest}
          number={entries.length}
          run={run}
          adminSlot={
            access.kind === "admin" ? (
              <AdminActions access={access} liveState={live.state} refresh={live.refresh} />
            ) : access.kind === "signed-out" ? (
              <Link className={styles.textLink} to={ROUTES.adminSignIn}>
                <Icon name="admin_panel_settings" size="medium" />
                Admin sign-in
              </Link>
            ) : access.kind === "checking" ? (
              <p className={styles.helperText} data-admin-note="checking">
                Checking admin access…
              </p>
            ) : (
              <NotAdminNote
                kind={access.kind}
                email={"identity" in access ? access.identity.email : null}
              />
            )
          }
        />
      )}
      <ComingSoonEntries ids={["pipeline-diagram", "timeline-scrubber"]} />
      {state.kind === "loading" && latest !== undefined ? <PendingSections state={state} /> : null}
      {run === undefined ? null : (
        <>
          <PipelineSteps manifest={run.manifest} manifestCid={run.manifestCid} />
          <LatestEvents manifest={run.manifest} />
          <WhatChanged run={run} number={entries.length} />
          <RunCard run={run} />
        </>
      )}
      {state.kind === "loading" && latest === undefined ? (
        <Skeleton variant="cards" count={1} />
      ) : null}
    </section>
  );
}

function PendingSections({
  state,
}: {
  readonly state: Extract<RunPageState, { kind: "loading" }>;
}): ReactElement {
  return (
    <div data-pending-manifest="" aria-label={RUN_STAGE_TEXTS[state.stage]}>
      <Skeleton variant="cards" count={1} />
    </div>
  );
}

/** The Run menu of the board: every run, newest first, with its manifest CID (from the index). */
function RunList({ entries }: { readonly entries: readonly RunsIndexEntry[] }): ReactElement {
  const newestFirst = entries.map((entry, i) => ({ entry, number: i + 1 })).reverse();
  const latest = newestFirst[0];
  return (
    <details className={styles.runMenu} data-run-list="">
      <summary className={styles.runMenuSummary}>
        <Icon name="history" size="medium" />
        <span className={styles.runMenuTitle}>
          {latest === undefined
            ? "No runs yet"
            : `${runLabel(latest.number, latest.entry.finishedAt)} · latest`}
        </span>
        <StatusPill status="info" icon="cloud_done" text="Published" />
        <Icon name="arrow_drop_down" size="medium" />
      </summary>
      <ul className={styles.runMenuList} aria-label="Runs, newest first">
        {newestFirst.map(({ entry, number }) => (
          <li key={entry.manifestCid} className={styles.runMenuItem} data-run-id={entry.runId}>
            <span className={styles.itemTitle}>
              <b>{runLabel(number, entry.finishedAt)}</b>
              <code className={styles.mono}>{entry.runId}</code>
            </span>
            <span className={styles.itemBody}>
              Finished <time dateTime={entry.finishedAt}>{formatUtc(entry.finishedAt)}</time> UTC ·
              Manifest <CidDisplay cid={entry.manifestCid} /> ·{" "}
              <Link className={styles.link} to={verifyPath(entry.manifestCid)}>
                Verify
              </Link>
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.itemBody}>{RUNS_TEXTS.numbering}</p>
    </details>
  );
}

function ageText(finishedAt: string, now: number): string {
  const days = Math.floor((now - Date.parse(finishedAt)) / DAY_MS);
  if (Number.isNaN(days) || days < 0) return "";
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

function SyncStatus({
  latest,
  number,
  run,
  adminSlot,
}: {
  readonly latest: RunsIndexEntry;
  readonly number: number;
  readonly run: LoadedRun | undefined;
  readonly adminSlot: ReactElement;
}): ReactElement {
  const age = ageText(latest.finishedAt, Date.now());
  return (
    <section className={styles.card} aria-labelledby="sync-heading" data-sync-status="">
      <div className={styles.cardHead}>
        <h3 id="sync-heading" className={styles.sectionTitle}>
          Sync status
        </h3>
        <StatusPill status="info" icon="cloud_done" text="Published" />
      </div>
      <dl className={styles.kv}>
        <div className={styles.kvRow}>
          <dt>Last sync</dt>
          <dd data-last-sync="">
            <time dateTime={latest.finishedAt}>{utcTimestamp(latest.finishedAt)}</time> UTC ·{" "}
            {runLabel(number, latest.finishedAt)}
            {age === "" ? "" : ` · ${age}`}
          </dd>
        </div>
        <div className={styles.kvRow}>
          <dt>Next sync</dt>
          <dd>None · scheduler off by default</dd>
        </div>
        <div className={styles.kvRow}>
          <dt>County coverage</dt>
          <dd data-county-coverage="">
            {run === undefined ? "Reading the manifest…" : countyCoverage(run.manifest)}
          </dd>
        </div>
      </dl>
      <p className={styles.provenance}>
        <Icon name="info" size="small" />
        <span>
          Runs start by hand. Last sync comes from {RUNS_INDEX_PATH}; coverage from the manifest.
        </span>
      </p>
      <div className={styles.adminSlot}>{adminSlot}</div>
    </section>
  );
}

/** Parcels with data out of the TCAD roll, only from manifest keys; else the reason it is missing. */
function countyCoverage(manifest: RunManifestV1): string {
  const published = manifest.coverage["parcels_published"];
  const total = manifest.coverage["source_total:tcad-2026-certified-json"];
  if (published === undefined || total === undefined || total.count === 0) {
    return "Not available · this run's manifest has no parcel count with the TCAD roll total";
  }
  const pct = ((published.count / total.count) * 100).toFixed(1);
  return `${pct}% of the TCAD roll · ${formatCount(published.count)} of ${formatCount(total.count)} parcels`;
}

/** The pipeline as steps, each with one fact the manifest holds (no step timings exist). */
function PipelineSteps({
  manifest,
  manifestCid,
}: {
  readonly manifest: RunManifestV1;
  readonly manifestCid: string;
}): ReactElement {
  const records = manifest.sources.reduce((sum, s) => sum + s.records, 0);
  const coverageKeys = Object.keys(manifest.coverage).length;
  const tables = manifest.artifacts.filter((a) => a.kind === "table").length;
  const steps: readonly { name: string; icon: string; metric: string }[] = [
    {
      name: "Fetch sources",
      icon: "cloud_download",
      metric: `${manifest.sources.length} sources · ${formatCount(records)} records`,
    },
    {
      name: "Check and join",
      icon: "rule",
      metric: `${coverageKeys} coverage counts recorded`,
    },
    { name: "Derive", icon: "auto_fix_high", metric: `${tables} published table parts` },
    {
      name: "Publish",
      icon: "cloud_upload",
      metric: `${manifest.artifacts.length} files · manifest ${manifestCid.slice(0, 8)}…`,
    },
    { name: "Verify", icon: "verified", metric: "Check it yourself on the Verify page" },
  ];
  return (
    <section className={styles.card} aria-labelledby="steps-heading" data-pipeline-steps="">
      <div>
        <h3 id="steps-heading" className={styles.sectionTitle}>
          Pipeline of {manifest.runId}
        </h3>
        <p className={styles.helperText}>
          A run that is in the index finished all five steps. The manifest records no per-step
          times.
        </p>
      </div>
      <ol className={styles.steps}>
        {steps.map((step, i) => (
          <li key={step.name} className={styles.step} data-step={step.name}>
            <span className={styles.stepNumber}>{i + 1}</span>
            <span className={styles.stepBody}>
              <b className={styles.itemTitle}>
                <Icon name={step.icon} size="medium" />
                {step.name}
              </b>
              <span className={styles.itemBody}>{step.metric}</span>
              <StatusPill status="verified" text="Done" />
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LatestEvents({ manifest }: { readonly manifest: RunManifestV1 }): ReactElement {
  const events = runEvents([manifest]).slice(-5).reverse();
  return (
    <section className={styles.card} aria-labelledby="events-heading" data-latest-events="">
      <div className={styles.cardHead}>
        <h3 id="events-heading" className={styles.sectionTitle}>
          Latest events
        </h3>
        <Link className={styles.textLink} to={ROUTES.runsLog}>
          Full log
        </Link>
      </div>
      <ul className={styles.list}>
        {events.map((event, i) => (
          <li key={i} className={styles.item} data-event={event.kind}>
            <span className={styles.itemTitle}>{eventLabel(event)}</span>
            <span className={styles.itemBody}>
              <time dateTime={event.time}>{formatUtc(event.time)}</time> UTC · {event.runId}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WhatChanged({
  run,
  number,
}: {
  readonly run: LoadedRun;
  readonly number: number;
}): ReactElement {
  const { manifest, manifestCid } = run;
  const first = manifest.previousManifestCid === null;
  const scale = Math.max(1, ...manifest.sources.map((s) => s.added + s.changed + s.removed));
  const total = manifest.sources.reduce((sum, s) => sum + s.added + s.changed + s.removed, 0);
  return (
    <section className={styles.card} aria-labelledby="changed-heading" data-what-changed="">
      <div className={styles.cardHead}>
        <div>
          <h3 id="changed-heading" className={styles.sectionTitle}>
            What Run {number} changed
          </h3>
          <p className={styles.helperText}>
            {first ? RUNS_TEXTS.firstRun : "Counted against the previous run's manifest."}
          </p>
        </div>
        {first ? null : (
          <Link
            className={styles.textLink}
            to={`${ROUTES.runsCompare}?a=${number - 1}&b=${number}`}
          >
            <Icon name="compare_arrows" size="medium" />
            Compare Run {number} with Run {number - 1}
          </Link>
        )}
      </div>
      {first ? null : (
        <p className={styles.itemBody}>
          Changes in this run: <b data-total-changes="">{total}</b> records
        </p>
      )}
      <ul className={styles.list} aria-label="Changed records per source">
        {manifest.sources.map((source) => (
          <li key={source.name} className={styles.changeRow} data-change-source={source.name}>
            <span className={styles.itemTitle}>{sourceLabel(source.name)}</span>
            <span className={styles.count}>{formatCount(source.records)} records</span>
            {first ? (
              <span className={styles.helper}>{RUNS_TEXTS.firstRun}</span>
            ) : (
              <>
                <span className={styles.stack} role="group" aria-label={changeAria(source)}>
                  <ShareBar
                    tone="added"
                    value={source.added}
                    max={scale}
                    label={`${source.added} added`}
                  />
                  <ShareBar
                    tone="changed"
                    value={source.changed}
                    max={scale}
                    label={`${source.changed} changed`}
                  />
                  <ShareBar
                    tone="removed"
                    value={source.removed}
                    max={scale}
                    label={`${source.removed} removed`}
                  />
                </span>
                <span className={styles.count}>
                  +{source.added} / ~{source.changed} / −{source.removed}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <dl className={styles.kv}>
        <div className={styles.kvRow}>
          <dt>Manifest CID</dt>
          <dd>
            <CidDisplay cid={manifestCid} />{" "}
            <Link className={styles.link} to={verifyPath(manifestCid)}>
              Verify
            </Link>
          </dd>
        </div>
        <div className={styles.kvRow}>
          <dt>Previous manifest CID</dt>
          <dd>
            {manifest.previousManifestCid === null ? (
              RUNS_TEXTS.firstRun
            ) : (
              <CidDisplay cid={manifest.previousManifestCid} />
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

const changeAria = (s: ManifestSource): string =>
  `${s.added} added, ${s.changed} changed, ${s.removed} removed`;

function Glyph({ name }: { readonly name: string }): ReactElement {
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
        <Glyph name="description" />
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
      <span className={styles.itemBody} data-source-delta={source.name}>
        <SourceDeltas
          added={source.added}
          changed={source.changed}
          removed={source.removed}
          firstRun={firstRun}
        />
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
      <Glyph name="cloud_done" />
      <span>{serverCheckText(check)}</span>
    </p>
  );
}
