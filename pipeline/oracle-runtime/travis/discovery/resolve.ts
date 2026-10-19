// T036: operator command `npm --prefix pipeline/oracle-runtime run resolve -- <source_key>
// captured|still-blocked` (FR-006f, contracts/cli.md).
//
// Sends the resolution to the TravisDiscovery workflow's shared `resolve` handler through
// the local Restate ingress. The handler completes the waiting source's durable promise;
// the running workflow then re-probes that source once (`captured`) or documents the
// blocker (`still-blocked`).
//
// Exit 0 when the resolution is recorded; exit 1 when the source is not waiting, the
// arguments are invalid, or the stack cannot be reached (nothing was recorded).
//
// Environment: RESTATE_INGRESS_URL (default http://localhost:8080) and
// TRAVIS_DISCOVERY_RUN_ID (default "travis", the workflow key `discover` starts).
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { redact } from "../lib/log.js";
import { SOURCE_KEYS } from "./catalog.schema.js";
import { DEFAULT_RUN_ID, ResolveRequestSchema, WORKFLOW_NAME } from "./workflow.js";

export const DEFAULT_INGRESS_URL = "http://localhost:8080";
const USAGE = `usage: npm --prefix pipeline/oracle-runtime run resolve -- <source_key> captured|still-blocked (source_key: ${SOURCE_KEYS.join(", ")})`;

const ResolveResponseSchema = z.union([
  z.object({ accepted: z.literal(true), promise: z.string() }),
  z.object({ accepted: z.literal(false), reason: z.string() }),
]);

export interface ResolveCliDeps {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  env?: Record<string, string | undefined>;
  out?: (line: string) => void;
}

export async function main(argv: readonly string[], deps: ResolveCliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out =
    deps.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const fetchImpl = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const say = (line: string): void => out(redact(line));

  const parsed = ResolveRequestSchema.safeParse({ source_key: argv[0], outcome: argv[1] });
  if (argv.length !== 2 || !parsed.success) {
    say(`resolve: not recorded: invalid arguments; ${USAGE}`);
    return 1;
  }
  const request = parsed.data;
  const ingress = (env.RESTATE_INGRESS_URL ?? DEFAULT_INGRESS_URL).replace(/\/+$/, "");
  const runId = env.TRAVIS_DISCOVERY_RUN_ID ?? DEFAULT_RUN_ID;
  const url = `${ingress}/${WORKFLOW_NAME}/${encodeURIComponent(runId)}/resolve`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(`resolve: not recorded: Restate ingress unreachable (${message}); is the local stack up?`);
    return 1;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const result = ResolveResponseSchema.safeParse(body);
  if (!response.ok || !result.success) {
    say(`resolve: not recorded: ingress answered HTTP ${response.status} for run ${runId}`);
    return 1;
  }
  if (!result.data.accepted) {
    say(`resolve: not recorded: ${result.data.reason}`);
    return 1;
  }
  say(
    `resolve: recorded ${request.source_key} ${request.outcome} for run ${runId} (${result.data.promise})`,
  );
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
