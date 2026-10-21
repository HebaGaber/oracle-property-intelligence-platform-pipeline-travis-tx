// A-03 T072 (G-C2a): `runs.summary` per contracts/api.md. The input is a CidV1 (else
// BAD_REQUEST, nothing fetched); the engine binds the views to that manifest (NOT_FOUND when the
// copy lacks it, INTERNAL_SERVER_ERROR when the bytes do not hash to it) and `runSummarySql()`
// counts the published roofing-permit rows. The Runs page shows this as its "Server check" line;
// the headline counts still come from the manifest itself (FR-009).
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { CidV1 } from "@countylens/contract";
import { runSummarySql } from "@countylens/query-core";
import { bindOnce, timedQuery } from "../engine/duckdb-node.js";
import { publicProcedure, router } from "../trpc.js";

export const RunSummaryInput = z.object({ manifestCid: CidV1 });

export interface RunSummary {
  readonly manifestCid: string;
  /** Always true on success: a mismatch between bytes and CID is an error, never a summary. */
  readonly verified: true;
  /** Tables the manifest publishes and the views are bound over (not the empty placeholders). */
  readonly tablesBound: number;
  readonly roofingPermitRows: number;
  readonly queryDurationMs: number;
}

export const runsRouter = router({
  summary: publicProcedure.input(RunSummaryInput).query(async ({ input }): Promise<RunSummary> => {
    const bound = await bindOnce(input.manifestCid);
    const { rows, queryDurationMs } = await timedQuery(runSummarySql(), {
      name: "runSummarySql",
      manifestCid: bound.manifestCid,
    });
    const count = rows[0]?.["roofing_permit_rows"];
    if (rows.length !== 1 || typeof count !== "number") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "runSummarySql returned no count row",
      });
    }
    return {
      manifestCid: bound.manifestCid,
      verified: true,
      tablesBound: bound.tables.filter((t) => t.emitted).length,
      roofingPermitRows: count,
      queryDurationMs,
    };
  }),
});
