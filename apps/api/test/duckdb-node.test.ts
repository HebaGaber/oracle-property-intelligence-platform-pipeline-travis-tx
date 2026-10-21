// A-03 T072 (G-C2a): the real @duckdb/node-api adapter (src/engine/duckdb-instance.ts) over a
// tiny Parquet file built in-test, plus the engine module's extension-directory rule. Proves the
// settings ADR-0001 fixes (threads, TimeZone UTC, no remote autoinstall / autoload, extension
// directory, memory limit) and the JSON-shaped values the builders rely on. Nothing here reaches
// S3 or the network; the httpfs case runs only where a local DuckDB extension copy exists.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDuckDb, type DuckDbEngine } from "../src/engine/duckdb-instance.js";
import {
  BIND_TTL_MS,
  DUCKDB_THREADS,
  EXTENSION_DIRECTORY_ENV,
  EXTENSION_DIRECTORY_NAME,
  extensionDirectory,
} from "../src/engine/duckdb-node.js";
import { PRESIGN_EXPIRES_S } from "../src/s3-read.js";
import { rowSchema } from "@countylens/contract";
import { viewRowFixtures } from "../../../packages/contract/test/helpers/view-row-literals.js";

let dir: string;
let file: string;
let engine: DuckDbEngine;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "countylens-duckdb-"));
  engine = await openDuckDb({
    threads: DUCKDB_THREADS,
    memoryLimit: "256MiB",
    extensionDirectory: join(dir, "extensions"),
    tempDirectory: join(dir, "tmp"),
    httpfs: false,
  });
  file = join(dir, "t.parquet");
  await engine.run(
    `COPY (SELECT * FROM (VALUES
      (1::BIGINT, DATE '2026-10-20', TIMESTAMPTZ '2026-10-20 22:00:10.663+00', 'a'),
      (2::BIGINT, DATE '2026-10-21', TIMESTAMPTZ '2026-10-21 00:00:00+00', NULL)
    ) AS v(n, d, t, s)) TO '${file}' (FORMAT parquet)`,
  );
});

afterAll(() => {
  engine.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("openDuckDb (real @duckdb/node-api)", () => {
  it("applies threads = 2, TimeZone UTC, the extension directory, the memory limit and no remote autoinstall / autoload", async () => {
    const [settings] = await engine.all(`SELECT
      current_setting('threads') AS threads,
      current_setting('TimeZone') AS tz,
      current_setting('extension_directory') AS ext,
      current_setting('autoinstall_known_extensions') AS autoinstall,
      current_setting('autoload_known_extensions') AS autoload,
      current_setting('memory_limit') AS mem`);
    expect(settings).toMatchObject({ threads: 2, tz: "UTC", autoinstall: false, autoload: false });
    expect(String(settings?.["ext"])).toContain(join(dir, "extensions"));
    expect(String(settings?.["mem"])).toBe("256.0 MiB");
  });

  it("reads a Parquet file built in-test with JSON-shaped values (DATE → YYYY-MM-DD, TIMESTAMPTZ → ISO UTC, BIGINT → number, NULL → null)", async () => {
    const rows = await engine.all(`SELECT n, d, t, s FROM read_parquet('${file}') ORDER BY n`);
    expect(rows).toEqual([
      { n: 1, d: "2026-10-20", t: "2026-10-20T22:00:10.663Z", s: "a" },
      { n: 2, d: "2026-10-21", t: "2026-10-21T00:00:00.000Z", s: null },
    ]);
  });

  it("casts a manifest finishedAt to its UTC calendar date (the builders' as_of_date)", async () => {
    const rows = await engine.all(
      `SELECT CAST(CAST('2026-10-20T22:00:10.663Z' AS TIMESTAMPTZ) AS DATE) AS as_of_date`,
    );
    expect(rows).toEqual([{ as_of_date: "2026-10-20" }]);
  });

  const LOCAL_EXTENSIONS = join(homedir(), ".duckdb", "extensions");
  it.skipIf(!existsSync(LOCAL_EXTENSIONS))(
    "LOAD httpfs resolves from extension_directory alone (local extension copy, autoinstall off)",
    async () => {
      const withHttpfs = await openDuckDb({
        threads: DUCKDB_THREADS,
        memoryLimit: "256MiB",
        extensionDirectory: LOCAL_EXTENSIONS,
        tempDirectory: join(dir, "tmp"),
        httpfs: true,
      });
      try {
        const rows = await withHttpfs.all(
          `SELECT extension_name, loaded FROM duckdb_extensions() WHERE extension_name = 'httpfs'`,
        );
        expect(rows).toEqual([{ extension_name: "httpfs", loaded: true }]);
      } finally {
        withHttpfs.close();
      }
    },
  );
});

// ERR-10 (A-03): the Lambda's conversion over every column of every contract/v1 view on the real
// @duckdb/node-api (query.radius / query.roofAge return v_property rows; runs.summary reads
// v_run): lists and structs come back as plain arrays and objects, nested BIGINT as number, and
// each row passes the contract/v1 row schema. Same fixtures as apps/web/test/arrow-rows-real.test.ts.
describe("ERR-10: openDuckDb rows over every contract/v1 column (real @duckdb/node-api)", () => {
  for (const fixture of viewRowFixtures()) {
    it(`${fixture.view} (${fixture.name}): every column is JSON-shaped and passes the contract/v1 row schema`, async () => {
      const rows = await engine.all(fixture.sql);
      expect(rows).toEqual([fixture.expected]);
      const parsed = rowSchema(fixture.view).safeParse(rows[0]);
      expect(parsed.success ? "ok" : parsed.error.message).toBe("ok");
    });
  }

  it("keeps nested values JSON-shaped: STRUCT dates and timestamps per contract, BIGINT lists as numbers", async () => {
    const [row] = await engine.all(`SELECT
      {'d': DATE '2026-09-03', 't': TIMESTAMPTZ '2026-10-20 22:00:10.663+00', 'n': [5]::BIGINT[]} AS s,
      [DATE '2026-09-03'] AS dates, [1, NULL]::BIGINT[] AS big`);
    expect(row).toEqual({
      s: { d: "2026-09-03", t: "2026-10-20T22:00:10.663Z", n: [5] },
      dates: ["2026-09-03"],
      big: [1, null],
    });
  });
});

describe("duckdb-node constants", () => {
  it("extensionDirectory is DUCKDB_EXTENSION_DIRECTORY, else <LAMBDA_TASK_ROOT>/duckdb-extensions", () => {
    expect(extensionDirectory({ [EXTENSION_DIRECTORY_ENV]: "/opt/ext" })).toBe("/opt/ext");
    expect(extensionDirectory({ LAMBDA_TASK_ROOT: "/var/task" })).toBe(
      join("/var/task", EXTENSION_DIRECTORY_NAME),
    );
    expect(extensionDirectory({})).toBe(join(process.cwd(), EXTENSION_DIRECTORY_NAME));
  });

  it("binds for less time than a presigned URL lives", () => {
    expect(BIND_TTL_MS).toBeLessThan(PRESIGN_EXPIRES_S * 1000);
  });
});
