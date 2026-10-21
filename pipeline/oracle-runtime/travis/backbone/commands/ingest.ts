// A-04 T027: `backbone ingest --track appraisal` (contracts/cli.md). Starts TcadBackbone over
// the whole export through the Restate ingress (never the Query DB) and polls its status:
// complete → 0 · failed → 1 · blocked → 2 · waiting_human → 3 (a missing / mismatched export,
// or a 403 on the one allowed download). Extra flags on the same verb:
//   --write-group --job <jobId>          the County group (R only, gis_centroid geometry only)
//   --join-proof --job <jobId> --seed <n> the read-only 1,000-row geoID→pID proof + reverse
// Prints counts and paths only.
import { z } from "zod";
import type { BackboneCommand, ExitCode } from "../cli.js";
import type { RunContext } from "../run-context.js";

const JobId = z.string().regex(/^travis-a04-[a-z0-9-]+$/);

const Args = z
  .object({
    track: z.literal("appraisal").optional(),
    writeGroup: z.literal(true).optional(),
    joinProof: z.literal(true).optional(),
    job: JobId.optional(),
    seed: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
    /** Poll interval in ms (tests pass 0). */
    pollMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (a) =>
      [a.track !== undefined, a.writeGroup === true, a.joinProof === true].filter(Boolean)
        .length === 1,
    {
      message: "give exactly one of --track appraisal, --write-group or --join-proof",
    },
  )
  .refine((a) => (a.track !== undefined ? a.job === undefined : a.job !== undefined), {
    message: "--write-group and --join-proof need --job <jobId>; --track appraisal takes none",
  })
  .refine((a) => (a.joinProof === true) === (a.seed !== undefined), {
    message: "--join-proof needs --seed <int>",
  });
export type IngestArgs = z.infer<typeof Args>;

const Status = z.looseObject({
  status: z.enum(["running", "waiting_human", "blocked", "complete", "failed"]),
  reason: z.string().nullable().optional(),
  loaded: z.number().int().optional(),
  records: z.number().int().optional(),
});

export const EXIT_FOR_STATUS: Readonly<Record<string, ExitCode>> = {
  complete: 0,
  failed: 1,
  blocked: 2,
  waiting_human: 3,
};

/** Polls TcadBackbone/<jobId>/status until it is not `running`; prints counts only. */
export async function waitForRun(
  ctx: RunContext,
  jobId: string,
  pollMs = 5_000,
): Promise<ExitCode> {
  for (;;) {
    const s = Status.parse(await ctx.ingress.call("TcadBackbone", "status", null, jobId));
    if (s.status !== "running") {
      ctx.print(
        `tcad: status=${s.status}${s.records === undefined ? "" : ` records=${s.records}`}${s.loaded === undefined ? "" : ` loaded=${s.loaded}`}${s.reason ? ` reason=${s.reason}` : ""}`,
      );
      return EXIT_FOR_STATUS[s.status] ?? 1;
    }
    if (pollMs > 0) await new Promise((r) => setTimeout(r, pollMs));
  }
}

const GroupOut = z.looseObject({
  zips: z.number().int(),
  out_of_scope: z.number().int(),
  dir: z.string(),
  geometry: z.record(z.string(), z.number()),
});
const ProofOut = z.looseObject({
  pass: z.boolean(),
  matched: z.number().int(),
  disagreements: z.number().int(),
  no_tcad_geoid: z.number().int(),
  ambiguous_geoid: z.number().int(),
  reverse_checked: z.number().int(),
  reverse_disagreements: z.number().int(),
});

export const command: BackboneCommand<IngestArgs> = {
  verb: "ingest",
  args: Args,
  startsRun: (a) => a.track !== undefined,
  async run(ctx, args) {
    if (args.writeGroup === true && args.job !== undefined) {
      const out = GroupOut.parse(
        await ctx.ingress.call("TcadBackbone", "writeGroup", { jobId: args.job }, args.job),
      );
      ctx.print(
        `county_group: zips=${out.zips} out_of_scope=${out.out_of_scope} geometry=${JSON.stringify(out.geometry)} dir=${out.dir}`,
      );
      return { jobId: args.job, exitCode: 0 };
    }
    if (args.joinProof === true && args.job !== undefined) {
      const seed = Number(args.seed);
      const out = ProofOut.parse(
        await ctx.ingress.call("TcadBackbone", "joinProof", { jobId: args.job, seed }, args.job),
      );
      ctx.print(
        `join_proof: no_tcad_geoid=${out.no_tcad_geoid} ambiguous_geoid=${out.ambiguous_geoid} reverse_checked=${out.reverse_checked} reverse_disagreements=${out.reverse_disagreements} seed=${seed}`,
      );
      ctx.print(
        `join_proof=${out.pass ? "pass" : "fail"} matched=${out.matched} disagreements=${out.disagreements}`,
      );
      return { jobId: args.job, exitCode: out.pass ? 0 : 1 };
    }
    const jobId = ctx.jobIdFor(null);
    await ctx.ingress.send("TcadBackbone", jobId, "run", { jobId, mode: "full", asOf: ctx.asOf() });
    return { jobId, exitCode: await waitForRun(ctx, jobId, args.pollMs) };
  },
};
