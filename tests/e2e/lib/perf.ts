// Shared helpers of the A-03 NFR cases (T061, T068: TC-NF-01, TC-NF-02, TC-NF-04, TC-NF-05,
// TC-050). Pure functions and config keys only: importing this module makes no network or AWS
// call. Percentiles are nearest rank, as ADR-0001 and scripts/bench-lambda.ts compute them
// (of 20 sorted values p50 is the 10th and p95 the 19th).
import { resolve } from "node:path";
import type { RunManifestV1 } from "@countylens/contract";
import { z } from "zod";
import { harnessConfig, repoRoot } from "./runtime.js";

/** Nearest-rank percentile of a non-empty sample. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError("percentile of an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] as number;
}

export interface TimingSummary {
  n: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  timingsMs: number[];
}

export function summarize(timingsMs: readonly number[]): TimingSummary {
  return {
    n: timingsMs.length,
    p50Ms: percentile(timingsMs, 50),
    p95Ms: percentile(timingsMs, 95),
    maxMs: Math.max(...timingsMs),
    timingsMs: [...timingsMs],
  };
}

/** NFR thresholds of the test plan (§ 8, NFR cases). */
export const LIMITS = {
  /** TC-NF-01: each cold first load. */
  firstLoadMs: 8_000,
  /** TC-NF-02 and TC-NF-05: p95 of 20 warm runs. */
  queryP95Ms: 3_000,
  /** TC-NF-04: warm API p95 over 30 calls. */
  apiWarmP95Ms: 1_000,
  /** TC-NF-04: cold start including DuckDB init. */
  apiColdStartMs: 3_000,
} as const;

/** Timed runs per query (warm-up rule, test plan § 3: one untimed warm-up precedes them). */
export const TIMED_RUNS = 20;
export const WARM_API_CALLS = 30;

// ---------------------------------------------------------------------------------------
// Fixed UI selectors (plan § "Atlas element map"; apps/web/src/routes/Permits.page.tsx).
// ---------------------------------------------------------------------------------------

export const SELECTORS = {
  permitsPage: 'section[data-route="permits"]',
  permitsReady: 'section[data-route="permits"][data-state="ready"]',
  runsPage: 'section[data-route="runs"]',
  permitsProgress: '[role="progressbar"][aria-label="Loading permits"]',
  permitsTable: 'table[aria-label="Permits"]',
  permitsCards: 'ul[aria-label="Permits"]',
  /** A rendered permit row: a data-table body row or a card. */
  permitRow: 'table[aria-label="Permits"] tbody tr, ul[aria-label="Permits"] > li',
  /** The full CID of a provenance line (never the truncated text). */
  cid: "[data-cid]",
} as const;

/**
 * TC-NF-02 step 2 runs the COUNT and listing queries "through the page's query hook". The
 * Permits page exposes that hook on `window` once DuckDB-WASM is ready; each call runs the
 * page's own query on its own engine and resolves to the COUNT value or the number of listed
 * rows. The spec fails with this name when the page does not expose it.
 */
export const PERMITS_QUERY_HOOK = "__countylensPermitsQuery";
export interface PermitsQueryHook {
  count(): Promise<number>;
  list(): Promise<number>;
}

/** The hosted Runs page's single API call (test plan § 3: `GET /api/trpc/runs.summary`). */
export const RUNS_SUMMARY_PATTERN = /\/api\/trpc\/(?:[^?]*,)?runs\.summary(?:[,?]|$)/;

// ---------------------------------------------------------------------------------------
// Config keys of the AWS-backed NFR cases (environment, with documented defaults).
// ---------------------------------------------------------------------------------------

const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const NfrEnv = z.object({
  /** The API Lambda (CDK `API_FUNCTION_NAME`, output `ApiFunctionName`). */
  API_FUNCTION_NAME: z.preprocess(blankToUndefined, z.string().min(1).default("countylens-api")),
  /** CloudWatch namespace of the business metrics (CDK `API_METRICS_NAMESPACE`). */
  API_METRICS_NAMESPACE: z.preprocess(blankToUndefined, z.string().min(1).default("CountyLens")),
  /**
   * TC-NF-05 scale data: the full Austin table split with `--part-size 48m` by the read-path
   * spike (gitignored, never committed). Relative paths resolve against the repo root.
   */
  AUSTIN_PARQUET_DIR: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("pipeline/data/raw/austin-parquet/v48m"),
  ),
  /** The capture receipt of that table (`{ expected, total, pages, … }`); its `total` is the row count. */
  AUSTIN_CAPTURE_SUMMARY: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("pipeline/data/raw/austin-full/summary.json"),
  ),
  /** The bench sub-prefix name under READPATH_PRIVATE_PREFIX. */
  TC_NF_05_BENCH_NAME: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .default("austin-48m"),
  ),
});
export type NfrConfig = z.infer<typeof NfrEnv> & {
  austinParquetDir: string;
  austinCaptureSummary: string;
  benchPrefix: string;
};

export function nfrConfig(): NfrConfig {
  const env = NfrEnv.parse(process.env);
  return {
    ...env,
    austinParquetDir: resolve(repoRoot, env.AUSTIN_PARQUET_DIR),
    austinCaptureSummary: resolve(repoRoot, env.AUSTIN_CAPTURE_SUMMARY),
    benchPrefix: `${harnessConfig().READPATH_PRIVATE_PREFIX}${env.TC_NF_05_BENCH_NAME}/`,
  };
}

/** The capture receipt the spike wrote (pipeline/data/raw/austin-full/summary.json). */
export const CaptureSummary = z
  .object({
    expected: z.number().int().positive(),
    total: z.number().int().positive(),
    pages: z.number().int().positive(),
  })
  .loose();
export type CaptureSummary = z.infer<typeof CaptureSummary>;

/** The JSON report scripts/bench-lambda.ts writes with `--json` (BenchReport). */
export const BenchReport = z.object({
  prefix: z.string(),
  runs: z.number().int(),
  warmup: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string(),
  results: z.array(
    z
      .object({
        query: z.enum(["count", "radius", "roofAge"]),
        preset: z.enum(["TC_NF_05", "ADR_0001"]),
        timingsMs: z.array(z.number()),
        p50Ms: z.number(),
        p95Ms: z.number(),
        rows: z.number().int(),
        coldStarts: z.number().int(),
        initMsMax: z.number(),
        warmupMs: z.array(z.number()),
        correlationIds: z.array(z.string()),
      })
      .loose(),
  ),
});
export type BenchReport = z.infer<typeof BenchReport>;

/** `coverage.permits_emitted.count` of a manifest (the published row count; FR-009). */
export function permitsEmitted(manifest: RunManifestV1): number {
  const entry = manifest.coverage.permits_emitted;
  if (!entry) throw new Error('manifest coverage has no "permits_emitted" entry');
  return entry.count;
}
