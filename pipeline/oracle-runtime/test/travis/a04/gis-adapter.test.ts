// A-04 T041: the GIS runner fetch through the vendored kit ArcGIS adapter with the injected
// geometry client. Offline: an in-process fake layer (SYNTHETIC TEST INPUT) replaces fetch;
// waits are recorded, never slept; the RNG is seeded. Never points at gis.traviscountytx.gov.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSourceClient } from "../../../travis/lib/source-client.js";
import {
  createGeometryClient,
  sha256Hex,
  type ArtifactWriter,
  type GisReceipt,
} from "../../../travis/gis/geometry-client.js";
import { RunnerConfig, runGisCapture } from "../../../travis/gis/runner-fetch.js";
import {
  FAKE_LAYER,
  OWNER_SENTINEL,
  fakeArcgis,
  seeded,
  type FakeOptions,
} from "../../fixtures/a04/gis/fake-arcgis.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "a04-gis-"));
  dirs.push(d);
  return d;
};

const config = (over: Partial<Record<string, unknown>> = {}) =>
  RunnerConfig.parse({
    mode: "full",
    layerUrl: FAKE_LAYER,
    outFields: ["OBJECTID", "PROP_ID", "GEO_ID"],
    pidField: "PROP_ID",
    geoidField: "GEO_ID",
    bulkPageSize: 2,
    bulkConcurrency: 1,
    userAgent:
      "oracle-travis-discovery/0.1 (PrismTeam Oracle Travis County pipeline; +https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx)",
    ...over,
  });

let clock = Date.parse("2026-10-22T03:00:00Z");
const now = (): Date => new Date((clock += 1000));

