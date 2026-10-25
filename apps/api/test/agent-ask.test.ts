// T023 (A-14, contracts/agent-ask.md, agent-design.md § "ash" > "Outcome taxonomy and how to
// trigger each for testing"): contract-level tests asserting each `outcome` value (`answered`,
// `paused`, `throttled`, `timed_out`) is reachable via documented, reversible configuration --
// a lowered abort threshold, a lowered spend cap, or a forced throttle -- never a hand-crafted
// fake `outcome`. `cancelled` is client-only (the Cancel button aborts the fetch before the
// server ever answers, agent-design.md's AI-tab-states table) and `failed` is an unexpected-error
// path (re-thrown, never swallowed, per ask.ts's catch block), so neither is exercised here.
// This stands in for the AI-tab Playwright suite until A-13's Explore shell merges (T033); the
// real `tests/agent/golden.json` grader (T020) and the hosted verification (TZ03) still need a
// deployed endpoint and are not duplicated here.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { QueryEngine } from "@countylens/query-core";
import {
  abortMs,
  dailySpendCapUsd,
  type AskDeps,
  type ModelLoopOutput,
  type RunModelLoop,
  runAgentAsk,
} from "../src/agent/ask.js";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: "xx-test-1",
    credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "test" },
  }),
);
const ddbMock = mockClient(ddb);

const FAKE_ENGINE: QueryEngine = { run: async () => {}, all: async () => [] };
const FAKE_BOUND = {
  runId: "travis-202609-permits-20261021t103516z",
  manifestCid: "bafyreicompletelyfakemanifestcidusedonlyinthistestxxxxxxxxxxxxxx",
  asOf: "2026-10-21T10:35:16.000Z",
  tables: [],
  views: [] as never[],
};

/** The dependency overrides every test shares: no real AWS call, a fixed bound run. */
function baseDeps(overrides: Partial<AskDeps> = {}): Partial<AskDeps> {
  return {
    ddb,
    spendTableName: "CountyLensAiSpendTest",
    now: () => new Date("2026-10-23T12:00:00.000Z"),
    getEngine: async () => FAKE_ENGINE,
    bindOnce: async () => FAKE_BOUND,
    ...overrides,
  };
}

function okModelLoop(text = "No roofing permits matched this question."): RunModelLoop {
  return async (): Promise<ModelLoopOutput> => ({
    text,
    steps: [{ tool: "searchRoofingPermits", input: {}, summary: "1 tool call(s), 1 result(s)" }],
    toolOutputs: [],
    totalTokens: 120,
  });
}

/** Resolves after `resolveAfterMs` unless `params.abortSignal` fires first, in which case it
 *  rejects the same way `AbortSignal.timeout` does (a "TimeoutError" DOMException) -- the real
 *  shape ask.ts's `isAbortError` must recognise. */
function slowModelLoop(resolveAfterMs: number): RunModelLoop {
  return (params) =>
    new Promise<ModelLoopOutput>((resolve, reject) => {
      const timer = setTimeout(
        () => resolve({ text: "too slow to matter", steps: [], toolOutputs: [], totalTokens: 1 }),
        resolveAfterMs,
      );
      params.abortSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "TimeoutError"));
      });
    });
}

function throttledModelLoop(): RunModelLoop {
  return async () => {
    const error = new Error("ThrottlingException: Rate exceeded") as Error & { statusCode: number };
    error.statusCode = 429;
    throw error;
  };
}

const INPUT = {
  prompt: "Which properties near Pflugerville have a roof older than 15 years?",
  manifest_cid: FAKE_BOUND.manifestCid,
};

/** A real DynamoDB `ConditionalCheckFailedException` is a named error, not a special class the
 *  document client re-wraps -- this is the shape `spend.ts`'s `isConditionalCheckFailed` (and
 *  aws-sdk-client-mock's `.rejects`) both recognise by `.name`. */
