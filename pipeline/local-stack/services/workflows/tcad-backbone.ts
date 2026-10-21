// A-04 T026: binds `TcadBackbone` (oracle-runtime travis/tcad/workflow.ts), keyed by job id
// (`travis-a04-…`). Handlers:
//   run         the backbone run (pure logic in runTcadBackbone); every write goes to the Loader
//               (track tcad); WAITING_HUMAN is a durable promise `resolve:<source>:<attempt>`
//   status      {status, reason?, records?, loaded?} for the CLI (exit 3 while waiting)
//   resolve     a human's answer to the waiting promise: {attempt, action: download | abort}
//   writeGroup  the County group (R only; geometry only for coordinate_source = gis_centroid)
//   joinProof   the read-only 1,000-row geoID → pID proof + reverse proof
// The Query DB is read here only (coordinates, join proof); the Loader is the only writer.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type * as Restate from "@restatedev/restate-sdk";
import { z } from "zod";
import { createSourceClient, type SourceClient } from "../../../oracle-runtime/travis/lib/source-client.js";
import { fetchDataGroupCids } from "../../../oracle-runtime/travis/transforms/lexicon-manifest.js";
import { verifyExport } from "../../../oracle-runtime/travis/tcad/export-verify.js";
import { streamExportRecords } from "../../../oracle-runtime/travis/tcad/export-stream.js";
import { exportSource, runDirFor } from "../../../oracle-runtime/travis/tcad/export-source.js";
import { createKeyInventory } from "../../../oracle-runtime/travis/tcad/key-inventory.js";
import { processRecord } from "../../../oracle-runtime/travis/tcad/process.js";
import { runJoinProof } from "../../../oracle-runtime/travis/tcad/join-proof.js";
import { planCountyGroup, writeCountyZips, type GroupInput } from "../../../oracle-runtime/travis/tcad/write-group.js";
import {
  TCAD_SOURCE_KEY,
  loaderInput,
  runTcadBackbone,
  type BackboneDeps,
  type BackboneResult,
  type Resolution,
  type TrackOp,
} from "../../../oracle-runtime/travis/tcad/workflow.js";
import { LOADER_KEY, lazyQueryDb, type createLoader } from "../loader.js";
import { TCAD_CHUNK, type createService as createChunk } from "./tcad-chunk.js";

type LoaderDefinition = ReturnType<typeof createLoader>;
type ChunkDefinition = ReturnType<typeof createChunk>;

export const TCAD_BACKBONE = "TcadBackbone";

const RunRequest = z.object({
  jobId: z.string().regex(/^travis-a04-[a-z0-9-]+$/),
  mode: z.enum(["pilot", "full"]),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  seedPids: z.array(z.string().regex(/^[1-9][0-9]*$/)).optional(),
});
const ResolveRequest = z.object({ attempt: z.number().int().nonnegative(), action: z.enum(["download", "abort"]) });

interface RunStatus {
  status: string;
  reason?: string | null;
  records?: number;
  loaded?: number;
}

const queryDb = lazyQueryDb();
let client: SourceClient | null = null;
const sourceClient = (): SourceClient => (client ??= createSourceClient({ hostSpacing: true }));

