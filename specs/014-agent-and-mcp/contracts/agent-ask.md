# Contract: `agent.ask` (tRPC procedure, Lambda)

Owner: `ash`. Full detail: `../design-ash.md`. Shared types: `../data-model.md`.

## Request

```ts
{
  prompt: string;                 // the plain-language question
  turns?: { prompt: string; outcome: string }[]; // last ≤4 turns, client-sent (no server conversation store)
  overrides?: Record<string, unknown>;            // from an edited "How I read this" chip, e.g. { tenure_years_min: 3 }
  manifest_cid?: string;           // CIDv1; pins the run this conversation compares against. Omitted on turn 1 → latest.
}
```

## Response (one response, no streaming — AD-09)

```ts
{
  answer: string;                 // model-written prose, citing [n]
  how: string;                    // server-built: centre label + source, radius, thresholds from `applied`
  steps: { tool: string; input: unknown; summary: string }[]; // ≤ 6
  matches: Match[];                // server-built from tool provenance, never from model text
  query: Record<string, unknown>;  // the resolved applied filters (echoes query-core's `applied`)
  missing: { field: string; reason: string }[];
  outcome: "answered" | "failed" | "paused" | "throttled" | "timed_out" | "cancelled";
  // Optional observability fields (ERR-63; absent on paused/throttled/timed_out except durationMs/traceId):
  modelCalls?: number;   // model calls this turn (AC-5 ceiling 3)
  outputTokens?: number; // output tokens this turn (AC-5 ceiling 1,500)
  durationMs?: number;
  traceId?: string;      // X-Ray trace id (`_X_AMZN_TRACE_ID` Root), no secrets
}
```

## Limits (enforced server-side, not by the model)

- ≤ 6 tool steps, ≤ 3 model calls, ≤ 1,500 output tokens per answer (AC-5).
- Timeout layering (AD-27): 23 s `AbortSignal.timeout` → `outcome: "timed_out"`; 25 s Lambda timeout; 25 s client stop; 29–30 s HTTP API ceiling (should never fire).
- $3/day spend cap (DynamoDB counter, checked before each model call) → `outcome: "paused"` with a `resetsAt` (next UTC day).
- Bedrock throttling (10 req/min account-wide) → `outcome: "throttled"`.
- Never a 5xx; never a partial answer returned as `"answered"`. A loop that ends without a final text answer (budget spent on tool calls, token cut-off) returns `outcome: "failed"` with `answer` stating which calls were tried, `matches = []` and `missing = [{field:"result", reason:"incomplete"}]`; planning text is never surfaced.
- Filters are never changed silently: if the model changed a filter between calls (or widened `open` to `open_or_stalled`), `answer` and `how` state the change.
- `missing[]` uses contract names: `contractor.name_as_printed`, `bbb_status`, `owner_is_out_of_area` (`not_in_export`; the owner mailing location is not in the published export).

## Error / empty behavior

- Every citation `[n]` in `answer` must correspond to `matches[n-1]`; any out-of-range or unregistered citation is stripped server-side before the response is sent (never shown to the user as a broken reference).
- `matches = []` with `outcome: "answered"` and `query.empty_reason`/`missing[]` set is the correct shape for "nothing found" / "out of scope" / "can't tell" — never `"failed"`.

## Verify on the hosted URL

See `../design-ash.md` § "How to verify on the hosted URL" and `../quickstart.md`.