function conditionalCheckFailed(): Error {
  const error = new Error("The conditional request failed");
  error.name = "ConditionalCheckFailedException";
  return error;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: undefined }); // spentUsd 0 unless a test overrides it
  // reserveSpend's reservation UpdateCommand, and the post-call true-up UpdateCommand, both
  // succeed by default with a low running total (well under every test's cap).
  ddbMock
    .on(UpdateCommand)
    .resolves({ Attributes: { pk: "SPEND#2026-10-23", spent_usd: 0.05, model_calls: 1 } });
});

describe("agent.ask outcome taxonomy (T023)", () => {
  it("answered: a normal tool-loop turn under budget, under the spend cap", async () => {
    const result = await runAgentAsk(INPUT, baseDeps({ runModelLoop: okModelLoop() }));
    expect(result.outcome).toBe("answered");
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.matches).toEqual([]); // the fake loop never calls a real tool
    expect(result.steps).toHaveLength(1);
  });

  it("paused: the daily spend cap is reached (lowered via dailySpendCapUsd override, a documented, reversible config change -- not a fake outcome). The atomic reservation's conditional check fails server-side (DynamoDB), not a client-side >= comparison", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    ddbMock
      .on(GetCommand)
      .resolves({ Item: { pk: "SPEND#2026-10-23", spent_usd: 0, model_calls: 0 } });
    const result = await runAgentAsk(
      INPUT,
      baseDeps({ dailySpendCapUsd: 0, runModelLoop: okModelLoop() }),
    );
    expect(result.outcome).toBe("paused");
    expect(result.matches).toEqual([]);
    expect(result.answer).toMatch(/budget/i);
  });

  it("paused is checked before any model call is placed: the pre-check short-circuits even if the model loop would otherwise answer", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    ddbMock
      .on(GetCommand)
      .resolves({ Item: { pk: "SPEND#2026-10-23", spent_usd: 0, model_calls: 0 } });
    let called = false;
    const loop: RunModelLoop = async () => {
      called = true;
      return { text: "should never run", steps: [], toolOutputs: [], totalTokens: 1 };
    };
    await runAgentAsk(INPUT, baseDeps({ dailySpendCapUsd: 0, runModelLoop: loop }));
    expect(called).toBe(false);
  });

  it("the spend-cap gate is one atomic conditional UpdateCommand, not a Get followed by a later, separate Update (Stage 5 review fix, Major #3): the pre-check itself carries a ConditionExpression DynamoDB evaluates against the item's pre-update state, so two concurrent requests cannot both observe 'under the cap' and both proceed -- the race the old read-then-later-write gate allowed", async () => {
    await runAgentAsk(INPUT, baseDeps({ runModelLoop: okModelLoop() }));
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    const reservation = updateCalls[0]?.args[0].input;
    expect(reservation).toMatchObject({
      TableName: "CountyLensAiSpendTest",
      ConditionExpression: expect.stringContaining("spent_usd"),
    });
    expect(String(reservation?.ConditionExpression)).toMatch(/</); // "< :cap"
    // No Get is used for the gate itself -- only as the paused-path fallback read (tested above).
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it("throttled: Bedrock's real throttling shape (429 statusCode) surfaces as outcome=throttled, not a thrown error", async () => {
    const result = await runAgentAsk(INPUT, baseDeps({ runModelLoop: throttledModelLoop() }));
    expect(result.outcome).toBe("throttled");
    expect(result.matches).toEqual([]);
  });

  it("throttled is also reachable from a provider error message alone (no statusCode field)", async () => {
    const loop: RunModelLoop = async () => {
      throw new Error("ThrottlingException from provider");
    };
    const result = await runAgentAsk(INPUT, baseDeps({ runModelLoop: loop }));
    expect(result.outcome).toBe("throttled");
  });

  it("timed_out: the 23s abort layer, lowered via abortMs override to fire before a deliberately slow model loop resolves -- a documented, reversible config change, never a fabricated outcome", async () => {
    const result = await runAgentAsk(
      INPUT,
      baseDeps({ abortMs: 5, runModelLoop: slowModelLoop(2000) }),
    );
    expect(result.outcome).toBe("timed_out");
    expect(result.answer).toMatch(/took too long/i);
    expect(result.matches).toEqual([]);
  }, 10_000);

  it("an unexpected loop error is a plain `failed` outcome, never a thrown error (T037)", async () => {
    const loop: RunModelLoop = async () => {
      throw new Error("something genuinely unexpected");
    };
    const result = await runAgentAsk(INPUT, baseDeps({ runModelLoop: loop }));
    expect(result.outcome).toBe("failed");
    expect(result.answer).not.toContain("genuinely unexpected");
    expect(result.matches).toEqual([]);
  });
});

