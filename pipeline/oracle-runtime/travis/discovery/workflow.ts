// T014: the TravisDiscovery Restate workflow shell (pattern 4, research R11).
//
// - Each probe runs as a journaled `ctx.run` step named by its idempotency key
//   `source:measurement:captured_date`, so a replay never re-probes a finished step.
// - The run record keeps `state: DISCOVERING | WAITING_HUMAN | READY` in workflow state;
//   any blocked or failed probe moves it to WAITING_HUMAN with a blocker entry. The durable
//   promise a human resolves (and the `resolve` command) arrive in T036.
// - READY never auto-advances to seed (kit default overridden; seed is A-04).
//
// One SDK instance: this file imports the Restate SDK **type-only**. The host
// (pipeline/local-stack/services/app.ts) passes in its own SDK module, so only the
// local-stack copy is ever loaded at runtime.
import type * as restate from "@restatedev/restate-sdk";
import type { Catalog, SourceKey } from "./catalog.schema.js";
import type { CaptureReceipt } from "../lib/source-client.js";
import { assembleUs1, type AssembleOptions, type Us1Blocks, type Us1Results } from "./assemble.js";
import { probeGisCount } from "./probes/arcgis.js";
import type { ProbeDeps } from "./probes/common.js";
import {
  probeBbb,
  probeContractorLicensing,
  probeOverture,
  type PriorObservation,
} from "./probes/evidence.js";
import { probeAustinPermits, probeComptroller } from "./probes/socrata.js";
import { probeTcad } from "./probes/tcad.js";

export const WORKFLOW_NAME = "TravisDiscovery";

export type RunState = "DISCOVERING" | "WAITING_HUMAN" | "READY";

export interface Blocker {
  source_key: SourceKey;
  step_key: string;
  receipt: CaptureReceipt;
  next_step: string;
}

export interface StepRecord {
  key: string;
  source_key: SourceKey;
  measurement: string;
  outcome: CaptureReceipt["outcome"];
  status: number | null;
  captured_at: string;
}

export interface RunRecord {
  run_id: string;
  started_at: string;
  state: RunState;
  blockers: Blocker[];
  steps: StepRecord[];
  validator: { exit_code: number; report_path: string; vendored_sha256: string } | null;
  /** Always false: READY never starts seed (A-04 does). */
  auto_advance_to_seed: false;
}

export interface ProbeStep {
  source_key: SourceKey;
  measurement: string;
  probe: () => Promise<CaptureReceipt>;
}

/** The side-effect surface of the workflow, so the logic is testable without Restate. */
export interface DiscoveryIO {
  /** Deterministic (journaled) current time. */
  now(): Promise<Date>;
  /** Journaled step: runs `fn` once and replays its (JSON-serializable) result afterwards. */
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Persists the run record (workflow state). */
  save(record: RunRecord): void;
}

const KEY_PART = /^[a-z0-9_]+$/;

/** Idempotency key `source:measurement:captured_date` (UTC date). */
export function stepKey(source: SourceKey, measurement: string, capturedAt: Date): string {
  for (const part of [source, measurement]) {
    if (!KEY_PART.test(part)) {
      throw new Error(`workflow: step key part "${part}" must be lower snake_case without ':'`);
    }
  }
  return `${source}:${measurement}:${capturedAt.toISOString().slice(0, 10)}`;
}

const NEXT_STEP_BLOCKED =
  "Human review: record the blocker and complete records request, then resolve (T036)";

export async function runDiscovery(
  io: DiscoveryIO,
  runId: string,
  steps: readonly ProbeStep[],
): Promise<RunRecord> {
  const started = await io.now();
  const record: RunRecord = {
    run_id: runId,
    started_at: started.toISOString(),
    state: "DISCOVERING",
    blockers: [],
    steps: [],
    validator: null,
    auto_advance_to_seed: false,
  };
  io.save(record);

  for (const step of steps) {
    const key = stepKey(step.source_key, step.measurement, await io.now());
    const receipt = await io.run(key, step.probe);
    record.steps.push({
      key,
      source_key: step.source_key,
      measurement: step.measurement,
      outcome: receipt.outcome,
      status: receipt.status,
      captured_at: receipt.captured_at,
    });
    if (receipt.outcome === "blocked" || receipt.outcome === "failed") {
      record.blockers.push({
        source_key: step.source_key,
        step_key: key,
        receipt,
        next_step: NEXT_STEP_BLOCKED,
      });
    }
    io.save(record);
  }

  record.state = record.blockers.length > 0 ? "WAITING_HUMAN" : "READY";
  io.save(record);
  return record;
}

