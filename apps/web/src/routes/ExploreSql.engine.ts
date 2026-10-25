// The SQL panel's engine session (A-13 T029; AC-6, FR-006, FR-017; research R2; AD-19). The only
// route-side importer of engine/duckdb-wasm (dynamic import, so the engine stays in its own
// "duckdb" chunk and loads only on `?mode=sql`). Same read path as the A-03 Permits loader: run
// index → latest manifest by CID (copy, then the labelled Filebase fallback) → the table parts
// from that host, CID-verified → registered buffers → the contract views a query names, bound on its
// first run (A13-2, createViewBinder; before A-16 every view was bound up front). The engine starts
// in parallel with the reads (ERR-17). `readOnlyRefusal` keeps every statement read-only before it
// reaches the engine (one SELECT, WITH, DESCRIBE or SHOW statement, no data-changing keyword);
// `sqlErrorLine` turns an engine error into one line "{first line} · Try: {fix}", no stack trace.
import type { ContractView, Row } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { readPathUrlsFromEnv } from "../data/config";
import { fallbackLabel } from "../data/fetch-by-cid";
import {
  fetchParts,
  partsToPrefetch,
  registeredPartName,
  type PartToFetch,
} from "../data/fetch-parts";
import { loadManifest } from "../data/manifest";
import { latestRun, loadRunsIndex } from "../data/runs-index";
import { STAGE_TEXTS } from "../engine/stages";

/**
 * query-core's CONTRACT_VIEWS, kept here so this route chunk imports no query-core runtime code
 * (its bind code reaches the panel only through the lazy engine chunk); test/sql-lazy-bind pins
 * it to query-core's list.
 */
export const SQL_VIEWS: readonly ContractView[] = [
  "v_property",
  "v_roofing_permit",
  "v_contractor",
  "v_run",
];
const VIEW_REF = new RegExp(`\\b(${SQL_VIEWS.join("|")})\\b`, "g");

/** The contract views `sql` names, in SQL_VIEWS order (query-core viewsReadBy). */
export function viewsNamedIn(sql: string): ContractView[] {
  const named = new Set([...sql.matchAll(VIEW_REF)].map((m) => m[1]));
  return SQL_VIEWS.filter((v) => named.has(v));
}

export interface SqlSession {
  readonly runId: string;
  readonly manifestCid: string;
  /** `fallback · {host}` when Filebase served the manifest and parts; null for the copy. */
  readonly fallbackLabel: string | null;
  /** True when `sql` names a contract view not bound yet (its first query binds it: slow). */
  readonly needsBind: (sql: string) => boolean;
  readonly query: (sql: string) => Promise<Row[]>;
  readonly close: () => Promise<void>;
}

type PartRef = { readonly name: string; readonly cid: string };

export interface ViewBinderDeps {
  /** The table part names the views read (query-core `boundPartNames`). */
  readonly partsFor: (views: readonly ContractView[]) => string[];
  /** Those parts to read up front, or null when they are too large (`partsToPrefetch`). */
  readonly prefetchable: (names: ReadonlySet<string>) => PartToFetch[] | null;
  /** Reads the parts (CID-verified) and registers them with the engine. */
  readonly fetchAndRegister: (parts: PartToFetch[]) => Promise<void>;
  /** Binds the views (query-core `bindManifest` with `views`), replacing the earlier bind. */
  readonly bind: (
    views: readonly ContractView[],
    partUrl: (artifact: PartRef) => string,
  ) => Promise<unknown>;
  /** Where the engine range-reads a part it was not given (the host that served the manifest). */
  readonly remoteUrl: (artifact: PartRef) => string;
  /** The registered file name of a prefetched part. */
  readonly registeredUrl: (artifact: PartRef) => string;
  /** Called with the views about to be bound (the stage text for the status note). */
  readonly onBind: (views: readonly ContractView[]) => void;
}

export interface ViewBinder {
  /** Binds the views `sql` names that are not bound yet; resolves when they are queryable. */
  (sql: string): Promise<void>;
  /** The views bound now, in CONTRACT_VIEWS order. */
  readonly bound: () => ContractView[];
  /** True when `sql` names a view not bound yet. */
  readonly pending: (sql: string) => boolean;
}

/**
 * A13-2: bind only the contract views a query names, the first time it names them, and remember
 * them. bindManifest drops and recreates the run schemas, so a new view rebinds the union of the
 * views named so far; parts already registered are not read again. Calls run one after another.
 * A failed bind leaves nothing bound (the schemas were dropped), so the next query binds again.
 */