describe("T036: the 23 s abort covers the whole request", () => {
  const never = <T>() => new Promise<T>(() => {});

  it("a hanging bind ends as timed_out", async () => {
    const result = await runAgentAsk(
      INPUT,
      baseDeps({ abortMs: 20, bindOnce: () => never(), runModelLoop: okModelLoop() }),
    );
    expect(result.outcome).toBe("timed_out");
    expect(result.answer).toMatch(/took too long/i);
  }, 5_000);

  it("a hanging engine and a hanging runs-index lookup end as timed_out", async () => {
    const engineHang = await runAgentAsk(
      INPUT,
      baseDeps({ abortMs: 20, getEngine: () => never(), runModelLoop: okModelLoop() }),
    );
    expect(engineHang.outcome).toBe("timed_out");
    const { manifest_cid: _omit, ...noPin } = INPUT;
    const indexHang = await runAgentAsk(
      noPin,
      baseDeps({ abortMs: 20, resolveManifestCid: () => never(), runModelLoop: okModelLoop() }),
    );
    expect(indexHang.outcome).toBe("timed_out");
  }, 5_000);

  it("a hanging tool call (a promise that never resolves) ends as timed_out", async () => {
    const hangingEngine: QueryEngine = { run: async () => {}, all: () => never() };
    const loop: RunModelLoop = async (params) => {
      await params.tools.searchRoofingPermits.execute?.(
        { status_class: "open", limit: 5 } as never,
        { toolCallId: "t", messages: [], abortSignal: params.abortSignal } as never,
      );
      return { text: "never reached", steps: [], toolOutputs: [], totalTokens: 1 };
    };
    const result = await runAgentAsk(
      INPUT,
      baseDeps({
        abortMs: 20,
        getEngine: async () => hangingEngine,
        bindViews: async () => FAKE_BOUND,
        runModelLoop: loop,
      }),
    );
    expect(result.outcome).toBe("timed_out");
  }, 5_000);

  it("a hanging spend reservation also ends as timed_out", async () => {
    ddbMock.on(UpdateCommand).callsFake(() => never());
    const result = await runAgentAsk(INPUT, baseDeps({ abortMs: 20, runModelLoop: okModelLoop() }));
    expect(result.outcome).toBe("timed_out");
  }, 5_000);

  it("a normal call still answers when the abort has room", async () => {
    const result = await runAgentAsk(
      INPUT,
      baseDeps({ abortMs: 5_000, runModelLoop: okModelLoop() }),
    );
    expect(result.outcome).toBe("answered");
  });
});

describe("T037: pre-loop errors are `failed`, not thrown", () => {
  const { manifest_cid: _omit, ...noPin } = INPUT;

  it("a DynamoDB failure on the reservation returns failed with a plain message", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("ProvisionedThroughputExceeded secret-internal"));
    const result = await runAgentAsk(INPUT, baseDeps({ runModelLoop: okModelLoop() }));
    expect(result.outcome).toBe("failed");
    expect(result.answer).not.toMatch(/secret-internal|at .*\.ts|Error:/);
  });

  it("a runs-index failure returns failed", async () => {
    const result = await runAgentAsk(
      noPin,
      baseDeps({
        resolveManifestCid: async () => {
          throw new Error("runs index: GET answered 500");
        },
        runModelLoop: okModelLoop(),
      }),
    );
    expect(result.outcome).toBe("failed");
    expect(result.answer).not.toMatch(/runs index|500/);
  });

  it("a bind failure returns failed", async () => {
    const result = await runAgentAsk(
      INPUT,
      baseDeps({
        bindOnce: async () => {
          throw new Error("duckdb bind exploded");
        },
        runModelLoop: okModelLoop(),
      }),
    );
    expect(result.outcome).toBe("failed");
    expect(result.answer).not.toMatch(/duckdb/);
  });
});