/** County group for one job: R parcels with their assembled coordinates (read-only SQL). */
async function writeGroup(jobId: string) {
  const sql = queryDb();
  let coords = new Map<string, { latitude: number | null; longitude: number | null; source: "gis_centroid" | "permit_point" | "none" }>();
  let assembled = true;
  try {
    const rows = await sql<Array<{ request_identifier: string; latitude: number | null; longitude: number | null; coordinate_source: string | null }>>`
      SELECT request_identifier, latitude, longitude, coordinate_source FROM parcels WHERE job_id = ${jobId} AND prop_type = 'R'`;
    coords = new Map(
      rows.map((r) => [
        r.request_identifier,
        { latitude: r.latitude, longitude: r.longitude, source: (r.coordinate_source ?? "none") as "gis_centroid" | "permit_point" | "none" },
      ]),
    );
  } catch {
    // Coordinates not assembled yet (0201_gis not applied): the unassembled-pilot rule.
    assembled = false;
    const rows = await sql<Array<{ request_identifier: string }>>`
      SELECT request_identifier FROM parcels WHERE job_id = ${jobId} AND prop_type = 'R'`;
    coords = new Map(rows.map((r) => [r.request_identifier, { latitude: null, longitude: null, source: "none" as const }]));
  }
  const src = exportSource();
  const cids = (await fetchDataGroupCids()).cids;
  const dir = join(runDirFor(jobId), "groups", "county");
  const inventory = createKeyInventory();
  const ctx = { jobId, asOf: new Date().toISOString().slice(0, 10), exportSha256: src.receipt.sha256, capturedAt: src.receipt.captured_at };
  const geometry: Record<string, number> = {};
  let zips = 0;
  let outOfScope = 0;
  let batch: GroupInput[] = [];
  const flush = (): void => {
    const plan = planCountyGroup(batch, cids);
    zips += writeCountyZips(dir, plan.groups).length;
    outOfScope += plan.out_of_scope.length;
    for (const g of plan.groups) geometry[g.geometry_rule] = (geometry[g.geometry_rule] ?? 0) + 1;
    batch = [];
  };
  for await (const rec of streamExportRecords(src.exportPath)) {
    const out = processRecord(rec, ctx, inventory);
    const l = out.loaded;
    if (l === undefined) continue;
    if (l.parcel.prop_type !== "R") continue;
    const c = coords.get(l.parcel.request_identifier);
    if (c === undefined) continue;
    batch.push({
      pID: l.parcel.request_identifier,
      geoId: l.parcel.geo_id,
      propType: l.parcel.prop_type,
      record: l.record,
      yearBuilt: l.parcel.property_structure_built_year,
      exportPoint:
        l.parcel.export_point_lat === null || l.parcel.export_point_lon === null
          ? null
          : { lat: l.parcel.export_point_lat, lon: l.parcel.export_point_lon, kind: l.parcel.export_point_kind },
      ...(assembled ? { coordinate: c } : {}),
    });
    if (batch.length >= 1000) flush();
  }
  if (batch.length > 0) flush();
  const nonR = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM parcels WHERE job_id = ${jobId} AND prop_type <> 'R'`;
  return { zips, out_of_scope: outOfScope + (nonR[0]?.n ?? 0), dir: dir.replace(/^.*\/pipeline\//, "pipeline/"), geometry };
}

async function joinProof(jobId: string, seed: number) {
  const sql = queryDb();
  const src = exportSource();
  return runJoinProof({
    seed,
    sampleAustinTcadIds: async (s, n) => {
      const rows = await sql<Array<{ tcad_id: string }>>`
        SELECT tcad_id FROM (SELECT DISTINCT tcad_id FROM property_improvements WHERE tcad_id IS NOT NULL) t
        ORDER BY md5(tcad_id || ${String(s)}) LIMIT ${n}`;
      return rows.map((r) => r.tcad_id);
    },
    resolveGeoIds: async (ids) => {
      const rows = await sql<Array<{ geo_id: string; request_identifier: string }>>`
        SELECT geo_id, request_identifier FROM parcel_geoids WHERE prop_type = 'R' AND geo_id IN ${sql(ids as string[])}`;
      const m = new Map<string, string[]>();
      for (const r of rows) m.set(r.geo_id, [...(m.get(r.geo_id) ?? []), r.request_identifier]);
      return m;
    },
    parcelIdsExist: async (ids) => {
      if (ids.length === 0) return new Set();
      const rows = await sql<Array<{ request_identifier: string }>>`
        SELECT request_identifier FROM parcels WHERE request_identifier IN ${sql(ids as string[])}`;
      return new Set(rows.map((r) => r.request_identifier));
    },
    zipPath: src.exportPath,
    zipSha256: src.receipt.sha256,
    exportRecords: () => streamExportRecords(src.exportPath),
  }).then((r) => ({ ...r, job_id: jobId }));
}

export function createService(restate: typeof Restate) {
  return restate.workflow({
    name: TCAD_BACKBONE,
    handlers: {
      run: async (ctx: Restate.WorkflowContext, raw: unknown): Promise<BackboneResult> => {
        const parsed = RunRequest.safeParse(raw);
        if (!parsed.success || parsed.data.jobId !== ctx.key) {
          throw new restate.TerminalError("TcadBackbone.run: {jobId = key, mode, asOf, seedPids?} required");
        }
        const req = parsed.data;
        const src = await ctx.run("export-source", async () => exportSource());
        const cids = req.mode === "pilot" ? await ctx.run("lexicon", async () => (await fetchDataGroupCids()).cids) : undefined;
        const loader = ctx.objectClient<LoaderDefinition>({ name: "Loader" } as LoaderDefinition, LOADER_KEY);
        const chunks = ctx.serviceClient<ChunkDefinition>({ name: TCAD_CHUNK } as ChunkDefinition);
        ctx.set<RunStatus>("status", { status: "running" });
        const deps: BackboneDeps = {
          step: (name, fn) => ctx.run(name, fn) as never,
          merge: async (op: TrackOp) => {
            if (op.kind === "run") ctx.set<RunStatus>("status", { status: op.status });
            const out = await loader.merge({ track: "tcad", input: loaderInput(req.jobId, op) });
            return { rowsWritten: out.rowsWritten };
          },
          verify: (path, sha) => verifyExport(path, sha),
          waitForHuman: async (name, why) => {
            ctx.set<RunStatus>("status", { status: "waiting_human", reason: why });
            ctx.set("waiting_on", name);
            return ctx.promise<Resolution>(name).get();
          },
          download: (request) => sourceClient().download(request),
          runChunk: (spec) => chunks.run(spec),
          listInputs: () => readdirSync(dirname(src.exportPath)).map((n) => join(dirname(src.exportPath), n)),
          records: (path) => streamExportRecords(path),
          now: () => new Date(),
        };
        const result = await runTcadBackbone(
          {
            jobId: req.jobId,
            mode: req.mode,
            asOf: req.asOf,
            exportPath: src.exportPath,
            receipt: src.receipt,
            runDir: runDirFor(req.jobId),
            ...(req.seedPids ? { seedPids: req.seedPids } : {}),
            ...(cids ? { cids } : {}),
          },
          deps,
        );
        ctx.set<RunStatus>("status", { status: result.status, records: result.summary.records, loaded: result.summary.loaded });
        return result;
      },
      status: async (ctx: Restate.WorkflowSharedContext): Promise<RunStatus> =>
        (await ctx.get<RunStatus>("status")) ?? { status: "running" },
      resolve: async (ctx: Restate.WorkflowSharedContext, raw: unknown): Promise<{ resolved: string }> => {
        const parsed = ResolveRequest.safeParse(raw);
        if (!parsed.success) throw new restate.TerminalError("TcadBackbone.resolve: {attempt, action} required");
        const name = `resolve:${TCAD_SOURCE_KEY}:${parsed.data.attempt}`;
        const waiting = await ctx.get<string>("waiting_on");
        if (waiting !== name) throw new restate.TerminalError(`TcadBackbone.resolve: the run is not waiting on ${name}`);
        await ctx.promise<Resolution>(name).resolve({ action: parsed.data.action });
        return { resolved: name };
      },
      writeGroup: async (ctx: Restate.WorkflowSharedContext, raw: unknown) => {
        const jobId = z.object({ jobId: z.string() }).parse(raw).jobId;
        if (jobId !== ctx.key) throw new restate.TerminalError("TcadBackbone.writeGroup: jobId must be the key");
        return ctx.run("write-group", () => writeGroup(jobId));
      },
      joinProof: async (ctx: Restate.WorkflowSharedContext, raw: unknown) => {
        const req = z.object({ jobId: z.string(), seed: z.number().int().nonnegative() }).parse(raw);
        return ctx.run("join-proof", () => joinProof(req.jobId, req.seed));
      },
    },
    options: { inactivityTimeout: { minutes: 30 }, abortTimeout: { hours: 3 } },
  });
}
