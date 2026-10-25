// Resilient upload of an `export-tables` directory (ERR-33). It does what elephant-cli's
// importTables does, step for step, so the receipt is the same:
//   1. read tables.car's CountyTables root and list every part (table, position, cid, bytes);
//      check each part file exists with the recorded size before the first add;
//   2. `add` each part (pin, CIDv1, raw leaves, 256 KiB chunker) and require the returned Hash to
//      have the recorded CID's digest;
//   3. `dag/import` tables.car (pin-roots, stats) and require the pinned root to be the CAR root;
//   4. poll the gateway for the root block until its sha256 matches, then read the first part back
//      and compare its size with the recorded bytes.
// What the CLI does not do, and this does: every request has its own timeout and is retried with
// exponential backoff on a timeout, a network error, 429 or 5xx (never on a hash mismatch or any
// other 4xx); every retry is logged with the real cause code (error.cause.code); confirmed parts
// are kept in a small sidecar so a later attempt skips them; the gateway poll treats network
// errors as "not yet". Credentials come from the env the caller passes and are redacted from every
// logged line.
import {
  existsSync,
  mkdirSync,
  openAsBlob,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { CarReader } from "@ipld/car";
import { decode as decodeDagJson } from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { sameDigest } from "./cid.js";
import { kuboToken, type FetchLike, KUBO_ADD_QUERY } from "./kubo-add.js";
import { FILEBASE_GATEWAY, FILEBASE_RPC_API, redact, secretValues } from "./sequence.js";

export interface TablesUploadSummary {
  api: string;
  root: string;
  countyRoot: string;
  parts: number;
  gatewayUrl: string;
  uploadedAt: string;
}

export interface TablesUploadOptions {
  /** The tables directory (holds tables.car and <table>/part-NNNNN.parquet). */
  input: string;
  /** The env holding the credentials; never process.env implicitly. */
  env: NodeJS.ProcessEnv;
  api?: string;
  gateway?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Per-request timeout before the size allowance (default 120 000 ms). */
  requestTimeoutMs?: number;
  /** Assumed slowest uplink, adds size / rate to an add's timeout (default 262 144 bytes/s). */
  minBytesPerSecond?: number;
  /** Retries after the first try of one request (default 6). */
  retries?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Gateway readback deadline (default 600 000 ms). */
  readbackTimeoutMs?: number;
  readbackIntervalMs?: number;
  /** Parts added at once (default 1: the uplink is the bottleneck). */
  concurrency?: number;
  /** Sidecar JSON file of confirmed parts; omitted = in-process memory only. */
  statePath?: string;
}

/** A failure no retry can fix (hash mismatch, a 4xx other than 429): the caller stops at once. */
export class TablesUploadFatal extends Error {}
class Fatal extends TablesUploadFatal {}

interface Part {
  table: string;
  position: number;
  cid: string;
  bytes: number;
  file: string;
  /** Path relative to the input directory, the sidecar key. */
  rel: string;
}

interface Confirmed {
  path: string;
  size: number;
  cid: string;
}

/** The cause code of a fetch failure ("UND_ERR_HEADERS_TIMEOUT", "ECONNRESET", ...) with its name. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.name];
  const seen = new Set<unknown>();
  let cause: unknown = error.cause;
  while (cause !== undefined && cause !== null && !seen.has(cause)) {
    seen.add(cause);
    const c = cause as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof c.code === "string") parts.push(c.code);
    else if (typeof c.message === "string") parts.push(c.message);
    cause = c.cause;
  }
  return `${parts.join(" ")}: ${error.message}`;
}

function hashLine(text: string): string | undefined {
  for (const raw of text.split("\n")) {
    const line = raw.trimStart();
    if (!line.startsWith("{")) continue;
    try {
      const hash = (JSON.parse(line) as { Hash?: unknown }).Hash;
      if (typeof hash === "string" && hash !== "") return hash;
    } catch {
      continue;
    }
  }
  return undefined;
}

function jsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimStart();
    if (!line.startsWith("{")) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      continue;
    }
  }
  return out;
}

export async function uploadTables(options: TablesUploadOptions): Promise<TablesUploadSummary> {
  const api = (options.api ?? FILEBASE_RPC_API).replace(/\/+$/, "");
  if (!URL.canParse(api)) throw new Error(`api must be a URL with a scheme, got ${api}`);
  const gateway = (
    options.gateway ??
    (new URL(api).host === "rpc.filebase.io" ? FILEBASE_GATEWAY : "http://127.0.0.1:8080")
  ).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const secrets = secretValues(options.env);
  const log = (line: string): void => options.log?.(redact(line, secrets));
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  const minBps = options.minBytesPerSecond ?? 262_144;
  const retries = options.retries ?? 6;
  const backoffBase = options.backoffBaseMs ?? 2_000;
  const backoffMax = options.backoffMaxMs ?? 60_000;
  const readbackTimeoutMs = options.readbackTimeoutMs ?? 600_000;
  const readbackIntervalMs = options.readbackIntervalMs ?? 2_000;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const token = kuboToken(options.env);
  const headers: Record<string, string> =
    token === undefined ? {} : { Authorization: `Bearer ${token}` };

  // ---- 1. the index ----
  const carPath = join(options.input, "tables.car");
  const reader = await CarReader.fromBytes(readFileSync(carPath));
  const roots = await reader.getRoots();
  const head = roots.length === 1 ? await reader.get(roots[0] as CID) : undefined;
  const index = head === undefined ? undefined : (decodeDagJson(head.bytes) as TablesIndex);
  const countyRoot = CID.asCID(index?.county_root);
  const tables = index?.tables;
  if (
    index?.label !== "CountyTables" ||
    countyRoot === null ||
    countyRoot === undefined ||
    tables === undefined ||
    typeof tables !== "object"
  )
    throw new Error(`${carPath} does not hold a CountyTables root`);
  const listed: Part[] = Object.entries(tables).flatMap(([table, entry]) =>
    (Array.isArray(entry.parts) ? entry.parts : []).map((part, position) => {
      const cid = CID.asCID(part.cid);
      if (cid === null || cid === undefined)
        throw new Error(`${carPath} records no CID for ${table} part ${position}`);
      const name = `part-${String(position).padStart(5, "0")}.parquet`;
      return {
        table,
        position,
        cid: cid.toString(),
        bytes: Number(part.bytes),
        file: join(options.input, table, name),
        rel: `${table}/${name}`,
      };
    }),
  );
  for (const part of listed) {
    const size = existsSync(part.file) ? statSync(part.file).size : undefined;
    if (size !== part.bytes)
      throw new Error(
        size === undefined
          ? `${part.file} is missing but ${carPath} records it`
          : `${part.file} is ${size} bytes but ${carPath} records ${part.bytes}`,
      );
  }

  // ---- request with timeout and retry ----
  async function request<T>(
    what: string,
    timeoutMs: number,
    send: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const started = Date.now();
      try {
        return await send(AbortSignal.timeout(timeoutMs));
      } catch (error) {
        if (error instanceof Fatal) throw error;
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        const why = describeError(error);
        if (attempt > retries)
          throw new Error(
            `${what} failed after ${attempt} tries (last: ${why} after ${elapsed}s)`,
            { cause: error },
          );
        const wait = Math.min(backoffBase * 2 ** (attempt - 1), backoffMax);
        log(
          `retry ${what} try ${attempt}/${retries + 1} failed after ${elapsed}s: ${why}; waiting ${wait / 1000}s`,
        );
        await sleep(wait);
      }
    }
  }

  /** A response status that is final (4xx except 429) is Fatal; 429 and 5xx throw to be retried. */
  function statusError(what: string, status: number, statusText: string, body: string): Error {
    const text = `${what}: HTTP ${status} ${statusText} ${body.slice(0, 200)}`;
    return status === 429 || status >= 500 ? new Error(text) : new Fatal(text);
  }

  // ---- sidecar ----
  const confirmed = new Map<string, Confirmed>();
  if (options.statePath !== undefined && existsSync(options.statePath)) {
    try {
      const saved = JSON.parse(readFileSync(options.statePath, "utf8")) as {
        api?: string;
        parts?: Confirmed[];
      };
      if (saved.api === api && Array.isArray(saved.parts))
        for (const p of saved.parts) confirmed.set(p.path, p);
    } catch {
      // A damaged sidecar only costs the optimisation.
    }
  }
  const saveState = (): void => {
    if (options.statePath === undefined) return;
    mkdirSync(dirname(options.statePath), { recursive: true });
    const tmp = `${options.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ api, parts: [...confirmed.values()] }));
    renameSync(tmp, options.statePath);
  };

  // ---- 2. the parts ----
  async function addPart(part: Part, n: number): Promise<void> {
    const known = confirmed.get(part.rel);
    if (known?.size === part.bytes && sameDigest(known.cid, part.cid)) {
      log(`skip ${part.rel} (${n}/${listed.length}): already added`);
      return;
    }
    const what = `add ${part.rel} (${n}/${listed.length}, ${part.bytes} bytes)`;
    const timeoutMs = requestTimeoutMs + Math.floor((part.bytes / minBps) * 1000);
    log(
      `adding ${part.rel} (${n}/${listed.length}, ${part.bytes} bytes, timeout ${Math.round(timeoutMs / 1000)}s)`,
    );
    const text = await request(what, timeoutMs, async (signal) => {
      const form = new FormData();
      form.append("file", await openAsBlob(part.file), basename(part.file));
      const response = await fetchImpl(`${api}/api/v0/add?${KUBO_ADD_QUERY}`, {
        method: "POST",
        headers,
        body: form,
        signal,
      });
      const body = await response.text();
      if (!response.ok) throw statusError(what, response.status, response.statusText, body);
      return body;
    });
    const hash = hashLine(text);
    if (hash === undefined || !safeSame(hash, part.cid))
      throw new Fatal(
        `add returned ${hash ?? "no CID"} for ${part.rel} but the index records ${part.cid}; not retried`,
      );
    confirmed.set(part.rel, { path: part.rel, size: part.bytes, cid: part.cid });
    saveState();
  }

  const queue = listed.map((part, i) => ({ part, n: i + 1 }));
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (
        let item = queue.shift();
        item !== undefined && failure === undefined;
        item = queue.shift()
      ) {
        try {
          await addPart(item.part, item.n);
        } catch (error) {
          failure ??= error;
        }
      }
    }),
  );
  if (failure !== undefined) throw failure;

  // ---- 3. dag/import of tables.car ----
  const carRoot = (roots[0] as CID).toString();
  if ((roots[0] as CID).multihash.code !== sha256.code)
    throw new Error(`Unsupported root hash: ${carRoot} is not sha2-256`);
  const importWhat = "dag/import of tables.car";
  const importText = await request(
    importWhat,
    requestTimeoutMs + Math.floor((statSync(carPath).size / minBps) * 1000),
    async (signal) => {
      const form = new FormData();
      form.append("file", await openAsBlob(carPath), "tables.car");
      const response = await fetchImpl(`${api}/api/v0/dag/import?pin-roots=true&stats=true`, {
        method: "POST",
        headers,
        body: form,
        signal,
      });
      const body = await response.text();
      if (!response.ok) throw statusError(importWhat, response.status, response.statusText, body);
      return body;
    },
  );
  const lines = jsonLines(importText);
  const imported = lines.filter((l) => l.Root !== undefined);
  if (imported.length !== 1)
    throw new Fatal(
      `dag/import returned ${imported.length} roots, expected one; response: ${importText.slice(0, 300)}`,
    );
  const pinned = imported[0]?.Root as { Cid?: { "/"?: string }; PinErrorMsg?: string };
  if (pinned.PinErrorMsg)
    throw new Fatal(`Pinning ${pinned.Cid?.["/"]} failed: ${pinned.PinErrorMsg}`);
  const pinnedCid = pinned.Cid?.["/"];
  if (pinnedCid === undefined || !safeSame(pinnedCid, carRoot))
    throw new Fatal(`dag/import reported root ${pinnedCid} but the CAR root is ${carRoot}`);
  const uploadedAt = new Date().toISOString();

  // ---- 4. readback; network errors are "not yet" until the deadline ----
  const gatewayUrl = `${gateway}/ipfs/${carRoot}`;
  const poll = async <T>(
    what: string,
    step: (signal: AbortSignal) => Promise<T | undefined>,
  ): Promise<T> => {
    const deadline = Date.now() + readbackTimeoutMs;
    let last = "no answer yet";
    log(`waiting for ${what}`);
    for (;;) {
      try {
        const value = await step(
          AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now()))),
        );
        if (value !== undefined) return value;
        last = "gateway answered not found";
      } catch (error) {
        // An abort at the deadline itself says nothing new; keep the earlier answer.
        if (Date.now() < deadline || last === "no answer yet") last = describeError(error);
      }
      if (Date.now() >= deadline)
        throw new Error(
          `Timed out after ${Math.round(readbackTimeoutMs / 1000)}s waiting for ${what}: ${last}`,
        );
      await sleep(readbackIntervalMs);
    }
  };
  const rootBytes = await poll(`${gatewayUrl} to resolve`, async (signal) => {
    const response = await fetchImpl(`${gatewayUrl}?format=raw`, { signal });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    return new Uint8Array(await response.arrayBuffer());
  });
  const digest = await sha256.digest(rootBytes);
  if (!Buffer.from(digest.bytes).equals(Buffer.from((roots[0] as CID).multihash.bytes)))
    throw new Error(`Gateway bytes for ${carRoot} hash to something other than the root`);

  const first = listed[0];
  if (first !== undefined) {
    const size = await poll(
      `${first.table} part ${first.position} to resolve on ${gateway}`,
      async (signal) =>
        (await served(`${gatewayUrl}/tables/${first.table}/parts/${first.position}/cid`, signal)) ??
        (await served(`${gateway}/ipfs/${first.cid}`, signal)),
    );
    if (size !== first.bytes)
      throw new Error(
        `Gateway serves ${size} bytes for ${first.cid} but the index records ${first.bytes}`,
      );
  }

  async function served(url: string, signal: AbortSignal): Promise<number | undefined> {
    const response = await fetchImpl(url, { headers: { Range: "bytes=0-0" }, signal });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const total = response.headers.get("content-range")?.match(/\/(\d+)$/);
    await response.body?.cancel();
    if (total?.[1] !== undefined) return Number(total[1]);
    const whole = await fetchImpl(url, { signal });
    if (!whole.ok) {
      await whole.body?.cancel();
      return undefined;
    }
    return (await whole.arrayBuffer()).byteLength;
  }

  if (options.statePath !== undefined) rmSync(options.statePath, { force: true });
  return {
    api,
    root: carRoot,
    countyRoot: countyRoot.toString(),
    parts: listed.length,
    gatewayUrl,
    uploadedAt,
  };
}

interface TablesIndex {
  label?: string;
  county_root?: unknown;
  tables?: Record<string, { parts?: { cid?: unknown; bytes?: unknown }[] }>;
}

function safeSame(a: string, b: string): boolean {
  try {
    return sameDigest(a, b);
  } catch {
    return false;
  }
}
