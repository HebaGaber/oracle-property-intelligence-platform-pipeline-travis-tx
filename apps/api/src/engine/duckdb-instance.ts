// A-03 T072 (G-C2a): the one module that imports @duckdb/node-api (ESLint allows it under
// apps/*/src/engine/** only, AD-19). `openDuckDb` returns the query-core QueryEngine over one
// in-memory DuckDB: `threads` per ADR-0001 (2 on the 1,769 MB Lambda), `extension_directory`
// pointing at the httpfs copy the CDK Api stack (T074) bundles beside the handler, remote
// autoinstall / autoload off so the Lambda never reaches extensions.duckdb.org, TimeZone UTC so
// the builders' as_of date is the manifest's UTC calendar date, and a writable temp directory
// (the Lambda task root is read-only). Values come back JSON-shaped, the same way as
// packages/query-core/scripts/duckdb-engine.ts (DATE → "YYYY-MM-DD", TIMESTAMPTZ → ISO 8601 UTC,
// BIGINT → number). duckdb-node.ts wraps this in the module-scope engine; the router tests
// replace this module with a recording fake so they run without a database.
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { QueryEngine, Row } from "@countylens/query-core";

export interface DuckDbOptions {
  /** DuckDB `threads` (ADR-0001 Lambda sizing: 2). */
  readonly threads: number;
  /** DuckDB `memory_limit`, e.g. "1GB": keeps DuckDB inside the Lambda's memory. */
  readonly memoryLimit: string;
  /** DuckDB `extension_directory`: `<dir>/<duckdb version>/<platform>/httpfs.duckdb_extension`. */
  readonly extensionDirectory: string;
  /** DuckDB `temp_directory` for spills; must be writable (under /tmp on Lambda). */
  readonly tempDirectory: string;
  /** `LOAD httpfs` after opening (the Lambda reads presigned HTTPS URLs); off over local files. */
  readonly httpfs: boolean;
}

export interface DuckDbEngine extends QueryEngine {
  close(): void;
}

/** DuckDB JS values → JSON-shaped values (dates as strings, BIGINT as number). */
function plain(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return type === "DATE" ? value.toISOString().slice(0, 10) : value.toISOString();
  }
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map((v) => plain(v, ""));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v, "")]));
  }
  return value;
}

/** Opens one in-memory DuckDB with the given options; the caller owns `close()`. */
export async function openDuckDb(options: DuckDbOptions): Promise<DuckDbEngine> {
  const instance = await DuckDBInstance.create(":memory:", {
    threads: String(options.threads),
    memory_limit: options.memoryLimit,
    extension_directory: options.extensionDirectory,
    temp_directory: options.tempDirectory,
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
  });
  const connection: DuckDBConnection = await instance.connect();
  try {
    await connection.run("SET TimeZone = 'UTC'");
    if (options.httpfs) await connection.run("LOAD httpfs");
  } catch (error) {
    connection.closeSync();
    instance.closeSync();
    throw error;
  }
  return {
    async run(sql: string): Promise<void> {
      await connection.run(sql);
    },
    async all(sql: string): Promise<Row[]> {
      const reader = await connection.runAndReadAll(sql);
      const types = reader.columnTypes().map((t) => t.toString());
      const names = reader.columnNames();
      return reader
        .getRowObjectsJS()
        .map((row) => Object.fromEntries(names.map((n, i) => [n, plain(row[n], types[i] ?? "")])));
    },
    close(): void {
      connection.closeSync();
      instance.closeSync();
    },
  };
}
