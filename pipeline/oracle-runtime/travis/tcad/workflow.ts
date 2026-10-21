// A-04 T026: the TcadBackbone run (durable-workflow-builder: CountyIngest-style workflow keyed
// by job id, pattern 11 fan-out to TcadChunk children with the pattern 1 backpressure window,
// durable promise for WAITING_HUMAN). Pure logic over injected deps; the Restate binding is
// pipeline/local-stack/services/workflows/tcad-backbone.ts (SDK type-only here).
//   1 status running
//   2 verify the export against the A-01 receipt (size/mtime/inode summary, CR2-10). Missing or
//     mismatched → status waiting_human and wait on a durable promise BEFORE any request
//     (NFR-002 "no new TCAD download without a stop"). Only a human resolution `download`
//     allows ONE identified request through the source client; a 403 is a blocked receipt,
//     status waiting_human again, no retry.
//   3 stream the export once (pilot: the seed pIDs only), write chunk inputs of `chunkSize`
//     records, run TcadChunk children with at most `window` in flight
//   4 refuse every other export file in the input dir (a supplemental export is never mixed in)
//   5 reconcile (seed = loaded + dead + invalid + transform_failure), dead.json, the D-7
//     limitations, finalize (duplicate export points, key inventory digest), status complete
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import type { DownloadRequest, DownloadResult } from "../lib/source-client.js";
import { GAZETTEER_SHA256 } from "../../../../packages/query-core/src/sql.generated.js";
import type { DataGroupCids } from "../transforms/lexicon-manifest.js";
import { writeChunkInput, type ChunkMergeOp, type ChunkOutcome, type ChunkSpec } from "./chunk.js";
import type { ExportRecordText } from "./export-stream.js";
import { ExportVerifyError } from "./export-verify.js";
import { DUPLICATE_MIN_GEOIDS } from "./export-point.js";
import { limitationsFor } from "./redact.js";
import { reconcile, writeDeadRecords, type Reconciliation } from "./reconcile.js";
import type { ChunkSummary } from "./process.js";
import type { CoverageRow } from "./write-group.js";

export type { ChunkOutcome, ChunkSpec } from "./chunk.js";

export const TCAD_SOURCE_KEY = "tcad-2026-certified-json";
export const DEFAULT_CHUNK_SIZE = 10_000;
export const DEFAULT_WINDOW = 4;
/** Download limits for the one identified request (A-01 FR-003). */
export const DOWNLOAD_INACTIVITY_MS = 10 * 60 * 1000;
export const DOWNLOAD_TOTAL_MS = 2 * 60 * 60 * 1000;

export type RunStatus = "running" | "waiting_human" | "blocked" | "complete" | "failed";

export type TrackOp =
  | ChunkMergeOp
  | { kind: "finalize"; duplicateMinGeoids: number; keyInventorySha256: string }
  | {
      kind: "run";
      track: "appraisal";
      mode: "pilot" | "full";
      status: RunStatus;
      as_of?: string;
      export_sha256?: string;
      gazetteer_sha256?: string;
      code_sha?: string;
    }
  | {
      kind: "receipt";
      receipt: {
        source_key: string;
        url: string;
        http_status: number | null;
        bytes: number | null;
        sha256: string | null;
        captured_at: string;
        outcome: "ok" | "blocked" | "error" | "skipped_checkpoint";
        attempts: number;
        ua: string;
        blocked_at: string | null;
      };
    }
  | {
      kind: "limitations";
      items: Array<{
        source_key: string;
        code: string;
        text: string;
        count: number | null;
        evidence_url: string | null;
      }>;
    };

/** The Loader input for one op: file ops carry their artifact; others hash the op itself. */
export function loaderInput(
  jobId: string,
  op: TrackOp,
): { jobId: string; artifactPath: string; artifactSha256: string; op: Record<string, unknown> } {
  if (op.kind === "chunk") {
    return {
      jobId,
      artifactPath: op.artifactPath,
      artifactSha256: op.artifactSha256,
      op: { kind: "chunk" },
    };
  }
  const sha = createHash("sha256")
    .update(`${jobId}\n${JSON.stringify(op)}`)
    .digest("hex");
  return { jobId, artifactPath: `op:${op.kind}`, artifactSha256: sha, op };
}

export interface BackboneInput {
  jobId: string;
  mode: "pilot" | "full";
  /** Run as-of date, fixed once for the run (RunContext.asOf). */
  asOf: string;
  /** The export file the A-01 receipt names (absolute). */
  exportPath: string;
  receipt: { url: string; sha256: string; captured_at: string };
  /** pipeline/data/runs/<jobId> (absolute). */
  runDir: string;
  /** Pilot: only these pIDs (as printed). */
  seedPids?: string[];
  chunkSize?: number;
  window?: number;
  /** Pilot: write the County group (needs the live lexicon data-group CIDs). */
  cids?: DataGroupCids;
  codeSha?: string;
}

export type Resolution = { action: "download" } | { action: "abort" };

