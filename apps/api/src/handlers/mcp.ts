// A-14/A-15 T026 (G-4): the MCP Lambda's real entry point (infra/src/api-stack.ts's `Mcp`
// NodejsFunction, `entry: .../handlers/mcp.ts, handler: "handler"`). Replaces the T018
// placeholder: `GET /health` and `POST /mcp` now go through `src/mcp/server.ts`'s real
// Streamable HTTP wiring (auth, Origin check, the six AD-21 tools) instead of a 501.
//
// `McpToolDeps.resolveRun` binds the hosted engine (`src/engine/duckdb-node.ts`'s `bindOnce` +
// `getEngine`, the same AD-18 binder the tRPC Lambda uses — SSM/S3/CID-copy wiring unchanged,
// nothing here reaches into it) to either the caller's `manifest_cid` or the latest entry of
// `runs/index.json`. Resolution failure (an unknown CID, a bind error, or no runs published) is
// never thrown past this module: it resolves to `undefined`, and `src/mcp/tools.ts` turns that
// into the typed `run_not_found` envelope.
//
// `runsIndex()` (src/mcp/runs-index.ts) reads `runs/index.json` from the CID-copy bucket
// (`env.CID_COPY_BUCKET`, already set on this Lambda alongside the DuckDB engine's own bucket
// env var) with one S3 GetObject — the same bucket/key `src/agent/ask.ts`'s
// `defaultResolveManifestCid` reads for the agent Lambda. A read/parse failure here still
// resolves to `undefined` from `resolveRun`, never throws past this module: `src/mcp/tools.ts`
// turns that into the typed `run_not_found` envelope, not a guess and not a crash.
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { RunsIndexV1 } from "@countylens/contract";
import { bindOnce, getEngine } from "../engine/duckdb-node.js";
import { createMcpHandler } from "../mcp/server.js";
import { latestOf, loadRunsIndex } from "../mcp/runs-index.js";
import type { McpRunContext, McpToolDeps } from "../mcp/tools.js";

const deps: McpToolDeps = {
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

const handleMcpEvent = createMcpHandler({ deps });

/** The deployed entry point (`handlers/mcp.handler`, infra/src/api-stack.ts's MCP Lambda). */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleMcpEvent(event);
}