/** The subset of the SDK this module needs; the host passes its own SDK module. */
export type RestateSdk = Pick<typeof restate, "workflow">;

/** Workflow step timeouts sit above the TCAD probe's own limits (10 min idle, 2 h total). */
export const WORKFLOW_OPTIONS = {
  inactivityTimeout: 15 * 60 * 1000,
  abortTimeout: 150 * 60 * 1000,
} as const;

const RUN_STATE_KEY = "run";

export interface TravisDiscoveryOptions {
  /** US1 probes (built per run). Without them the workflow records an empty run. */
  probes?: () => Us1Probes;
  /** Writes the assembled catalog (pipeline/docs/travis-sources.yaml in production). */
  writeCatalog?: (catalog: Catalog) => void;
}

export function createTravisDiscovery(sdk: RestateSdk, options: TravisDiscoveryOptions = {}) {
  return sdk.workflow({
    name: WORKFLOW_NAME,
    options: WORKFLOW_OPTIONS,
    handlers: {
      run: async (ctx: restate.WorkflowContext): Promise<RunRecord> => {
        const io: DiscoveryIO = {
          now: async () => new Date(await ctx.date.now()),
          run: (name, fn) => ctx.run(name, fn),
          save: (record) => ctx.set(RUN_STATE_KEY, record),
        };
        if (!options.probes) return runDiscovery(io, ctx.key, []);
        const { record, blocks } = await runSourceDiscovery(io, ctx.key, options.probes());
        const write = options.writeCatalog;
        if (write) {
          const snapshot = (await io.now()).toISOString();
          await io.run(`catalog:write:${snapshot.slice(0, 10)}`, async () => {
            write(buildUs1Catalog(blocks, snapshot, 0));
            return true;
          });
        }
        return record;
      },
      status: async (ctx: restate.WorkflowSharedContext): Promise<RunRecord | null> =>
        (await ctx.get<RunRecord>(RUN_STATE_KEY)) ?? null,
    },
  });
}

// ---------- T025: the US1 probe steps ----------

/** One function per US1 probe step; each returns a JSON-serializable probe result. */
export interface Us1Probes {
  austin: () => Promise<Us1Results["austin"]>;
  comptroller: () => Promise<Us1Results["comptroller"]>;
  tcad: () => Promise<Us1Results["tcad"]>;
  gis: () => Promise<Us1Results["gis"]>;
  bbb: () => Promise<Us1Results["bbb"]>;
  overture: () => Promise<Us1Results["overture"]>;
  licensing: () => Promise<Us1Results["licensing"]>;
}

export interface Us1Deps extends ProbeDeps {
  /** Override of pipeline/data/raw/tcad/ (tests only). */
  rawDir?: string;
  tcadLandingUrl?: string;
  tcadLimits?: { inactivityMs: number; totalMs: number };
  /** JSON record path of the TCAD export once confirmed from the Export Layouts. */
  tcadRecordPath?: string;
  gisTimeoutMs?: number;
  /** The recorded BBB challenge observation to reuse instead of a new request. */
  bbbPrior?: PriorObservation;
}

export function createUs1Probes(deps: Us1Deps): Us1Probes {
  const base: ProbeDeps = { client: deps.client, now: deps.now };
  return {
    austin: () => probeAustinPermits(base),
    comptroller: () => probeComptroller(base),
    tcad: () =>
      probeTcad({
        ...base,
        ...(deps.rawDir === undefined ? {} : { rawDir: deps.rawDir }),
        ...(deps.tcadLandingUrl === undefined ? {} : { landingUrl: deps.tcadLandingUrl }),
        ...(deps.tcadLimits === undefined ? {} : { limits: deps.tcadLimits }),
        ...(deps.tcadRecordPath === undefined ? {} : { recordPath: deps.tcadRecordPath }),
      }),
    gis: () =>
      probeGisCount(base, deps.gisTimeoutMs === undefined ? {} : { timeoutMs: deps.gisTimeoutMs }),
    bbb: () => probeBbb(base, deps.bbbPrior),
    overture: () => probeOverture(base),
    licensing: () => probeContractorLicensing(base),
  };
}

