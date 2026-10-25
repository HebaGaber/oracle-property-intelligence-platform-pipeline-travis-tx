// T022 (A-14, contracts/agent-ask.md, data-model.md § "agent.ask contract", agent-design.md §
// "ash"): the `agent.ask` tRPC procedure. AI SDK tool loop over `getModel()` (model.ts) and the
// four tools (tools.ts), with explicit step/call/token budgets, the AD-27 4-layer timeout's
// server-side layer (23 s abort -> `timed_out`; the 25 s Lambda timeout, the 25 s client stop and
// the 29-30 s HTTP API ceiling are the other three layers, set outside this module), a spend-cap
// pre-check (spend.ts) -> `paused`, and Bedrock-throttle detection -> `throttled`. Conversation
// state is client-sent `turns[]` (no server store, AD-09's "one response, no streaming" model).
// `how`/`missing[]`/`query` are composed here from tool-result envelopes only, never from model
// text (agent-design.md § 4: "the model writes only `answer` prose and chooses tool arguments").
//
// Every external dependency (the DynamoDB spend client, the engine/bind functions, the
// latest-run index read, the model-loop call itself) is injectable via `AskDeps` so the four
// outcomes T023 tests for (`answered`, `paused`, `throttled`, `timed_out`) are each reachable
// through documented, reversible configuration (an env var or a constructor override) rather
// than by hand-crafting a fake `outcome` value.
import { generateText, stepCountIs, type LanguageModel } from "ai";
import { z } from "zod";
import { CidV1 } from "@countylens/contract";
import { MetricUnit } from "@aws-lambda-powertools/metrics";
import type { BoundRun, QueryEngine } from "@countylens/query-core";
import { bindOnce, getEngine } from "../engine/duckdb-node.js";
import { lazyViewEngine, type BindViews } from "../engine/lazy-views.js";
import { createCitationRegistry, type Match } from "./citations.js";
import { agentObservability } from "./observability.js";
import {
  DAILY_SPEND_CAP_USD,
  SPEND_RESERVATION_USD,
  getSpendDocumentClient,
  recordSpend,
  reserveSpend,
} from "./spend.js";
import { getModel, type EnvSource } from "./model.js";
import { latestOf, loadRunsIndex } from "../mcp/runs-index.js";
import { createAgentTools, type AgentTools } from "./tools.js";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/** Stage 5 review fix (Critical #2): the EMF metric name infra/src/api-stack.ts's `SpendAlarm`
 *  watches (`SPEND_METRIC_NAME`, not imported directly -- infra depends on the bundled entry,
 *  not apps/api's source, same reason as every other infra/app name pairing in this story). The
 *  alarm's statistic is `Maximum` over 5 minutes, so the value emitted each call must be the
 *  day's running total (`spentUsd` after the increment), not the per-call delta, or the alarm
 *  would never see $2.40. */
export const SPEND_METRIC_NAME = "AiSpendUsd";

// ---------------------------------------------------------------------------------------
// Contract (data-model.md § "agent.ask contract"; contracts/agent-ask.md)
// ---------------------------------------------------------------------------------------

export const AgentAskTurn = z.object({ prompt: z.string(), outcome: z.string() }).strict();

/** Client-sent, never persisted server-side (AD-09). */
export const AgentAskInput = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    /** Last <=4 turns; the client resends them so "that area" resolves without a server store. */
    turns: z.array(AgentAskTurn).max(4).optional(),
    /** From an edited "How I read this" chip, e.g. `{ tenure_years_min: 3 }`. */
    overrides: z.record(z.string(), z.unknown()).optional(),
    /** Pins the run this conversation compares against. Omitted on turn 1 -> latest. */
    manifest_cid: CidV1.optional(),
  })
  .strict();
export type AgentAskInput = z.infer<typeof AgentAskInput>;

export const AGENT_OUTCOMES = [
  "answered",
  "failed",
  "paused",
  "throttled",
  "timed_out",
  "cancelled",
] as const;
export const AgentOutcome = z.enum(AGENT_OUTCOMES);
export type AgentOutcome = z.infer<typeof AgentOutcome>;

export interface AgentAskStep {
  tool: string;
  input: unknown;
  summary: string;
}

