// Root router (A-03 T008, T064, T072; A-13 T012): `runs` (runs.summary), `query` (query.radius,
// query.roofAge) per contracts/api.md, and `explore` (explore.search, A-13
// contracts/explore-search.md). `AppRouter` is the type the shared client (packages/api-client)
// imports type-only; procedures change additively only (ARD § 6).
import { router } from "../trpc.js";
import { exploreRouter } from "./explore.js";
import { queryRouter } from "./query.js";
import { runsRouter } from "./runs.js";

export const appRouter = router({
  runs: runsRouter,
  query: queryRouter,
  explore: exploreRouter,
});

export type AppRouter = typeof appRouter;
