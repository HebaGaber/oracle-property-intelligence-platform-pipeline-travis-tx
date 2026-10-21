// The browser query engine (A-03 T054; ARD § 4 AD-19: the only module of apps/web that imports
// DuckDB). DuckDB-WASM's eh bundle is self-hosted (the WASM and its worker are Vite assets of
// this build, no CDN) and lazy-loaded through dynamic `import()`, so it stays outside the
// 300 KB gate; the WASM asset is served Brotli-compressed (scripts/compress-wasm.ts, ADR-0001
// Finding 2). The database is opened with exactly `{ allowFullHTTPReads: true,
// forceFullHTTPReads: false, reliableHeadRequests: false }` (ADR-0001 Finding 1, decision 4):
// without them this build downloads every table part whole instead of range-reading it.
// Values come back JSON-shaped as the QueryEngine contract says (dates YYYY-MM-DD, timestamps
// ISO 8601 UTC, bigints as numbers, lists and structs as plain values).
import {
  bindManifest,
  listRoofingPermitsSql,
  type BoundRun,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import { EngineStartError } from "./errors";
import { parsePermitRows, type PermitListRow } from "./permit-list";
import { PERF_MARKS, PERF_MEASURES, timed } from "./timing";

export interface DuckDbFilesystemFlags {
  readonly allowFullHTTPReads: boolean;
  readonly forceFullHTTPReads: boolean;
  readonly reliableHeadRequests: boolean;
}

export interface DuckDbOpenConfig {
  readonly filesystem: DuckDbFilesystemFlags;
}

/** ADR-0001 decision 4: range reads on, no forced full reads, no HEAD probes (CloudFront answers HEAD+Range with 200). */
export const DUCKDB_FILESYSTEM_FLAGS: DuckDbFilesystemFlags = Object.freeze({
  allowFullHTTPReads: true,
  forceFullHTTPReads: false,
  reliableHeadRequests: false,
});

/** What `db.open` receives, exactly. */
export const DUCKDB_OPEN_CONFIG: DuckDbOpenConfig = Object.freeze({
  filesystem: DUCKDB_FILESYSTEM_FLAGS,
});

/** The self-hosted eh bundle files (`@duckdb/duckdb-wasm/dist`), by name; TC-028 serves the WASM with `Content-Encoding: br`. */
export const SELF_HOSTED_BUNDLE = Object.freeze({
  mainModule: "duckdb-eh.wasm",
  mainWorker: "duckdb-browser-eh.worker.js",
});

/** The subset of an Arrow `Table` the row conversion reads (apache-arrow 17). */
export interface ArrowFieldLike {
  readonly name: string;
  readonly type: {
    /** Arrow `Type` id from the IPC format: Date = 8, Timestamp = 10. */
    readonly typeId: number;
    /** Arrow `TimeUnit`: SECOND 0, MILLISECOND 1, MICROSECOND 2, NANOSECOND 3. */
    readonly unit?: number;
  };
}

export interface ArrowTableLike {
  readonly schema: { readonly fields: readonly ArrowFieldLike[] };
  toArray(): readonly { toJSON(): Record<string, unknown> }[];
}

export interface DuckDbConnectionLike {
  query(sql: string): Promise<ArrowTableLike>;
  close(): Promise<void>;
}

/** The subset of `AsyncDuckDB` the engine uses; a fake satisfies it in unit tests. */
export interface AsyncDuckDbLike {
  instantiate(mainModule: string, pthreadWorker?: string | null): Promise<unknown>;
  open(config: DuckDbOpenConfig): Promise<void>;
  connect(): Promise<DuckDbConnectionLike>;
  terminate(): Promise<void>;
}

export interface DuckDbRuntime {
  readonly bundle: {
    readonly mainModule: string;
    readonly mainWorker: string;
    readonly pthreadWorker: string | null;
  };
  createDb(workerUrl: string): AsyncDuckDbLike;
}

export type LoadDuckDb = () => Promise<DuckDbRuntime>;

/** Lazy-loads the library and the self-hosted eh bundle (Vite emits both files as assets). */
export const loadSelfHostedDuckDb: LoadDuckDb = async () => {
  const [duckdb, wasm, worker] = await Promise.all([
    import("@duckdb/duckdb-wasm"),
    import("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url"),
    import("@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url"),
  ]);
  return {
    bundle: { mainModule: wasm.default, mainWorker: worker.default, pthreadWorker: null },
    createDb: (workerUrl) => new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl)),
  };
};

export interface BrowserEngine extends QueryEngine {
  /** Closes the connection and terminates the worker. */
  close(): Promise<void>;
}

