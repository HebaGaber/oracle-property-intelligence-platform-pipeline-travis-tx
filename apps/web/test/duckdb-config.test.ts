// A-03 T053 (G-C4): the browser engine's configuration, without instantiating DuckDB-WASM
// (jsdom; no network). ADR-0001 Findings 1–2 and decision 4: the engine is opened with exactly
// `{ allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false }` (else
// every file is downloaded whole), the eh bundle is self-hosted and lazy-loaded, and the WASM is
// served Brotli-compressed under its own file name (T057, TC-028). The loader wiring is checked
// with fakes: the host that served the manifest is the host `partUrl` binds for the parts.
// Red run (before T054/T057): `Cannot find module '../src/engine/duckdb-wasm'`.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { PERMITS_TEXTS, readPathUrls } from "@countylens/shared";
import type { QueryEngine, Row } from "@countylens/query-core";
import {
  DUCKDB_FILESYSTEM_FLAGS,
  DUCKDB_OPEN_CONFIG,
  SELF_HOSTED_BUNDLE,
  arrowToRows,
  openEngine,
  type ArrowTableLike,
  type AsyncDuckDbLike,
  type DuckDbOpenConfig,
  type DuckDbRuntime,
} from "../src/engine/duckdb-wasm";
import type { FetchByCidOptions } from "../src/data/fetch-by-cid";
import { EngineStartError } from "../src/engine/errors";
import { createPermitsLoader, type EngineModule } from "../src/engine/load-permits";
import { STAGE_TEXTS } from "../src/routes/Permits.page";
import { WASM_FILE_PATTERN, compressWasm } from "../scripts/compress-wasm";

const RANGE_READ_FLAGS = {
  allowFullHTTPReads: true,
  forceFullHTTPReads: false,
  reliableHeadRequests: false,
};

interface FakeDb extends AsyncDuckDbLike {
  readonly calls: string[];
  readonly openConfigs: DuckDbOpenConfig[];
  readonly statements: string[];
}

function fakeDb(options: { failInstantiate?: boolean } = {}): FakeDb {
  const calls: string[] = [];
  const openConfigs: DuckDbOpenConfig[] = [];
  const statements: string[] = [];
  const emptyTable: ArrowTableLike = { schema: { fields: [] }, toArray: () => [] };
  return {
    calls,
    openConfigs,
    statements,
    async instantiate(mainModule: string) {
      calls.push(`instantiate:${mainModule}`);
      if (options.failInstantiate) throw new Error("WebAssembly.instantiate failed (fake)");
    },
    async open(config: DuckDbOpenConfig) {
      calls.push("open");
      openConfigs.push(config);
    },
    async connect() {
      calls.push("connect");
      return {
        async query(sql: string) {
          statements.push(sql);
          return emptyTable;
        },
        async close() {
          calls.push("connection.close");
        },
      };
    },
    async terminate() {
      calls.push("terminate");
    },
  };
}

function fakeRuntime(db: FakeDb): DuckDbRuntime {
  return {
    bundle: {
      mainModule: "/assets/duckdb-eh-test.wasm",
      mainWorker: "/assets/duckdb-browser-eh.worker-test.js",
      pthreadWorker: null,
    },
    createDb: (workerUrl) => {
      db.calls.push(`createDb:${workerUrl}`);
      return db;
    },
  };
}

describe("DuckDB-WASM open flags (ADR-0001 Finding 1, decision 4)", () => {
  it("names exactly the three range-read flags", () => {
    expect(DUCKDB_FILESYSTEM_FLAGS).toStrictEqual(RANGE_READ_FLAGS);
    expect(DUCKDB_OPEN_CONFIG).toStrictEqual({ filesystem: RANGE_READ_FLAGS });
  });

  it("instantiates the eh bundle, then opens the database with those flags, then connects", async () => {
    const db = fakeDb();
    const engine = await openEngine(() => Promise.resolve(fakeRuntime(db)));
    expect(db.openConfigs).toHaveLength(1);
    expect(db.openConfigs[0]).toStrictEqual({ filesystem: RANGE_READ_FLAGS });
    expect(db.calls.slice(0, 4)).toEqual([
      "createDb:/assets/duckdb-browser-eh.worker-test.js",
      "instantiate:/assets/duckdb-eh-test.wasm",
      "open",
      "connect",
    ]);
    // builders.ts: the engine's TimeZone must be UTC so as_of is the manifest's UTC date.
    expect(db.statements).toContain("SET TimeZone = 'UTC'");
    await engine.close();
    expect(db.calls).toContain("terminate");
  });

  it("reports an engine that cannot start with the fixed text, keeping the cause", async () => {
    const db = fakeDb({ failInstantiate: true });
    const failure = openEngine(() => Promise.resolve(fakeRuntime(db)));
    await expect(failure).rejects.toBeInstanceOf(EngineStartError);
    await expect(failure).rejects.toMatchObject({ message: PERMITS_TEXTS.engineFailure });
    await expect(failure).rejects.toHaveProperty("cause");
    expect(db.openConfigs).toHaveLength(0);
  });

  it("self-hosts the eh bundle (no CDN): the WASM and its worker by their dist file names", () => {
    expect(SELF_HOSTED_BUNDLE).toStrictEqual({
      mainModule: "duckdb-eh.wasm",
      mainWorker: "duckdb-browser-eh.worker.js",
    });
  });
});

