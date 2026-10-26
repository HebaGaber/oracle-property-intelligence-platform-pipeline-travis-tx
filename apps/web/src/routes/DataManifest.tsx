// Data · Manifest (`/data/manifest`; A-13 T023, AC-3, FR-003c, FR-003d, FR-016; TC-005, TC-018,
// TC-019, TC-024). The run chain first: from the latest manifest back through
// `previousManifestCid` (data/run-chain), each run with its CID (Copy CID), finish time, previous
// CID or "previous: none", and a Verify link. Then the Atlas data table of every manifest artifact:
// name, CID, codec, size, SHA-256, CAR, and the action: "Verify" for a file ≤ 50 MB, "Verify via
// CAR" (linking to its CAR's Verify page when it has one) for a directory or a larger file. Every
// value is the manifest's; the fallback chip names Filebase when it served the read. A
// react-router lazy route module.
import type { ManifestArtifact, RunManifestV1 } from "@countylens/contract";
import { PROGRESS_LABELS, VERIFY_TEXTS, verifyPath } from "@countylens/shared";
import { useEffect, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router";
import { DataTabs } from "../components/DataTabs";
import { ErrorBanner } from "../components/ErrorBanner";
import { CidDisplay } from "../components/CidDisplay";
import { FallbackChip } from "../components/FallbackChip";
import { LinearProgress } from "../components/LinearProgress";
import { Provenance } from "../components/Provenance";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { utcTimestamp } from "../data/format";
import { loadRunChain, type RunChainLink } from "../data/run-chain";
import type { LoadedRun } from "../data/run-loader";
import { runNumbers, runsByFinish } from "../data/runs-index";
import { VERIFY_MAX_BYTES } from "../data/verify-lane";
import {
  RUN_STAGE_TEXTS,
  runErrorNode,
  loadManifestByCid,
  runLabel,
  toRunLoadError,
  useLatestRun,
  type RunLoadError,
} from "./Runs.shared";
import runStyles from "./Runs.module.css";
import styles from "./DataManifest.module.css";

/** Shown in the CAR column of an artifact the manifest lists no CAR for (never blank). */
const NO_CAR_TEXT = "no CAR listed for this artifact";

export function Component(): ReactElement {
  const { state, retry } = useLatestRun();
  // The run picker: `?run={runId}` shows that indexed run's manifest; no parameter (or an
  // unknown run) shows the latest.
  const [params, setParams] = useSearchParams();
  const latest = state.kind === "ready" ? state.run : undefined;
  const wanted = params.get("run");
  const entry = latest?.index.runs.find(
    (r) => r.runId === wanted && r.runId !== latest.entry.runId,
  );
  const [other, setOther] = useState<LoadedRun | RunLoadError>();
  useEffect(() => {
    setOther(undefined);
    if (latest === undefined || entry === undefined) return;
    const controller = new AbortController();
    loadManifestByCid(entry.manifestCid, controller.signal).then(
      (read) => !controller.signal.aborted && setOther({ ...latest, entry, ...read }),
      (error: unknown) => !controller.signal.aborted && setOther(toRunLoadError(error)),
    );
    return () => controller.abort();
  }, [latest, entry]);
  const failed = other && !("manifest" in other) ? other : undefined;
  const shown = entry ? (failed ? undefined : (other as LoadedRun | undefined)) : latest;
  return (
    <section
      aria-label="Data · Manifest"
      data-route="data-manifest"
      data-state={state.kind}
      className={styles.page}
    >
      <h2 className={runStyles.title}>Data · Manifest</h2>
      <DataTabs current="manifest" verifyCid={shown?.manifestCid ?? null} />
      {latest && (
        <select
          className={runStyles.select}
          aria-label="Run"
          value={entry?.runId ?? latest.entry.runId}
          onChange={(e) => setParams({ run: e.target.value })}
        >
          {runsByFinish(latest.index)
            .map((r, i) => (
              <option key={r.runId} value={r.runId}>
                {runLabel(i + 1, r.finishedAt)}
              </option>
            ))
            .reverse()}
        </select>
      )}
      {failed && <ErrorBanner message={runErrorNode(failed)} />}
      {entry && !other && <Skeleton variant="rows" />}
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="rows" />
        </>
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {shown ? <ManifestView run={shown} /> : null}
    </section>
  );
}

function ManifestView({ run }: { readonly run: LoadedRun }): ReactElement {
  const { manifest, manifestCid, read } = run;
  return (
    <>
      <div className={runStyles.header}>
        <span className={runStyles.itemBody}>
          Run {manifest.runId} · manifest <CidDisplay cid={manifestCid} />
        </span>
        <FallbackChip source={read.source} />
      </div>
      <RunChain head={manifestCid} headManifest={manifest} numbers={runNumbers(run.index)} />
      <ArtifactTable manifest={manifest} />
      <Provenance>
        Manifest <CidDisplay cid={manifestCid} /> · run {manifest.runId} · read from{" "}
        {read.source.host}
      </Provenance>
    </>
  );
}

type ChainState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly chain: readonly RunChainLink[] }
  | { readonly kind: "error"; readonly error: RunLoadError };

