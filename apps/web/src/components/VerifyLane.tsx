// One Verify lane (A-13 T023; research R3, data-model.md VerifyLane; AC-3, AC-7, FR-003,
// FR-003a–c): an Atlas outlined card per public gateway with the operator name, the exact URL,
// the manifest's size and SHA-256 and, once the bytes arrived, the received size and the SHA-256
// computed in this page. The lane runs data/verify-lane's state machine on mount (a simple CORS
// GET, never the CID copy; backoff 2/4/8 s) and shows each state: retrying → "rate-limited,
// retrying" or "no readable response (rate-limited or blocked), retrying"; ✓ only in `verified`;
// a mismatch shows both values. `data-lane` / `data-state` are the hooks the hosted tests read.
// `fetch` and `sleep` are injectable for the unit tests only.
import { VERIFY_TEXTS } from "@countylens/shared";
import { useEffect, useState, type ReactElement } from "react";
import {
  runVerifyLane,
  type LaneState,
  type VerifyGateway,
  type VerifyTarget,
} from "../data/verify-lane";
import { StatusPill } from "./StatusPill";
import styles from "./VerifyLane.module.css";

export const GATEWAY_OPERATORS: Readonly<Record<VerifyGateway, string>> = {
  pinata: "Pinata",
  filebase: "Filebase",
};

export interface VerifyLaneProps {
  readonly gateway: VerifyGateway;
  /** `https://{gateway host}/ipfs/{cid}` (verifyLaneUrl). */
  readonly url: string;
  readonly target: VerifyTarget;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function VerifyLane({
  gateway,
  url,
  target,
  fetch: fetchImpl,
  sleep,
}: VerifyLaneProps): ReactElement {
  const [state, setState] = useState<LaneState>({ kind: "idle" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "idle" });
    runVerifyLane({
      url,
      target,
      signal: controller.signal,
      onState: (next) => {
        if (!controller.signal.aborted) setState(next);
      },
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      ...(sleep === undefined ? {} : { sleep }),
    }).catch(() => undefined);
    return () => controller.abort();
  }, [url, target, fetchImpl, sleep]);

  const titleId = `lane-${gateway}`;
  const gotSize =
    state.kind === "verified" ? state.size : state.kind === "mismatch" ? state.got.size : 0;
  const gotSha =
    state.kind === "verified" ? state.sha256 : state.kind === "mismatch" ? state.got.sha256 : "";
  return (
    <section
      className={styles.lane}
      aria-labelledby={titleId}
      data-lane={gateway}
      data-state={state.kind}
    >
      <h3 id={titleId} className={styles.title}>
        {state.kind === "verified" ? (
          <span className={styles.check} aria-label="verified">
            ✓
          </span>
        ) : null}
        {GATEWAY_OPERATORS[gateway]}
      </h3>
      <p className={styles.url}>
        <code>{url}</code>
      </p>
      <dl className={styles.values}>
        <dt>Manifest size</dt>
        <dd data-expected-size="" data-value={target.size}>
          {target.size}
        </dd>
        <dt>Manifest SHA-256</dt>
        <dd className={styles.digest} data-expected-sha256="" data-value={target.sha256}>
          {target.sha256}
        </dd>
        {state.kind === "verified" || state.kind === "mismatch" ? (
          <>
            <dt>Received size</dt>
            <dd data-got-size="" data-value={gotSize}>
              {gotSize}
            </dd>
            <dt>SHA-256 computed here</dt>
            <dd className={styles.digest} data-got-sha256="" data-value={gotSha}>
              {gotSha}
            </dd>
          </>
        ) : null}
      </dl>
      <LaneStatus state={state} />
    </section>
  );
}

/** One persistent polite region: its children change, so every state (final ones too) is spoken. */
function LaneStatus({ state }: { readonly state: LaneState }): ReactElement {
  return (
    <p className={styles.status} role="status" aria-live="polite">
      <LaneStatusBody state={state} />
    </p>
  );
}

function LaneStatusBody({ state }: { readonly state: LaneState }): ReactElement {
  switch (state.kind) {
    case "idle":
    case "fetching":
      return <>Fetching{state.kind === "fetching" ? ` · try ${state.attempt}` : ""}</>;
    case "retrying":
      return (
        <>
          <StatusPill status="warning" text={state.text} /> next try in{" "}
          {Math.round(state.delayMs / 1000)} s
        </>
      );
    case "verified":
      return <StatusPill status="verified" text={VERIFY_TEXTS.verified} />;
    case "mismatch":
    case "failed":
      return (
        <span role="alert">
          <StatusPill status="error" text={state.text} />
        </span>
      );
    case "via_car":
      return <StatusPill status="info" text={state.text} />;
  }
}
