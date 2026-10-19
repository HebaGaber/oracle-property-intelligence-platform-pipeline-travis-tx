// T010: the single HTTP boundary for every Travis County source request (pattern 2).
//
// Guard rules (contracts/capture-receipt.md, ARD § 8):
// - at most 2 concurrent requests per host (p-limit per host);
// - one constant, identified User-Agent naming the project and repo (no email);
// - StopOnBlocked: HTTP 403, a 2xx body that fails its Zod parse (challenge page) or a
//   timeout gives exactly one attempt and outcome `blocked`;
// - backoff only on 429/5xx: full jitter, 1 s base, 60 s cap, 5 attempts, honouring
//   Retry-After; still failing after 5 attempts gives outcome `failed` (FR-006e);
// - no proxy, agent, dispatcher, IP or header rotation: the request init carries only
//   method, headers, signal and redirect;
// - a capture receipt per request; an optional Socrata app token is sent as a header and
//   recorded only as `app_token_used`;
// - `isGeoBlock` is true only for an explicit body, error-code or header signal (FR-006b).
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import pLimit, { type LimitFunction } from "p-limit";
import type { ZodType } from "zod";
import { createLogger, redact, type LogFields } from "./log.js";

export const USER_AGENT =
  "oracle-travis-discovery/0.1 (PrismTeam Oracle Travis County pipeline; " +
  "+https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx)";

export const MAX_CONCURRENCY_PER_HOST = 2;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 60_000;
export const MAX_ATTEMPTS = 5;
export const DEFAULT_TIMEOUT_MS = 60_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type CaptureOutcome = "ok" | "blocked" | "throttled-then-ok" | "failed";
export type BlockedReason = "http-403" | "challenge" | "timeout";

export interface CaptureReceipt {
  url: string;
  method: "GET" | "HEAD";
  status: number | null;
  bytes: number;
  sha256: string;
  captured_at: string;
  user_agent: string;
  attempts: number;
  outcome: CaptureOutcome;
  /** "none" or the quoted explicit geo signal from the saved response (FR-006b). */
  geo_signal: string;
  app_token_used: boolean;
  timeout_ms: number | null;
  blocked_reason: BlockedReason | null;
  rate_limits_observed: string | null;
  /** network error message (redacted) when no HTTP response was received */
  error?: string;
  /** Blocked or failed captures only: what the evidence file needs (T037). Never logged. */
  stop_evidence?: StopEvidence;
}

/** Saved response of a stop (blocked/failed) capture, for the committed evidence file. */
export interface StopEvidence {
  /** Lower-cased response headers without cookies, auth or token-bearing headers. */
  headers: Record<string, string>;
  /** At most EVIDENCE_EXCERPT_BYTES of the body, base64 (JSON-safe for the journal). */
  excerpt_base64: string;
  /** Size of the whole body the excerpt came from. */
  body_bytes: number;
}

export interface CaptureRequest<T> {
  url: string;
  method?: "GET" | "HEAD";
  /** Zod schema the body must satisfy; a 2xx that fails it is a challenge (`blocked`). */
  schema?: ZodType<T>;
  /** How the body is handed to the schema: parsed JSON (default) or raw text. */
  bodyKind?: "json" | "text";
  accept?: string;
  timeoutMs?: number;
  /** Send the optional Socrata app token (header `X-App-Token`). */
  useAppToken?: boolean;
  /** Lower the attempt budget below MAX_ATTEMPTS (for example 1 for a single observation). */
  maxAttempts?: number;
}

export interface DownloadRequest {
  url: string;
  /** Final file path; data is streamed to `<destPath>.part` and renamed on success. */
  destPath: string;
  /** No bytes for this long counts as a timeout (FR-003: 10 minutes). */
  inactivityMs: number;
  /** The whole download may not run longer than this (FR-003: 2 hours). */
  totalMs: number;
  accept?: string;
}

export interface DownloadResult {
  receipt: CaptureReceipt;
  /** The saved file, or null when the download did not complete. */
  path: string | null;
  /** Wall-clock seconds from request to last byte (measured with a monotonic clock). */
  seconds: number;
  /** At most EXCERPT_BYTES of a non-2xx or HTML body, for blocked evidence. */
  excerpt: Buffer;
  headers: Record<string, string>;
}