/** Thrown by a test's waitForHuman to stand for a suspended Restate invocation. */
export class Suspended extends Error {
  override name = "Suspended";
}

export interface BackboneDeps {
  /** A journaled side effect (ctx.run): replays return the recorded value. */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Loader.merge on track tcad (a journaled child call). */
  merge(op: TrackOp): Promise<{ rowsWritten: number }>;
  verify(path: string, sha256: string): Promise<{ sha256: string }>;
  /** Waits on the durable promise `name` until a human resolves it. */
  waitForHuman(name: string, why: string): Promise<Resolution>;
  /** The source client's download (one identified request, StopOnBlocked). */
  download(request: DownloadRequest): Promise<DownloadResult>;
  /** One TcadChunk child (a journaled child call). */
  runChunk(spec: ChunkSpec): Promise<ChunkOutcome>;
  /** Files currently in the export's directory. */
  listInputs(): string[];
  records(path: string): AsyncIterable<ExportRecordText>;
  now(): Date;
}

export interface BackboneResult {
  jobId: string;
  status: RunStatus;
  chunks: number;
  summary: ChunkSummary;
  reconciliation: Reconciliation;
  refused_inputs: Array<{ file: string; reason: "supplemental_export_not_mixed" }>;
  key_inventory_sha256: string;
  coverage: CoverageRow[] | null;
  zips: number;
}

const PID_LINE = /^\s*"pID": "?([0-9]+)"?,?$/m;

/** pID as printed in a record's text (the export prints it near the top). */
export function pidOfText(text: string): string | null {
  return PID_LINE.exec(text.slice(0, 400))?.[1] ?? null;
}

