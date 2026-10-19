// The `discover` operator command: starts the TravisDiscovery run through the Restate
// ingress and waits for a settled state. Offline: the ingress is a fake fetch.
import { describe, expect, it } from "vitest";
import { main } from "../travis/discovery/discover.js";

interface Call {
  url: string;
  method: string;
}

function record(over: Record<string, unknown>): Record<string, unknown> {
  return {
    run_id: "travis",
    state: "DISCOVERING",
    steps: [{ key: "austin_permits:measurements:2026-01-01" }],
    blockers: [],
    validator: null,
    waiting_human_hours: 0,
    resolutions: [],
    waiting_since: null,
    completed_at: null,
    auto_advance_to_seed: false,
    ...over,
  };
}

function ingress(
  statuses: unknown[],
  send: () => Response = () => Response.json({ status: "Accepted" }),
) {
  const calls: Call[] = [];
  const queue = [...statuses];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, method: init.method ?? "GET" });
    if (url.endsWith("/run/send")) return send();
    if (url.endsWith("/status")) return Response.json(queue.length > 1 ? queue.shift() : queue[0]);
    return new Response("not found", { status: 404 });
  };
  return { calls, fetch };
}

const BLOCKER = {
  source_key: "tcad_certified",
  next_step: "File the records request",
  waiting: true,
  resolution: null,
  receipt: { status: 403, outcome: "blocked" },
};

function run(fake: ReturnType<typeof ingress>, env: Record<string, string> = {}) {
  const out: string[] = [];
  let sleeps = 0;
  const done = main({
    fetch: fake.fetch,
    env: { DISCOVER_POLL_MS: "1", ...env },
    out: (l) => out.push(l),
    sleep: async () => {
      sleeps += 1;
    },
    now: () => sleeps * 1000,
  });
  return { done, out, sleeps: () => sleeps };
}

describe("discover", () => {
  it("sends the run to TravisDiscovery/travis on the default ingress and waits for WAITING_HUMAN", async () => {
    const fake = ingress([
      null,
      record({}),
      record({
        state: "WAITING_HUMAN",
        blockers: [BLOCKER],
        waiting_since: "2026-01-01T01:00:00.000Z",
        validator: { exit_code: 1, report_path: "docs/evidence/A-01-readiness.json" },
      }),
    ]);
    const r = run(fake);
    expect(await r.done).toBe(0);
    expect(fake.calls[0]).toEqual({
      url: "http://localhost:8080/TravisDiscovery/travis/run/send",
      method: "POST",
    });
    expect(
      fake.calls
        .slice(1)
        .every((c) => c.url === "http://localhost:8080/TravisDiscovery/travis/status"),
    ).toBe(true);
    const text = r.out.join("\n");
    expect(text).toMatch(/state WAITING_HUMAN/);
    expect(text).toMatch(/blocker tcad_certified \(blocked, HTTP 403, waiting for a human\)/);
    expect(text).toMatch(/validator exit 1/);
  });

  it("does not stop on a transient WAITING_HUMAN before the run starts waiting", async () => {
    const fake = ingress([
      record({ state: "WAITING_HUMAN", blockers: [BLOCKER] }),
      record({ state: "DISCOVERING" }),
      record({ state: "READY", completed_at: "2026-01-01T02:00:00.000Z" }),
    ]);
    const r = run(fake);
    expect(await r.done).toBe(0);
    expect(r.out.join("\n")).toMatch(/READY; seed is never started automatically/);
    expect(fake.calls.filter((c) => c.url.endsWith("/status"))).toHaveLength(3);
  });

  it("honours RESTATE_INGRESS_URL and TRAVIS_DISCOVERY_RUN_ID", async () => {
    const fake = ingress([record({ state: "READY", completed_at: "2026-01-01T02:00:00.000Z" })]);
    const r = run(fake, {
      RESTATE_INGRESS_URL: "http://127.0.0.1:18080/",
      TRAVIS_DISCOVERY_RUN_ID: "travis-2",
    });
    expect(await r.done).toBe(0);
    expect(fake.calls[0]?.url).toBe("http://127.0.0.1:18080/TravisDiscovery/travis-2/run/send");
  });

  it("shows an existing run instead of starting a second one", async () => {
    const fake = ingress(
      [record({ state: "READY", completed_at: "2026-01-01T02:00:00.000Z" })],
      () => Response.json({ status: "PreviouslyAccepted" }),
    );
    const r = run(fake);
    expect(await r.done).toBe(0);
    expect(r.out.join("\n")).toMatch(/already exists/);
  });

  it("exits 1 when the ingress is unreachable", async () => {
    const r = run({
      calls: [],
      fetch: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    expect(await r.done).toBe(1);
    expect(r.out.join("\n")).toMatch(/unreachable/);
  });

  it("exits 1 when the ingress refuses the run (deployment not registered)", async () => {
    const r = run(ingress([null], () => new Response("{}", { status: 404 })));
    expect(await r.done).toBe(1);
    expect(r.out.join("\n")).toMatch(/HTTP 404/);
  });

  it("exits 1 when the run is still discovering after DISCOVER_MAX_HOURS", async () => {
    const fake = ingress([record({})]);
    const r = run(fake, { DISCOVER_MAX_HOURS: "0.001" });
    expect(await r.done).toBe(1);
    expect(r.out.join("\n")).toMatch(/still DISCOVERING/);
  });
});
