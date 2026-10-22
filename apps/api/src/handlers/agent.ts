// A-14 T016 (G-2, wave 1): a placeholder entry point for the agent Lambda the CDK Api stack
// (infra/src/api-stack.ts, Agent block) bundles. The real `agent.ask` tRPC procedure — the
// ToolLoopAgent/Vercel AI SDK tool loop, the spend-cap pre-check (src/agent/spend.ts), the
// 23 s abort / timeout layering (AD-27) — lands in apps/api/src/agent/ask.ts in a later wave
// (T019-T022); until then this handler reports 501 so `cdk synth`/bundling is green without
// pretending the agent is built, matching the same placeholder pattern as handlers/mcp.ts.
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export async function handler(
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  return {
    statusCode: 501,
    body: JSON.stringify({ error: "agent.ask not yet implemented (A-14 T019-T022)" }),
  };
}
