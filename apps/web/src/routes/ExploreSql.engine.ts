// The SQL panel's engine session (A-13 T029; AC-6, FR-006, FR-017; research R2; AD-19). The only
// route-side importer of engine/duckdb-wasm (dynamic import, so the engine stays in its own
// "duckdb" chunk and loads only on `?mode=sql`). Same read path as the A-03 Permits loader: run
// index → latest manifest by CID (copy, then the labelled Filebase fallback) → the table parts
// from that host, CID-verified → registered buffers → the contract views bound. The engine starts
// in parallel with the reads (ERR-17). `readOnlyRefusal` keeps every statement read-only before it
// reaches the engine (one SELECT, WITH, DESCRIBE or SHOW statement, no data-changing keyword);
// `sqlErrorLine` turns an engine error into one line "{first line} · Try: {fix}", no stack trace.
import type { Row } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { readPathUrlsFromEnv } from "../data/config";
import { fallbackLabel } from "../data/fetch-by-cid";
import { fetchParts, partsToPrefetch, registeredPartName } from "../data/fetch-parts";
import { loadManifest } from "../data/manifest";
import { latestRun, loadRunsIndex } from "../data/runs-index";
import { STAGE_TEXTS } from "../engine/stages";

export interface SqlSession {
  readonly runId: string;
  readonly manifestCid: string;
  /** `fallback · {host}` when Filebase served the manifest and parts; null for the copy. */
  readonly fallbackLabel: string | null;
  readonly query: (sql: string) => Promise<Row[]>;
  readonly close: () => Promise<void>;
}

/** Opens the in-browser engine on the latest run; `report` receives the stage texts. */
export async function openSqlSession(
  report: (stage: string) => void,
  signal: AbortSignal,
): Promise<SqlSession> {
  report(STAGE_TEXTS.engine);
  const starting = import("../engine/duckdb-wasm").then(async (module) => ({
    module,
    engine: await module.openEngine(),
  }));
  starting.catch(() => undefined);
  try {
    report(STAGE_TEXTS.manifest);
    const index = await loadRunsIndex({ signal });
    const entry = latestRun(index);
    const loaded = await loadManifest(entry.manifestCid, { urls: readPathUrlsFromEnv(), signal });
    const wanted = partsToPrefetch(loaded.manifest);
    const parts = wanted === null ? null : await fetchParts(wanted, loaded.read, { signal });
    const { module, engine } = await starting;
    signal.throwIfAborted();
    report(STAGE_TEXTS.bind);
    let partUrl = loaded.read.partUrl;
    if (parts !== null) {
      for (const part of parts) await engine.registerFile(registeredPartName(part), part.bytes);
      partUrl = registeredPartName;
    }
    await module.bindRun(engine, loaded.read.bytes, partUrl);
    return {
      runId: loaded.manifest.runId,
      manifestCid: loaded.manifestCid,
      fallbackLabel: fallbackLabel(loaded.read.source),
      query: (sql) => engine.all(sql),
      close: () => engine.close(),
    };
  } catch (error) {
    starting.then(
      ({ engine }) => engine.close().catch(() => undefined),
      () => undefined,
    );
    throw error;
  }
}

const READ_ONLY_START = /^(select|with|describe|show|from|summarize|explain)\b/i;
const WRITE_WORDS =
  /\b(insert|update|delete|create|drop|alter|copy|attach|detach|install|load|pragma|export|import|call|set|reset|truncate|merge|vacuum|checkpoint|use|begin|commit|rollback)\b/i;

/** The SQL without comments and string literals (so a word inside quotes never counts). */
function code(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .trim();
}

/** null when the statement may run; else the fixed read-only text. */
export function readOnlyRefusal(sql: string): string | null {
  const body = code(sql).replace(/;\s*$/, "");
  if (body === "" || body.includes(";")) return EXPLORE_TEXTS.sqlReadOnly;
  if (!READ_ONLY_START.test(body) || WRITE_WORDS.test(body)) return EXPLORE_TEXTS.sqlReadOnly;
  return null;
}

function fixFor(firstLine: string, message: string): string {
  const didYouMean = /Did you mean "([^"]+)"/.exec(message)?.[1];
  if (didYouMean !== undefined) return `use ${didYouMean}`;
  if (/Catalog Error/i.test(firstLine))
    return "check the table or column name; SHOW TABLES lists the views (v_property, v_roofing_permit, …)";
  if (/Parser Error/i.test(firstLine))
    return "check the spelling of the keywords; a query starts with SELECT, WITH, DESCRIBE or SHOW";
  if (/Binder Error/i.test(firstLine)) return "check the column names; DESCRIBE {view} lists them";
  if (/Conversion Error/i.test(firstLine)) return "cast the value to the column's type";
  return "simplify the query and run it again";
}

/** "{first line} · Try: {fix}" of an engine error; the rest of the message (and any stack) is dropped. */
export function sqlErrorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = (message.split("\n")[0] ?? message).trim() || "The query failed";
  return EXPLORE_TEXTS.sqlError(firstLine, fixFor(firstLine, message));
}
