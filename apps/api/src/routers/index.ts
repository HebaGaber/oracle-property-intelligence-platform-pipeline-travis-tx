// Root router (A-03 T008). Empty in W2; W3 registers `runs` (T072, runs.summary) and `query`
// (T064, query.radius / query.roofAge) per contracts/api.md. `AppRouter` is the type the shared
// client (packages/api-client) imports type-only; procedures change additively only (ARD § 6).
import { router } from "../trpc.js";

export const appRouter = router({});

export type AppRouter = typeof appRouter;