export interface CaptureResult<T> {
  receipt: CaptureReceipt;
  /** Parsed body when a schema was given and the outcome is ok/throttled-then-ok. */
  data: T | null;
  /** Raw body bytes of the final attempt (for evidence files and streaming-free probes). */
  body: Buffer;
  /** Lower-cased response headers of the final attempt. */
  headers: Record<string, string>;
}

export interface SourceClientOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
  timeoutMs?: number;
  /** Optional Socrata app token; defaults to SOCRATA_APP_TOKEN from the environment. */
  appToken?: string;
  log?: (event: string, fields: LogFields) => void;
  /** Monotonic milliseconds for elapsed-time measurement; defaults to performance.now. */
  clock?: () => number;
}

export interface SourceClient {
  capture<T = unknown>(request: CaptureRequest<T>): Promise<CaptureResult<T>>;
  /** Streams one large file to disk with inactivity and total limits (TCAD export). */
  download(request: DownloadRequest): Promise<DownloadResult>;
}

/** Bytes kept from a refused download body for the evidence excerpt. */
export const EXCERPT_BYTES = 64 * 1024;

/** Bytes of a stop body kept on the receipt for the evidence file (journal-friendly). */
export const EVIDENCE_EXCERPT_BYTES = 4 * 1024;

/** Response headers never kept: session cookies, auth challenges and anything token-like. */
const UNSAFE_HEADER =
  /cookie|authori[sz]ation|authenticate|token|secret|password|api-?key|session/i;

/** Drops cookie, auth and token-bearing headers; redacts the remaining values. */
export function safeHeaders(
  headers: Record<string, string>,
  secrets: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (UNSAFE_HEADER.test(lower)) continue;
    out[lower] = redact(value, secrets);
  }
  return out;
}

export function stopEvidence(
  headers: Record<string, string>,
  body: Buffer,
  secrets: readonly string[] = [],
): StopEvidence {
  return {
    headers: safeHeaders(headers, secrets),
    excerpt_base64: body.subarray(0, EVIDENCE_EXCERPT_BYTES).toString("base64"),
    body_bytes: body.byteLength,
  };
}

/** The receipt as logged: without the saved stop body. */
function loggable(receipt: CaptureReceipt): LogFields {
  const { stop_evidence: _evidence, ...rest } = receipt;
  return { ...rest };
}

export interface SavedResponse {
  status: number | null;
  headers: Record<string, string>;
  body: string;
}

/** Full-jitter exponential backoff: random() * min(cap, base * 2^(attempt-1)). */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

const GEO_BODY_PATTERNS: readonly RegExp[] = [
  /not (?:available|accessible) (?:in|from) your (?:country|region|location)/i,
  /(?:unavailable|blocked|restricted) in your (?:country|region|location)/i,
  /(?:country|region|geographic(?:al)?|geo)[- ]?(?:block(?:ed|ing)?|restrict(?:ed|ion)?)/i,
  /error code:?\s*1009\b/i, // Cloudflare: "the owner has banned your country or region"
  /access (?:is )?denied[^.]{0,40}\b(?:country|region)\b/i,
];
const GEO_HEADER_NAME = /(?:^|-)geo(?:-|block|$)/i;
const GEO_HEADER_VALUE = /block|restrict|den(?:y|ied)|forbid|country|region/i;
const COUNTRY_INFO_HEADERS = new Set(["cf-ipcountry", "x-country-code", "x-geo-country"]);

/**
 * Returns the quoted explicit geo signal from a saved response, or null. A bare 403, a
 * bot challenge or a country header that every response carries is never a signal.
 */
export function detectGeoSignal(saved: SavedResponse): string | null {
  for (const pattern of GEO_BODY_PATTERNS) {
    const match = pattern.exec(saved.body);
    if (match) return match[0].slice(0, 200);
  }
  for (const [name, value] of Object.entries(saved.headers)) {
    const lower = name.toLowerCase();
    if (COUNTRY_INFO_HEADERS.has(lower)) continue;
    const named = GEO_HEADER_NAME.test(lower) || lower === "x-deny-reason";
    if (named && GEO_HEADER_VALUE.test(value)) return `${lower}: ${value}`.slice(0, 200);
  }
  return null;
}

export function isGeoBlock(saved: SavedResponse): boolean {
  return detectGeoSignal(saved) !== null;
}

