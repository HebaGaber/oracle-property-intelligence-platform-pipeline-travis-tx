// The local binder of the bind guard (src/bind-guard.ts, CR-A-03 F-1): the real query-core
// bindManifest over an in-memory node DuckDB, reading each table part from the run directory
// (manifest artifact names are relative to it), then listRoofingPermitsSql() and
// runSummarySql(). It lives outside src/ because DuckDB is banned from pipeline/publish/src
// (ARD § 4, AD-19); src/bind-guard.ts imports it lazily. query-core and its DuckDB adapter are
// imported by path (packages/query-core/scripts/duckdb-engine.ts, the A-02 node adapter), so
// this package needs no new dependency entry.
import { join } from "node:path";
import {
  bindManifest,
  listRoofingPermitsSql,
  runSummarySql,
} from "../../../packages/query-core/src/index.js";
import { openDuckDb } from "../../../packages/query-core/scripts/duckdb-engine.js";
import type { LocalBinder } from "../src/bind-guard.js";

export const localBind: LocalBinder = async ({ manifestBytes, runDir }) => {
  const db = await openDuckDb();
  try {
    const bound = await bindManifest(manifestBytes, join(runDir, "tables"), db, {
      partUrl: ({ name }) => join(runDir, name),
    });
    const permits = await db.all(listRoofingPermitsSql());
    const [summary] = await db.all(runSummarySql());
    if (summary === undefined) throw new Error("runSummarySql returned no row");
    return {
      runId: String(summary.run_id),
      manifestCid: String(summary.manifest_cid),
      permitRows: permits.length,
      roofingPermitRows: Number(summary.roofing_permit_rows),
      tables: bound.tables.length,
    };
  } finally {
    db.close();
  }
};
