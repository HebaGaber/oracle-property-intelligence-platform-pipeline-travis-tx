// T034: User Story 4 workflow tests (FR-006 to FR-006f). A blocked receipt moves the run to
// WAITING_HUMAN and waits on a durable promise; a human resolves it as "captured" or "still
// blocked"; a 429/5xx after 5 attempts waits as well; READY never starts seed.
// Synthetic responses only (test-only); an injected fetch answers every host, nothing real
// is called, and the clock is injected.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ATTEMPTS,
  USER_AGENT,
  createSourceClient,
  type FetchLike,
} from "../travis/lib/source-client.js";
import { CatalogSchema, type Catalog } from "../travis/discovery/catalog.schema.js";
import { checkCatalog } from "../travis/discovery/check-catalog.js";
import type { JurisdictionProfileEntry } from "../travis/profiles/jurisdictions.js";
import {
  createJurisdictionProbes,
  createTravisDiscovery,
  createUs1Probes,
  planResolution,
  runTravisDiscovery,
  type HumanIO,
  type Resolution,
  type RunRecord,
} from "../travis/discovery/workflow.js";
import { main as resolveMain } from "../travis/discovery/resolve.js";
import {
  fakeHttp,
  hangUntilAborted,
  json,
  silent,
  steppingClock,
  text,
  type RecordedCall,
  type Route,
} from "./fixtures/fake-http.js";
import { must } from "./helpers.js";

const START = Date.parse("2026-01-01T00:00:00.000Z");
const HOUR = 3_600_000;
const FULL_PAGE = JSON.stringify(Array.from({ length: 50_000 }, (_, i) => ({ id: i })));
const LANDING = `<html><body><p>Certified on July 25, 2026.</p>
<a href="/files/2026-special-export.json">2026 Certified Special Export (JSON)</a>
<a href="/files/layouts.zip">Export Layouts</a>
<a href="/files/supp-1.zip">2026 Supplemental Appraisal Roll Export 1</a></body></html>`;
const EXPORT = JSON.stringify([{ prop_id: 1, deed_date: "2020-01-01" }, { prop_id: 2 }]);
const CENSUS_URL = "https://census.test/place_by_county.txt";
const CENSUS = [
  "STATE|STATEFP|COUNTYFP|COUNTYNAME|PLACEFP|PLACENS|PLACENAME|TYPE|CLASSFP|FUNCSTAT",
  "TX|48|453|Travis County|00001|00000001|Alpha city|INCORPORATED PLACE|C1|A",
].join("\n");
const REQUEST = {
  recipient_office: "Synthetic City Secretary",
  system_scope: "synthetic permits, 2000 to present",
  route: "records-first" as const,
  request_portal_url: "https://records.test/request",
};
const PROFILE: JurisdictionProfileEntry[] = [
  {
    key: "alpha",
    jurisdiction: "Alpha",
    census_placefp: "00001",
    spec_class: "supported",
    case: "history-online",
    portal_kind: "open-data-api",
    portal: "https://alpha.test/api",
    evidence_url: "https://alpha.test/permits",
    earliest_record_date: "1990-01-01",
    records_request: REQUEST,
  },
  {
    key: "synthetic_unincorporated",
    jurisdiction: "Synthetic County unincorporated",
    census_placefp: null,
    spec_class: "records request",
    case: "custodian-only",
    evidence_url: "https://county.test/permits",
    records_request: REQUEST,
  },
];

/** Mutable so a test can change a source's answer between the first probe and a re-probe. */
interface Scenario {
  tcadBlocked?: boolean;
  austinThrottled?: boolean;
  bbbBlocked?: boolean;
  alphaBlocked?: boolean;
}