describe("T048: the $0.05 reservation is trued up or released, never burned", () => {
  const updates = () => ddbMock.commandCalls(UpdateCommand).map((c) => c.args[0].input);
  const releases = () => updates().filter((u) => String(u.UpdateExpression).includes(":minusOne"));

  it("an answered call trues up and does not release", async () => {
    await runAgentAsk(INPUT, baseDeps({ runModelLoop: okModelLoop() }));
    expect(releases()).toHaveLength(0);
    expect(updates()).toHaveLength(2); // reserve + true-up
  });

  it.each([
    ["throttled", throttledModelLoop()],
    [
      "failed",
      async () => {
        throw new Error("boom");
      },
    ],
    ["timed_out", slowModelLoop(2000)],
  ])("a %s call releases the reservation once, with the reserved amount", async (_n, loop) => {
    await runAgentAsk(INPUT, baseDeps({ abortMs: 20, runModelLoop: loop as RunModelLoop }));
    const rel = releases();
    expect(rel).toHaveLength(1);
    expect(rel[0]?.ExpressionAttributeValues).toMatchObject({ ":delta": -0.05, ":minusOne": -1 });
  });

  it("a failure before the model (bind) also releases it", async () => {
    await runAgentAsk(
      INPUT,
      baseDeps({
        bindOnce: async () => {
          throw new Error("x");
        },
      }),
    );
    expect(releases()).toHaveLength(1);
  });

  it("a paused call took no reservation, so it releases nothing", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    ddbMock
      .on(GetCommand)
      .resolves({ Item: { pk: "SPEND#2026-10-23", spent_usd: 3, model_calls: 9 } });
    await runAgentAsk(INPUT, baseDeps({ dailySpendCapUsd: 3, runModelLoop: okModelLoop() }));
    expect(releases()).toHaveLength(0);
  });
});

describe("how/query/missing aggregate across every tool call, not just the last (Stage 5 review fix, Major #5)", () => {
  it("a searchProperties call followed by a geocodePlace disambiguation call last still surfaces searchProperties's applied filters, area and unknown_excluded in how/query/missing", async () => {
    const loop: RunModelLoop = async () => ({
      text: "Found matches near Pflugerville.",
      steps: [],
      totalTokens: 50,
      toolOutputs: [
        {
          matches: [],
          returned: 0,
          total: 0,
          truncated: false,
          empty_reason: null,
          unknown_excluded: { roof_age_years: 3 },
          area: { label: "Pflugerville city · Census 2024 Gazetteer · 30.45, -97.60" },
          applied: { radius_mi: 5, roof_age_years_min: 15 },
        },
        // geocodePlace's own output shape: no `applied` key, so it must not clobber the above.
        { status: "found", label: "Round Rock city", point: { lat: 30.5, lon: -97.68 } },
      ],
    });
    const result = await runAgentAsk(INPUT, baseDeps({ runModelLoop: loop }));
    expect(result.outcome).toBe("answered");
    expect(result.how).toContain("Pflugerville");
    expect(result.query).toMatchObject({ radius_mi: 5, roof_age_years_min: 15 });
    expect(result.missing).toContainEqual({ field: "roof_age_years", reason: "unknown" });
  });
});

describe("documented, reversible config helpers (T023)", () => {
  it("dailySpendCapUsd reads AI_DAILY_CAP_USD, else spend.ts's $3 default", () => {
    expect(dailySpendCapUsd({})).toBe(3);
    expect(dailySpendCapUsd({ AI_DAILY_CAP_USD: "0.05" })).toBe(0.05);
  });

  it("abortMs reads AGENT_ABORT_MS, else the 23s default", () => {
    expect(abortMs({})).toBe(23_000);
    expect(abortMs({ AGENT_ABORT_MS: "1000" })).toBe(1000);
  });
});