export function createViewBinder(deps: ViewBinderDeps): ViewBinder {
  let bound: ContractView[] = [];
  const registered = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  const missing = (sql: string): ContractView[] =>
    viewsNamedIn(sql).filter((v) => !bound.includes(v));
  const ensure = async (sql: string): Promise<void> => {
    if (missing(sql).length === 0) return;
    const union = SQL_VIEWS.filter((v) => bound.includes(v) || viewsNamedIn(sql).includes(v));
    deps.onBind(union);
    const names = deps.partsFor(union);
    const fresh = names.filter((n) => !registered.has(n));
    const toFetch = fresh.length === 0 ? [] : deps.prefetchable(new Set(fresh));
    if (toFetch !== null && toFetch.length > 0) {
      await deps.fetchAndRegister(toFetch);
      for (const p of toFetch) registered.add(p.name);
    }
    try {
      await deps.bind(union, (a) =>
        registered.has(a.name) ? deps.registeredUrl(a) : deps.remoteUrl(a),
      );
      bound = union;
    } catch (error) {
      bound = [];
      throw error;
    }
  };
  const binder = ((sql: string) => {
    const next = chain.then(() => ensure(sql));
    chain = next.catch(() => undefined);
    return next;
  }) as ViewBinder;
  Object.defineProperty(binder, "bound", { value: () => [...bound] });
  Object.defineProperty(binder, "pending", { value: (sql: string) => missing(sql).length > 0 });
  return binder;
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
    const { module, engine } = await starting;
    signal.throwIfAborted();
    // A13-2: nothing is bound yet; each query binds the views it names (createViewBinder).
    const binder = createViewBinder({
      partsFor: (views) => module.viewPartNames(loaded.manifest.artifacts, views),
      prefetchable: (names) => partsToPrefetch(loaded.manifest, undefined, names),
      fetchAndRegister: async (parts) => {
        for (const part of await fetchParts(parts, loaded.read, { signal }))
          await engine.registerFile(registeredPartName(part), part.bytes);
      },
      bind: (views, partUrl) => module.bindViews(engine, loaded.read.bytes, partUrl, views),
      remoteUrl: loaded.read.partUrl,
      registeredUrl: registeredPartName,
      onBind: () => report(STAGE_TEXTS.bind),
    });
    return {
      runId: loaded.manifest.runId,
      manifestCid: loaded.manifestCid,
      fallbackLabel: fallbackLabel(loaded.read.source),
      needsBind: binder.pending,
      query: async (sql) => {
        await binder(sql);
        return engine.all(boundedSql(sql));
      },
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

/** The keywords a mistyped first word is matched against (FR-017: the suggested fix). */
const TYPO_TARGETS = ["SELECT", "WITH", "DESCRIBE", "SHOW"] as const;

/** Levenshtein edit distance (insert, delete, substitute), lower case. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row.push(
        Math.min(
          (previous[j] as number) + 1,
          (row[j - 1] as number) + 1,
          (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      );
    }
    previous = row;
  }
  return previous[b.length] as number;
}

/**
 * A mistyped read keyword at the start ("SELEC count(*) ...") gets one line
 * `Syntax error near "SELEC" · Try: SELECT` (FR-017). Nothing runs. A word that is closer to a
 * data-changing or IO keyword than to a read keyword ("delet") keeps the read-only refusal.
 */
function keywordTypo(word: string): string | null {
  const lower = word.toLowerCase();
  if (lower.length < 3) return null;
  let best: { readonly target: string; readonly distance: number } | null = null;
  for (const target of TYPO_TARGETS) {
    const distance = editDistance(lower, target.toLowerCase());
    if (distance <= 2 && (best === null || distance < best.distance)) best = { target, distance };
  }
  if (best === null) return null;
  for (const forbidden of FORBIDDEN_WORDS) {
    if (editDistance(lower, forbidden) <= best.distance) return null;
  }
  return EXPLORE_TEXTS.sqlError(`Syntax error near "${word}"`, best.target);
}

/** null when the statement may run; else the fixed read-only text (or the one-line typo message). */
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
    return (first?.kind === "word" ? keywordTypo(first.text) : null) ?? EXPLORE_TEXTS.sqlReadOnly;
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
    return "check the table or column name; the views are v_property, v_roofing_permit, v_contractor and v_run";
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