/** Export files next to the run's export: refused, never read. */
export function refusedInputs(
  files: readonly string[],
  exportPath: string,
): BackboneResult["refused_inputs"] {
  return files
    .filter((f) => f !== exportPath && /\.(zip|json)$/i.test(f) && /json/i.test(basename(f)))
    .map((f) => ({ file: basename(f), reason: "supplemental_export_not_mixed" as const }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function inventorySha(parts: readonly ChunkOutcome[]): string {
  const keys = new Set<string>();
  for (const p of parts) for (const k of Object.keys(p.inventory)) keys.add(k);
  return createHash("sha256")
    .update([...keys].sort().join("\n"))
    .digest("hex");
}

async function verifyOrWait(input: BackboneInput, deps: BackboneDeps): Promise<boolean> {
  const runOp = (status: RunStatus): TrackOp => ({
    kind: "run",
    track: "appraisal",
    mode: input.mode,
    status,
    export_sha256: input.receipt.sha256,
  });
  for (let attempt = 0; ; attempt += 1) {
    const check = await deps.step(`verify-${attempt}`, async () => {
      try {
        await deps.verify(input.exportPath, input.receipt.sha256);
        return { ok: true as const, code: null };
      } catch (e) {
        if (e instanceof ExportVerifyError) return { ok: false as const, code: e.code };
        throw e;
      }
    });
    if (check.ok) return true;
    await deps.merge(runOp("waiting_human"));
    const resolution = await deps.waitForHuman(
      `resolve:${TCAD_SOURCE_KEY}:${attempt}`,
      check.code ?? "export_missing",
    );
    if (resolution.action === "abort") {
      await deps.merge(runOp("failed"));
      return false;
    }
    // The one identified request a human allowed (no retry after a 403).
    const receipt = await deps.step(`download-${attempt}`, async () => {
      const d = await deps.download({
        url: input.receipt.url,
        destPath: input.exportPath,
        inactivityMs: DOWNLOAD_INACTIVITY_MS,
        totalMs: DOWNLOAD_TOTAL_MS,
      });
      const r = d.receipt;
      const blocked = r.outcome === "blocked";
      return {
        source_key: TCAD_SOURCE_KEY,
        url: r.url,
        http_status: r.status,
        bytes: r.bytes,
        sha256: r.sha256 === "" ? null : r.sha256,
        captured_at: r.captured_at,
        outcome: blocked
          ? ("blocked" as const)
          : r.outcome === "failed"
            ? ("error" as const)
            : ("ok" as const),
        attempts: r.attempts,
        ua: r.user_agent,
        blocked_at: blocked ? r.captured_at : null,
      };
    });
    await deps.merge({ kind: "receipt", receipt });
  }
}

export async function runTcadBackbone(
  input: BackboneInput,
  deps: BackboneDeps,
): Promise<BackboneResult> {
  const runOp = (
    status: RunStatus,
    extra: Partial<Extract<TrackOp, { kind: "run" }>> = {},
  ): TrackOp => ({
    kind: "run",
    track: "appraisal",
    mode: input.mode,
    status,
    export_sha256: input.receipt.sha256,
    gazetteer_sha256: GAZETTEER_SHA256,
    ...(input.codeSha ? { code_sha: input.codeSha } : {}),
    ...extra,
  });
  await deps.merge(runOp("running"));
  const empty: ChunkSummary = {
    records: 0,
    loaded: 0,
    dead: 0,
    invalid: 0,
    transform_failure: 0,
    redacted: 0,
    by_prop_type: {},
  };
  if (!(await verifyOrWait(input, deps))) {
    return {
      jobId: input.jobId,
      status: "failed",
      chunks: 0,
      summary: empty,
      reconciliation: reconcile(0, []),
      refused_inputs: [],
      key_inventory_sha256: "",
      coverage: null,
      zips: 0,
    };
  }

  const size = input.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const window = Math.max(1, input.window ?? DEFAULT_WINDOW);
  const wanted = input.seedPids ? new Set(input.seedPids) : null;
  const ctx = {
    jobId: input.jobId,
    asOf: input.asOf,
    exportSha256: input.receipt.sha256,
    capturedAt: input.receipt.captured_at,
  };
  const outcomes: ChunkOutcome[] = [];
  const inflight: Array<Promise<ChunkOutcome>> = [];
  let batch: ExportRecordText[] = [];
  let n = 0;
  let seen = 0;
  const flush = async (): Promise<void> => {
    const records = batch;
    const index = n;
    batch = [];
    n += 1;
    const spec = await deps.step(`chunk-input-${index}`, async (): Promise<ChunkSpec> => {
      const inputPath = join(input.runDir, "chunks", `c${index}.input.ndjson.gz`);
      return {
        jobId: input.jobId,
        n: index,
        inputPath,
        inputSha256: writeChunkInput(inputPath, records),
        records: records.length,
        mappedPath: join(input.runDir, "chunks", `c${index}.ndjson.gz`),
        ctx,
        ...(input.cids
          ? { group: { dir: join(input.runDir, "groups", "county"), cids: input.cids } }
          : {}),
      };
    });
    if (inflight.length >= window) outcomes.push(await (inflight.shift() as Promise<ChunkOutcome>));
    inflight.push(deps.runChunk(spec));
  };
  for await (const rec of deps.records(input.exportPath)) {
    if (wanted !== null) {
      const pid = pidOfText(rec.text);
      if (pid === null || !wanted.has(pid)) continue;
    }
    seen += 1;
    batch.push(rec);
    if (batch.length >= size) await flush();
  }
  if (batch.length > 0) await flush();
  while (inflight.length > 0) outcomes.push(await (inflight.shift() as Promise<ChunkOutcome>));
  if (wanted !== null && seen !== wanted.size) {
    throw new Error(`pilot: ${wanted.size - seen} seed pIDs are not in the export`);
  }

  const refused = await deps.step("inputs", async () =>
    refusedInputs(deps.listInputs(), input.exportPath),
  );
  outcomes.sort((a, b) => a.n - b.n);
  const reconciliation = reconcile(
    seen,
    outcomes.map((o) => o.summary),
  );
  await deps.step("dead", async () => {
    writeDeadRecords(
      input.runDir,
      outcomes.flatMap((o) => o.dead),
    );
    return true;
  });
  const [countText, ruleText] = limitationsFor(reconciliation.redacted);
  await deps.merge({
    kind: "limitations",
    items: [
      {
        source_key: TCAD_SOURCE_KEY,
        code: "owner_confidential_count",
        text: countText,
        count: reconciliation.redacted,
        evidence_url: null,
      },
      {
        source_key: TCAD_SOURCE_KEY,
        code: "owner_confidential_rule",
        text: ruleText,
        count: null,
        evidence_url: null,
      },
    ],
  });
  const keyInventorySha256 = inventorySha(outcomes);
  await deps.merge({
    kind: "finalize",
    duplicateMinGeoids: DUPLICATE_MIN_GEOIDS,
    keyInventorySha256,
  });
  await deps.merge(runOp("complete", { as_of: input.asOf }));
  const coverage = outcomes.flatMap((o) => o.coverage ?? []);
  return {
    jobId: input.jobId,
    status: "complete",
    chunks: outcomes.length,
    summary: {
      records: reconciliation.n,
      loaded: reconciliation.loaded,
      dead: reconciliation.dead,
      invalid: reconciliation.invalid,
      transform_failure: reconciliation.transform_failure,
      redacted: reconciliation.redacted,
      by_prop_type: reconciliation.by_prop_type,
    },
    reconciliation,
    refused_inputs: refused,
    key_inventory_sha256: keyInventorySha256,
    coverage: coverage.length === 0 ? null : mergeCoverage(coverage),
    zips: outcomes.reduce((s, o) => s + o.zips, 0),
  };
}

/** One coverage row per field across chunks (extracted when any chunk extracted it). */
export function mergeCoverage(rows: readonly CoverageRow[]): CoverageRow[] {
  const by = new Map<string, CoverageRow>();
  for (const r of rows) {
    const prior = by.get(r.field);
    by.set(
      r.field,
      prior
        ? {
            ...prior,
            extracted: prior.extracted || r.extracted,
            properties: prior.properties + r.properties,
          }
        : { ...r },
    );
  }
  return [...by.values()];
}
