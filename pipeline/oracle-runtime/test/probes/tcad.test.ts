// T017 TCAD probe tests. Synthetic exports only (test-only): an injected fetch serves a
// tiny invented landing page and export; traviscad.org is never called. Downloads go to
// a temporary folder except where the default folder itself is under test.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createSourceClient, type FetchLike } from "../../travis/lib/source-client.js";
import {
  INACTIVITY_LIMIT_MS,
  ROLL_YEAR,
  TCAD_PUBLIC_INFO_URL,
  TCAD_RAW_DIR,
  TOTAL_LIMIT_MS,
  findTcadLinks,
  probeTcad,
  scanExport,
  tcadExportPath,
} from "../../travis/discovery/probes/tcad.js";
import { fakeHttp, silent, text, type Route } from "../fixtures/fake-http.js";
import { buildZip } from "../fixtures/synthetic-zip.js";
import { must } from "../helpers.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");
const BASE = "https://traviscad.test";

const LANDING = `<!doctype html><html><body>
<h2>Downloads</h2>
<p>The 2026 appraisal roll was certified on July 25, 2026.</p>
<a href="/files/2025-certified-special-export.json">2025 Certified Special Export (JSON)</a>
<a href="/files/2026-certified-special-export.json">2026 Certified Special Export (JSON)</a>
<a href="${BASE}/files/2026-certified-appraisal-export.zip">2026 Certified Appraisal Export (July)</a>
<a href="/files/export-layouts.zip">Export Layouts</a>
<a href="/files/2026-supplemental-01.zip">2026 Supplemental Appraisal Roll Export 01</a>
<a href="/files/2026-supplemental-02.zip">2026 Supplemental Appraisal Roll Export 02</a>
</body></html>`;

const RECORDS = [
  { prop_id: 101, geo_id: "0100000101", deed_date: "", owner: { name: "SYNTHETIC A" } },
  { prop_id: 102, geo_id: "0100000102", deed_date: "2019-03-04", owner: { name: "SYNTHETIC B" } },
  { prop_id: 103, geo_id: "0100000103", deed_date: null, situs: "1 SYNTHETIC ST" },
];
const EXPORT_JSON = JSON.stringify(RECORDS);

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "tcad-probe-test-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function client(fetch: FetchLike) {
  return createSourceClient({
    fetch,
    sleep: async () => undefined,
    random: () => 0,
    now: () => FIXED,
    log: silent,
  });
}

function routes(exportBody: Buffer | string = EXPORT_JSON): Route[] {
  return [
    {
      match: (u) => u.pathname === "/publicinformation",
      respond: () => text(LANDING),
    },
    {
      match: (u) => u.pathname === "/files/export-layouts.zip",
      respond: () =>
        new Response(new Uint8Array(buildZip([{ name: "layout.txt", data: Buffer.from("x") }])), {
          headers: { "content-type": "application/zip" },
        }),
    },
    {
      match: (u) => u.pathname === "/files/2026-certified-special-export.json",
      respond: () =>
        new Response(typeof exportBody === "string" ? exportBody : new Uint8Array(exportBody), {
          headers: { "content-type": "application/octet-stream" },
        }),
    },
  ];
}

