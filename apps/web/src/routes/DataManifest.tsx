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
import { Link } from "react-router";
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
import { VERIFY_MAX_BYTES } from "../data/verify-lane";
import {
  RUN_STAGE_TEXTS,
  runErrorNode,
  loadManifestByCid,
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
  return (
    <section
      aria-label="Data · Manifest"
      data-route="data-manifest"
      data-state={state.kind}
      className={styles.page}
    >
      <h2 className={runStyles.title}>Data · Manifest</h2>
      {state.kind === "loading" ? (
        <>
          <LinearProgress label={PROGRESS_LABELS.runs} stageText={RUN_STAGE_TEXTS[state.stage]} />
          <Skeleton variant="rows" />
        </>
      ) : null}
      {state.kind === "error" ? (
        <ErrorBanner message={runErrorNode(state.error)} onRetry={retry} />
      ) : null}
      {state.kind === "ready" ? <ManifestView run={state.run} /> : null}
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
      <RunChain head={manifestCid} headManifest={manifest} />
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
}: {
  readonly head: string;
  readonly headManifest: RunManifestV1;
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
        <ul className={runStyles.list} aria-label="Run chain">
          {state.chain.map((link) => (
            <li
              key={link.manifestCid}
              className={runStyles.item}
              data-chain-entry=""
              data-cid={link.manifestCid}
            >
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
              <th scope="col">Size (bytes)</th>
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
                <td className={styles.num} data-size={artifact.size}>
                  {artifact.size}
                </td>
                <td className={styles.digest} data-sha256={artifact.sha256}>
                  {artifact.sha256}
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
