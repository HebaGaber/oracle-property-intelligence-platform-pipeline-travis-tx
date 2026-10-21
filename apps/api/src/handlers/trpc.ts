// A-03 T008 stub of the Lambda entry point. T073 (G-C2b) implements it: the tRPC AWS Lambda
// adapter over `appRouter` + `createContext`, wrapped by middy with Powertools
// `injectLambdaContext` (correlation ID from the HTTP API event), `captureLambdaHandler` and
// `logMetrics({ captureColdStartMetric: true })`; the direct-invoke bench branch (T065) is
// routed from here too; every response carries `x-correlation-id` and `x-trace-id`
// (contracts/api.md). The handler type is fixed so the CDK Api stack (T074) can target it now.
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Handler,
} from "aws-lambda";

export type TrpcHandler = Handler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>;

export const handler: TrpcHandler = () => {
  throw new Error("not implemented");
};
