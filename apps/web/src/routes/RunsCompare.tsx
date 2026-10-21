// Runs · Compare (`/runs/compare?a=&b=`; A-13 T020, AC-1, FR-001a, FR-001b, FR-016; TC-007,
// TC-014, TC-015). `a` and `b` are 1-based run numbers in `runs/index.json` order (default: the
// run before the latest, and the latest). With one published run the page says "first run ·
// nothing to compare against" and links to it; nothing is invented. With two it shows both runs
// (run ID, manifest CID, finish time, fallback chip when Filebase served the read), run b's
// `previousManifestCid` link and its per-source deltas, and the old-manifest check: a plain GET
// of run a's manifest on Pinata and on Filebase (data/run-chain, never the CID copy); "old
// manifest still resolves on Pinata and Filebase" appears only after both answered with bytes of
// that CID. A react-router lazy route module.
import type { RunManifestV1 } from "@countylens/contract";
import { PROGRESS_LABELS, ROUTES, RUNS_TEXTS, verifyPath } from "@countylens/shared";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router";
import { ErrorBanner } from "../components/ErrorBanner";
import { CidDisplay } from "../components/CidDisplay";
import { FallbackChip } from "../components/FallbackChip";
import { LinearProgress } from "../components/LinearProgress";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import type { ReadSource } from "../data/fetch-by-cid";
import { utcTimestamp } from "../data/format";
import {
  checkManifestResolves,
  oldManifestResolvesText,
  type ChainResolves,
  type GatewayCheck,
} from "../data/run-chain";
import type { RunsIndexEntry } from "../data/runs-index";
import { verifyUrlsFromEnv } from "../data/verify-lane";
import {
  RUN_STAGE_TEXTS,
  runErrorNode,
  SourceDeltas,
  loadManifestByCid,
  toRunLoadError,
  useLatestRun,
  type RunLoadError,
} from "./Runs.shared";
import styles from "./Runs.module.css";

const GATEWAY_LABELS = { pinata: "Pinata", filebase: "Filebase" } as const;
const CHECK_LABELS: Readonly<Record<GatewayCheck, string>> = {
  pending: "checking",
  resolves: "answered with the manifest's bytes",
  fails: "did not serve the manifest's bytes",
};

interface ComparedRun {
  readonly n: number;
  readonly entry: RunsIndexEntry;
  readonly manifest: RunManifestV1;
  readonly source: ReadSource;
}

function runNumber(value: string | null, fallback: number): number {
  const n = value === null ? NaN : Number(value);
  return Number.isInteger(n) ? n : fallback;
}

export function Component(): ReactElement {
  const { state, retry } = useLatestRun();
  const [params] = useSearchParams();
  return (
    <section
      aria-label="Runs · Compare"
      data-route="runs-compare"
      data-state={state.kind}
      className={styles.page}
    >
      <h2 className={styles.title}>Runs · Compare</h2>
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="cards" count={2} />
        </>
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {state.kind === "ready" ? (
        <ComparePair
          entries={[...state.run.index.runs].sort(
            (x, y) => Date.parse(x.finishedAt) - Date.parse(y.finishedAt),
          )}
          a={params.get("a")}
          b={params.get("b")}
        />
      ) : null}
    </section>
  );
}

function ComparePair({
  entries,
  a,
  b,
}: {
  readonly entries: readonly RunsIndexEntry[];
  readonly a: string | null;
  readonly b: string | null;
}): ReactElement {
  const count = entries.length;
  const bn = runNumber(b, count);
  const an = runNumber(a, bn - 1);
  const valid = count >= 2 && an >= 1 && bn <= count && an < bn;
  const ea = valid ? entries[an - 1] : undefined;
  const eb = valid ? entries[bn - 1] : undefined;

  if (ea === undefined || eb === undefined) {
    const only = entries[count - 1];
    return (
      <article
        className={styles.card}
        data-compare-run=""
        data-cid={only?.manifestCid}
        aria-label="Single run"
      >
        <p className={styles.times}>{RUNS_TEXTS.firstRun}</p>
        {only === undefined ? null : (
          <p className={styles.itemBody}>
            <Link className={styles.link} to={ROUTES.runs}>
              {only.runId}
            </Link>{" "}
            · <CidDisplay cid={only.manifestCid} />
          </p>
        )}
      </article>
    );
  }
  return <TwoRuns key={`${an}-${bn}`} a={{ n: an, entry: ea }} b={{ n: bn, entry: eb }} />;
}

type PairState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly a: ComparedRun; readonly b: ComparedRun }
  | { readonly kind: "error"; readonly error: RunLoadError };