describe("constants", () => {
  it("names the real landing page, roll year and FR-003 limits", () => {
    expect(TCAD_PUBLIC_INFO_URL).toBe("https://traviscad.org/publicinformation");
    expect(ROLL_YEAR).toBe(2026);
    expect(INACTIVITY_LIMIT_MS).toBe(10 * 60 * 1000);
    expect(TOTAL_LIMIT_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("the default download folder is pipeline/data/raw/tcad/ (gitignored)", () => {
    expect(TCAD_RAW_DIR.endsWith(["pipeline", "data", "raw", "tcad"].join(sep))).toBe(true);
    const path = tcadExportPath(`${BASE}/files/2026-certified-special-export.json`);
    expect(path.startsWith(TCAD_RAW_DIR + sep)).toBe(true);
    expect(path.endsWith("2026-certified-special-export.json")).toBe(true);
  });
});

describe("findTcadLinks", () => {
  it("picks the 2026 certified special export, the layouts, supplementals and the certification date", () => {
    const links = findTcadLinks(LANDING, `${BASE}/publicinformation`);
    expect(links.certified_special_export).toBe(`${BASE}/files/2026-certified-special-export.json`);
    expect(links.export_layouts).toBe(`${BASE}/files/export-layouts.zip`);
    expect(links.supplemental.map((s) => s.url)).toEqual([
      `${BASE}/files/2026-supplemental-01.zip`,
      `${BASE}/files/2026-supplemental-02.zip`,
    ]);
    expect(links.certification_date).toBe("2026-07-25");
  });

  it("returns nulls when the page lists no such links", () => {
    const links = findTcadLinks("<html><body>nothing</body></html>", `${BASE}/`);
    expect(links).toEqual({
      certified_special_export: null,
      export_layouts: null,
      supplemental: [],
      certification_date: null,
    });
  });
});

describe("scanExport (streaming)", () => {
  it("counts records, lists fields, prints the key exactly and detects deed/sale dates", async () => {
    const dir = tmp();
    const path = join(dir, "export.json");
    writeFileSync(path, EXPORT_JSON);
    const scan = await scanExport(path);
    expect(scan.count).toBe(3);
    expect(scan.record_path).toBe("");
    expect(scan.fields).toEqual(
      expect.arrayContaining(["prop_id", "geo_id", "deed_date", "owner", "owner.name", "situs"]),
    );
    expect(scan.identifier_name).toBe("prop_id");
    expect(scan.identifier_proven).toBe(true);
    expect(scan.identifier_format).toMatch(/integer/);
    expect(scan.deed_or_sale_dates_present).toBe(true);
  });

  it("keeps the identifier exactly as printed (upper case) and reports duplicates as unproven", async () => {
    const dir = tmp();
    const path = join(dir, "export.json");
    writeFileSync(path, JSON.stringify([{ PROP_ID: "7" }, { PROP_ID: "7" }, { PROP_ID: "8" }]));
    const scan = await scanExport(path);
    expect(scan.identifier_name).toBe("PROP_ID");
    expect(scan.identifier_proven).toBe(false);
    expect(scan.deed_or_sale_dates_present).toBe(false);
  });

  it("finds the record array under a top-level key and honours an explicit record path", async () => {
    const dir = tmp();
    const path = join(dir, "export.json");
    writeFileSync(path, JSON.stringify({ meta: { year: 2026 }, properties: RECORDS }));
    expect((await scanExport(path)).record_path).toBe("properties");
    expect((await scanExport(path)).count).toBe(3);
    expect((await scanExport(path, { recordPath: "properties" })).count).toBe(3);
  });

  it("reads a JSON entry inside a ZIP export", async () => {
    const dir = tmp();
    const path = join(dir, "export.zip");
    writeFileSync(
      path,
      buildZip([
        { name: "readme.txt", data: Buffer.from("synthetic"), deflate: false },
        { name: "export.json", data: Buffer.from(EXPORT_JSON) },
      ]),
    );
    const scan = await scanExport(path);
    expect(scan.zip_entry).toBe("export.json");
    expect(scan.count).toBe(3);
  });

  it("counts a larger synthetic export without loading the whole file", async () => {
    const dir = tmp();
    const path = join(dir, "big.json");
    const n = 20_000;
    writeFileSync(
      path,
      `[${Array.from({ length: n }, (_, i) => JSON.stringify({ prop_id: i + 1 })).join(",")}]`,
    );
    expect((await scanExport(path)).count).toBe(n);
    const source = readFileSync(
      fileURLToPath(new URL("../../travis/discovery/probes/tcad.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/readFileSync|readFile\(|JSON\.parse\(\s*await/);
  });
});

describe("probeTcad", () => {
  it("downloads once, records bytes, SHA-256, download rate, roll year and certification date", async () => {
    const dir = tmp();
    const { fetch, calls } = fakeHttp(routes());
    const result = await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
    });
    expect(result.status).toBe("available");
    const exportCalls = calls.filter((c) => c.url.endsWith("2026-certified-special-export.json"));
    expect(exportCalls).toHaveLength(1);

    const receipt = must(result.export_receipt);
    expect(receipt.bytes).toBe(Buffer.byteLength(EXPORT_JSON));
    expect(receipt.sha256).toBe(createHash("sha256").update(EXPORT_JSON).digest("hex"));
    expect(receipt.outcome).toBe("ok");
    expect(must(result.download_rate).bytes).toBe(Buffer.byteLength(EXPORT_JSON));
    expect(must(result.download_rate).megabytes_per_minute).toBeGreaterThanOrEqual(0);

    const path = must(result.export_path);
    expect(path.startsWith(dir + sep)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(EXPORT_JSON);

    expect(result.roll_year).toBe(2026);
    expect(result.certification_date).toBe("2026-07-25");
    expect(result.assessed_parcel_count).toMatchObject({
      value: 3,
      source_url: `${BASE}/files/2026-certified-special-export.json`,
      method: "streaming count",
    });
    expect(must(result.scan).identifier_name).toBe("prop_id");
    expect(must(result.layouts_receipt).outcome).toBe("ok");
    expect(result.links?.supplemental).toHaveLength(2);
  });

  it("HTTP 403 on the landing page: blocked, one attempt, null roll count with a reason", async () => {
    const dir = tmp();
    const { fetch, calls } = fakeHttp([
      { match: () => true, respond: () => text("Forbidden", 403) },
    ]);
    const result = await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
    });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe("blocked");
    expect(must(result.blocked_receipt)).toMatchObject({ status: 403, attempts: 1 });
    expect(result.assessed_parcel_count.value).toBeNull();
    expect(result.assessed_parcel_count.missing_reason).toMatch(/403/);
    expect(result.export_path).toBeNull();
  });

  it("a stalled download (no data within the inactivity limit) is blocked with timeout_ms", async () => {
    const dir = tmp();
    const stalled: Route = {
      match: (u) => u.pathname === "/files/2026-certified-special-export.json",
      respond: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("[{"));
              // then nothing: the server stalls
            },
          }),
          { headers: { "content-type": "application/octet-stream" } },
        ),
    };
    const { fetch, calls } = fakeHttp([stalled, ...routes()]);
    const result = await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
      limits: { inactivityMs: 40, totalMs: 5_000 },
    });
    expect(result.status).toBe("blocked");
    const receipt = must(result.blocked_receipt);
    expect(receipt.outcome).toBe("blocked");
    expect(receipt.blocked_reason).toBe("timeout");
    expect(must(receipt.timeout_ms)).toBeGreaterThanOrEqual(40);
    expect(calls.filter((c) => c.url.endsWith("special-export.json"))).toHaveLength(1);
    expect(result.export_path).toBeNull();
    expect(existsSync(join(dir, "2026-certified-special-export.json"))).toBe(false);
    expect(result.assessed_parcel_count.missing_reason).toMatch(/timeout/);
  });

  it("a download that keeps trickling past the total limit is blocked with timeout_ms", async () => {
    const dir = tmp();
    let timer: ReturnType<typeof setInterval> | undefined;
    const trickle: Route = {
      match: (u) => u.pathname === "/files/2026-certified-special-export.json",
      respond: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              timer = setInterval(() => controller.enqueue(new TextEncoder().encode(" ")), 5);
            },
            cancel() {
              clearInterval(timer);
            },
          }),
          { headers: { "content-type": "application/octet-stream" } },
        ),
    };
    const { fetch } = fakeHttp([trickle, ...routes()]);
    const result = await probeTcad({
      client: client(fetch),
      now: () => FIXED,
      rawDir: dir,
      landingUrl: `${BASE}/publicinformation`,
      limits: { inactivityMs: 1_000, totalMs: 60 },
    });
    clearInterval(timer);
    expect(result.status).toBe("blocked");
    expect(must(must(result.blocked_receipt).timeout_ms)).toBeGreaterThanOrEqual(60);
  });
});