const ARROW_DATE = 8;
const ARROW_TIMESTAMP = 10;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasFunction = <K extends string>(
  value: Record<string, unknown>,
  key: K,
): value is Record<string, unknown> & Record<K, () => unknown> => typeof value[key] === "function";

/** Arrow vectors and struct rows → arrays and objects; bigint → number; Date → ISO 8601. */
function plain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (!isObject(value)) return value;
  if (hasFunction(value, "toArray")) return (value.toArray() as unknown[]).map(plain);
  if (Array.isArray(value)) return value.map(plain);
  if (hasFunction(value, "toJSON")) return plain(value.toJSON());
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
}

/** Epoch milliseconds of an Arrow temporal value (apache-arrow ≥ 15 returns ms numbers). */
function epochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`arrowToRows: unsupported temporal value ${String(value)}`);
}

function convert(value: unknown, type: ArrowFieldLike["type"]): unknown {
  if (value === null || value === undefined) return null;
  if (type.typeId === ARROW_DATE) return new Date(epochMs(value)).toISOString().slice(0, 10);
  if (type.typeId === ARROW_TIMESTAMP) return new Date(epochMs(value)).toISOString();
  return plain(value);
}

/** An Arrow result table as JSON-shaped rows (QueryEngine `Row`). */
export function arrowToRows(table: ArrowTableLike): Row[] {
  const fields = table.schema.fields;
  return table.toArray().map((row) => {
    const json = row.toJSON();
    const out: Row = {};
    for (const field of fields) out[field.name] = convert(json[field.name], field.type);
    return out;
  });
}

async function start(
  load: LoadDuckDb,
): Promise<{ db: AsyncDuckDbLike; conn: DuckDbConnectionLike }> {
  const runtime = await load();
  const db = runtime.createDb(runtime.bundle.mainWorker);
  try {
    await db.instantiate(runtime.bundle.mainModule, runtime.bundle.pthreadWorker);
    await db.open(DUCKDB_OPEN_CONFIG);
    const conn = await db.connect();
    // builders.ts: the engine's TimeZone must be UTC so as_of is the manifest's UTC date.
    await conn.query("SET TimeZone = 'UTC'");
    return { db, conn };
  } catch (cause) {
    await db.terminate().catch(() => undefined);
    throw cause;
  }
}

/** Loads, instantiates and opens DuckDB-WASM with the range-read flags; EngineStartError on failure. */
export async function openEngine(load: LoadDuckDb = loadSelfHostedDuckDb): Promise<BrowserEngine> {
  let started: { db: AsyncDuckDbLike; conn: DuckDbConnectionLike };
  try {
    started = await timed(PERF_MEASURES.init, () => start(load), {
      start: PERF_MARKS.initStart,
      end: PERF_MARKS.initEnd,
    });
  } catch (cause) {
    throw new EngineStartError(cause);
  }
  const { db, conn } = started;
  return {
    async run(sql: string): Promise<void> {
      await conn.query(sql);
    },
    async all(sql: string): Promise<Row[]> {
      return arrowToRows(await conn.query(sql));
    },
    async close(): Promise<void> {
      await conn.close().catch(() => undefined);
      await db.terminate();
    },
  };
}

/** Binds the contract views to the manifest; `partUrl` is the read path the manifest came from (no mixed hosts). */
export function bindRun(
  engine: QueryEngine,
  manifestBytes: Uint8Array,
  partUrl: (artifact: { name: string; cid: string }) => string,
): Promise<BoundRun> {
  return bindManifest(manifestBytes, "", engine, { partUrl });
}

/** The single page of permits, ordered by permit_number (listRoofingPermitsSql), validated; measured as `countylens:query:list`. */
export async function listPermits(engine: QueryEngine): Promise<PermitListRow[]> {
  const rows = await timed(PERF_MEASURES.list, () => engine.all(listRoofingPermitsSql()));
  return parsePermitRows(rows);
}

/** The page's own COUNT: one row per v_roofing_permit row, as the listing selects them. */
export const COUNT_PERMITS_SQL = "SELECT count(*)::INTEGER AS n FROM v_roofing_permit";

/** COUNT over v_roofing_permit, measured as `countylens:query:count`. */
export async function countPermits(engine: QueryEngine): Promise<number> {
  const rows = await timed(PERF_MEASURES.count, () => engine.all(COUNT_PERMITS_SQL));
  const n = rows.length === 1 ? rows[0]?.["n"] : undefined;
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new Error(`Permits COUNT did not return one integer row (${rows.length} rows)`);
  }
  return n;
}