function parseRetryAfter(value: string | null, now: Date): number | null {
  if (value === null || value.trim() === "") return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now.getTime());
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type Attempt =
  | { kind: "response"; status: number; headers: Record<string, string>; body: Buffer; at: Date }
  | { kind: "timeout"; at: Date }
  | { kind: "error"; message: string; at: Date };

export function createSourceClient(options: SourceClientOptions = {}): SourceClient {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => new Date());
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clock = options.clock ?? (() => performance.now());
  // An empty token (option or environment) means no token.
  const appToken = (options.appToken ?? process.env.SOCRATA_APP_TOKEN ?? "") || null;
  const secrets = appToken ? [appToken] : [];
  const logger = createLogger(undefined, secrets);
  const emit = options.log ?? ((event: string, fields: LogFields) => logger.info(event, fields));
  const limiters = new Map<string, LimitFunction>();

  const limiterFor = (url: string): LimitFunction => {
    const host = new URL(url).host;
    let limiter = limiters.get(host);
    if (!limiter) {
      limiter = pLimit(MAX_CONCURRENCY_PER_HOST);
      limiters.set(host, limiter);
    }
    return limiter;
  };

  async function attemptOnce(
    url: string,
    method: "GET" | "HEAD",
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<Attempt> {
    const at = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        signal: controller.signal,
        redirect: "follow",
      });
      const body = Buffer.from(await response.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        responseHeaders[name.toLowerCase()] = value;
      });
      return { kind: "response", status: response.status, headers: responseHeaders, body, at };
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) return { kind: "timeout", at };
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "error", message: redact(message, secrets), at };
    } finally {
      clearTimeout(timer);
    }
  }

  async function captureUnlimited<T>(request: CaptureRequest<T>): Promise<CaptureResult<T>> {
    const method = request.method ?? "GET";
    const timeoutMs = request.timeoutMs ?? defaultTimeout;
    const tokenUsed = request.useAppToken === true && appToken !== null;
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: request.accept ?? "*/*",
    };
    if (tokenUsed && appToken !== null) headers["x-app-token"] = appToken;

    const observed: string[] = [];
    let attempts = 0;
    let last: Attempt | null = null;

    const budget = Math.max(1, Math.min(MAX_ATTEMPTS, request.maxAttempts ?? MAX_ATTEMPTS));
    while (attempts < budget) {
      attempts += 1;
      last = await attemptOnce(request.url, method, headers, timeoutMs);
      if (last.kind !== "response" || !isRetryable(last.status)) break;
      const retryAfterHeader = last.headers["retry-after"] ?? null;
      observed.push(
        retryAfterHeader === null
          ? `HTTP ${last.status}`
          : `HTTP ${last.status} Retry-After ${retryAfterHeader}`,
      );
      if (attempts >= budget) break;
      const retryAfterMs = parseRetryAfter(retryAfterHeader, now());
      await sleep(retryAfterMs ?? backoffDelayMs(attempts, random));
    }
    if (last === null) throw new Error("source-client: no attempt was made");

    const body = last.kind === "response" ? last.body : Buffer.alloc(0);
    const responseHeaders = last.kind === "response" ? last.headers : {};
    const status = last.kind === "response" ? last.status : null;

    let outcome: CaptureOutcome;
    let blockedReason: BlockedReason | null = null;
    let data: T | null = null;

    if (last.kind === "timeout") {
      outcome = "blocked";
      blockedReason = "timeout";
    } else if (last.kind === "error") {
      outcome = "failed";
    } else if (last.status === 403) {
      outcome = "blocked";
      blockedReason = "http-403";
    } else if (last.status >= 200 && last.status < 300) {
      const parsed = request.schema ? parseBody(request.schema, body, request.bodyKind) : null;
      if (parsed && !parsed.ok) {
        outcome = "blocked";
        blockedReason = "challenge";
      } else {
        data = parsed ? parsed.value : null;
        outcome = attempts > 1 ? "throttled-then-ok" : "ok";
      }
    } else {
      outcome = "failed";
    }

    const geo =
      outcome === "blocked" || outcome === "failed"
        ? detectGeoSignal({ status, headers: responseHeaders, body: body.toString("utf8") })
        : null;

    const receipt: CaptureReceipt = {
      url: redact(request.url, secrets),
      method,
      status,
      bytes: body.byteLength,
      sha256: sha256(body),
      captured_at: last.at.toISOString(),
      user_agent: USER_AGENT,
      attempts,
      outcome,
      geo_signal: geo ?? "none",
      app_token_used: tokenUsed,
      timeout_ms: last.kind === "timeout" ? timeoutMs : null,
      blocked_reason: blockedReason,
      rate_limits_observed: observed.length > 0 ? observed.join("; ") : null,
    };
    if (last.kind === "error") receipt.error = last.message;
    if (outcome === "blocked" || outcome === "failed") {
      receipt.stop_evidence = stopEvidence(responseHeaders, body, secrets);
    }

    emit("source.capture", loggable(receipt));
    return { receipt, data, body, headers: responseHeaders };
  }

  async function downloadUnlimited(request: DownloadRequest): Promise<DownloadResult> {
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: request.accept ?? "*/*",
    };
    const startedMs = clock();
    const startedAt = now();
    const part = `${request.destPath}.part`;
    const observed: string[] = [];
    let attempts = 0;

    const finish = (
      fields: Pick<CaptureReceipt, "status" | "outcome"> &
        Partial<Pick<CaptureReceipt, "timeout_ms" | "blocked_reason" | "error">> & {
          bytes: number;
          sha256: string;
          headers: Record<string, string>;
          excerpt: Buffer;
          path: string | null;
        },
    ): DownloadResult => {
      const geo =
        fields.outcome === "blocked" || fields.outcome === "failed"
          ? detectGeoSignal({
              status: fields.status,
              headers: fields.headers,
              body: fields.excerpt.toString("utf8"),
            })
          : null;
      const receipt: CaptureReceipt = {
        url: redact(request.url, secrets),
        method: "GET",
        status: fields.status,
        bytes: fields.bytes,
        sha256: fields.sha256,
        captured_at: startedAt.toISOString(),
        user_agent: USER_AGENT,
        attempts,
        outcome: fields.outcome,
        geo_signal: geo ?? "none",
        app_token_used: false,
        timeout_ms: fields.timeout_ms ?? null,
        blocked_reason: fields.blocked_reason ?? null,
        rate_limits_observed: observed.length > 0 ? observed.join("; ") : null,
      };
      if (fields.error !== undefined) receipt.error = fields.error;
      if (fields.outcome === "blocked" || fields.outcome === "failed") {
        receipt.stop_evidence = stopEvidence(fields.headers, fields.excerpt, secrets);
        receipt.stop_evidence.body_bytes = fields.bytes;
      }
      emit("source.download", loggable(receipt));
      return {
        receipt,
        path: fields.path,
        seconds: (clock() - startedMs) / 1000,
        excerpt: fields.excerpt,
        headers: fields.headers,
      };
    };

    // A timer can fire a fraction of a millisecond before the monotonic clock reaches its
    // limit, so a timeout records at least the limit that fired (FR-003: >= 10 min / 2 h).
    let limitHit = 0;
    const elapsed = (): number => Math.max(1, limitHit, Math.round(clock() - startedMs));

    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      const controller = new AbortController();
      let timedOut = false;
      const total = setTimeout(
        () => {
          timedOut = true;
          limitHit = Math.max(limitHit, request.totalMs);
          controller.abort();
        },
        Math.max(0, request.totalMs - (clock() - startedMs)),
      );
      let idle = setTimeout(() => {
        timedOut = true;
        limitHit = Math.max(limitHit, request.inactivityMs);
        controller.abort();
      }, request.inactivityMs);
      const clearTimers = (): void => {
        clearTimeout(total);
        clearTimeout(idle);
      };

      let response: Response;
      try {
        response = await fetchImpl(request.url, {
          method: "GET",
          headers,
          signal: controller.signal,
          redirect: "follow",
        });
      } catch (error) {
        clearTimers();
        if (timedOut || controller.signal.aborted || isAbort(error)) {
          return finish({
            status: null,
            outcome: "blocked",
            blocked_reason: "timeout",
            timeout_ms: elapsed(),
            bytes: 0,
            sha256: sha256(Buffer.alloc(0)),
            headers: {},
            excerpt: Buffer.alloc(0),
            path: null,
          });
        }
        const message = error instanceof Error ? error.message : String(error);
        return finish({
          status: null,
          outcome: "failed",
          error: redact(message, secrets),
          bytes: 0,
          sha256: sha256(Buffer.alloc(0)),
          headers: {},
          excerpt: Buffer.alloc(0),
          path: null,
        });
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        responseHeaders[name.toLowerCase()] = value;
      });
      const contentType = responseHeaders["content-type"] ?? "";
      const isHtml = /text\/html/i.test(contentType);

      if (response.status < 200 || response.status >= 300 || isHtml) {
        // Read a bounded excerpt only; never stream an error or challenge body to disk.
        const body = Buffer.from(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
        clearTimers();
        const excerpt = body.subarray(0, EXCERPT_BYTES);
        if (isRetryable(response.status) && attempts < MAX_ATTEMPTS) {
          const retryAfterHeader = responseHeaders["retry-after"] ?? null;
          observed.push(
            retryAfterHeader === null
              ? `HTTP ${response.status}`
              : `HTTP ${response.status} Retry-After ${retryAfterHeader}`,
          );
          const retryAfterMs = parseRetryAfter(retryAfterHeader, now());
          await sleep(retryAfterMs ?? backoffDelayMs(attempts, random));
          continue;
        }
        if (isRetryable(response.status)) observed.push(`HTTP ${response.status}`);
        const blocked = response.status === 403 || (response.status < 300 && isHtml);
        return finish({
          status: response.status,
          outcome: blocked ? "blocked" : "failed",
          blocked_reason: blocked ? (response.status === 403 ? "http-403" : "challenge") : null,
          bytes: body.byteLength,
          sha256: sha256(body),
          headers: responseHeaders,
          excerpt,
          path: null,
        });
      }

      // 2xx with a file body: stream it to <dest>.part, hashing as it arrives.
      mkdirSync(dirname(request.destPath), { recursive: true });
      const out = createWriteStream(part);
      const hash = createHash("sha256");
      let bytes = 0;
      const reader = response.body?.getReader() ?? null;
      const onAbort = (): void => {
        void reader?.cancel().catch(() => undefined);
      };
      controller.signal.addEventListener("abort", onAbort);
      let streamError: string | null = null;
      try {
        while (reader) {
          const { done, value } = await reader.read();
          if (done || timedOut) break;
          clearTimeout(idle);
          idle = setTimeout(() => {
            timedOut = true;
            limitHit = Math.max(limitHit, request.inactivityMs);
            controller.abort();
          }, request.inactivityMs);
          hash.update(value);
          bytes += value.byteLength;
          if (!out.write(value)) await new Promise((r) => out.once("drain", r));
        }
      } catch (error) {
        if (!timedOut) streamError = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimers();
        controller.signal.removeEventListener("abort", onAbort);
        await new Promise<void>((resolve) => out.end(() => resolve()));
      }

      if (timedOut || streamError !== null) {
        rmSync(part, { force: true });
        return finish({
          status: response.status,
          outcome: timedOut ? "blocked" : "failed",
          blocked_reason: timedOut ? "timeout" : null,
          timeout_ms: timedOut ? elapsed() : null,
          ...(streamError === null ? {} : { error: redact(streamError, secrets) }),
          bytes,
          sha256: hash.digest("hex"),
          headers: responseHeaders,
          excerpt: Buffer.alloc(0),
          path: null,
        });
      }
      renameSync(part, request.destPath);
      return finish({
        status: response.status,
        outcome: attempts > 1 ? "throttled-then-ok" : "ok",
        bytes,
        sha256: hash.digest("hex"),
        headers: responseHeaders,
        excerpt: Buffer.alloc(0),
        path: request.destPath,
      });
    }
    throw new Error("source-client: download loop ended without a result");
  }

  return {
    capture<T = unknown>(request: CaptureRequest<T>): Promise<CaptureResult<T>> {
      return limiterFor(request.url)(() => captureUnlimited(request));
    },
    download(request: DownloadRequest): Promise<DownloadResult> {
      return limiterFor(request.url)(() => downloadUnlimited(request));
    },
  };
}

function parseBody<T>(
  schema: ZodType<T>,
  body: Buffer,
  kind: "json" | "text" = "json",
): { ok: true; value: T } | { ok: false } {
  const text = body.toString("utf8");
  let input: unknown = text;
  if (kind === "json") {
    try {
      input = JSON.parse(text) as unknown;
    } catch {
      return { ok: false };
    }
  }
  const result = schema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}
