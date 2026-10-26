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
// Run menu (A-16 PO note): choosing a run sets `?run=<runId>` and the pipeline steps, Latest
// events, What changed and the run card show that run (default: the latest). Sync status always
// describes the latest run. An unknown `run` shows the latest run and says why.
// Layout (A-16 F3, PO 2026-10-26): title + Run menu left of Sync status from 1024 px; the
// pipeline as a Fetch sources panel (each manifest source with its records) and steps 2–5;
// Timeline (Coming soon entries) beside Latest events; What changed split into totals + CIDs and
// the per-source rows; the run card in two columns with data groups as a compact grid. The Run
// menu floats over the page and closes on a choice, on focus leaving it, or on Escape.
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
import { useRef, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router";
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
import { RUN_STAGE_TEXTS, type LoadedRun, type SelectedRun } from "../data/run-loader";
import { dataGroupItems, type DataGroupItem } from "../data/data-groups";
import { runEvents, type RunEvent } from "../data/run-events";
import { RUNS_INDEX_PATH, runsByFinish, type RunsIndexEntry } from "../data/runs-index";
import { serverCheckText, useServerCheck } from "../data/server-check";
import { AdminActions, NotAdminNote } from "./RunsAdmin";
import {
  eventLabel,
  runErrorNode,
  runLabel,
  ShareBar,
  SourceDeltas,
  useRun,
  type RunPageState,
} from "./Runs.shared";
import styles from "./Runs.module.css";

/** The coverage rows of the card, in display order (plan § Atlas element map → Coverage rows). */
const COVERAGE_ROWS: readonly CoverageLabelKey[] = ["permits_emitted", "permits_no_tcad_geoid"];

/** Helper text when the manifest carries no such coverage key (never a blank row). */
const COVERAGE_NOT_REPORTED = "Not reported in this run's manifest";

const DAY_MS = 86_400_000;

export function Component(): ReactElement {
  const [params] = useSearchParams();
  const requested = params.get("run");
  const { state, retry, index } = useRun(requested);
  const access = useAdminAccess();
  const live = useLiveRun(access.kind === "admin");
  const run = state.kind === "ready" ? state.run : undefined;
  const selected = state.kind === "ready" ? state.selected : undefined;
  const entries = index === undefined ? [] : runsByFinish(index);
  const latest = entries[entries.length - 1];
  // While a chosen run loads, the menu already marks it (the URL is the source of truth).
  const currentId = selected?.entry.runId ?? requested ?? latest?.runId;

  return (
    <section aria-label="Runs" data-route="runs" data-state={state.kind} className={styles.page}>
      {/* Board Runs1440: title, Run menu and intro on the left, Sync status on the right. */}
      <div>
        <div className={styles.pageHead}>
          <h2 className={styles.pageTitle}>Pipeline runs</h2>
          {entries.length > 0 ? <RunList entries={entries} currentId={currentId} /> : null}
          <p className={styles.intro}>
            Each run fetches every source, checks and joins them, derives roof age and contractors,
            then publishes a new manifest CID. A run never changes an earlier one. Every count comes
            from the run&apos;s manifest.
          </p>
        </div>
        {latest === undefined ? null : (
          <SyncStatus
            latest={latest}
            number={entries.length}
            run={selected?.isLatest === false ? "earlier" : run}
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
      </div>
      {state.kind === "loading" ? (
        <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {selected?.notFound == null ? null : (
        <p className={styles.helperText} role="status" data-run-not-found={selected.notFound}>
          Run <code className={styles.mono}>{selected.notFound}</code> is not in {RUNS_INDEX_PATH} ·
          showing the latest run instead.
        </p>
      )}
      {state.kind === "loading" && latest !== undefined ? <PendingSections state={state} /> : null}
      {run === undefined || selected === undefined ? (
        <ComingSoonEntries ids={["pipeline-diagram", "timeline-scrubber"]} />
      ) : (
        <div className={styles.cardGrid} data-shown-run={run.entry.runId}>
          <PipelineSteps
            manifest={run.manifest}
            manifestCid={run.manifestCid}
            label={runLabel(selected.number, run.entry.finishedAt)}
          />
          <div className={styles.wide}>
            <Timeline label={runLabel(selected.number, run.entry.finishedAt)} />
            <LatestEvents manifest={run.manifest} />
          </div>
          <WhatChanged run={run} number={selected.number} />
          <RunCard run={run} selected={selected} />
        </div>
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

/**
 * The Run menu of the board: every run, newest first, with its manifest CID (from the index).
 * Each run's title links to `?run=<runId>`; the shown run is marked (`aria-current`, a check).
 */
function RunList({
  entries,
  currentId,
}: {
  readonly entries: readonly RunsIndexEntry[];
  readonly currentId: string | undefined;
}): ReactElement {
  const newestFirst = entries.map((entry, i) => ({ entry, number: i + 1 })).reverse();
  const latestId = newestFirst[0]?.entry.runId;
  const shown = newestFirst.find(({ entry }) => entry.runId === currentId) ?? newestFirst[0];
  const menu = useRef<HTMLDetailsElement>(null);
  // The router follows the link (so open-in-new-tab works); the menu closes on the choice.
  const close = (): void => {
    if (menu.current !== null) menu.current.open = false;
  };
  return (
    <details
      ref={menu}
      className={styles.runMenu}
      data-run-list=""
      // The menu floats over the page (board "rsel-menu"): focus leaving it or Escape closes it.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.open = false;
      }}
    >
      <summary className={styles.runMenuSummary} data-current-run={shown?.entry.runId ?? ""}>
        <Icon name="history" size="medium" />
        <span>
          <span>
            {shown === undefined
              ? "No runs yet"
              : `${runLabel(shown.number, shown.entry.finishedAt)}${
                  shown.entry.runId === latestId ? " · latest" : ""
                }`}
          </span>
          {shown === undefined ? null : (
            <span>
              {formatUtc(shown.entry.finishedAt)} UTC · {shown.entry.runId}
            </span>
          )}
        </span>
        <StatusPill status="info" icon="cloud_done" text="Published" />
        <Icon name="arrow_drop_down" size="medium" />
      </summary>
      <div>
        <ul className={styles.runMenuList} aria-label="Runs, newest first">
          {newestFirst.map(({ entry, number }) => (
            <li
              key={entry.manifestCid}
              className={`${styles.runMenuItem} ${entry.runId === shown?.entry.runId ? styles.runMenuItemCurrent : ""}`}
              data-run-id={entry.runId}
            >
              <Link
                className={styles.runMenuChoice}
                to={{ search: runSearch(entry.runId, latestId) }}
                aria-current={entry.runId === shown?.entry.runId ? "true" : undefined}
                onClick={close}
                data-choose-run={entry.runId}
              >
                <span>
                  {entry.runId === shown?.entry.runId ? <Icon name="check" size="medium" /> : null}
                </span>
                <b>
                  {runLabel(number, entry.finishedAt)}
                  {entry.runId === latestId ? " · latest" : ""}
                </b>
              </Link>
              <span>
                <code className={styles.mono}>{entry.runId}</code>
                <span>
                  Manifest <CidDisplay cid={entry.manifestCid} />
                  <Link className={styles.link} to={verifyPath(entry.manifestCid)}>
                    Verify
                  </Link>
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className={styles.itemBody}>{RUNS_TEXTS.numbering}</p>
      </div>
    </details>
  );
}

/** The `/runs` query for a run: none for the latest (the default), else `?run=<runId>`. */
function runSearch(runId: string, latestId: string | undefined): string {
  return runId === latestId ? "" : `?${new URLSearchParams({ run: runId }).toString()}`;
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
  /** The latest run once read; "earlier" while the page shows an earlier run's manifest. */
  readonly run: LoadedRun | "earlier" | undefined;
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
            <time dateTime={latest.finishedAt}>{formatUtc(latest.finishedAt)}</time> UTC ·{" "}
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
            {run === undefined
              ? "Reading the manifest…"
              : run === "earlier"
                ? "Not shown · an earlier run is open; choose the latest in the Run menu"
                : countyCoverage(run.manifest)}
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

/**
 * The pipeline (board "Pipeline · Run N"): step 1 lists every fetched source with its records,
 * then steps 2–5, each with one fact the manifest holds. No step timings exist, so no times.
 */
function PipelineSteps({
  manifest,
  manifestCid,
  label,
}: {
  readonly manifest: RunManifestV1;
  readonly manifestCid: string;
  readonly label: string;
}): ReactElement {
  const coverageKeys = Object.keys(manifest.coverage).length;
  const tables = manifest.artifacts.filter((a) => a.kind === "table").length;
  const steps: readonly { name: string; icon: string; metric: string }[] = [
    { name: "Check and join", icon: "rule", metric: `${coverageKeys} coverage counts recorded` },
    { name: "Derive", icon: "auto_fix_high", metric: `${tables} published table parts` },
    {
      name: "Publish",
      icon: "cloud_upload",
      metric: `${manifest.artifacts.length} files · manifest ${manifestCid.slice(0, 8)}…`,
    },
    { name: "Verify", icon: "verified", metric: "Check it yourself on the Verify page" },
  ];
  return (
    <section
      className={`${styles.card} ${styles.wide}`}
      aria-labelledby="steps-heading"
      data-pipeline-steps=""
    >
      <div>
        <h3 id="steps-heading" className={styles.cardTitle}>
          Pipeline · {label}
        </h3>
        <p className={styles.helperText}>
          {manifest.sources.length} sources → check and join → derive → publish → verify ·{" "}
          <span className={styles.mono}>{manifest.runId}</span>
        </p>
        <p className={styles.helperText}>
          A run that is in the index finished all five steps. The manifest records no per-step
          times.
        </p>
      </div>
      <ol>
        <li className={styles.step} data-step="Fetch sources">
          <span>
            <span className={styles.stepNumber}>1</span>
            <b>
              <Icon name="cloud_download" size="medium" />
              Fetch sources
            </b>
            <span className={styles.itemBody}>
              {manifest.sources.length} of {manifest.sources.length} done
            </span>
          </span>
          <ul aria-label="Fetch step: records per feed">
            {manifest.sources.map((source) => (
              <li key={source.name} data-fetch-source={source.name}>
                <Icon name="check_circle" size="small" />
                <span>{sourceLabel(source.name)}</span>
                <span>{formatCount(source.records)}</span>
              </li>
            ))}
          </ul>
        </li>
        {steps.map((step, i) => (
          <li key={step.name} className={styles.step} data-step={step.name}>
            <span>
              <Icon name="check_circle" size="medium" />
              <span className={styles.stepNumber}>{i + 2}</span>
            </span>
            <b>
              <Icon name={step.icon} size="medium" />
              {step.name}
            </b>
            <span className={styles.itemBody}>{step.metric}</span>
            <span>Done</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Board "Timeline · Run N": the manifest has a start, one capture time per source and a finish,
 * no per-step start and end, so the Gantt chart stays Coming soon and the card shows the run's
 * own times (the board's "Show as table" view of what exists).
 */
function Timeline({ label }: { readonly label: string }): ReactElement {
  return (
    <section className={styles.card} aria-labelledby="timeline-heading" data-timeline="">
      <h3 id="timeline-heading" className={styles.cardTitle}>
        Timeline · {label}
      </h3>
      <p className={styles.helperText}>
        The manifest records no per-step times, so the chart is not drawn; the run card below gives
        its start and finish.
      </p>
      <ComingSoonEntries ids={["pipeline-diagram", "timeline-scrubber"]} />
    </section>
  );
}

const EVENT_ICONS: Readonly<Record<RunEvent["kind"], { readonly icon: string }>> = {
  started: { icon: "play_arrow" },
  captured: { icon: "cloud_download" },
  finished: { icon: "cloud_upload" },
};

function LatestEvents({ manifest }: { readonly manifest: RunManifestV1 }): ReactElement {
  const events = runEvents([manifest]).slice(-5).reverse();
  return (
    <section className={styles.card} aria-labelledby="events-heading" data-latest-events="">
      <div className={styles.cardHead}>
        <h3 id="events-heading" className={styles.cardTitle}>
          Latest events
        </h3>
        <Link className={styles.textLink} to={ROUTES.runsLog}>
          Full log
        </Link>
      </div>
      <ul className={styles.list}>
        {events.map((event, i) => (
          <li key={i} data-event={event.kind}>
            <Icon name={EVENT_ICONS[event.kind].icon} size="small" />
            <span>
              <span>{eventLabel(event)}</span>
              <span className={styles.itemBody}>
                <time dateTime={event.time}>{formatUtc(event.time)}</time> UTC ·{" "}
                <span className={styles.mono}>{event.runId}</span>
              </span>
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
  const sum = (key: "added" | "changed" | "removed"): number =>
    manifest.sources.reduce((total, s) => total + s[key], 0);
  const added = sum("added");
  const changed = sum("changed");
  const removed = sum("removed");
  const total = added + changed + removed;
  return (
    <section
      className={`${styles.card} ${styles.wide}`}
      aria-labelledby="changed-heading"
      data-what-changed=""
    >
      <div className={styles.cardHead}>
        <div>
          <h3 id="changed-heading" className={styles.cardTitle}>
            What Run {number} changed
          </h3>
          <p className={styles.helperText}>
            {first ? RUNS_TEXTS.firstRun : `Counted against Run ${number - 1}'s manifest.`}
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
      <div>
        <div>
          {first ? null : (
            <p className={styles.itemBody}>
              Changes in Run {number} vs Run {number - 1} · <b data-total-changes="">{total}</b>{" "}
              records · added <b>{formatCount(added)}</b> · changed <b>{formatCount(changed)}</b> ·
              removed <b>{formatCount(removed)}</b>
            </p>
          )}
          <div data-cid-boxes="">
            <div>
              <span className={styles.tileLabel}>Manifest CID</span>
              <span>
                <CidDisplay cid={manifestCid} />
                <Link className={styles.link} to={verifyPath(manifestCid)}>
                  Verify
                </Link>
              </span>
            </div>
            <div>
              <span className={styles.tileLabel}>Previous manifest CID</span>
              <span>
                {manifest.previousManifestCid === null ? (
                  RUNS_TEXTS.firstRun
                ) : (
                  <CidDisplay cid={manifest.previousManifestCid} />
                )}
              </span>
            </div>
          </div>
        </div>
        <div>
          <p className={styles.changeRow} aria-hidden="true">
            <span>Source</span>
            <span className={styles.num}>Records</span>
            <span>Changed records (one scale for this run)</span>
            <span className={styles.num}>+ / ~ / −</span>
          </p>
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
        </div>
      </div>
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

function RunCard({
  run,
  selected,
}: {
  readonly run: LoadedRun;
  readonly selected: SelectedRun;
}): ReactElement {
  const { manifest, manifestCid, read } = run;
  const groups = dataGroupItems(manifest);
  return (
    <article className={`${styles.card} ${styles.wide}`} aria-labelledby="run-title">
      <header className={styles.header}>
        <h2 id="run-title" className={styles.title}>
          {manifest.runId}
        </h2>
        <FallbackChip source={read.source} />
      </header>
      <div>
        <p className={styles.times} data-run-number={selected.number}>
          {runLabel(selected.number, run.entry.finishedAt)} ·{" "}
          {selected.isLatest ? "the latest run" : "an earlier run (choose another in the Run menu)"}
        </p>
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
      </div>

      <div>
        <div>
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
          <ul aria-labelledby="groups-heading">
            {groups.map((item) => (
              <GroupItem key={item.artifact.name} item={item} />
            ))}
          </ul>
        </div>

        <div>
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
        </div>
      </div>

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
