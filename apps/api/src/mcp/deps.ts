// The hosted engine wiring of `McpToolDeps`, shared by the MCP Lambda (handlers/mcp.ts) and the
// in-process "Try a tool" proxy (routers/mcp-proxy.ts). `resolveRun` binds the AD-18 DuckDB engine
// (src/engine/duckdb-node.ts) to the caller's `manifest_cid` or the latest `runs/index.json`
// entry; resolution failure resolves to `undefined` (never thrown), which src/mcp/tools.ts turns
// into the typed `run_not_found` envelope. Nothing here reads a secret or the MCP token.
import type { RunsIndexV1 } from "@countylens/contract";
import { bindOnce, getEngine } from "../engine/duckdb-node.js";
import { latestOf, loadRunsIndex } from "./runs-index.js";
import type { McpRunContext, McpToolDeps } from "./tools.js";

export function createEngineDeps(): McpToolDeps {
  return {
    async resolveRun(manifestCid): Promise<McpRunContext | undefined> {
      try {
        let cid = manifestCid;
        if (cid === undefined) {
          const index = await loadRunsIndex();
          const latest = latestOf(index);
          if (latest === undefined) return undefined;
          cid = latest.manifestCid;
        }
        const [bound, engine] = await Promise.all([bindOnce(cid), getEngine()]);
        return { engine, bound };
      } catch {
        return undefined;
      }
    },
    runsIndex(): Promise<Pick<RunsIndexV1, "runs">> {
      return loadRunsIndex();
    },
  };
}