const EMPTY_ENVELOPE = (applied: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  matches: [],
  returned: 0,
  total: 0,
  truncated: false,
  empty_reason: "no_match",
  unknown_excluded: {},
  area: { label: "Pflugerville city · Census 2024 Gazetteer · 30.45, -97.60" },
  applied,
  ...extra,
});

describe("ERR-61: an unfinished loop is never 'answered'", () => {
  it("budget exhausted on tool calls -> failed, planning text not surfaced, tried calls listed", async () => {
    const loop: RunModelLoop = async () => ({
      text: "Let me also try without the open_years_min filter.",
      incomplete: true,
      modelCalls: 3,
      steps: [
        {
          tool: "searchRoofingPermits",
          input: { status_class: "open", open_years_min: 5 },
          summary: "",
        },
      ],
      toolOutputs: [EMPTY_ENVELOPE({ status_class: "open", open_years_min: 5 })],
      totalTokens: 10,
    });
    const result = await runAgentAsk(INPUT, baseDeps({ runModelLoop: loop }));
    expect(result.outcome).not.toBe("answered");
    expect(result.outcome).toBe("failed");
    expect(result.answer).not.toContain("Let me also try");
    expect(result.answer).toContain("searchRoofingPermits");
    expect(result.matches).toEqual([]);
    expect(result.missing).toContainEqual({ field: "result", reason: "incomplete" });
  });

  it("empty final text is also not 'answered'", async () => {
    const loop: RunModelLoop = async () => ({ text: "  ", steps: [], toolOutputs: [] });
    const result = await runAgentAsk(INPUT, baseDeps({ runModelLoop: loop }));
    expect(result.outcome).toBe("failed");
  });
});

describe("ERR-61/62: a changed filter is stated, never silent", () => {
  it("radius 5 -> 10 and open -> open_or_stalled appear in answer, how and query", async () => {
    const loop: RunModelLoop = async () => ({
      text: "No matches.",
      steps: [
        {
          tool: "searchRoofingPermits",
          input: { status_class: "open_or_stalled", open_years_min: 3 },
          summary: "",
        },
        {
          tool: "searchRoofingPermits",
          input: { status_class: "open_or_stalled", open_years_min: 1 },
          summary: "",
        },
      ],
      toolOutputs: [EMPTY_ENVELOPE({ status_class: "open_or_stalled", open_years_min: 1 })],
      totalTokens: 10,
    });
    const result = await runAgentAsk(
      { prompt: "Which have open roofing permits open for 5 years?" },
      baseDeps({ runModelLoop: loop }),
    );
    expect(result.answer).toContain("open_years_min changed from 3 to 1");
    expect(result.answer).toContain("widened to open_or_stalled");
    expect(result.how).toContain("Filters changed during the search");
    expect(result.query).toMatchObject({ open_years_min: 1 });
  });
});

