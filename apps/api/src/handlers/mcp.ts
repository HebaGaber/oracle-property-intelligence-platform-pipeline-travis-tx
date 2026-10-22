// A-14 T018 (G-4, wave 1): a placeholder entry point for the MCP Lambda the CDK Api stack
// (infra/src/api-stack.ts, MCP block) bundles. The real Streamable HTTP transport, the six
// AD-21 tool registrations and the auth.ts (T017) wiring land in apps/api/src/mcp/server.ts in
// a later wave (T024-T026); until then this handler answers GET /health (no auth, matching the
// contract `../mcp/auth.ts` will gate every other route with) and reports every other path as
// not yet implemented, so `cdk synth`/bundling is green without pretending the server is built.
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const path = event.requestContext.http.path;
  if (path.endsWith("/health")) {
    return { statusCode: 200, body: JSON.stringify({ status: "ok" }) };
  }
  return {
    statusCode: 501,
    body: JSON.stringify({ error: "mcp server not yet implemented (A-14 T024-T026)" }),
  };
}