export interface AgentAskResponse {
  answer: string;
  how: string;
  steps: AgentAskStep[];
  matches: Match[];
  query: Record<string, unknown>;
  missing: { field: string; reason: string }[];
  outcome: AgentOutcome;
}

// ---------------------------------------------------------------------------------------
// Budgets (AC-5; agent-design.md § "ash" > "Limits & how enforced")
// ---------------------------------------------------------------------------------------

export const MAX_MODEL_CALLS = 3;
export const MAX_TOOL_STEPS = 6;
export const MAX_OUTPUT_TOKENS = 1500;
/** 23 s per-request abort (AD-27 layer 1); the Lambda (25 s), client (25 s) and HTTP API
 *  (29-30 s) layers are configured outside this module. */
export const DEFAULT_ABORT_MS = 23_000;

/** A crude per-token cost estimate for the spend counter (there is no real-time per-token
 *  billing query on either provider): $3/1,000,000 tokens, a conservative Sonnet-class estimate.
 *  Documented here, not imported from a provider SDK (constitution VI) -- this is money math,
 *  not a model call. */
export const ESTIMATED_USD_PER_TOKEN = 0.000_003;

function envNumber(env: EnvSource, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `AI_DAILY_CAP_USD`, else spend.ts's `DAILY_SPEND_CAP_USD` -- a documented, reversible way to
 *  drive the real spend counter to `paused` without issuing $3 of real Bedrock calls (the
 *  verification-run pattern agent-design.md's "Outcome taxonomy" table names for `paused`). */
export function dailySpendCapUsd(env: EnvSource = process.env): number {
  return envNumber(env, "AI_DAILY_CAP_USD", DAILY_SPEND_CAP_USD);
}

/** `AGENT_ABORT_MS`, else `DEFAULT_ABORT_MS` -- the same documented, reversible pattern for
 *  `timed_out` (agent-design.md's "Outcome taxonomy": "temporarily set the abort to 1s via env
 *  var for one verification call, then restore"). */
export function abortMs(env: EnvSource = process.env): number {
  return envNumber(env, "AGENT_ABORT_MS", DEFAULT_ABORT_MS);
}

// ---------------------------------------------------------------------------------------
// Model loop (the one seam between this module and the Vercel AI SDK's own call shape)
// ---------------------------------------------------------------------------------------

export interface ModelLoopOutput {
  text: string;
  steps: AgentAskStep[];
  /** Every tool call's output this turn, in call order (Stage 5 review fix, Major #5: using
   *  only the LAST call's output silently dropped a real filtered result when a later call --
   *  e.g. `geocodePlace`, run last to disambiguate before answering -- wasn't the one carrying
   *  the `applied`/`area`/`unknown_excluded` envelope). `how`/`query`/`missing[]` are built by
   *  aggregating across all of these, never from model text. */
  toolOutputs: Record<string, unknown>[];
  totalTokens?: number;
}

export interface ModelLoopParams {
  model: LanguageModel;
  tools: AgentTools;
  system: string;
  prompt: string;
  abortSignal: AbortSignal;
  maxOutputTokens: number;
  maxSteps: number;
}

export type RunModelLoop = (params: ModelLoopParams) => Promise<ModelLoopOutput>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The real tool loop: one `generateText` call with `tools`, `stopWhen: stepCountIs(maxSteps)`
 *  (AC-5's combined step/model-call cap -- see the module header's T022 note on how the two
 *  separate budgets in agent-design.md are enforced through one AI SDK stop condition here) and
 *  the 23 s `abortSignal`. */
export async function defaultRunModelLoop(params: ModelLoopParams): Promise<ModelLoopOutput> {
  const result = await generateText({
    model: params.model,
    tools: params.tools,
    system: params.system,
    prompt: params.prompt,
    abortSignal: params.abortSignal,
    maxOutputTokens: params.maxOutputTokens,
    stopWhen: stepCountIs(params.maxSteps),
  });

  const steps: AgentAskStep[] = result.steps.map((step) => {
    const call = step.toolCalls[0];
    return {
      tool: call?.toolName ?? "",
      input: call?.input ?? null,
      summary: `${step.toolCalls.length} tool call(s), ${step.toolResults.length} result(s)`,
    };
  });

  const toolOutputs = result.toolResults
    .map((toolResult) => toolResult.output)
    .filter(isRecord);

  return {
    text: result.text,
    steps,
    toolOutputs,
    ...(result.usage?.totalTokens !== undefined ? { totalTokens: result.usage.totalTokens } : {}),
  };
}

// ---------------------------------------------------------------------------------------
// Latest-run resolution (manifest_cid omitted on turn 1 -> runs/index.json's latest entry)
// ---------------------------------------------------------------------------------------

export type ResolveManifestCid = (env: EnvSource) => Promise<string>;

/** Reads the site's `runs/index.json` (`loadRunsIndex`, via `RUNS_INDEX_URL`) and returns the
 *  entry with the greatest `finishedAt` (`latestOf`). Any read/parse failure, or an empty index,
 *  throws: it propagates as a real Lambda error, never a guessed run. */
export async function defaultResolveManifestCid(env: EnvSource): Promise<string> {
  const latest = latestOf(await loadRunsIndex(env));
  if (latest === undefined) throw new Error("runs/index.json: no published runs");
  return latest.manifestCid;
}

// ---------------------------------------------------------------------------------------
// Error classification (never swallowed as a fake outcome: anything else re-throws)
// ---------------------------------------------------------------------------------------

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function errorStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const code = error.statusCode;
  return typeof code === "number" ? code : undefined;
}

/** `AbortSignal.timeout`'s DOMException is named "TimeoutError"; a manually-aborted
 *  `AbortController` throws "AbortError" -- both mean the 23 s layer fired. */
export function isAbortError(error: unknown): boolean {
  const name = errorName(error);
  return name === "AbortError" || name === "TimeoutError";
}

/** Bedrock's `ThrottlingException` (10 req/min account-wide, CLAUDE.md) surfaces through the AI
 *  SDK as an `APICallError` with a 429 status or the provider's exception name in the message. */
export function isThrottleError(error: unknown): boolean {
  if (errorStatusCode(error) === 429) return true;
  return /throttl|toomanyrequests/i.test(errorMessage(error));
}

// ---------------------------------------------------------------------------------------
// Structured parts: how / query / missing, built only from tool-result envelopes
// ---------------------------------------------------------------------------------------

function dedupeMissing(
  entries: { field: string; reason: string }[],
): { field: string; reason: string }[] {
  const seen = new Set<string>();
  const out: { field: string; reason: string }[] = [];
  for (const entry of entries) {
    const key = `${entry.field}:${entry.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** A query-core `ResultEnvelope`-shaped tool output (always carries `applied`, per
 *  tools.ts's `projectEnvelope`) -- `geocodePlace`'s own output shape (`status`/`label`/`point`)
 *  never does, so this filter is what tells the two apart without a tool-name allowlist. */
function isEnvelopeOutput(
  output: Record<string, unknown>,
): output is Record<string, unknown> & { applied: Record<string, unknown> } {
  return isRecord(output.applied);
}

/**
 * Stage 5 review fix (Major #5): aggregates `how`/`query`/`missing[]` across EVERY envelope-
 * shaped tool output this turn, not just the last tool call -- a turn that calls
 * `searchProperties` then `geocodePlace` last (to disambiguate before answering) must not lose
 * `searchProperties`'s real filtered-result data just because it was not the final call.
 * `applied` fields merge left-to-right (a later call's threshold overrides an earlier one's, the
 * ordinary "most recent wins" rule); `area`/`unknown_excluded`/`empty_reason`/`truncated`
 * contribute to `missing[]`/`how` from every envelope, not only the last.
 */
function composeStructuredParts(
  matches: Match[],
  toolOutputs: Record<string, unknown>[],
): { how: string; query: Record<string, unknown>; missing: { field: string; reason: string }[] } {
  const envelopes = toolOutputs.filter(isEnvelopeOutput);

  let applied: Record<string, unknown> = {};
  let areaLabel: string | undefined;
  const missing: { field: string; reason: string }[] = [];

  for (const envelope of envelopes) {
    applied = { ...applied, ...envelope.applied };

    const area = isRecord(envelope.area) ? envelope.area : undefined;
    if (typeof area?.label === "string") areaLabel = area.label;

    const unknownExcluded = isRecord(envelope.unknown_excluded) ? envelope.unknown_excluded : {};
    for (const [field, count] of Object.entries(unknownExcluded)) {
      if (typeof count === "number" && count > 0) missing.push({ field, reason: "unknown" });
    }
    const emptyReason = envelope.empty_reason;
    if (typeof emptyReason === "string") missing.push({ field: "result", reason: emptyReason });
    if (envelope.truncated === true) missing.push({ field: "result", reason: "truncated" });
  }
  for (const match of matches) {
    for (const entry of match.missing) missing.push(entry);
  }

  const howParts: string[] = [];
  if (areaLabel !== undefined) howParts.push(areaLabel);
  for (const [key, value] of Object.entries(applied)) {
    if (key === "area" || key === "manifest_cid") continue;
    howParts.push(`${key}: ${JSON.stringify(value)}`);
  }

  return { how: howParts.join("; "), query: applied, missing: dedupeMissing(missing) };
}

function buildSystemPrompt(input: AgentAskInput): string {
  return [
    "You are CountyLens's property-lead assistant for Travis County roofing leads.",
    "Answer only from tool results: cite every claim about a specific property or permit as",
    "[n] where n is the citation index a tool call returned; never invent a CID or a count.",
    "If a filtered field is unknown for some rows, say 'unknown', never 'none found'.",
    "If the question refers to 'that area' or a prior place, use the most recent area from",
    "turns/overrides unless the question names a new place; call geocodePlace only to",
    "disambiguate, since searchProperties/searchRoofingPermits resolve area.place themselves.",
    "Be concise: this answer has a 1,500-output-token budget and at most 3 tool-calling turns.",
    input.overrides !== undefined
      ? `The user edited these assumptions this turn: ${JSON.stringify(input.overrides)}.`
      : "",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}

function buildPrompt(input: AgentAskInput): string {
  const history = (input.turns ?? [])
    .map((turn) => `Q: ${turn.prompt}\n(outcome: ${turn.outcome})`)
    .join("\n");
  return history.length > 0 ? `${history}\nQ: ${input.prompt}` : input.prompt;
}

// ---------------------------------------------------------------------------------------
// Dependencies (every external boundary, overridable for the T023 contract tests)
// ---------------------------------------------------------------------------------------

export interface AskDeps {
  env: EnvSource;
  now: () => Date;
  ddb: DynamoDBDocumentClient;
  spendTableName: string;
  dailySpendCapUsd: number;
  abortMs: number;
  maxModelCalls: number;
  maxToolSteps: number;
  maxOutputTokens: number;
  reservationUsd: number;
  model: LanguageModel;
  getEngine: () => Promise<QueryEngine>;
  /** The initial bind: just `v_run`, enough for the run echo (ERR-19 follow-up). */
  bindOnce: (manifestCid: string) => Promise<BoundRun>;
  /** Binds the views a tool query names, lazily, per statement (default: bindOnce). */
  bindViews: BindViews;
  resolveManifestCid: ResolveManifestCid;
  runModelLoop: RunModelLoop;
}

function emptyResponse(outcome: AgentOutcome, answer = ""): AgentAskResponse {
  return { answer, how: "", steps: [], matches: [], query: {}, missing: [], outcome };
}

/**
 * The `agent.ask` tool loop. Every field of `deps` is optional and defaults to the real AWS/AI
 * SDK wiring; tests override one field at a time (a lowered `abortMs`/`dailySpendCapUsd`, or a
 * `runModelLoop` fake that throws a throttle/abort-shaped error) to reach each outcome
 * deterministically, per T023.
 */
export async function runAgentAsk(
  rawInput: z.input<typeof AgentAskInput>,
  overrides: Partial<AskDeps> = {},
): Promise<AgentAskResponse> {
  const input = AgentAskInput.parse(rawInput);
  const env = overrides.env ?? process.env;
  const now = overrides.now ?? (() => new Date());
  const ddb = overrides.ddb ?? getSpendDocumentClient();
  const spendTableName = overrides.spendTableName ?? env.SPEND_TABLE_NAME ?? "";
  const cap = overrides.dailySpendCapUsd ?? dailySpendCapUsd(env);
  const reservationUsd = overrides.reservationUsd ?? SPEND_RESERVATION_USD;
  const abortTimeoutMs = overrides.abortMs ?? abortMs(env);
  const maxModelCalls = overrides.maxModelCalls ?? MAX_MODEL_CALLS;
  const maxToolSteps = overrides.maxToolSteps ?? MAX_TOOL_STEPS;
  const maxOutputTokens = overrides.maxOutputTokens ?? MAX_OUTPUT_TOKENS;
  const model = overrides.model ?? getModel(env);
  const getEngineFn = overrides.getEngine ?? getEngine;
  const bindFn = overrides.bindOnce ?? ((manifestCid: string) => bindOnce(manifestCid, ["v_run"]));
  const bindViews = overrides.bindViews ?? bindOnce;
  const resolveManifestCid = overrides.resolveManifestCid ?? defaultResolveManifestCid;
  const runModelLoop = overrides.runModelLoop ?? defaultRunModelLoop;

  // Spend-cap pre-check (agent-design.md § "ash" > "Spend-cap + alarm design"; Stage 5 review
  // fix, Major #3): one atomic conditional reservation, never a separate read-then-later-write
  // (which let two concurrent requests both pass a check before either's model call finished).
  // Never a half-run -- checked/reserved before any model call is placed.
  const spend = await reserveSpend(ddb, spendTableName, now(), reservationUsd, cap);
  if (spend.spentUsd >= cap) {
    agentObservability().logger.warn("agent.ask paused: daily spend cap reached", {
      spentUsd: spend.spentUsd,
      cap,
    });
    return emptyResponse("paused", "Daily AI budget reached for today.");
  }

  const manifestCid = input.manifest_cid ?? (await resolveManifestCid(env));
  const engine = await getEngineFn();
  const bound = await bindFn(manifestCid);

  const registry = createCitationRegistry();
  const tools = createAgentTools({
    engine: lazyViewEngine(engine, manifestCid, bindViews),
    bound,
    registry,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), abortTimeoutMs);

  try {
    const result = await runModelLoop({
      model,
      tools,
      system: buildSystemPrompt(input),
      prompt: buildPrompt(input),
      abortSignal: controller.signal,
      maxOutputTokens,
      // AC-5's two budgets (<=6 tool steps, <=3 model calls) are enforced through the one AI SDK
      // stop condition the default loop supports (stepCountIs): the smaller cap dominates, which
      // is <=3 model calls for this tool set (each step issues at most one tool call).
      maxSteps: Math.min(maxModelCalls, maxToolSteps),
    });

    if (result.totalTokens !== undefined) {
      // True the reservation up to the real cost (never re-incrementing model_calls -- reserveSpend
      // already counted this call).
      const actualUsd = result.totalTokens * ESTIMATED_USD_PER_TOKEN;
      const status = await recordSpend(ddb, spendTableName, actualUsd - reservationUsd, now(), {
        incrementModelCalls: false,
      });
      // The SpendAlarm's statistic is Maximum/5min: emit the day's running total, not the delta.
      agentObservability().metrics.addMetric(SPEND_METRIC_NAME, MetricUnit.NoUnit, status.spentUsd);
    }

    const matches = registry.matches();
    const { cleaned, outOfRangeCitations, ungroundedCids } = registry.postCheck(result.text);
    const { how, query, missing } = composeStructuredParts(matches, result.toolOutputs);

    agentObservability().logger.info("agent.ask answered", {
      toolSteps: result.steps.length,
      matches: matches.length,
      outOfRangeCitations,
      ungroundedCids,
    });

    return {
      answer: cleaned,
      how,
      steps: result.steps,
      matches,
      query,
      missing,
      outcome: "answered",
    };
  } catch (error) {
    if (isAbortError(error)) {
      agentObservability().logger.warn("agent.ask timed out (23s abort)");
      return emptyResponse("timed_out", "Took too long. Try again, or use Filters instead.");
    }
    if (isThrottleError(error)) {
      agentObservability().logger.warn("agent.ask throttled by the model provider");
      return emptyResponse("throttled", "The model is busy right now; try again in a minute.");
    }
    throw error; // unexpected -- a real Lambda error, never swallowed as a fake outcome.
  } finally {
    clearTimeout(timer);
  }
}
