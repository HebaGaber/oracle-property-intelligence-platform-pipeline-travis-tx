// A-03 T072 (G-C2a): the Lambda's DuckDB engine behind the query-core QueryEngine interface
// (research R-03, ADR-0001 Lambda sizing, ERR-18). One instance per sandbox (`threads = 4`, bundled httpfs
// through `extension_directory`, remote autoinstall / autoload off). The contract views are bound
// once per manifest CID through `bindManifest`, every table part read over a presigned in-region
// `ipfs/<cid>` GET URL (s3-read.ts), and re-bound after BIND_TTL_MS so a warm sandbox never
// holds a view over an expired signature. `timedQuery` / `query` run one read-only statement and
// cap the result at MAX_ROWS (AD-21). Observability (T073) hooks in through `setQueryObserver`,
// so the `duckdb.query` subsegment wraps exactly the engine call and sees the builder name and the
// manifest CID, never the SQL text or a row (FR-007).
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunManifestV1 } from "@countylens/contract";
import {
  MAX_ROWS,
  bindManifest,
  type BoundRun,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import { PRESIGN_EXPIRES_S, getManifest, presignPart } from "../s3-read.js";
import { openDuckDb, type DuckDbEngine } from "./duckdb-instance.js";

/** ERR-18 (AM-06 sizing update for the PO; ADR-0001 sized 2 threads at 1,769 MB): four threads
 *  at 3,008 MB (2 vCPU). The cold read is latency-bound range GETs, which DuckDB issues per
 *  thread, so more threads mean more requests in flight; compute stays ≤ 175 ms. */
export const DUCKDB_THREADS = 4;
/** DuckDB's own cap, under the 3,008 MB Lambda so Node and the runtime keep headroom. */
export const DUCKDB_MEMORY_LIMIT = "1GB";
/** Overrides the extension directory (tests, local runs); the Lambda uses the bundled default. */
export const EXTENSION_DIRECTORY_ENV = "DUCKDB_EXTENSION_DIRECTORY";
/** Where the CDK Api stack (T074) copies httpfs: `<task root>/duckdb-extensions/<version>/<platform>/`. */
export const EXTENSION_DIRECTORY_NAME = "duckdb-extensions";
/** A bound run is reused this long: well inside PRESIGN_EXPIRES_S, so no view outlives its URLs. */
export const BIND_TTL_MS = 30 * 60 * 1000;

if (BIND_TTL_MS >= PRESIGN_EXPIRES_S * 1000) {
  throw new Error("BIND_TTL_MS must be shorter than the presigned URL lifetime");
}

export type Env = Readonly<Record<string, string | undefined>>;

/** `DUCKDB_EXTENSION_DIRECTORY`, else the bundled directory beside the handler. */
export function extensionDirectory(env: Env = process.env): string {
  return (
    env[EXTENSION_DIRECTORY_ENV] ??
    join(env["LAMBDA_TASK_ROOT"] ?? process.cwd(), EXTENSION_DIRECTORY_NAME)
  );
}

let engine: Promise<DuckDbEngine> | undefined;

/** The query-core engine over the module-scope DuckDB instance (created on first use). */
export function getEngine(): Promise<QueryEngine> {
  engine ??= openDuckDb({
    threads: DUCKDB_THREADS,
    memoryLimit: DUCKDB_MEMORY_LIMIT,
    extensionDirectory: extensionDirectory(),
    tempDirectory: join(tmpdir(), "countylens-duckdb"),
    httpfs: true,
    cacheRemoteReads: true, // ERR-18: a warm sandbox re-reads no footer or chunk it already holds
  }).catch((error: unknown) => {
    engine = undefined; // a failed open is not kept; the next request tries again
    throw error;
  });
  return engine;
}

interface BoundState {
  readonly cid: string;
  readonly boundAt: number;
  readonly run: Promise<BoundRun>;
}

let bound: BoundState | undefined;

async function bind(manifestCid: string): Promise<BoundRun> {
  // NOT_FOUND and the CID mismatch are raised here, before any engine work.
  const bytes = await getManifest(manifestCid);
  const manifest = RunManifestV1.parse(JSON.parse(new TextDecoder().decode(bytes)));
  const parts = manifest.artifacts.filter((a) => a.kind === "table");
  const urls = new Map(
    await Promise.all(
      parts.map(async (p): Promise<[string, string]> => [p.cid, await presignPart(p.cid)]),
    ),
  );
  const db = await getEngine();
  return bindManifest(bytes, "", db, {
    partUrl: ({ cid }) => {
      const url = urls.get(cid);
      if (url === undefined) throw new Error(`bind: no presigned URL for part ${cid}`);
      return url;
    },
  });
}

/** Binds the contract views to `manifestCid` once per sandbox; a repeat call is a no-op until
 *  BIND_TTL_MS has passed or another CID is requested. */
export function bindOnce(manifestCid: string): Promise<BoundRun> {
  const now = Date.now();
  if (bound !== undefined && bound.cid === manifestCid && now - bound.boundAt < BIND_TTL_MS) {
    return bound.run;
  }
  const run = bind(manifestCid).catch((error: unknown) => {
    if (bound?.run === run) bound = undefined; // a failed bind is not kept
    throw error;
  });
  bound = { cid: manifestCid, boundAt: now, run };
  return run;
}

export interface QueryMeta {
  /** The query-core builder name (`runSummarySql`, `radiusSql`, …), never SQL text. */
  readonly name: string;
  readonly manifestCid?: string;
}

/** Wraps every engine call (T073: the `duckdb.query` subsegment with its annotations). */
export type QueryObserver = <T>(meta: QueryMeta, run: () => Promise<T>) => Promise<T>;

let observer: QueryObserver | undefined;

export function setQueryObserver(next: QueryObserver | undefined): void {
  observer = next;
}

export interface TimedRows {
  readonly rows: Row[];
  /** Milliseconds spent in the engine call only (binding and engine init excluded). */
  readonly queryDurationMs: number;
}

const READ_ONLY = /^\s*(?:SELECT|WITH)\b/i;

/** Runs one read-only statement against the bound views, timed, ≤ MAX_ROWS rows. */
export async function timedQuery(
  sql: string,
  meta: QueryMeta = { name: "query" },
): Promise<TimedRows> {
  if (!READ_ONLY.test(sql) || /;\s*\S/.test(sql)) {
    throw new Error("timedQuery: one SELECT statement only");
  }
  const db = await getEngine();
  const run = async (): Promise<TimedRows> => {
    const started = performance.now();
    const rows = await db.all(sql);
    const queryDurationMs = Math.round((performance.now() - started) * 1000) / 1000;
    return { rows: rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows, queryDurationMs };
  };
  return observer === undefined ? run() : observer(meta, run);
}

/** Runs one read-only statement against the bound views (≤ 1,000 rows). */
export async function query(sql: string, meta?: QueryMeta): Promise<Row[]> {
  return (await timedQuery(sql, meta)).rows;
}
