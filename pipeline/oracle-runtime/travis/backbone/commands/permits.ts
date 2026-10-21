// A-04 T051: `backbone permits --mode backfill|incremental|pilot` or `backbone permits --link`
// (contracts/cli.md). Starts the AustinPermits workflow through the Restate ingress (never the
// Query DB), waits for its output, prints counts only, and exits 0 ok · 1 failed · 2 blocked
// (a source refused; receipt written; never retried). `pilot` = one page (maxPages 1);
// `--link` = link + classify over the loaded rows (the Loader writes).
import { z } from "zod";
import type { BackboneCommand, ExitCode } from "../cli.js";

const Args = z
  .object({
    mode: z.enum(["backfill", "incremental", "pilot"]).optional(),
    link: z.literal(true).optional(),
    /** Start the backfill from page 1, archiving a stale cursor (F2 OR-m5). */
    fresh: z.literal(true).optional(),
  })
  .strict()
  .refine((a) => (a.mode === undefined) !== (a.link === undefined), {
    message: "give exactly one of --mode backfill|incremental|pilot or --link",
  })
  .refine((a) => a.fresh === undefined || a.mode === "backfill", {
    message: "--fresh only goes with --mode backfill",
  });
type Args = z.infer<typeof Args>;

const Output = z.looseObject({
  status: z.enum(["complete", "waiting_human", "failed"]),
  exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  pages: z.number().int().optional(),
  rows: z.number().int().optional(),
  written: z.number().int().optional(),
  tombstones: z.number().int().optional(),
  watermark: z.string().nullable().optional(),
  watermarkCheck: z.string().optional(),
  reason: z.string().optional(),
});

export const command: BackboneCommand<Args> = {
  verb: "permits",
  args: Args,
  async run(ctx, args) {
    const mode = args.link === true ? "link" : (args.mode ?? "backfill");
    const jobId = ctx.jobIdFor(`permits-${mode}`);
    const key = `austin-3syk-w9eu-${jobId.replace(/^travis-a04-permits-/, "")}`;
    await ctx.ingress.send("AustinPermits", key, "run", {
      jobId,
      mode,
      ...(args.fresh ? { fresh: true } : {}),
    });
    const out = Output.parse(await ctx.ingress.get("AustinPermits", key));
    const counts = [
      `status=${out.status}`,
      `pages=${out.pages ?? 0}`,
      `rows=${out.rows ?? 0}`,
      `written=${out.written ?? 0}`,
      `tombstones=${out.tombstones ?? 0}`,
      ...(out.watermark ? [`watermark=${out.watermark}`] : []),
      ...(out.watermarkCheck ? [`watermark_check=${out.watermarkCheck}`] : []),
    ];
    ctx.print(`permits ${mode}: ${counts.join(" ")}`);
    if (out.reason) ctx.print(`permits ${mode}: ${out.reason}`);
    return { jobId, exitCode: out.exitCode as ExitCode };
  },
};