function socrata(host: string, counts: Record<string, string>, s: Scenario): Route[] {
  const throttled = (): boolean => host === "data.austintexas.gov" && s.austinThrottled === true;
  return [
    {
      match: (u) => u.host === host && throttled(),
      respond: () => json({ message: "synthetic: too many requests" }, 429),
    },
    {
      match: (u) => u.host === host && u.searchParams.get("$group") === "jurisdiction",
      respond: () => json([{ jurisdiction: "AUSTIN FULL PURPOSE", count: "100" }]),
    },
    {
      match: (u) => u.host === host && u.searchParams.get("$order") === ":id",
      respond: () => new Response(FULL_PAGE, { headers: { "content-type": "application/json" } }),
    },
    {
      match: (u) => u.host === host && u.searchParams.get("$select") === "count(*)",
      respond: (u) => json([{ count: counts[u.searchParams.get("$where") ?? ""] ?? "0" }]),
    },
  ];
}

function routes(s: Scenario): Route[] {
  return [
    ...socrata("data.austintexas.gov", { "": "2400000", "tcad_id IS NULL": "1234" }, s),
    ...socrata("data.texas.gov", { "": "90000", "taxpayer_county_code='227'": "3000" }, s),
    {
      match: (u) => u.host === "traviscad.org",
      respond: (u) => {
        if (s.tcadBlocked)
          return text("<html>Forbidden</html>", 403, {
            "content-type": "text/html",
            "set-cookie": "session=synthetic-secret",
          });
        if (u.pathname === "/publicinformation") return text(LANDING);
        if (u.pathname === "/files/layouts.zip")
          return new Response("PK", { headers: { "content-type": "application/zip" } });
        return new Response(EXPORT, { headers: { "content-type": "application/json" } });
      },
    },
    { match: (u) => u.host === "gis.traviscountytx.gov", respond: () => json({ count: 2 }) },
    {
      match: (u) => u.host.endsWith("bbb.org"),
      respond: () =>
        s.bbbBlocked
          ? text("<html>Just a moment...</html>", 403)
          : text("<html>synthetic listing page</html>"),
    },
    {
      match: (u) => u.host === "census.test",
      respond: () => text(CENSUS, 200, { "content-type": "text/plain" }),
    },
    {
      match: (u) => u.host === "alpha.test",
      respond: () =>
        s.alphaBlocked ? text("Forbidden", 403) : text("<html>synthetic permits page</html>"),
    },
    { match: () => true, respond: () => text("<html>synthetic evidence page</html>") },
  ];
}

/** Thrown by the fake durable promise when no resolution is scripted: the run suspends. */
class Suspended extends Error {
  constructor(readonly names: readonly string[]) {
    super("suspended on durable promise");
  }
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
});

interface Harness {
  scenario: Scenario;
  calls: RecordedCall[];
  journal: string[];
  saved: RunRecord[];
  awaited: string[][];
  catalogs: Catalog[];
  evidence: Map<string, string>;
  validatorRuns: number;
  sleeps: number;
  io: HumanIO;
  run: () => Promise<RunRecord>;
}

function harness(scenario: Scenario, resolutions: Resolution[] = []): Harness {
  const rawDir = mkdtempSync(join(tmpdir(), "us4-raw-"));
  tmpDirs.push(rawDir);
  const { fetch, calls } = fakeHttp(routes(scenario));
  let clock = START;
  const h: Harness = {
    scenario,
    calls,
    journal: [],
    saved: [],
    awaited: [],
    catalogs: [],
    evidence: new Map(),
    validatorRuns: 0,
    sleeps: 0,
    io: undefined as unknown as HumanIO,
    run: async () => {
      throw new Error("unset");
    },
  };
  const client = createSourceClient({
    fetch: fetch as FetchLike,
    sleep: async () => {
      h.sleeps += 1;
    },
    random: () => 0,
    now: () => new Date(clock),
    log: silent,
  });
  const queue = [...resolutions];
  h.io = {
    now: async () => new Date(clock),
    run: async (name, fn) => {
      h.journal.push(name);
      return fn();
    },
    save: (r) => {
      h.saved.push(structuredClone(r));
    },
    awaitResolution: async (names) => {
      h.awaited.push([...names]);
      const next = queue.shift();
      if (!next) throw new Suspended(names);
      clock += 2 * HOUR; // the human answers two hours later
      return next;
    },
  };
  const probes = createUs1Probes({
    client,
    now: steppingClock("2026-01-01T00:00:00Z", 30_000),
    rawDir,
    gisTimeoutMs: 20,
  });
  const jurisdictions = createJurisdictionProbes(
    { client, now: () => new Date(clock) },
    { censusUrl: CENSUS_URL },
  );
  h.run = () =>
    runTravisDiscovery(h.io, "run-us4", {
      probes,
      jurisdictions,
      profile: PROFILE,
      writeCatalog: (c) => {
        h.catalogs.push(structuredClone(c));
      },
      runValidator: async () => {
        h.validatorRuns += 1;
        return {
          exit_code: 0,
          report_path: "docs/evidence/A-01-readiness.json",
          vendored_sha256: "0".repeat(64),
        };
      },
      writeEvidence: (path, content) => {
        h.evidence.set(path, content);
      },
    });
  return h;
}