describe("arrowToRows: JSON-shaped values (QueryEngine contract)", () => {
  // Arrow `Type` ids from the IPC format: Int 2, Utf8 5, Date 8, Timestamp 10, List 12, Struct 13.
  const table: ArrowTableLike = {
    schema: {
      fields: [
        { name: "permit_number", type: { typeId: 5 } },
        { name: "issue_date", type: { typeId: 8 } },
        { name: "captured_at", type: { typeId: 10, unit: 2 } },
        { name: "open_days", type: { typeId: 2 } },
        { name: "missing", type: { typeId: 12 } },
        { name: "as_of", type: { typeId: 10, unit: 1 } },
      ],
    },
    toArray: () => [
      {
        toJSON: () => ({
          permit_number: "TEST-0001",
          issue_date: Date.UTC(2026, 8, 3),
          captured_at: 1_792_000_000_000,
          open_days: 12n,
          missing: {
            toArray: () => [
              { toJSON: () => ({ field: "status_raw", reason: "no_lexicon_carrier" }) },
            ],
          },
          as_of: new Date("2026-10-01T00:00:00.000Z"),
        }),
      },
      {
        toJSON: () => ({
          permit_number: null,
          issue_date: null,
          captured_at: 1_792_000_000_000n,
          open_days: null,
          missing: { toArray: () => [] },
          as_of: 1_790_000_000_000,
        }),
      },
    ],
  };

  it("turns dates into YYYY-MM-DD, timestamps into ISO 8601 UTC, bigints into numbers and nested vectors into plain values", () => {
    const rows = arrowToRows(table);
    expect(rows).toEqual([
      {
        permit_number: "TEST-0001",
        issue_date: "2026-09-03",
        captured_at: new Date(1_792_000_000_000).toISOString(),
        open_days: 12,
        missing: [{ field: "status_raw", reason: "no_lexicon_carrier" }],
        as_of: "2026-10-01T00:00:00.000Z",
      },
      {
        permit_number: null,
        issue_date: null,
        captured_at: new Date(1_792_000_000_000).toISOString(),
        open_days: null,
        missing: [],
        as_of: new Date(1_790_000_000_000).toISOString(),
      },
    ]);
  });
});

/** A syntactically valid, obviously synthetic base32 CIDv1 (contract `isCidV1`). */
const cid = (tag: string): string => `bafkrei${tag}`.padEnd(59, "a");

