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
import type { SourceKey } from "./catalog.schema.js";
import type { CaptureReceipt } from "../lib/source-client.js";

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
  /** Journaled step: runs `fn` once and replays its result afterwards. */
  run<T extends CaptureReceipt>(name: string, fn: () => Promise<T>): Promise<T>;
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

export function createTravisDiscovery(
  sdk: RestateSdk,
  steps: () => readonly ProbeStep[] = () => [],
) {
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
        return runDiscovery(io, ctx.key, steps());
      },
      status: async (ctx: restate.WorkflowSharedContext): Promise<RunRecord | null> =>
        (await ctx.get<RunRecord>(RUN_STATE_KEY)) ?? null,
    },
  });
}
