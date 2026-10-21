// A-03 API observability on the hosted runtime (T068; AC-7, FR-007, NFR-004; contracts/api.md
// "Observability"). AWS reads use the `assess` profile; the region comes from its configuration.
//
// - TC-050: one hosted Runs page load → exactly one `runs.summary` call with `x-correlation-id`
//   and `x-trace-id`; exactly one Powertools JSON log line with that correlation ID; an X-Ray
//   trace with the `duckdb.query` subsegment; datapoints for QueryDurationMs, ItemsProcessed and
//   ItemsFailed (procedure = runs.summary); identifiers and counts only in the log line and the
//   trace (no presigned URL, URL, credential or row value).
// - TC-051: reads `x-correlation-id` and `x-trace-id` from the response headers of a hosted
//   `runs.summary` call, then requires docs/evidence/A-03.md, in the format of tests/e2e/README.md
//   "Observability evidence", to record both in backticks (a TC-050 correlation ID of the same
//   shape as the live one, an X-Ray root trace ID) plus a ```json excerpt of the Powertools log
//   line with that `correlation_id`; the recorded trace ID resolves with
//   `aws xray batch-get-traces`.
// - TC-NF-04: a cold start forced by an environment change, then one Runs page load: X-Ray
//   `Initialization` + `Invocation` (node init and the DuckDB init of the first query) < 3 s;
//   then one untimed warm-up and 30 warm calls from the hosted page: p95 of the response time
//   and of the response's `queryDurationMs` < 1 s. The original environment is restored.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Response } from "@playwright/test";
import { expect, test } from "./lib/fixtures.js";
import { NEEDS_AWS_TAG } from "./lib/needs-aws.js";
import {
  durationMs,
  findLogLines,
  flattenSegments,
  forceColdStart,
  functionLogGroup,
  metricSampleCount,
  poll,
  traceSegments,
  type XraySegment,
} from "./lib/ops.js";
import {
  LIMITS,
  RUNS_SUMMARY_PATTERN,
  SELECTORS,
  WARM_API_CALLS,
  nfrConfig,
  summarize,
} from "./lib/perf.js";
import { repoRoot, runtimeUrl } from "./lib/runtime.js";

const PROCEDURE = "runs.summary";
const QUERY_SUBSEGMENT = "duckdb.query";
const METRICS = ["QueryDurationMs", "ItemsProcessed", "ItemsFailed"] as const;
const POWERTOOLS_KEYS = [
  "level",
  "message",
  "service",
  "timestamp",
  "correlation_id",
  "xray_trace_id",
];
/** Log fields that may carry text: identifiers only (FR-007). Every other field must be a number or boolean. */
const IDENTIFIER_FIELDS = new Set([
  ...POWERTOOLS_KEYS,
  "function_arn",
  "function_name",
  "function_request_id",
  "function_memory_size",
  "cold_start",
  "sampling_rate",
  "requestId",
  "procedure",
  "query",
  "manifestCid",
  "preset",
  "prefix",
  "errorCode",
]);
const ANNOTATION_KEYS = new Set([
  "query",
  "procedure",
  "manifestCid",
  "preset",
  "ColdStart",
  "Service",
]);
const FORBIDDEN = [
  { name: "presigned URL", pattern: /X-Amz-Signature/i },
  { name: "URL", pattern: /https?:\/\//i },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "credential", pattern: /aws_secret|secretaccesskey|sessiontoken|x-amz-security-token/i },
];
const TRACE_ID = /^1-[0-9a-f]{8}-[0-9a-f]{24}$/;

interface SummaryCall {
  url: string;
  status: number;
  correlationId: string;
  traceId: string;
  calls: number;
}

/** Opens {RUNTIME_URL}/runs in a fresh private context and captures its `runs.summary` call(s). */
async function loadRunsPage(browser: Browser): Promise<SummaryCall> {
  const context = await browser.newContext({ colorScheme: "light" });
  try {
    const page = await context.newPage();
    const responses: Response[] = [];
    page.on("response", (response) => {
      if (RUNS_SUMMARY_PATTERN.test(response.url())) responses.push(response);
    });
    await page.goto(`${runtimeUrl()}/runs`, { waitUntil: "domcontentloaded" });
    await page
      .locator(`${SELECTORS.runsPage} ${SELECTORS.cid}`)
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    const first = responses[0];
    expect(first, "the Runs page calls /api/trpc/runs.summary").toBeDefined();
    const headers = (await first?.allHeaders()) ?? {};
    return {
      url: first?.url() ?? "",
      status: first?.status() ?? 0,
      correlationId: headers["x-correlation-id"] ?? "",
      traceId: headers["x-trace-id"] ?? "",
      calls: responses.length,
    };
  } finally {
    await context.close();
  }
}

/** The JSON log lines whose `correlation_id` equals `id` (polled until X-Ray/Logs catch up). */
async function logLinesFor(id: string, sinceMs: number): Promise<Record<string, unknown>[]> {
  const group = await functionLogGroup(nfrConfig().API_FUNCTION_NAME);
  const parse = (lines: string[]): Record<string, unknown>[] =>
    lines.flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return typeof parsed === "object" &&
          parsed !== null &&
          (parsed as Record<string, unknown>).correlation_id === id
          ? [parsed as Record<string, unknown>]
          : [];
      } catch {
        return [];
      }
    });
  return poll(
    async () => parse(await findLogLines(group, id, sinceMs)),
    (lines) => lines.length > 0,
    { timeoutMs: 3 * 60_000, intervalMs: 10_000 },
  );
}