describe("ERR-62/63: contract missing[] names and honest owner-location statement", () => {
  it("owner_is_out_of_area filter -> missing lists it and the answer says not in the published export", async () => {
    const loop: RunModelLoop = async () => ({
      text: "No properties matched; the dataset had good coverage.",
      steps: [
        {
          tool: "searchProperties",
          input: { tenure_years_min: 10, owner_is_out_of_area: true },
          summary: "",
        },
      ],
      toolOutputs: [
        EMPTY_ENVELOPE({ radius_mi: 5, tenure_years_min: 10, owner_is_out_of_area: true }),
      ],
      totalTokens: 10,
    });
    const result = await runAgentAsk(
      { prompt: "Homes near Lakeway with owners outside the area?" },
      baseDeps({ runModelLoop: loop }),
    );
    expect(result.missing).toContainEqual({
      field: "owner_is_out_of_area",
      reason: "not_in_export",
    });
    expect(result.answer).toMatch(/not in the published export/);
    expect(result.query).toMatchObject({ radius_mi: 5 });
  });

  it("contractor/BBB questions flag the contract names, not the column names", async () => {
    const loop: RunModelLoop = async () => ({
      text: "Permit 2026-1 has no BBB data.",
      steps: [{ tool: "searchRoofingPermits", input: { permit_number: "2026-1 BP" }, summary: "" }],
      toolOutputs: [EMPTY_ENVELOPE({ permit_number: "2026-1 BP" })],
      totalTokens: 10,
    });
    const result = await runAgentAsk(
      { prompt: "What is the BBB rating of the contractor on 2026-1 BP?" },
      baseDeps({ runModelLoop: loop }),
    );
    const fields = result.missing.map((m) => m.field);
    expect(fields).toContain("bbb_status");
    expect(fields).toContain("contractor.name_as_printed");
    expect(fields).not.toContain("bbb_rating");
    expect(fields).not.toContain("contractor_name_raw");
    expect(result.answer).toMatch(/BBB status is not available/);
  });
});

describe("ERR-63: budget figures are exposed", () => {
  it("modelCalls, outputTokens, durationMs and traceId are present; traceId is the X-Ray Root only", async () => {
    const loop: RunModelLoop = async () => ({
      text: "Done.",
      steps: [],
      toolOutputs: [],
      modelCalls: 2,
      outputTokens: 321,
      totalTokens: 400,
    });
    const result = await runAgentAsk(
      INPUT,
      baseDeps({
        runModelLoop: loop,
        env: { _X_AMZN_TRACE_ID: "Root=1-abc-def;Parent=1;Sampled=1" },
      }),
    );
    expect(result.modelCalls).toBe(2);
    expect(result.outputTokens).toBe(321);
    expect(typeof result.durationMs).toBe("number");
    expect(result.traceId).toBe("1-abc-def");
  });
});