function hostCalls(calls: readonly RecordedCall[], host: string): number {
  return calls.filter((c) => new URL(c.url).host === host).length;
}

function lastSaved(h: Harness): RunRecord {
  return must(h.saved.at(-1), "saved run record");
}

function source(catalog: Catalog, key: string) {
  return must(
    catalog.sources.find((s) => s.key === key),
    key,
  );
}

describe("A-01-TC-018 blocked receipt waits for a human (FR-006, FR-006a, FR-006d)", () => {
  it("a TCAD 403 moves the run to WAITING_HUMAN on a durable promise, with one request and no timer loop", async () => {
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);

    const record = lastSaved(h);
    expect(record.state).toBe("WAITING_HUMAN");
    expect(record.auto_advance_to_seed).toBe(false);
    expect(must(h.awaited[0])).toEqual(
      expect.arrayContaining(["resolve:tcad_certified:1", "resolve:tcad_supplemental:1"]),
    );
    const tcad = must(record.blockers.find((b) => b.source_key === "tcad_certified"));
    expect(tcad).toMatchObject({ waiting: true, attempt: 1, promise: "resolve:tcad_certified:1" });
    expect(tcad.receipt.attempts).toBe(1);
    // exactly one request to the blocked host, no sleeps (no backoff on 403, no polling)
    expect(hostCalls(h.calls, "traviscad.org")).toBe(1);
    expect(h.sleeps).toBe(0);
    // the catalog is written once before waiting, with the TCAD rows blocked
    const catalog = must(h.catalogs.at(-1));
    expect(source(catalog, "tcad_certified").status).toBe("blocked");
    expect(CatalogSchema.safeParse(catalog).success).toBe(true);
  });

  it("the workflow module has no timer loop: it waits only on the durable promise", () => {
    const path = fileURLToPath(new URL("../travis/discovery/workflow.ts", import.meta.url));
    const src = readFileSync(path, "utf8");
    expect(src).not.toMatch(/setTimeout|setInterval|ctx\.sleep|\.sleep\(/);
    expect(src).toMatch(/ctx\.promise/);
  });

  it("T038: blocked TCAD rows carry a complete records request (Public Information Act, 2026 certified + supplemental)", async () => {
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const catalog = must(h.catalogs.at(-1));
    for (const key of ["tcad_certified", "tcad_supplemental"]) {
      const row = source(catalog, key);
      const req = must(row.records_request, `${key}.records_request`);
      expect(req.recipient_office).toMatch(/Travis Central Appraisal District/);
      expect(req.recipient_office).toMatch(/public information/i);
      expect(req.system_scope).toMatch(/Public Information Act/);
      expect(req.system_scope).toMatch(/2026 Certified/);
      expect(req.system_scope).toMatch(/supplemental/i);
      expect(["records-first", "api-first"]).toContain(req.route);
      expect(req.request_portal_url ?? req.request_email).toBeTruthy();
      expect(must(row.next_step)).toMatch(/records request/i);
    }
    expect(checkCatalog(catalog).filter((l) => /tcad/.test(l))).toEqual([]);
    const blocker = must(lastSaved(h).blockers.find((b) => b.source_key === "tcad_certified"));
    expect(must(blocker.records_request).recipient_office).toMatch(/Travis Central/);
  });

  it("T038: a BBB challenge records the official BBB API application as the next step (recorded only)", async () => {
    const h = harness({ bbbBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const bbb = source(must(h.catalogs.at(-1)), "bbb");
    expect(bbb.status).toBe("blocked");
    expect(must(bbb.next_step)).toMatch(/BBB API/);
    expect(must(bbb.next_step)).toMatch(/recorded only/i);
    expect(must(bbb.records_request)).toMatchObject({ route: "api-first" });
    expect(must(must(bbb.records_request).request_portal_url)).toMatch(
      /^https:\/\/developer\.bbb\.org/,
    );
  });

  it("T037: an evidence file is written for each blocked source and jurisdiction row, at its evidence_path", async () => {
    const h = harness({ tcadBlocked: true, alphaBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const catalog = must(h.catalogs.at(-1));
    const paths = [
      must(source(catalog, "tcad_certified").blocked_evidence).evidence_path,
      must(source(catalog, "tcad_supplemental").blocked_evidence).evidence_path,
      must(must(catalog.permits).jurisdictions.find((j) => j.key === "alpha")?.blocked_evidence)
        .evidence_path,
    ];
    for (const p of paths) {
      expect(p.startsWith("docs/evidence/blocked/")).toBe(true);
      expect(h.evidence.has(p)).toBe(true);
      expect(must(h.evidence.get(p))).toMatch(/^---\nid: /);
    }
    expect([...h.evidence.values()].join("\n")).not.toContain("synthetic-secret");
  });
});

describe("A-01-TC-027 resolve (FR-006f)", () => {
  it("captured: re-probes only that source once with the same User-Agent, rewrites the catalog and re-runs the validator", async () => {
    const scenario: Scenario = { tcadBlocked: true };
    const h = harness(scenario, [{ source_key: "tcad_certified", outcome: "captured" }]);
    // the human gets access before resolving: the next TCAD request succeeds
    const originalAwait = h.io.awaitResolution.bind(h.io);
    h.io.awaitResolution = async (names) => {
      scenario.tcadBlocked = false;
      return originalAwait(names);
    };
    const before = { journal: 0, calls: 0, austin: 0, gis: 0 };
    const originalRun = h.io.run.bind(h.io);
    let resolved = false;
    h.io.run = async (name, fn) => {
      if (!resolved && /reprobe/.test(name)) {
        resolved = true;
        before.calls = h.calls.length;
        before.austin = hostCalls(h.calls, "data.austintexas.gov");
        before.gis = hostCalls(h.calls, "gis.traviscountytx.gov");
      }
      return originalRun(name, fn);
    };

    const record = await h.run();

    const reprobes = h.journal.filter((k) => /reprobe/.test(k));
    expect(reprobes).toHaveLength(1);
    expect(must(reprobes[0])).toMatch(/^tcad_certified:export:\d{4}-\d{2}-\d{2}:reprobe:1$/);
    // only TCAD was asked again; every request carried the one project User-Agent
    const after = h.calls.slice(before.calls);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((c) => new URL(c.url).host === "traviscad.org")).toBe(true);
    expect(hostCalls(h.calls, "data.austintexas.gov")).toBe(before.austin);
    expect(hostCalls(h.calls, "gis.traviscountytx.gov")).toBe(before.gis);
    const agents = new Set(
      h.calls.map((c) => new Headers(c.init.headers as Record<string, string>).get("user-agent")),
    );
    expect([...agents]).toEqual([USER_AGENT]);

    // catalog rewritten with TCAD available, validator re-run once, run READY
    expect(h.catalogs.length).toBe(2);
    const catalog = must(h.catalogs.at(-1));
    expect(source(catalog, "tcad_certified").status).toBe("available");
    expect(must(catalog.parcel).assessed_parcel_count).toBe(2);
    expect(h.validatorRuns).toBe(1);
    expect(record.validator).toMatchObject({ exit_code: 0 });
    expect(record.state).toBe("READY");
    expect(record.blockers).toEqual([]);
    expect(record.auto_advance_to_seed).toBe(false);
    // the run went WAITING_HUMAN -> DISCOVERING (re-probe) -> READY
    const states = h.saved.map((r) => r.state);
    const waitAt = states.indexOf("WAITING_HUMAN");
    expect(waitAt).toBeGreaterThan(-1);
    expect(states.slice(waitAt)).toContain("DISCOVERING");
  });

  it("still-blocked: stays WAITING_HUMAN with the blocker and records request documented; no new request", async () => {
    const h = harness({ tcadBlocked: true }, [
      { source_key: "tcad_certified", outcome: "still-blocked" },
      { source_key: "tcad_supplemental", outcome: "still-blocked" },
    ]);
    const record = await h.run();
    expect(record.state).toBe("WAITING_HUMAN");
    expect(hostCalls(h.calls, "traviscad.org")).toBe(1);
    expect(h.journal.some((k) => /reprobe/.test(k))).toBe(false);
    expect(h.validatorRuns).toBe(0);
    for (const key of ["tcad_certified", "tcad_supplemental"] as const) {
      const b = must(record.blockers.find((x) => x.source_key === key));
      expect(b.waiting).toBe(false);
      expect(b.resolution).toBe("still-blocked");
      expect(b.next_step).toMatch(/still blocked/);
      expect(b.next_step).toMatch(/Travis Central Appraisal District/);
      expect(b.next_step).toMatch(/FR-006d/);
    }
    expect(record.resolutions.map((r) => `${r.source_key}:${r.outcome}`)).toEqual([
      "tcad_certified:still-blocked",
      "tcad_supplemental:still-blocked",
    ]);
    // the catalog keeps the blocked rows and is rewritten with the waiting time
    const catalog = must(h.catalogs.at(-1));
    expect(source(catalog, "tcad_certified").status).toBe("blocked");
  });

  it("captured but still blocked: the source waits again on a new promise (attempt 2), one more request only", async () => {
    const h = harness({ tcadBlocked: true }, [
      { source_key: "tcad_certified", outcome: "captured" },
    ]);
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    expect(hostCalls(h.calls, "traviscad.org")).toBe(2);
    const record = lastSaved(h);
    expect(record.state).toBe("WAITING_HUMAN");
    const b = must(record.blockers.find((x) => x.source_key === "tcad_certified"));
    expect(b).toMatchObject({ waiting: true, attempt: 2, promise: "resolve:tcad_certified:2" });
    expect(must(h.awaited.at(-1))).toContain("resolve:tcad_certified:2");
  });

  it("planResolution accepts a waiting source and refuses one that is not waiting", async () => {
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const record = lastSaved(h);
    expect(planResolution(record, { source_key: "tcad_certified", outcome: "captured" })).toEqual({
      accepted: true,
      promise: "resolve:tcad_certified:1",
    });
    expect(
      planResolution(record, { source_key: "austin_permits", outcome: "captured" }),
    ).toMatchObject({ accepted: false });
    expect(
      planResolution(record, { source_key: "tcad_certified", outcome: "maybe" }),
    ).toMatchObject({ accepted: false });
    expect(
      planResolution(null, { source_key: "tcad_certified", outcome: "captured" }),
    ).toMatchObject({ accepted: false });
  });

  it("the Restate resolve handler resolves the durable promise only for a waiting source", async () => {
    const h = harness({ tcadBlocked: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const record = lastSaved(h);
    let handlers: Record<string, (ctx: unknown, input?: unknown) => Promise<unknown>> = {};
    const sdk = {
      workflow: (def: { handlers: typeof handlers }) => {
        handlers = def.handlers;
        return def;
      },
    };
    createTravisDiscovery(sdk as unknown as Parameters<typeof createTravisDiscovery>[0]);
    expect(Object.keys(handlers).sort()).toEqual(["resolve", "run", "status"]);
    const resolved: Array<{ name: string; value: unknown }> = [];
    const ctx = {
      key: "run-us4",
      get: async () => record,
      promise: (name: string) => ({
        resolve: async (value: unknown) => {
          resolved.push({ name, value });
        },
      }),
    };
    const ok = await must(handlers.resolve)(ctx, {
      source_key: "tcad_certified",
      outcome: "still-blocked",
    });
    expect(ok).toMatchObject({ accepted: true });
    expect(resolved).toEqual([
      {
        name: "resolve:tcad_certified:1",
        value: { source_key: "tcad_certified", outcome: "still-blocked" },
      },
    ]);
    const refused = await must(handlers.resolve)(ctx, {
      source_key: "austin_permits",
      outcome: "captured",
    });
    expect(refused).toMatchObject({ accepted: false });
    expect(resolved).toHaveLength(1);
  });

  it("resolve CLI exits 0 for a waiting source and 1 for one that is not waiting", async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    const ingress = (accepted: boolean) => async (url: string, init: RequestInit) => {
      posted.push({ url, body: JSON.parse(String(init.body)) as unknown });
      return json(
        accepted
          ? { accepted, promise: "resolve:tcad_certified:1" }
          : { accepted, reason: "not waiting" },
      );
    };
    const lines: string[] = [];
    const out = (l: string) => {
      lines.push(l);
    };
    const env = {
      RESTATE_INGRESS_URL: "http://ingress.test:8080",
      TRAVIS_DISCOVERY_RUN_ID: "run-x",
    };

    expect(
      await resolveMain(["tcad_certified", "still-blocked"], { fetch: ingress(true), env, out }),
    ).toBe(0);
    expect(posted[0]).toEqual({
      url: "http://ingress.test:8080/TravisDiscovery/run-x/resolve",
      body: { source_key: "tcad_certified", outcome: "still-blocked" },
    });
    expect(
      await resolveMain(["austin_permits", "captured"], { fetch: ingress(false), env, out }),
    ).toBe(1);
    // bad arguments never reach the ingress
    const sent = posted.length;
    expect(await resolveMain(["tcad_certified", "maybe"], { fetch: ingress(true), env, out })).toBe(
      1,
    );
    expect(
      await resolveMain(["not_a_source", "captured"], { fetch: ingress(true), env, out }),
    ).toBe(1);
    expect(await resolveMain([], { fetch: ingress(true), env, out })).toBe(1);
    expect(posted.length).toBe(sent);
    // an unreachable stack is reported, not a crash
    const down = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    expect(await resolveMain(["tcad_certified", "captured"], { fetch: down, env, out })).toBe(1);
    expect(lines.join("\n")).not.toMatch(/\/Users\//);
  });
});

describe("A-01-TC-026 exhausted and download limits (FR-006e, FR-003)", () => {
  it("429 on all 5 attempts: measurement null with 'throttled: 5 attempts exhausted', outcome failed, WAITING_HUMAN for that source only", async () => {
    const h = harness({ austinThrottled: true });
    await expect(h.run()).rejects.toBeInstanceOf(Suspended);
    const record = lastSaved(h);
    expect(record.state).toBe("WAITING_HUMAN");
    expect(record.blockers.map((b) => b.source_key)).toEqual(["austin_permits"]);
    expect(must(h.awaited[0])).toEqual(["resolve:austin_permits:1"]);

    const catalog = must(h.catalogs.at(-1));
    const austin = source(catalog, "austin_permits");
    expect(austin.status).toBe("blocked");
    expect(austin.denominator.value).toBeNull();
    expect(must(austin.denominator.missing_reason)).toContain("throttled: 5 attempts exhausted");
    expect(must(austin.blocked_evidence)).toMatchObject({
      outcome: "failed",
      attempts: MAX_ATTEMPTS,
      http_status: 429,
      user_agent: USER_AGENT,
    });
    // other sources finished
    for (const key of ["tx_comptroller", "tcad_certified", "tcad_gis"]) {
      expect(source(catalog, key).status).toBe("available");
    }
    expect(CatalogSchema.safeParse(catalog).success).toBe(true);
  });

  it("a TCAD download with no data for 10 minutes is blocked with timeout_ms >= 600,000", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "us4-dl-"));
    tmpDirs.push(dir);
    const client = createSourceClient({
      fetch: (async (_url: string, init: RequestInit) => hangUntilAborted(init)) as FetchLike,
      log: silent,
      clock: () => Date.now(),
    });
    const pending = client.download({
      url: "https://traviscad.test/export.json",
      destPath: join(dir, "export.json"),
      inactivityMs: 600_000,
      totalMs: 7_200_000,
    });
    await vi.advanceTimersByTimeAsync(600_001);
    const result = await pending;
    expect(result.receipt.outcome).toBe("blocked");
    expect(result.receipt.blocked_reason).toBe("timeout");
    expect(must(result.receipt.timeout_ms)).toBeGreaterThanOrEqual(600_000);
    expect(result.receipt.attempts).toBe(1);
    expect(result.path).toBeNull();
  });

  it("a TCAD download still running after 2 hours is blocked with timeout_ms >= 7,200,000", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "us4-dl-"));
    tmpDirs.push(dir);
    // a server that trickles one byte every 5 minutes forever (until the client cancels)
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const trickle = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: (controller) =>
            new Promise<void>((resolve) => {
              timer = globalThis.setTimeout(() => {
                controller.enqueue(new Uint8Array([0x5b]));
                resolve();
              }, 300_000);
            }),
          cancel: () => {
            globalThis.clearTimeout(timer);
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    const client = createSourceClient({
      fetch: (async () => trickle()) as FetchLike,
      log: silent,
      clock: () => Date.now(),
    });
    const pending = client.download({
      url: "https://traviscad.test/export.json",
      destPath: join(dir, "export.json"),
      inactivityMs: 600_000,
      totalMs: 7_200_000,
    });
    await vi.advanceTimersByTimeAsync(7_500_000);
    const result = await pending;
    expect(result.receipt.outcome).toBe("blocked");
    expect(result.receipt.blocked_reason).toBe("timeout");
    expect(must(result.receipt.timeout_ms)).toBeGreaterThanOrEqual(7_200_000);
    expect(result.path).toBeNull();
  });
});

