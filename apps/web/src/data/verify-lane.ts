// Verify lanes (A-13 T014, research R3, data-model.md VerifyLane; AM-01, ERR-15): one lane per
// public gateway (Pinata, Filebase), never the CID copy. Each lane makes a "simple" CORS GET
// (credentials omitted, no Range, no custom header, so no preflight), hashes the body with
// WebCrypto SHA-256 and compares size and digest with the manifest; a raw CID must also equal
// the bytes' raw-leaves CID. ✓ (`verified`) only on a full match; a difference is a `mismatch`
// with both values.
// States: idle → fetching(n) → retrying(n) → verified | mismatch | failed | via_car.
//   - a readable 429 → "rate-limited, retrying" (a numeric Retry-After is honoured);
//   - an unreadable response (TypeError: Filebase sends its 429 without CORS) or no response
//     within 30 s → "no readable response (rate-limited or blocked), retrying";
//   - backoff 2, 4 then 8 s: the first try plus at most 3 retries, then `failed`;
//   - another HTTP status fails at once, naming the status;
//   - a directory, or a file over 50 MB, is `via_car` with no request.
import { rawCid } from "@countylens/query-core";
import {
  VERIFY_TEXTS,
  readPathUrls,
  type GatewayName,
  type ReadPathUrls,
  type SizeAndDigest,
} from "@countylens/shared";
import { CID_COPY_HOST_KEY, FILEBASE_GATEWAY_HOST_KEY, viteEnv, type WebEnv } from "./config";
import { browserFetch } from "./http";

export const PINATA_GATEWAY_HOST_KEY = "VITE_PINATA_GATEWAY_HOST";
export const VERIFY_BACKOFF_MS = [2000, 4000, 8000] as const;
export const VERIFY_TIMEOUT_MS = 30_000;
export const VERIFY_MAX_BYTES = 50 * 1024 * 1024;
/** A Retry-After longer than this is capped (the lane stays responsive). */
export const VERIFY_MAX_RETRY_AFTER_MS = 60_000;

export type VerifyGateway = GatewayName;
export const VERIFY_GATEWAYS: readonly VerifyGateway[] = ["pinata", "filebase"];

export interface VerifyTarget {
  readonly cid: string;
  readonly size: number;
  readonly sha256: string;
  readonly kind: "car" | "table" | "directory";
  readonly codec: string;
}

export type RetryReason = "rate_limited" | "no_readable_response";

export type LaneState =
  | { readonly kind: "idle" }
  | { readonly kind: "fetching"; readonly attempt: number }
  | {
      readonly kind: "retrying";
      readonly attempt: number;
      readonly reason: RetryReason;
      readonly text: string;
      readonly delayMs: number;
    }
  | { readonly kind: "verified"; readonly size: number; readonly sha256: string }
  | {
      readonly kind: "mismatch";
      readonly got: SizeAndDigest;
      readonly expected: SizeAndDigest;
      readonly text: string;
    }
  | { readonly kind: "failed"; readonly text: string }
  | { readonly kind: "via_car"; readonly text: string };

/** The gateway URL of a lane: `https://{gateway host}/ipfs/{cid}` (never the CID copy). */
export function verifyLaneUrl(urls: ReadPathUrls, gateway: VerifyGateway, cid: string): string {
  return urls.gatewayUrl(cid, gateway);
}

/** Read-path URLs with both gateways from the build environment (VITE_PINATA_GATEWAY_HOST too). */
export function verifyUrlsFromEnv(env: WebEnv = viteEnv): ReadPathUrls {
  const need = (key: string): string => {
    const value = env(key);
    if (value === undefined) throw new Error(`${key} is not set in the web build environment`);
    return value;
  };
  return readPathUrls({
    cidCopyHost: need(CID_COPY_HOST_KEY),
    filebaseGatewayHost: need(FILEBASE_GATEWAY_HOST_KEY),
    pinataGatewayHost: need(PINATA_GATEWAY_HOST_KEY),
  });
}

export interface RunVerifyLaneOptions {
  readonly url: string;
  readonly target: VerifyTarget;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onState?: (state: LaneState) => void;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Attempt =
  | { readonly kind: "bytes"; readonly bytes: Uint8Array }
  | { readonly kind: "retry"; readonly reason: RetryReason; readonly retryAfterMs?: number }
  | { readonly kind: "status"; readonly status: number };

async function attempt(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  outer: AbortSignal | undefined,
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forward = (): void => controller.abort(outer?.reason);
  outer?.addEventListener("abort", forward, { once: true });
  try {
    const response = await fetchImpl(url, { credentials: "omit", signal: controller.signal });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After"));
      return Number.isFinite(seconds) && seconds > 0
        ? {
            kind: "retry",
            reason: "rate_limited",
            retryAfterMs: Math.min(seconds * 1000, VERIFY_MAX_RETRY_AFTER_MS),
          }
        : { kind: "retry", reason: "rate_limited" };
    }
    if (response.status !== 200) return { kind: "status", status: response.status };
    return { kind: "bytes", bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    if (outer?.aborted === true) throw error;
    return { kind: "retry", reason: "no_readable_response" };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
}

const RETRY_TEXT: Record<RetryReason, string> = {
  rate_limited: VERIFY_TEXTS.rateLimited,
  no_readable_response: VERIFY_TEXTS.noReadableResponse,
};
const GAVE_UP: Record<RetryReason, string> = {
  rate_limited: "rate-limited",
  no_readable_response: "no readable response",
};

/** Runs one lane to its final state, reporting every state through `onState`. */
export async function runVerifyLane(options: RunVerifyLaneOptions): Promise<LaneState> {
  const { url, target } = options;
  const fetchImpl = options.fetch ?? browserFetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS;
  const report = (state: LaneState): LaneState => {
    options.onState?.(state);
    return state;
  };

  if (target.kind === "directory" || target.size > VERIFY_MAX_BYTES) {
    return report({ kind: "via_car", text: VERIFY_TEXTS.viaCar });
  }
  const tries = VERIFY_BACKOFF_MS.length + 1;
  for (let n = 1; n <= tries; n++) {
    report({ kind: "fetching", attempt: n });
    const result = await attempt(url, fetchImpl, timeoutMs, options.signal);
    if (result.kind === "status") {
      return report({
        kind: "failed",
        text: VERIFY_TEXTS.notVerified(`${new URL(url).host} answered HTTP ${result.status}`),
      });
    }
    if (result.kind === "retry") {
      const delay = VERIFY_BACKOFF_MS[n - 1];
      if (delay === undefined) {
        return report({
          kind: "failed",
          text: VERIFY_TEXTS.notVerified(`${GAVE_UP[result.reason]} after ${tries} tries`),
        });
      }
      const delayMs = result.retryAfterMs ?? delay;
      report({
        kind: "retrying",
        attempt: n,
        reason: result.reason,
        text: RETRY_TEXT[result.reason],
        delayMs,
      });
      await sleep(delayMs);
      continue;
    }
    const got: SizeAndDigest = { size: result.bytes.length, sha256: await sha256Hex(result.bytes) };
    const expected: SizeAndDigest = { size: target.size, sha256: target.sha256 };
    const cidMatches = target.codec !== "raw" || (await rawCid(result.bytes)) === target.cid;
    if (got.size === expected.size && got.sha256 === expected.sha256 && cidMatches) {
      return report({ kind: "verified", size: got.size, sha256: got.sha256 });
    }
    return report({ kind: "mismatch", got, expected, text: VERIFY_TEXTS.mismatch(got, expected) });
  }
  return report({ kind: "failed", text: VERIFY_TEXTS.notVerified("no answer") });
}