async function traceWith(traceId: string, name: string): Promise<XraySegment[]> {
  return poll(
    async () => flattenSegments(await traceSegments(traceId)),
    (all) => all.some((s) => s.name === name),
    { timeoutMs: 3 * 60_000, intervalMs: 10_000 },
  );
}

/** FR-007: names of forbidden contents found in a text, if any. */
const forbiddenIn = (text: string): string[] =>
  FORBIDDEN.filter((f) => f.pattern.test(text)).map((f) => f.name);

/** Digits → `9`, letters → `x`: two IDs from one generator share a shape. */
const idShape = (id: string): string => id.replace(/[0-9]/g, "9").replace(/[a-z]/gi, "x");

interface RecordedObservability {
  correlationId: string | undefined;
  traceId: string | undefined;
  logLine: Record<string, unknown> | undefined;
}

/**
 * The TC-050 evidence block of docs/evidence/A-03.md (tests/e2e/README.md, "Observability
 * evidence"): a line `x-correlation-id: \`<id>\``, a line `x-trace-id: \`1-…\`` and a ```json
 * fenced excerpt with the one Powertools log line whose `correlation_id` is that ID.
 */
function parseObservabilityEvidence(markdown: string): RecordedObservability {
  const correlationId = /x-correlation-id[^\n`]*`([^`\s]+)`/i.exec(markdown)?.[1];
  const traceId = /x-trace-id[^\n`]*`([^`\s]+)`/i.exec(markdown)?.[1];
  let logLine: Record<string, unknown> | undefined;
  for (const block of markdown.matchAll(/```json\s*\n([\s\S]*?)```/g)) {
    const body = block[1] ?? "";
    for (const candidate of [body, ...body.split(/\r?\n/)]) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed) &&
          correlationId !== undefined &&
          (parsed as Record<string, unknown>).correlation_id === correlationId
        ) {
          logLine = parsed as Record<string, unknown>;
          break;
        }
      } catch {
        // Not a whole JSON value; try the next candidate.
      }
    }
    if (logLine) break;
  }
  return { correlationId, traceId, logLine };
}

/** The first numeric `queryDurationMs` anywhere in a tRPC response body. */
function queryDurationOf(body: unknown): number | undefined {
  if (Array.isArray(body)) {
    for (const item of body) {
      const found = queryDurationOf(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof body === "object" && body !== null) {
    for (const [key, value] of Object.entries(body)) {
      if (key === "queryDurationMs" && typeof value === "number") return value;
      const found = queryDurationOf(value);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

test.describe("A-03 API observability", () => {
  test.describe.configure({ timeout: 15 * 60_000 });

  test(`@scenario:A-03-TC-050 ${NEEDS_AWS_TAG}`, async ({ browser, run }, testInfo) => {
    const startedMs = Date.now() - 60_000;
    const call = await loadRunsPage(browser);
    expect(call.calls, "exactly one runs.summary call per page load").toBe(1);
    expect(call.status, "runs.summary answered 200").toBe(200);
    expect(call.correlationId, "x-correlation-id header").not.toBe("");
    expect(call.traceId, "x-trace-id header is an X-Ray root trace ID").toMatch(TRACE_ID);

    const lines = await logLinesFor(call.correlationId, startedMs);
    expect(
      lines,
      `exactly one JSON log line with correlation_id ${call.correlationId}`,
    ).toHaveLength(1);
    const line = lines[0] ?? {};
    for (const key of POWERTOOLS_KEYS)
      expect.soft(Object.keys(line), `log line has ${key}`).toContain(key);
    expect.soft(line.procedure, "log line names the procedure").toBe(PROCEDURE);
    expect.soft(line.manifestCid, "log line carries the run's manifest CID").toBe(run.manifestCid);
    expect.soft(typeof line.queryDurationMs, "log line carries queryDurationMs").toBe("number");

    const segments = await traceWith(call.traceId, QUERY_SUBSEGMENT);
    const query = segments.find((s) => s.name === QUERY_SUBSEGMENT);
    expect(query, `trace ${call.traceId} has a ${QUERY_SUBSEGMENT} subsegment`).toBeDefined();
    expect
      .soft(query?.annotations?.procedure, "duckdb.query annotated with the procedure")
      .toBe(PROCEDURE);

    const endMs = Date.now() + 60_000;
    const datapoints: Record<string, number> = {};
    for (const metric of METRICS) {
      datapoints[metric] = await poll(
        () =>
          metricSampleCount(nfrConfig().API_METRICS_NAMESPACE, metric, PROCEDURE, startedMs, endMs),
        (count) => count > 0,
        { timeoutMs: 6 * 60_000, intervalMs: 20_000 },
      );
      expect
        .soft(datapoints[metric], `${metric} (procedure=${PROCEDURE}) has a datapoint`)
        .toBeGreaterThan(0);
    }

    // FR-007: identifiers and counts only.
    const textFields = Object.entries(line).filter(
      ([, v]) => typeof v === "string" || typeof v === "object",
    );
    expect
      .soft(
        textFields.map(([k]) => k).filter((k) => !IDENTIFIER_FIELDS.has(k)),
        "log fields with text are identifiers only (others are numbers or booleans)",
      )
      .toEqual([]);
    expect
      .soft(forbiddenIn(JSON.stringify(line)), "log line has no URL, presigned URL or credential")
      .toEqual([]);
    const annotations = segments.flatMap((s) => Object.entries(s.annotations ?? {}));
    expect
      .soft(
        annotations.map(([k]) => k).filter((k) => !ANNOTATION_KEYS.has(k)),
        "trace annotations are identifiers only",
      )
      .toEqual([]);
    const traceText = JSON.stringify(
      segments.map((s) => ({ name: s.name, annotations: s.annotations, metadata: s.metadata })),
    );
    expect
      .soft(
        forbiddenIn(traceText),
        "trace annotations and metadata have no URL, presigned URL or credential",
      )
      .toEqual([]);

    await testInfo.attach("tc-050-evidence.json", {
      body: JSON.stringify(
        {
          runtimeUrl: runtimeUrl(),
          request: call.url.replace(/\?.*$/, ""),
          "x-correlation-id": call.correlationId,
          "x-trace-id": call.traceId,
          logLine: line,
          subsegments: segments.map((s) => ({
            name: s.name,
            ms: durationMs(s),
            annotations: s.annotations ?? {},
          })),
          datapoints,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });

  test(`@scenario:A-03-TC-051 ${NEEDS_AWS_TAG}`, async ({ browser }, testInfo) => {
    // Step 0: the hosted call's own response headers give the live identifiers and their shape.
    const call = await loadRunsPage(browser);
    expect(call.status, "runs.summary answered 200").toBe(200);
    expect(call.correlationId, "x-correlation-id response header").not.toBe("");
    expect(call.traceId, "x-trace-id response header is an X-Ray root trace ID").toMatch(TRACE_ID);

    // Steps 1–2: docs/evidence/A-03.md in the documented format (tests/e2e/README.md,
    // "Observability evidence").
    const evidencePath = resolve(repoRoot, "docs", "evidence", "A-03.md");
    expect(existsSync(evidencePath), "docs/evidence/A-03.md exists").toBe(true);
    const recorded = parseObservabilityEvidence(readFileSync(evidencePath, "utf8"));
    expect(
      recorded.correlationId,
      "docs/evidence/A-03.md records `x-correlation-id: `<id>`` (in backticks)",
    ).toBeDefined();
    expect(
      recorded.traceId,
      "docs/evidence/A-03.md records `x-trace-id: `1-…`` (in backticks)",
    ).toMatch(TRACE_ID);
    expect(
      idShape(recorded.correlationId ?? ""),
      `the recorded correlation ID has the shape of the live header (${call.correlationId})`,
    ).toBe(idShape(call.correlationId));
    expect(
      recorded.logLine,
      "docs/evidence/A-03.md has a ```json excerpt holding the Powertools log line of that correlation_id",
    ).toBeDefined();
    const line = recorded.logLine ?? {};
    for (const key of POWERTOOLS_KEYS)
      expect.soft(Object.keys(line), `recorded log line has ${key}`).toContain(key);
    expect.soft(line.procedure, "recorded log line names the procedure").toBe(PROCEDURE);
    expect
      .soft(
        String(line.xray_trace_id ?? ""),
        "recorded log line's xray_trace_id is the recorded x-trace-id",
      )
      .toContain(recorded.traceId ?? "");
    expect
      .soft(
        forbiddenIn(JSON.stringify(line)),
        "recorded log line has no URL, presigned URL or credential",
      )
      .toEqual([]);

    // Expected result: the recorded trace resolves with `aws xray batch-get-traces`.
    const segments = await traceWith(recorded.traceId ?? "", QUERY_SUBSEGMENT);
    await testInfo.attach("tc-051-evidence.json", {
      body: JSON.stringify(
        {
          evidence: "docs/evidence/A-03.md",
          live: { "x-correlation-id": call.correlationId, "x-trace-id": call.traceId },
          recorded,
          resolvedSegments: segments.length,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    expect(
      segments.length,
      `recorded trace ${recorded.traceId ?? ""} resolves with batch-get-traces`,
    ).toBeGreaterThan(0);
  });

  test(`@scenario:A-03-TC-NF-04 ${NEEDS_AWS_TAG}`, async ({ browser, page }, testInfo) => {
    // Step 0: the hosted runtime answers before anything in AWS is changed.
    const baseline = await loadRunsPage(browser);
    expect(baseline.status, "runs.summary answers on the hosted runtime").toBe(200);

    const functionName = nfrConfig().API_FUNCTION_NAME;
    const handle = await forceColdStart(functionName);
    let cold: SummaryCall | undefined;
    let coldSegments: XraySegment[] | undefined;
    let warm: { responseMs: number[]; queryDurationMs: number[]; statuses: number[] } | undefined;
    try {
      // Step 1: the first request after the change starts a new sandbox.
      cold = await loadRunsPage(browser);
      expect(cold.traceId, "cold call x-trace-id").toMatch(TRACE_ID);
      coldSegments = await traceWith(cold.traceId, "Initialization");

      // Step 2: one untimed warm-up, then 30 warm calls from the hosted page context.
      await page.goto(`${runtimeUrl()}/runs`, { waitUntil: "domcontentloaded" });
      warm = await page
        .evaluate(
          async ({ url, calls }) => {
            const once = async (): Promise<{ ms: number; status: number; body: unknown }> => {
              const t0 = performance.now();
              const res = await fetch(url, { cache: "no-store" });
              const body: unknown = await res.json();
              return { ms: performance.now() - t0, status: res.status, body };
            };
            await once();
            const responseMs: number[] = [];
            const bodies: unknown[] = [];
            const statuses: number[] = [];
            for (let i = 0; i < calls; i += 1) {
              const r = await once();
              responseMs.push(r.ms);
              bodies.push(r.body);
              statuses.push(r.status);
            }
            return { responseMs, bodies, statuses };
          },
          { url: cold.url, calls: WARM_API_CALLS },
        )
        .then((r) => ({
          responseMs: r.responseMs.map((ms) => Math.round(ms)),
          queryDurationMs: r.bodies.map((b) => queryDurationOf(b) ?? Number.NaN),
          statuses: r.statuses,
        }));
    } finally {
      await handle.restore();
    }

    const fn = (coldSegments ?? []).find(
      (s) => s.origin === "AWS::Lambda::Function" || s.name === "Initialization",
    );
    const init = (coldSegments ?? []).find((s) => s.name === "Initialization");
    const invocation = (coldSegments ?? []).find((s) => s.name === "Invocation");
    const coldMs =
      (init ? durationMs(init) : Number.NaN) + (invocation ? durationMs(invocation) : Number.NaN);
    const responses = summarize(warm?.responseMs ?? []);
    const queryDurations = summarize(
      (warm?.queryDurationMs ?? []).filter((v) => Number.isFinite(v)),
    );
    await testInfo.attach("tc-nf-04-evidence.json", {
      body: JSON.stringify(
        {
          coldStartNonce: handle.nonce,
          coldTraceId: cold?.traceId,
          coldCorrelationId: cold?.correlationId,
          initializationMs: init ? durationMs(init) : null,
          invocationMs: invocation ? durationMs(invocation) : null,
          coldStartMs: coldMs,
          warm: { responses, queryDurations, statuses: warm?.statuses },
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    expect(fn, "the cold trace has the Lambda function segment").toBeDefined();
    expect(
      init,
      "the cold trace has an Initialization subsegment (a real cold start)",
    ).toBeDefined();
    expect(
      invocation,
      "the cold trace has an Invocation subsegment (includes the DuckDB init)",
    ).toBeDefined();
    expect
      .soft(coldMs, `cold start incl. DuckDB init < ${LIMITS.apiColdStartMs} ms`)
      .toBeLessThan(LIMITS.apiColdStartMs);
    expect(
      warm?.statuses.every((s) => s === 200),
      "every warm call answered 200",
    ).toBe(true);
    expect(responses.n, `${WARM_API_CALLS} warm calls`).toBe(WARM_API_CALLS);
    expect(queryDurations.n, "every warm response carries queryDurationMs").toBe(WARM_API_CALLS);
    expect
      .soft(queryDurations.p95Ms, `warm QueryDurationMs p95 < ${LIMITS.apiWarmP95Ms} ms`)
      .toBeLessThan(LIMITS.apiWarmP95Ms);
    expect(responses.p95Ms, `warm response p95 < ${LIMITS.apiWarmP95Ms} ms`).toBeLessThan(
      LIMITS.apiWarmP95Ms,
    );
  });
});