describe("A-01-TC-NF-03 waiting_human_hours (SC-006)", () => {
  it("records the hours spent waiting for a human in the run record and the rewritten catalog", async () => {
    const h = harness({ tcadBlocked: true }, [
      { source_key: "tcad_certified", outcome: "still-blocked" },
      { source_key: "tcad_supplemental", outcome: "still-blocked" },
    ]);
    const record = await h.run();
    // two resolutions, each answered two hours after the wait began
    expect(record.waiting_human_hours).toBeCloseTo(4, 6);
    expect(must(h.catalogs[0]).waiting_human_hours).toBe(0);
    expect(must(h.catalogs.at(-1)).waiting_human_hours).toBeCloseTo(4, 6);
  });
});

describe("READY never starts seed (FR-006d; kit default overridden)", () => {
  it("all sources reachable: READY, no wait, no auto-advance, no client call to another service", async () => {
    const h = harness({});
    const record = await h.run();
    expect(record.state).toBe("READY");
    expect(record.auto_advance_to_seed).toBe(false);
    expect(h.awaited).toEqual([]);
    expect(record.waiting_human_hours).toBe(0);
    const path = fileURLToPath(new URL("../travis/discovery/workflow.ts", import.meta.url));
    const src = readFileSync(path, "utf8");
    expect(src).not.toMatch(/serviceClient|objectClient|workflowClient|SendClient|genericSend/);
  });
});