describe("createPermitsLoader: index → manifest → engine → bind → list (partUrl wiring)", () => {
  const manifestCid = cid("manifest");
  const partCid = cid("part");
  const bytes = new TextEncoder().encode("{}");
  const urls = readPathUrls({
    cidCopyHost: "copy.test",
    filebaseGatewayHost: "gateway.test",
  });
  const index: RunsIndexV1 = {
    schema: "oracle-travis-runs-index.v1",
    runs: [{ runId: "test-run", manifestCid, finishedAt: "2026-10-01T00:00:00Z" }],
  };
  const partUrl = (artifact: { name: string; cid: string }): string =>
    `https://served.test/${artifact.cid}`;

  function deps(coverageCount: number | undefined) {
    const coverage: RunManifestV1["coverage"] =
      coverageCount === undefined
        ? {}
        : { permits_emitted: { count: coverageCount, derivation: "published_rows" } };
    const manifest = { runId: "test-run", coverage } as unknown as RunManifestV1;
    const engine: QueryEngine & { closed: boolean; close(): Promise<void> } = {
      closed: false,
      run: async () => undefined,
      all: async () => [],
      close: async () => {
        engine.closed = true;
      },
    };
    const rows: Row[] = [{ permit_number: "TEST-0001" }];
    const engineModule: EngineModule = {
      openEngine: vi.fn(async () => engine),
      bindRun: vi.fn(async () => ({
        runId: "test-run",
        manifestCid,
        asOf: "2026-10-01T00:00:00Z",
        tables: [],
      })),
      listPermits: vi.fn(async () => rows as never),
    };
    const loadManifest = vi.fn(async (_cid: string, _options: FetchByCidOptions) => ({
      manifest,
      manifestCid,
      read: {
        cid: manifestCid,
        bytes,
        source: { kind: "fallback" as const, host: "gateway.test" },
        partUrl,
      },
    }));
    return {
      engine,
      rows,
      engineModule,
      loadManifest,
      loader: createPermitsLoader({
        loadRunsIndex: vi.fn(async () => index),
        latestRun: (i: RunsIndexV1) => i.runs[0] as RunsIndexV1["runs"][number],
        loadManifest,
        fallbackLabel: (source) =>
          source.kind === "fallback" ? `fallback · ${source.host}` : null,
        urls,
        engine: () => Promise.resolve(engineModule),
      }),
    };
  }

  it("binds the parts with the partUrl of the read that served the manifest and reports the stages in order", async () => {
    const d = deps(1);
    const stages: string[] = [];
    const loaded = await d.loader((stage) => stages.push(stage), new AbortController().signal);

    expect(d.loadManifest).toHaveBeenCalledTimes(1);
    expect(d.loadManifest.mock.calls[0]?.[0]).toBe(manifestCid);
    expect(d.loadManifest.mock.calls[0]?.[1]).toMatchObject({ urls });
    expect(d.engineModule.bindRun).toHaveBeenCalledTimes(1);
    const bindCall = vi.mocked(d.engineModule.bindRun).mock.calls[0];
    expect(bindCall).toBeDefined();
    const [engineArg, bytesArg, partUrlArg] = bindCall as NonNullable<typeof bindCall>;
    expect(engineArg).toBe(d.engine);
    expect(bytesArg).toBe(bytes);
    expect(partUrlArg).toBe(partUrl);
    expect(partUrlArg({ name: "tables/county/property/part-00000.parquet", cid: partCid })).toBe(
      `https://served.test/${partCid}`,
    );
    expect(stages).toEqual([
      STAGE_TEXTS.engine,
      STAGE_TEXTS.manifest,
      STAGE_TEXTS.bind,
      STAGE_TEXTS.query,
    ]);
    expect(loaded).toEqual({
      runId: "test-run",
      manifestCid,
      permitsEmitted: 1,
      rows: d.rows,
      fallbackLabel: "fallback · gateway.test",
    });
    expect(d.engine.closed, "the engine is released after the single-page list").toBe(true);
  });

  it("refuses a manifest without coverage.permits_emitted (FR-009: counts only from the manifest)", async () => {
    const d = deps(undefined);
    await expect(d.loader(() => undefined, new AbortController().signal)).rejects.toThrow(
      /coverage\.permits_emitted/,
    );
  });
});

describe("compress-wasm (T057, TC-028): Brotli level 11 of duckdb-eh.wasm, file name kept", () => {
  const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  function dist(): { dir: string; wasm: string; other: string; original: Buffer } {
    const dir = mkdtempSync(join(tmpdir(), "countylens-wasm-"));
    mkdirSync(join(dir, "assets"));
    const body = Buffer.alloc(64 * 1024);
    for (let i = 0; i < body.length; i += 1) body[i] = (i * 7919) % 251;
    const original = Buffer.concat([Buffer.from(WASM_MAGIC), body]);
    const wasm = join(dir, "assets", "duckdb-eh-Ab12cD3e.wasm");
    const other = join(dir, "assets", "other-module-Xy9.wasm");
    writeFileSync(wasm, original);
    writeFileSync(other, original);
    return { dir, wasm, other, original };
  }

  it("matches the hashed Vite asset name of the eh bundle only", () => {
    expect(WASM_FILE_PATTERN.test("duckdb-eh.wasm")).toBe(true);
    expect(WASM_FILE_PATTERN.test("duckdb-eh-Ab12cD3e.wasm")).toBe(true);
    expect(WASM_FILE_PATTERN.test("duckdb-mvp.wasm")).toBe(false);
    expect(WASM_FILE_PATTERN.test("duckdb-browser-eh.worker.js")).toBe(false);
  });

  it("writes Brotli bytes over the same path, decompressing to the original, and skips other files", () => {
    const { dir, wasm, other, original } = dist();
    const report = compressWasm(dir, { quality: 11 });
    expect(report.files.map((f) => f.path)).toEqual([wasm]);
    const compressed = readFileSync(wasm);
    expect(compressed.subarray(0, 4).equals(Buffer.from(WASM_MAGIC.slice(0, 4)))).toBe(false);
    expect(brotliDecompressSync(compressed).equals(original)).toBe(true);
    expect(report.files[0]).toMatchObject({
      bytes: original.length,
      compressedBytes: compressed.length,
    });
    expect(readFileSync(other).equals(original), "non-eh wasm untouched").toBe(true);
  });

  it("is idempotent: a second run leaves an already compressed file alone", () => {
    const { dir, wasm, original } = dist();
    compressWasm(dir, { quality: 11 });
    const once = readFileSync(wasm);
    const report = compressWasm(dir, { quality: 11 });
    expect(report.files[0]).toMatchObject({ path: wasm, skipped: true });
    expect(readFileSync(wasm).equals(once)).toBe(true);
    expect(brotliDecompressSync(readFileSync(wasm)).equals(original)).toBe(true);
  });
});