function TwoRuns({
  a,
  b,
}: {
  readonly a: { readonly n: number; readonly entry: RunsIndexEntry };
  readonly b: { readonly n: number; readonly entry: RunsIndexEntry };
}): ReactElement {
  const [state, setState] = useState<PairState>({ kind: "loading" });
  const { n: an, entry: ea } = a;
  const { n: bn, entry: eb } = b;
  useEffect(() => {
    const controller = new AbortController();
    const load = async (run: {
      readonly n: number;
      readonly entry: RunsIndexEntry;
    }): Promise<ComparedRun> => {
      const loaded = await loadManifestByCid(run.entry.manifestCid, controller.signal);
      return { ...run, manifest: loaded.manifest, source: loaded.read.source };
    };
    Promise.all([load({ n: an, entry: ea }), load({ n: bn, entry: eb })]).then(
      ([ra, rb]) => {
        if (!controller.signal.aborted) setState({ kind: "ready", a: ra, b: rb });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", error: toRunLoadError(error) });
      },
    );
    return () => controller.abort();
    // The pair is keyed by its run numbers (ComparePair), so the entries are fixed for a mount.
  }, [ea.manifestCid, eb.manifestCid]);

  if (state.kind === "loading") return <Skeleton variant="cards" count={2} />;
  if (state.kind === "error") return <ErrorBanner message={runErrorNode(state.error)} />;
  return (
    <>
      <div className={styles.page}>
        <RunColumn run={state.a} />
        <RunColumn run={state.b} />
      </div>
      <OldManifestCheck cid={state.a.entry.manifestCid} />
    </>
  );
}

function RunColumn({ run }: { readonly run: ComparedRun }): ReactElement {
  const { manifest, entry } = run;
  const titleId = `compare-run-${run.n}`;
  const totalSize = manifest.artifacts.reduce((sum, a) => sum + a.size, 0);
  const car = manifest.artifacts.find((a) => a.kind === "car");
  return (
    <article
      className={styles.card}
      aria-labelledby={titleId}
      data-compare-run={run.n}
      data-cid={entry.manifestCid}
    >
      <header className={styles.header}>
        <h3 id={titleId} className={styles.title}>
          Run {run.n} · {manifest.runId}
        </h3>
        <FallbackChip source={run.source} />
      </header>
      <p className={styles.itemBody}>
        Manifest <CidDisplay cid={entry.manifestCid} />
      </p>
      <p className={styles.times}>Finished {utcTimestamp(manifest.finishedAt)} UTC</p>
      <p className={styles.itemBody}>
        Previous manifest:{" "}
        {manifest.previousManifestCid === null ? (
          <span>{RUNS_TEXTS.firstRun}</span>
        ) : (
          <Link
            className={styles.link}
            to={verifyPath(manifest.previousManifestCid)}
            data-previous-cid={manifest.previousManifestCid}
          >
            {manifest.previousManifestCid}
          </Link>
        )}
      </p>
      <p className={styles.itemBody}>
        Artifacts: {manifest.artifacts.length} ·{" "}
        <span data-total-size={totalSize}>{totalSize} bytes in total</span>
        {car === undefined ? null : (
          <>
            {" · "}
            <Link className={styles.link} to={verifyPath(car.cid)} data-car-link={car.cid}>
              CAR {car.name}
            </Link>
          </>
        )}
      </p>
      <ul className={styles.list} aria-label={`Sources of run ${run.n}`}>
        {manifest.sources.map((source) => (
          <li key={source.name} className={styles.item} data-source={source.name}>
            <span className={styles.itemTitle}>
              <code className={styles.mono}>{source.name}</code>
            </span>
            <span className={styles.itemBody}>
              {source.records} records ·{" "}
              <SourceDeltas
                added={source.added}
                changed={source.changed}
                removed={source.removed}
                firstRun={manifest.previousManifestCid === null}
              />
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function OldManifestCheck({ cid }: { readonly cid: string }): ReactElement {
  const [resolves, setResolves] = useState<ChainResolves>({
    pinata: "pending",
    filebase: "pending",
  });
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResolves({ pinata: "pending", filebase: "pending" });
    setFailure(null);
    let urls: ReturnType<typeof verifyUrlsFromEnv>;
    try {
      urls = verifyUrlsFromEnv();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return () => controller.abort();
    }
    checkManifestResolves(cid, { urls, signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setResolves(result);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [cid, attempt]);
  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  const text = oldManifestResolvesText(resolves);
  return (
    <section className={styles.card} aria-labelledby="old-manifest-heading">
      <h3 id="old-manifest-heading" className={styles.sectionTitle}>
        Old manifest on the public gateways
      </h3>
      {text === null ? null : <StatusPill status="verified" text={text} />}
      {failure === null ? null : <StatusPill status="error" text={failure} />}
      <ul className={styles.list}>
        {(["pinata", "filebase"] as const).map((gateway) => (
          <li
            key={gateway}
            className={`${styles.item} ${styles.itemBody}`}
            data-gateway={gateway}
            data-check={resolves[gateway]}
          >
            {GATEWAY_LABELS[gateway]}: {CHECK_LABELS[resolves[gateway]]}
          </li>
        ))}
      </ul>
      <p className={styles.itemBody}>
        <button type="button" className={styles.action} onClick={recheck}>
          Re-check
        </button>
      </p>
    </section>
  );
}
