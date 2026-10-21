// tRPC request context (A-03 T008; build-frontend-backends § tRPC backend). T073 (G-C2b) adds
// the Powertools Logger / Tracer / Metrics and the correlation ID here; procedures read them
// from `ctx` and never construct their own.
import type { CreateAWSLambdaContextOptions } from "@trpc/server/adapters/aws-lambda";
import type { APIGatewayProxyEventV2, Context as LambdaContext } from "aws-lambda";

export interface Context {
  readonly event: APIGatewayProxyEventV2;
  readonly lambda: LambdaContext;
}

export function createContext({
  event,
  context,
}: CreateAWSLambdaContextOptions<APIGatewayProxyEventV2>): Context {
  return { event, lambda: context };
}
