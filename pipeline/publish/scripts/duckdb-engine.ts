// The DuckDB engine the identity gate binds manifests with (AD-19: src/ never imports DuckDB;
// scripts wire it). In-memory, with the extensions bindManifest's views need, TimeZone UTC.
import type { QueryEngine, Row } from "@countylens/query-core";
import { DuckDBInstance } from "@duckdb/node-api";
import type { OpenedEngine } from "../src/identity-gate.js";

export async function openDuckDbEngine(): Promise<OpenedEngine> {
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  await conn.run("LOAD parquet; LOAD httpfs; LOAD json; LOAD icu; SET TimeZone = 'UTC'");
  const engine: QueryEngine = {
    run: async (sql) => {
      await conn.run(sql);
    },
    all: async (sql) => (await conn.runAndReadAll(sql)).getRowObjectsJson() as Row[],
  };
  return { engine, close: () => conn.closeSync() };
}
