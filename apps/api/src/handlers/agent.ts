// A-14 T016/T019-T022 (G-2): the agent Lambda's entry point (infra/src/api-stack.ts, Agent
// block). `agent.ask` — the Vercel AI SDK tool loop (src/agent/ask.ts), the spend-cap pre-check
// (src/agent/spend.ts), the 23 s abort/timeout layering (AD-27) — is served through the tRPC AWS
// Lambda adapter over its own router (src/agent/router.ts), the same adapter handlers/trpc.ts
// uses for the query API's appRouter, just a different, independent router/Lambda pair (AD-27:
// the agent Lambda's blast radius and timeout are its own, never shared with the query API).
import { awsLambdaRequestHandler } from "@trpc/server/adapters/aws-lambda";
import { createContext } from "../context.js";
import { agentRouter } from "../agent/router.js";

export const handler = awsLambdaRequestHandler({ router: agentRouter, createContext });
