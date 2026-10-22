// T020 (A-14, agent-design.md § 6.2-6.3, ../../../assessment-guide/reference/checks.md § 7.1-7.2):
// the Vitest driver for golden.json, run against the deployed `agent.ask` HTTP contract.
//
// This is written against `agent.ask` *before it exists* (ash's apps/api/src/agent/ask.ts is
// built concurrently this wave, in a different builder group — see tasks.md T022). That is
// expected TDD red state, not a bug: with AGENT_URL unset, every case here is skipped with a
// clear, explicit report instead of silently passing or erroring the whole suite, so
// `pnpm test` stays green for wave 2's checkpoint while still documenting exactly what will run
// once the endpoint is deployed (constitution I: localhost/unset is never evidence, so this file
// refuses to default AGENT_URL to a local address).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  checkBudget,
  checkCorrectness,
  checkGroundedness,
  checkHonesty,
  checkOutOfScope,
  checkRecall,
  runOracle,
  type AgentAskResponse,
  type OracleCall,
} from "./grader.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, "golden.json");

interface GoldenExpect {
  must_mention?: string[];
  must_flag_missing?: string[];
  empty_reason?: string | null;
  matches_length?: number;
  must_not_contain_cid?: boolean;
  oracle: OracleCall;
}

interface GoldenCase {
  id: string;
  turns: Array<{ prompt: string }>;
  expect: GoldenExpect;
}

interface GoldenFile {
  cases: GoldenCase[];
}

function loadGolden(): GoldenFile {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenFile;
}

/** The hosted agent.ask base URL, e.g. https://countylens.<domain>/api. Must be a real hosted
 *  endpoint, never localhost (constitution I) — a loopback value is treated the same as unset. */
function agentUrl(): string | null {
  const value = process.env.AGENT_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
  } catch {
    return null;
  }
  return value.replace(/\/+$/, "");
}

async function askAgent(
  baseUrl: string,
  turns: Array<{ prompt: string }>,
): Promise<AgentAskResponse> {
  let last: AgentAskResponse | null = null;
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of turns) {
    const res = await fetch(`${baseUrl}/agent.ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: turn.prompt,
        turns: history,
        sessionQuestionCount: history.length / 2,
      }),
    });
    if (!res.ok) {
      throw new Error(`agent.ask returned ${res.status} for prompt "${turn.prompt}"`);
    }
    last = (await res.json()) as AgentAskResponse;
    history.push({ role: "user", content: turn.prompt });
    history.push({ role: "assistant", content: last.answer });
  }
  if (!last) throw new Error("golden case has no turns");
  return last;
}

const baseUrl = agentUrl();
const golden = loadGolden();

describe("agent.ask golden queries (T020, checks.md § 7.1, agent-design.md § 6.2)", () => {
  if (!baseUrl) {
    it.skip(
      "SKIPPED: AGENT_URL is not set to a hosted address. agent.ask is not deployed yet this " +
        "wave (ash's apps/api/src/agent/ask.ts, T022) — this is expected TDD red state. Set " +
        "AGENT_URL=https://<hosted-api> to run G1-G6 against the deployed agent.",
      () => {},
    );
    return;
  }

  for (const goldenCase of golden.cases) {
    it(`${goldenCase.id}: ${goldenCase.turns[goldenCase.turns.length - 1]?.prompt}`, async () => {
      const response = await askAgent(baseUrl, goldenCase.turns);
      const expectation = goldenCase.expect;

      // Budget ceilings apply to every case regardless of outcome.
      const budget = checkBudget(response);
      expect(budget.pass, `budget: ${JSON.stringify(budget)}`).toBe(true);

      if (goldenCase.id === "G6") {
        const outOfScope = checkOutOfScope(response);
        expect(outOfScope.pass, `G6 out-of-scope check: ${JSON.stringify(outOfScope)}`).toBe(true);
        if (expectation.matches_length !== undefined) {
          expect(response.matches.length).toBe(expectation.matches_length);
        }
      }

      const oracle = await runOracle(expectation.oracle);

      const honesty = checkHonesty(
        response,
        expectation,
        "empty_reason" in oracle ? (oracle.empty_reason as string | null) : null,
      );
      expect(honesty.pass, `honesty: ${JSON.stringify(honesty)}`).toBe(true);

      const correctness = checkCorrectness(response, oracle);
      expect(correctness.pass, `correctness: ${JSON.stringify(correctness)}`).toBe(true);

      const recall = checkRecall(response, oracle);
      expect(recall.pass, `recall: ${JSON.stringify(recall)}`).toBe(true);

      const groundedness = await checkGroundedness(response, async (cid) => {
        const res = await fetch(`${baseUrl}/trpc/query.getProperty?input=${encodeURIComponent(JSON.stringify({ property_cid: cid }))}`);
        if (!res.ok) return false;
        const body = (await res.json()) as { returned?: number };
        return (body.returned ?? 0) > 0;
      });
      expect(groundedness.pass, `groundedness: ${JSON.stringify(groundedness)}`).toBe(true);
    });
  }
});
