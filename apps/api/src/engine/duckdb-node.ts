// A-03 T008 stub (interface fixed for T072, G-C2a): the Lambda's DuckDB engine. T072 implements
// it with `@duckdb/node-api` (the only module allowed to import it: apps/*/src/engine/**, AD-19):
// a module-scope instance (`threads = 2`, bundled `httpfs` via `extension_directory`, remote
// autoinstall / autoload off), views bound once per manifest CID through `bindManifest` with
// `partUrl` → presigned `ipfs/<cid>` URLs (research R-03), results capped at 1,000 rows.
import type { BoundRun, QueryEngine, Row } from "@countylens/query-core";

/** ADR-0001 Lambda sizing: two DuckDB threads at 1,769 MB. */
export const DUCKDB_THREADS = 2;

/** The query-core engine over the module-scope DuckDB instance (created on first use). */
export function getEngine(): Promise<QueryEngine> {
  throw new Error("not implemented");
}

/** Binds the contract views to `manifestCid` once per sandbox; a repeat call is a no-op. */
export function bindOnce(_manifestCid: string): Promise<BoundRun> {
  throw new Error("not implemented");
}

/** Runs one read-only statement against the bound views (≤ 1,000 rows). */
export function query(_sql: string): Promise<Row[]> {
  throw new Error("not implemented");
}