/** Step order, the source each step measures and its measurement name (idempotency key). */
const US1_STEPS: ReadonlyArray<readonly [keyof Us1Probes, SourceKey, string]> = [
  ["austin", "austin_permits", "measurements"],
  ["comptroller", "tx_comptroller", "measurements"],
  ["tcad", "tcad_certified", "export"],
  ["gis", "tcad_gis", "feature_count"],
  ["bbb", "bbb", "observation"],
  ["overture", "overture", "licence"],
  ["licensing", "contractor_licensing", "evidence"],
];

/** Which step's stop receipt explains a blocked source row. */
const STEP_FOR_SOURCE: Partial<Record<SourceKey, keyof Us1Probes>> = {
  austin_permits: "austin",
  tx_comptroller: "comptroller",
  tcad_certified: "tcad",
  tcad_supplemental: "tcad",
  tcad_gis: "gis",
  bbb: "bbb",
  overture: "overture",
  contractor_licensing: "licensing",
};

export interface SourceDiscoveryResult {
  record: RunRecord;
  results: Us1Results;
  blocks: Us1Blocks;
}

export async function runSourceDiscovery(
  io: DiscoveryIO,
  runId: string,
  probes: Us1Probes,
  options: Partial<AssembleOptions> = {},
): Promise<SourceDiscoveryResult> {
  const started = await io.now();
  const record: RunRecord = {
    run_id: runId,
    started_at: started.toISOString(),
    state: "DISCOVERING",
    blockers: [],
    steps: [],
    validator: null,
    auto_advance_to_seed: false,
  };
  io.save(record);

  const results: Partial<Us1Results> = {};
  const stepKeys: Partial<Record<keyof Us1Probes, string>> = {};
  for (const [name, sourceKey, measurement] of US1_STEPS) {
    const key = stepKey(sourceKey, measurement, await io.now());
    stepKeys[name] = key;
    const result = await io.run(key, probes[name] as () => Promise<Us1Results[typeof name]>);
    (results as Record<string, unknown>)[name] = result;
    const last = result.blocked_receipt ?? result.receipts.at(-1) ?? null;
    record.steps.push({
      key,
      source_key: sourceKey,
      measurement,
      outcome: last?.outcome ?? "ok",
      status: last?.status ?? null,
      captured_at: last?.captured_at ?? (await io.now()).toISOString(),
    });
    io.save(record);
  }

  const complete = results as Us1Results;
  const blocks = assembleUs1(complete, {
    assembledAt: options.assembledAt ?? (await io.now()).toISOString(),
    ...(options.evidencePath === undefined ? {} : { evidencePath: options.evidencePath }),
  });

  for (const source of blocks.sources) {
    if (source.status !== "blocked") continue;
    const step = STEP_FOR_SOURCE[source.key];
    const receipt = step ? complete[step].blocked_receipt : null;
    if (!step || !receipt) continue;
    record.blockers.push({
      source_key: source.key,
      step_key: stepKeys[step] as string,
      receipt,
      next_step: NEXT_STEP_BLOCKED,
    });
  }
  record.state = record.blockers.length > 0 ? "WAITING_HUMAN" : "READY";
  io.save(record);
  return { record, results: complete, blocks };
}

/** The catalog with the US1 blocks (permits, destination and census come in US2-US4). */
export function buildUs1Catalog(
  blocks: Us1Blocks,
  snapshotTime: string,
  waitingHumanHours: number,
): Catalog {
  return {
    county: "Travis",
    state: "TX",
    slug: "travis",
    fips: "48453",
    snapshot_time: snapshotTime,
    waiting_human_hours: waitingHumanHours,
    parcel: blocks.parcel,
    enrichment: blocks.enrichment,
    sources: blocks.sources,
  };
}
