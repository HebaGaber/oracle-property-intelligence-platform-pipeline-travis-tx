// A-04 T026: binds `TcadChunk` (oracle-runtime travis/tcad/chunk.ts), one child per ~10k export
// records. Each part is journaled: prepare (parse → redact → map → mapped artifact, pilot
// zips) as one ctx.run, then ONE Loader merge (track tcad, the only writer), then cleanup; a
// retry after a crash never re-reads a deleted input.
import type * as Restate from "@restatedev/restate-sdk";
import { cleanupChunk, prepareChunk, type ChunkOutcome, type ChunkSpec } from "../../../oracle-runtime/travis/tcad/chunk.js";
import { loaderInput } from "../../../oracle-runtime/travis/tcad/workflow.js";
import { LOADER_KEY, type createLoader } from "../loader.js";

type LoaderDefinition = ReturnType<typeof createLoader>;

export const TCAD_CHUNK = "TcadChunk";

export function createService(restate: typeof Restate) {
  return restate.service({
    name: TCAD_CHUNK,
    handlers: {
      run: async (ctx: Restate.Context, spec: ChunkSpec): Promise<ChunkOutcome> => {
        const out = await ctx.run(`prepare-c${spec.n}`, () => prepareChunk(spec));
        await ctx
          .objectClient<LoaderDefinition>({ name: "Loader" } as LoaderDefinition, LOADER_KEY)
          .merge({
            track: "tcad",
            input: loaderInput(spec.jobId, { kind: "chunk", artifactPath: spec.mappedPath, artifactSha256: out.mappedSha256 }),
          });
        await ctx.run(`cleanup-c${spec.n}`, async () => {
          cleanupChunk(spec);
          return true;
        });
        return out;
      },
    },
    options: { inactivityTimeout: { minutes: 30 }, abortTimeout: { minutes: 60 } },
  });
}
