// Root router (A-03 T008, T064, T072): `runs` (runs.summary) and `query` (query.radius,
// query.roofAge) per contracts/api.md. `AppRouter` is the type the shared client
// (packages/api-client) imports type-only; procedures change additively only (ARD § 6).
import { router } from "../trpc.js";
import { queryRouter } from "./query.js";
import { runsRouter } from "./runs.js";

export const appRouter = router({
  runs: runsRouter,
  query: queryRouter,
});

export type AppRouter = typeof appRouter;
