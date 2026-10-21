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
      query: (sql) => engine.all(boundedSql(sql)),
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

const READ_ONLY_START = new Set([
  "select",
  "with",
  "describe",
  "show",
  "from",
  "summarize",
  "explain",
]);
/** Data-changing, DDL and IO words that never belong in a read-only statement (any position). */
const FORBIDDEN_WORDS = new Set([
  "insert",
  "update",
  "delete",
  "create",
  "drop",
  "alter",
  "copy",
  "attach",
  "detach",
  "install",
  "pragma",
  "export",
  "import",
  "call",
  "truncate",
  "merge",
  "vacuum",
  "checkpoint",
  "use",
]);
/** DuckDB table functions that read files or URLs, or run SQL text, when followed by `(`. */
const FILE_FUNCTION = /^(read_\w+|\w+_scan|parquet_\w+|glob|sniff_csv|query|query_table|getenv)$/;
/** Words that end a FROM list, so a later string is a value again. */
const FROM_END = new Set([
  "where",
  "group",
  "order",
  "having",
  "limit",
  "offset",
  "window",
  "qualify",
  "union",
  "intersect",
  "except",
  "select",
  "on",
  "using",
]);

type Token =
  | { readonly kind: "word"; readonly text: string }
  | { readonly kind: "string" }
  | { readonly kind: "quoted"; readonly plain: boolean }
  | { readonly kind: "punct"; readonly text: string };

/**
 * One pass over the SQL: whitespace and comments vanish, string literals ('…' with '' escapes,
 * E'…' with backslashes, $tag$…$tag$) and quoted identifiers become single tokens, so no word or
 * `;` inside them is ever seen as code. Block comments do not nest here: that is the safe reading
 * (a nesting engine only makes this stricter). null = unterminated string or comment.
 */
function tokenize(sql: string, ends: number[] = []): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    while (ends.length < tokens.length) ends.push(i);
    const c = sql[i] as string;
    if (/\s/u.test(c)) {
      i += 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return null;
      i = end + 2;
    } else if (c === "'") {
      // Backslashes are not escapes here: reading `\'` as a closing quote is the stricter view.
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) return null;
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      tokens.push({ kind: "string" });
      i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      let text = "";
      for (;;) {
        if (j >= sql.length) return null;
        const d = sql[j] as string;
        if (d === '"' && sql[j + 1] === '"') {
          text += '"';
          j += 2;
        } else if (d === '"') break;
        else {
          text += d;
          j += 1;
        }
      }
      // A plain quoted name is read as the bare word it spells (so "update" is still caught).
      if (/^[\p{L}_][\p{L}\p{N}_$]*$/u.test(text)) tokens.push({ kind: "word", text });
      else tokens.push({ kind: "quoted", plain: false });
      i = j + 1;
    } else if (c === "$" && /^\$[A-Za-z_]*\$/.test(sql.slice(i))) {
      const tag = (/^\$[A-Za-z_]*\$/.exec(sql.slice(i)) as RegExpExecArray)[0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) return null;
      tokens.push({ kind: "string" });
      i = end + tag.length;
    } else if (/[\p{L}_]/u.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[\p{L}\p{N}_$]/u.test(sql[j] as string)) j += 1;
      tokens.push({ kind: "word", text: sql.slice(i, j) });
      i = j;
    } else {
      tokens.push({ kind: "punct", text: c });
      i += 1;
    }
  }
  while (ends.length < tokens.length) ends.push(i);
  return tokens;
}

/** null when the statement may run; else the fixed read-only text. */
export function readOnlyRefusal(sql: string): string | null {
  const tokens = tokenize(sql);
  if (tokens === null) return EXPLORE_TEXTS.sqlReadOnly;
  while (
    tokens[tokens.length - 1]?.kind === "punct" &&
    (tokens[tokens.length - 1] as { text: string }).text === ";"
  )
    tokens.pop();
  const first = tokens[0];
  if (first?.kind !== "word" || !READ_ONLY_START.has(first.text.toLowerCase()))
    return EXPLORE_TEXTS.sqlReadOnly;
  let inFrom = false;
  let listStart = false;
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k] as Token;
    if (token.kind === "punct" && token.text === ";") return EXPLORE_TEXTS.sqlReadOnly;
    if (token.kind === "word") {
      const word = token.text.toLowerCase();
      if (FORBIDDEN_WORDS.has(word)) return EXPLORE_TEXTS.sqlReadOnly;
      const next = tokens[k + 1];
      if (FILE_FUNCTION.test(word) && next?.kind === "punct" && next.text === "(")
        return EXPLORE_TEXTS.sqlReadOnly;
      if (word === "from" || word === "join") {
        inFrom = true;
        listStart = true;
        continue;
      }
      if (FROM_END.has(word)) inFrom = false;
    } else if (token.kind === "punct" && token.text === ",") {
      listStart = inFrom;
      continue;
    } else if (token.kind === "punct" && token.text === ")") {
      inFrom = false;
    } else if (inFrom && listStart && (token.kind === "string" || token.kind === "quoted")) {
      // FROM 'file.csv' / FROM "file.csv": DuckDB reads the file named there.
      return EXPLORE_TEXTS.sqlReadOnly;
    }
    listStart = false;
  }
  return null;
}

/** Rows the SQL grid shows; the engine is asked for one more, to know whether it was cut. */
export const SQL_RESULT_ROWS = 500;

/**
 * SELECT, WITH and FROM statements run as a subquery with LIMIT cap + 1, so a huge result is never
 * materialised; other statements (SHOW, DESCRIBE, …) run as written and the grid caps the rows.
 */
export function boundedSql(sql: string): string {
  const ends: number[] = [];
  const tokens = tokenize(sql, ends);
  if (tokens === null) return sql;
  let last = tokens.length - 1;
  while (
    last >= 0 &&
    tokens[last]?.kind === "punct" &&
    (tokens[last] as { text: string }).text === ";"
  )
    last -= 1;
  const first = tokens[0];
  if (last < 0 || first?.kind !== "word") return sql;
  if (!["select", "with", "from"].includes(first.text.toLowerCase())) return sql;
  const body = sql.slice(0, ends[last]);
  return `SELECT * FROM (\n${body}\n) AS result LIMIT ${SQL_RESULT_ROWS + 1}`;
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
