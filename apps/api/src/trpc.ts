// tRPC initialisation (A-03 T008). One instance for the whole API; routers import `router` and
// `publicProcedure` from here. Every procedure input is a Zod schema (constitution V); the API
// is public and read-only (FR-013), so there is no protected procedure in A-03.
import { initTRPC } from "@trpc/server";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;
