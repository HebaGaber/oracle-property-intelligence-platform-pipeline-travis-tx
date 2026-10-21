// A-03 T007 stub (interface fixed for T042/T054, G-C3/G-C4): read one published artifact by
// CID from the CID copy first, then the Filebase gateway as the labelled fallback (research
// R-01; data-model.md § FetchByCid state; PO decision D-2). The fallback triggers on a network
// error, a non-200 or no first byte within FIRST_BYTE_TIMEOUT_MS; a 429 on the fallback is a
// non-200 (Error state). The host that served the manifest is the host `partUrl` binds for the
// table parts, so one load never mixes hosts. Browser-safe: hosts come in through `urls`.
import type { ReadPathUrls } from "@countylens/shared";

/** D-2: the copy must deliver a first byte within 4 s or the read falls back. */
export const FIRST_BYTE_TIMEOUT_MS = 4000;

/** plan § "Fixed texts": the error-banner text when neither host served the bytes (TC-032 step 5). */
export const BOTH_HOSTS_DOWN_TEXT =
  "Data could not be reached from the CID copy or the Filebase gateway";

/** Which host served a read; `fallback` carries the configured FILEBASE_GATEWAY_HOST for the label. */
export type ReadSource =
  | { readonly kind: "copy"; readonly host: string }
  | { readonly kind: "fallback"; readonly host: string };

/** A manifest table part, as `bindManifest`'s `partUrl` receives it. */
export interface PartArtifact {
  readonly name: string;
  readonly cid: string;
}

export interface FetchByCidOptions {
  /** `readPathUrls(...)` bound to the validated VITE_* hosts. */
  readonly urls: ReadPathUrls;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  /** Defaults to FIRST_BYTE_TIMEOUT_MS. */
  readonly firstByteTimeoutMs?: number;
}

export interface FetchByCidResult {
  readonly cid: string;
  readonly bytes: Uint8Array;
  readonly source: ReadSource;
  /** Binds every table part to the host that served this artifact (no mixed reads in one load). */
  readonly partUrl: (artifact: PartArtifact) => string;
}

/** Both hosts failed: the page shows BOTH_HOSTS_DOWN_TEXT in the error banner. */
export class BothHostsDownError extends Error {
  override readonly name = "BothHostsDownError";

  constructor(
    readonly cid: string,
    options?: { readonly cause?: unknown },
  ) {
    super(BOTH_HOSTS_DOWN_TEXT, options);
  }
}

/** The bytes a host returned do not hash to the requested CID (rejected, never shown). */
export class CidMismatchError extends Error {
  override readonly name = "CidMismatchError";

  constructor(
    readonly expected: string,
    readonly actual: string,
    readonly source: ReadSource,
  ) {
    super(`CID mismatch from ${source.host}: expected ${expected}, got ${actual}`);
  }
}

export function fetchByCid(_cid: string, _options: FetchByCidOptions): Promise<FetchByCidResult> {
  throw new Error("not implemented");
}

/** `fallback · {host}` for a fallback read (TC-032…034), `null` when the copy served it. */
export function fallbackLabel(_source: ReadSource): string | null {
  throw new Error("not implemented");
}