describe("ERR-61..63 follow-up: golden G2/G4/G5 deterministic rules", () => {
  it("G2: 'many years' is read as at least 5, named in how and in the answer; contractor not printed even with an empty search", async () => {
    let system = "";
    const loop: RunModelLoop = async (params) => {
      system = params.system;
      return {
        text: "No open roofing permits matched.",
        steps: [
          {
            tool: "searchRoofingPermits",
            input: { status_class: "open", open_years_min: 5 },
            summary: "",
          },
        ],
        toolOutputs: [EMPTY_ENVELOPE({ radius_mi: 5, status_class: "open", open_years_min: 5 })],
        totalTokens: 10,
      };
    };
    const result = await runAgentAsk(
      {
        prompt:
          "Which properties near that area have open roofing permits that have been open for many years, and who is the listed contractor?",
      },
      baseDeps({ runModelLoop: loop }),
    );
    expect(system).toMatch(/many years.*open_years_min 5/);
    expect(result.how).toMatch(/open at least 5 years/);
    expect(result.answer).toMatch(/at least 5 years/);
    expect(result.answer).toMatch(/not printed/);
    const fields = result.missing.map((m) => m.field);
    expect(fields).toContain("contractor.name_as_printed");
    expect(fields).toContain("bbb_status");
  });

  it("G2: contractor not printed applies even when no permit search happened", async () => {
    const loop: RunModelLoop = async () => ({
      text: "I could not run that.",
      steps: [],
      toolOutputs: [],
      totalTokens: 5,
    });
    const result = await runAgentAsk(
      { prompt: "Who is the contractor on the oldest roof permit?" },
      baseDeps({ runModelLoop: loop }),
    );
    expect(result.answer).toMatch(/contractor name is not printed/);
    expect(result.missing.map((m) => m.field)).toContain("contractor.name_as_printed");
  });

  it("G2: the model's own 'names are not available' wording does not suppress the contract phrase 'contractor not printed'", async () => {
    const loop: RunModelLoop = async () => ({
      text: "Contractor names are **not available** in the published export.",
      steps: [],
      toolOutputs: [],
      totalTokens: 5,
    });
    const result = await runAgentAsk(
      { prompt: "Who is the contractor on the oldest roof permit?" },
      baseDeps({ runModelLoop: loop }),
    );
    expect(result.answer).toMatch(/contractor not printed/);
  });

  it("G4: owners-outside-area question flags owner_is_out_of_area even when the model dropped that filter", async () => {
    const loop: RunModelLoop = async () => ({
      text: "Found homes with 10+ years of tenure.",
      steps: [{ tool: "searchProperties", input: { tenure_years_min: 10 }, summary: "" }],
      toolOutputs: [EMPTY_ENVELOPE({ radius_mi: 5, tenure_years_min: 10 })],
      totalTokens: 10,
    });
    const result = await runAgentAsk(
      {
        prompt:
          "Which homes near Lakeway haven't changed owners in 10+ years and have owners outside the area?",
      },
      baseDeps({ runModelLoop: loop }),
    );
    expect(result.missing).toContainEqual({
      field: "owner_is_out_of_area",
      reason: "not_in_export",
    });
    expect(result.answer).toContain(
      "I cannot tell which owners live outside the area: the owner's mailing location is not in the published export.",
    );
    expect(result.query).toMatchObject({ radius_mi: 5, tenure_years_min: 10 });
    expect(result.query).not.toHaveProperty("owner_is_out_of_area");
  });

  it("G4: an ordinary tenure question does not flag owner location", async () => {
    const loop: RunModelLoop = async () => ({
      text: "Done.",
      steps: [],
      toolOutputs: [EMPTY_ENVELOPE({ tenure_years_min: 10 })],
      totalTokens: 10,
    });
    const result = await runAgentAsk(
      { prompt: "Which homes near Lakeway have not changed owners in 10+ years?" },
      baseDeps({ runModelLoop: loop }),
    );
    expect(result.missing.map((m) => m.field)).not.toContain("owner_is_out_of_area");
  });

  it("G5: a permit number never looked up by the model is looked up deterministically; BBB flagged and stated", async () => {
    const calls: string[] = [];
    const engine: QueryEngine = {
      run: async () => {},
      all: async (sql: string) => {
        calls.push(sql);
        return [];
      },
    };
    const loop: RunModelLoop = async () => ({
      text: "BBB rating is not available.",
      steps: [],
      toolOutputs: [],
      totalTokens: 10,
      modelCalls: 1,
    });
    const result = await runAgentAsk(
      { prompt: "What's the BBB rating of the contractor on permit 2024-123456 BP?" },
      baseDeps({
        runModelLoop: loop,
        getEngine: async () => engine,
        bindViews: async () => FAKE_BOUND,
      }),
    );
    expect(calls.some((q) => q.includes("2024-123456 BP"))).toBe(true);
    expect(result.steps.map((s) => s.tool)).toContain("searchRoofingPermits");
    expect(result.answer).toContain("2024-123456 BP");
    expect(result.answer).toMatch(/BBB status is not available in the published data/);
    expect(result.missing.map((m) => m.field)).toContain("bbb_status");
    expect(result.outcome).toBe("answered");
  });

  it("G5: no second lookup when the model already searched that permit number", async () => {
    const calls: string[] = [];
    const engine: QueryEngine = {
      run: async () => {},
      all: async (sql: string) => (calls.push(sql), []),
    };
    const loop: RunModelLoop = async () => ({
      text: "Not found.",
      steps: [
        { tool: "searchRoofingPermits", input: { permit_number: "2024-123456 BP" }, summary: "" },
      ],
      toolOutputs: [EMPTY_ENVELOPE({ permit_number: "2024-123456 BP" })],
      totalTokens: 10,
    });
    await runAgentAsk(
      { prompt: "BBB rating of the contractor on permit 2024-123456 BP?" },
      baseDeps({
        runModelLoop: loop,
        getEngine: async () => engine,
        bindViews: async () => FAKE_BOUND,
      }),
    );
    expect(calls).toHaveLength(0);
  });
});