async function run(fake: FakeOptions, cfg = config(), out = tmp()) {
  const server = fakeArcgis(fake);
  const waits: number[] = [];
  const source = createSourceClient({
    fetch: server.fetch,
    sleep: async () => {},
    timeoutMs: 15,
    log: () => {},
  });
  const result = await runGisCapture({
    config: cfg,
    outDir: out,
    source,
    sleep: async (ms) => {
      waits.push(ms);
    },
    random: seeded(42),
    now,
  });
  const receipts = existsSync(join(out, "receipts.jsonl"))
    ? readFileSync(join(out, "receipts.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as GisReceipt)
    : [];
  return { server, waits, result, out, receipts };
}

const pageRequests = (events: ReturnType<typeof fakeArcgis>["events"]) =>
  events.filter((e) => e.type === "start" && e.kind === "page");

describe("A-04 T041 GIS runner fetch (gis-adapter)", () => {
  it("A-04-TC-026 timeout → 5 attempts, waits [0,1s] [0,2s] [0,4s] [0,8s] full jitter, then blocked; no complete.json", async () => {
    const { server, waits, result, out, receipts } = await run({
      total: 10,
      page: (n) => (n === 3 ? "timeout" : undefined),
    });
    expect(result.status).toBe("blocked");
    expect(result.exitCode).toBe(2);
    expect(server.pageAttempts.get(3)).toBe(5);
    expect(waits).toHaveLength(4);
    waits.forEach((w, i) => {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1000 * 2 ** i);
    });
    expect(waits.every((w, i) => w === 1000 * 2 ** i)).toBe(false);
    const blocked = JSON.parse(readFileSync(join(out, "blocked.json"), "utf8"));
    expect(blocked).toMatchObject({ outcome: "blocked", reason: "gave_up" });
    expect(blocked.blocked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    const stop = receipts.find((r) => r.outcome === "blocked");
    expect(stop?.blocked_at).toBe(blocked.blocked_at);
    expect(stop?.attempts).toBe(5);
    expect(existsSync(join(out, "complete.json"))).toBe(false);
    // pages 1–2 kept, with checkpoints
    expect(readdirSync(join(out, "pages"))).toHaveLength(2);
    expect(readdirSync(join(out, "checkpoints"))).toHaveLength(2);
  });

  it("A-04-TC-026 a 403 on page 3 → exactly one request to it, no retry, no further request", async () => {
    const { server, waits, result, out } = await run(
      { total: 12, page: (n) => (n === 3 ? 403 : undefined), latencyMs: 2 },
      config({ bulkConcurrency: 2 }),
    );
    expect(result.status).toBe("blocked");
    expect(server.pageAttempts.get(3)).toBe(1);
    expect(waits).toEqual([]);
    const at403 = server.events.findIndex((e) => e.type === "end" && e.status === 403);
    expect(at403).toBeGreaterThan(-1);
    expect(server.events.slice(at403 + 1).filter((e) => e.type === "start")).toEqual([]);
    expect(JSON.parse(readFileSync(join(out, "blocked.json"), "utf8"))).toMatchObject({
      outcome: "blocked",
      reason: "http_403",
      http_status: 403,
    });
    expect(existsSync(join(out, "complete.json"))).toBe(false);
  });

  it("A-04-TC-027 restart: checkpointed pages are skipped, the first page request is page 5, none twice or missing", async () => {
    const out = tmp();
    const first = await run({ total: 20, page: (n) => (n === 5 ? 500 : undefined) }, config(), out);
    expect(first.result.status).toBe("blocked");
    expect(readdirSync(join(out, "checkpoints"))).toHaveLength(4);

    const second = await run({ total: 20 }, config(), out);
    expect(second.result.status).toBe("complete");
    const pages = pageRequests(second.server.events);
    expect(new URL(pages[0]?.url ?? "").searchParams.get("objectIds")).toBe("9,10");
    expect(pages).toHaveLength(6);
    const skipped = second.receipts.filter((r) => r.outcome === "skipped_checkpoint");
    expect(skipped).toHaveLength(4);
    // the union of page ids = the snapshot ids, none twice
    const ids = readdirSync(join(out, "pages")).flatMap((f) =>
      (
        JSON.parse(readFileSync(join(out, "pages", f), "utf8")).features as Array<{
          attributes: { OBJECTID: number };
        }>
      ).map((x) => x.attributes.OBJECTID),
    );
    expect(ids.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const complete = JSON.parse(readFileSync(join(out, "complete.json"), "utf8"));
    expect(complete).toMatchObject({ mode: "full", pages: 10, features: 20 });
    expect(complete.snapshot_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("A-04-TC-027 a checkpoint whose snapshot digest differs is not trusted: that page is fetched again", async () => {
    const out = tmp();
    await run({ total: 8, page: (n) => (n === 4 ? 500 : undefined) }, config(), out);
    const cps = readdirSync(join(out, "checkpoints"));
    const victim = join(out, "checkpoints", cps[0] ?? "");
    const cp = JSON.parse(readFileSync(victim, "utf8"));
    writeFileSync(victim, JSON.stringify({ ...cp, snapshotSha256: "0".repeat(64) }));
    const again = await run({ total: 8 }, config(), out);
    expect(again.result.status).toBe("complete");
    expect(pageRequests(again.server.events)).toHaveLength(2);
    expect(again.receipts.filter((r) => r.outcome === "skipped_checkpoint")).toHaveLength(2);
  });

  it("A-04-TC-028 400 pages: ≤ maxRecordCount ids per page, ≤ 2 in flight (bulkConcurrency 5 clamped), geometry only on page queries", async () => {
    const { server, result, out } = await run(
      { total: 2000, maxRecordCount: 5, latencyMs: 1 },
      config({ bulkPageSize: 2000, bulkConcurrency: 5 }),
    );
    expect(result.status).toBe("complete");
    expect(server.pageSizeSeen).toHaveLength(400);
    expect(Math.max(...server.pageSizeSeen)).toBe(5);
    expect(server.maxInFlightPages()).toBe(2);
    for (const e of server.events.filter((x) => x.type === "start")) {
      const p = new URL(e.url).searchParams;
      if (e.kind === "page") {
        expect(p.get("returnGeometry")).toBe("true");
        expect(p.get("outSR")).toBe("4326");
        expect(p.get("geometryPrecision")).toBe("7");
        expect(p.get("outFields")).toBe("OBJECTID,PROP_ID,GEO_ID");
      } else if (e.kind === "count" || e.kind === "ids") {
        expect(p.get("returnGeometry")).toBe("false");
        expect(p.get("outSR")).toBeNull();
        expect(p.get("geometryPrecision")).toBeNull();
        expect(p.get("outFields")).toBe("");
      }
    }
    // the artifact holds IDs and geometry only, never an owner or address column
    const one = readFileSync(join(out, "pages", readdirSync(join(out, "pages"))[0] ?? ""), "utf8");
    expect(one).not.toContain(OWNER_SENTINEL);
    expect(one).not.toContain("SITUS_ADDR");
  });

  it("A-04-TC-028 page size is capped at 2,000 even when maxRecordCount is higher", async () => {
    const { server, result } = await run(
      { total: 4500, maxRecordCount: 3000 },
      config({ bulkPageSize: 2000, bulkConcurrency: 2 }),
    );
    expect(result.status).toBe("complete");
    expect(server.pageSizeSeen.sort((a, b) => b - a)).toEqual([2000, 2000, 500]);
  });

  it("raw body and receipt are written before json() returns", async () => {
    const files = new Map<string, Buffer>();
    const receipts: GisReceipt[] = [];
    const writer: ArtifactWriter = {
      write: (p, b) => void files.set(p, Buffer.from(b)),
      read: (p) => files.get(p) ?? null,
      appendReceipt: (r) => void receipts.push(r),
    };
    const server = fakeArcgis({ total: 4 });
    const client = createGeometryClient({
      source: createSourceClient({ fetch: server.fetch, log: () => {} }),
      out: writer,
      outFields: ["OBJECTID"],
      pageKeyOf: (ids) => sha256Hex(ids.join(",")),
      sleep: async () => {},
    });
    const url = `${FAKE_LAYER}/query?f=json&outFields=*&returnGeometry=false&objectIds=1,2&where=1%3D1`;
    await client.json(url);
    const key = sha256Hex("1,2");
    const body = files.get(`pages/${key}.json`);
    expect(body).toBeDefined();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      outcome: "ok",
      page_key: key,
      http_status: 200,
      kind: "page",
    });
    expect(receipts[0]?.sha256).toBe(sha256Hex(body ?? ""));
    expect(receipts[0]?.ua).toMatch(/^oracle-travis-discovery\//);
  });

  it("the kit's drift refusal (arcgis_source_drift) surfaces as a failure, never complete", async () => {
    const { result, out } = await run({ total: 6, endTotal: 7 });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(readFileSync(join(out, "failed.json"), "utf8"))).toMatchObject({
      outcome: "failed",
      code: "arcgis_source_drift",
    });
    expect(existsSync(join(out, "complete.json"))).toBe(false);
  });

  it("pilot mode: layer metadata, count, ids and exactly one page; no complete.json", async () => {
    const { server, result, out } = await run({ total: 10 }, config({ mode: "pilot" }));
    expect(result.status).toBe("pilot");
    expect(result.exitCode).toBe(0);
    expect(
      server.events
        .filter((e) => e.type === "start")
        .map((e) => e.kind)
        .sort(),
    ).toEqual(["count", "ids", "meta", "page"]);
    for (const f of ["meta.json", "count.json", "ids.json", "pilot.json", "config.json"]) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
    expect(existsSync(join(out, "complete.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(out, "pilot.json"), "utf8"))).toMatchObject({
      mode: "pilot",
      pages: 1,
      features: 2,
      count: 10,
      object_id_field: "OBJECTID",
    });
  });

  it("an outField the layer does not have stops before any page request", async () => {
    const { server, result, out } = await run(
      { total: 4 },
      config({ outFields: ["OBJECTID", "PIN"], pidField: "PIN", geoidField: null }),
    );
    expect(result.status).toBe("failed");
    expect(pageRequests(server.events)).toEqual([]);
    expect(JSON.parse(readFileSync(join(out, "failed.json"), "utf8"))).toMatchObject({
      code: "out_field_not_in_layer",
    });
  });
});