function RunChain({
  head,
  headManifest,
  numbers,
}: {
  readonly head: string;
  readonly headManifest: RunManifestV1;
  /** "Run N" by run ID, from runs/index.json (the header badge, Runs and Log numbering). */
  readonly numbers: ReadonlyMap<string, number>;
}): ReactElement {
  const [state, setState] = useState<ChainState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const load = async (cid: string): Promise<RunManifestV1> =>
      cid === head ? headManifest : (await loadManifestByCid(cid, controller.signal)).manifest;
    loadRunChain(head, load).then(
      (chain) => {
        if (!controller.signal.aborted) setState({ kind: "ready", chain });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", error: toRunLoadError(error) });
      },
    );
    return () => controller.abort();
  }, [head, headManifest]);

  return (
    <section className={runStyles.card} aria-labelledby="chain-heading">
      <h3 id="chain-heading" className={runStyles.sectionTitle}>
        Run chain
      </h3>
      {state.kind === "loading" ? <Skeleton variant="cards" count={1} /> : null}
      {state.kind === "error" ? <ErrorBanner message={runErrorNode(state.error)} /> : null}
      {state.kind === "ready" ? (
        <ul className={styles.chainCards} aria-label="Run chain">
          {state.chain.map((link, i) => (
            <li
              key={link.manifestCid}
              className={`${styles.chainCard} ${i === 0 ? styles.chainCurrent : ""}`}
              data-chain-entry=""
              data-cid={link.manifestCid}
            >
              <span className={styles.chainLabel} data-chain-label="">
                Run {numbers.get(link.runId) ?? "not in the index"}
                {i === 0 ? <span className={styles.chainThis}> · this run</span> : null}
              </span>
              <span className={runStyles.itemTitle}>
                <code className={runStyles.mono}>{link.runId}</code>
                <CidDisplay cid={link.manifestCid} />
              </span>
              <span className={runStyles.itemBody}>
                finished {utcTimestamp(link.finishedAt)} UTC ·{" "}
                {link.previousManifestCid === null ? (
                  "previous: none"
                ) : (
                  <>
                    previous: <CidDisplay cid={link.previousManifestCid} />
                  </>
                )}
              </span>
              <span>
                <Link className={styles.actionLink} to={verifyPath(link.manifestCid)}>
                  Verify
                </Link>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Sizes as the board shows them (B, KB, MB, GB; 1 KB = 1,024 bytes); exact bytes in the title. */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function needsCar(artifact: ManifestArtifact): boolean {
  return artifact.kind === "directory" || artifact.size > VERIFY_MAX_BYTES;
}

function ArtifactTable({ manifest }: { readonly manifest: RunManifestV1 }): ReactElement {
  return (
    <section className={runStyles.card} aria-labelledby="artifacts-heading">
      <h3 id="artifacts-heading" className={runStyles.sectionTitle}>
        Artifacts ({manifest.artifacts.length})
      </h3>
      <div className={styles.scroll}>
        <table className={styles.table} aria-label="Artifacts">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">CID</th>
              <th scope="col">Codec</th>
              <th scope="col">Size</th>
              <th scope="col">SHA-256</th>
              <th scope="col">CAR</th>
              <th scope="col">Check</th>
            </tr>
          </thead>
          <tbody>
            {manifest.artifacts.map((artifact) => (
              <tr key={artifact.name} data-artifact={artifact.name}>
                <td className={styles.mono}>{artifact.name}</td>
                <td>
                  <CidDisplay cid={artifact.cid} />
                </td>
                <td className={styles.mono} data-codec={artifact.codec}>
                  {artifact.codec}
                </td>
                <td
                  className={styles.num}
                  data-size={artifact.size}
                  title={`${artifact.size} bytes`}
                >
                  {humanBytes(artifact.size)}
                </td>
                <td className={styles.digest} data-sha256={artifact.sha256} title={artifact.sha256}>
                  {artifact.sha256.slice(0, 8)}…{artifact.sha256.slice(-4)}
                </td>
                <td>
                  {artifact.carCid === undefined ? (
                    <StatusPill status="unavailable" text={NO_CAR_TEXT} />
                  ) : (
                    <span data-car-cid={artifact.carCid}>
                      <CidDisplay cid={artifact.carCid} />
                    </span>
                  )}
                </td>
                <td>
                  {!needsCar(artifact) ? (
                    <Link className={styles.actionLink} to={verifyPath(artifact.cid)}>
                      Verify
                    </Link>
                  ) : artifact.carCid !== undefined ? (
                    <Link className={styles.actionLink} to={verifyPath(artifact.carCid)}>
                      {VERIFY_TEXTS.viaCar}
                    </Link>
                  ) : (
                    <span className={styles.mono}>{VERIFY_TEXTS.viaCar}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
