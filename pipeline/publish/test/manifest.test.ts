// T027: buildManifest() and the run index from fixture CLI outputs (real CAR and dag-json bytes
// built here). A-03: no pilot limitation, fixed source order, coverage derivations, carCid on
// car and directory artifacts, 48m part bound, exact JCS bytes, RunsIndexV1 ordered by finishedAt.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { CarWriter } from "@ipld/car/writer";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import { PILOT_LIMITATION, RunManifestV1, RunsIndexV1, isCidV1 } from "@countylens/contract";
import { SOURCE_ORDER, buildManifest, type BuildManifestInput } from "../src/manifest.js";
import {
  addRun,
  emptyRunsIndex,
  parseRunsIndex,
  runsIndexBytes,
  verifyCommittedRuns,
} from "../src/runs-index.js";
import { cidOfBytes, cidOfFile } from "../src/cid.js";
import { jcsBytes } from "../src/jcs.js";
import { PART_SIZE_BYTES } from "../src/sequence.js";

const SHA = "c".repeat(64);
const RUN_ID = "travis-202609-reroof-20261021t1530z";
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

async function writeCar(path: string, value: unknown): Promise<CID> {
  const bytes = dagJson.encode(value);
  const root = CID.create(1, dagJson.code, await sha256.digest(bytes));
  const { writer, out } = CarWriter.create([root]);
  const chunks: Uint8Array[] = [];
  const done = (async () => {
    for await (const c of out) chunks.push(c);
  })();
  await writer.put({ cid: root, bytes });
  await writer.close();
  await done;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat(chunks));
  return root;
}

function write(path: string, body: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

interface Fixture {
  input: BuildManifestInput;
  runDir: string;
}

interface FixtureOptions {
  corruptPart?: boolean;
  wrongCountyRoot?: boolean;
  countyTables?: string[];
  /** `part_size_bytes` written into every CountyTables block. */
  partSizeBytes?: number;
  /** Declare one county part larger than the 48m bound. */
  oversizedPart?: boolean;
}

async function fixture(opts: FixtureOptions = {}): Promise<Fixture> {
  const p = mkdtempSync(join(tmpdir(), "run-"));
  const groups: BuildManifestInput["groups"] = [];
  for (const group of ["county", "property_improvement"] as const) {
    const carPath = join(p, `car/travis-${group}.car`);
    const countyRoot = await writeCar(carPath, { label: "CountyIndex", group });
    const tablesDir = join(p, `tables/${group}`);
    const tableNames =
      group === "county"
        ? (opts.countyTables ?? ["property", "structure"])
        : ["property", "property_improvement"];
    const tables: Record<
      string,
      { rows: number; parts: Array<{ cid: CID; rows: number; bytes: number }> }
    > = {};
    for (const [i, name] of tableNames.entries()) {
      const bytes = new TextEncoder().encode(`PAR1 ${group} ${name} ${i}`);
      write(join(tablesDir, name, "part-00000.parquet"), bytes);
      const declared =
        opts.oversizedPart && group === "county" && i === 0 ? PART_SIZE_BYTES + 1 : bytes.length;
      tables[name] = {
        rows: i + 1,
        parts: [{ cid: CID.parse(await cidOfBytes(bytes)), rows: i + 1, bytes: declared }],
      };
    }
    if (opts.corruptPart && group === "county" && tableNames.includes("property"))
      write(join(tablesDir, "property", "part-00000.parquet"), "tampered");
    const otherRoot = CID.create(
      1,
      dagJson.code,
      await sha256.digest(new TextEncoder().encode("other")),
    );
    const tablesRoot = await writeCar(join(tablesDir, "tables.car"), {
      label: "CountyTables",
      version: 1,
      county_root: opts.wrongCountyRoot ? otherRoot : countyRoot,
      part_size_bytes: opts.partSizeBytes ?? PART_SIZE_BYTES,
      codec: "zstd",
      tables,
    });
    const exportJson = join(p, `reports/${group}-tables-export.json`);
    write(
      exportJson,
      JSON.stringify({
        output: tablesDir,
        car: join(tablesDir, "tables.car"),
        root: tablesRoot.toString(),
        countyRoot: countyRoot.toString(),
        partSizeBytes: opts.partSizeBytes ?? PART_SIZE_BYTES,
        codec: "zstd",
        tables: Object.fromEntries(
          Object.entries(tables).map(([k, v]) => [k, { rows: v.rows, parts: v.parts.length }]),
        ),
        parts: tableNames.length,
        exportedAt: "2026-10-21T15:00:00.000Z",
      }),
    );
    groups.push({
      group,
      carPath,
      carRoot: countyRoot.toString(),
      tablesDir,
      tablesRoot: tablesRoot.toString(),
      tablesExportJson: exportJson,
    });
  }
  write(
    join(p, "capture/austin/receipts.jsonl"),
    [
      {
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=A",
        captured_at: "2026-10-21T14:00:01.000Z",
        outcome: "ok",
      },
      {
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=B",
        captured_at: "2026-10-21T14:00:02.000Z",
        outcome: "ok",
      },
      {
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=C",
        captured_at: "2026-10-21T14:00:03.000Z",
        outcome: "ok",
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n",
  );
  write(
    join(p, "capture/tcad/receipt.json"),
    JSON.stringify({ captured_at: "2026-10-21T14:30:00.000Z", records: [{}, {}, {}] }),
  );
  const input: BuildManifestInput = {
    runId: RUN_ID,
    county: "travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-21T14:00:00.000Z",
    finishedAt: "2026-10-21T15:00:00.000Z",
    previousManifestCid: null,
    runDir: p,
    groups,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-10-20T12:36:38.000Z",
        receipts: join(p, "capture/austin/receipts.jsonl"),
        limitations: [],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation",
        watermark: "entry@sha256:" + "d".repeat(64),
        receipts: join(p, "capture/tcad/receipt.json"),
        limitations: [],
      },
    ],
    profiles: [
      {
        name: "travis-austin",
        version: "1.0.0",
        sha256: SHA,
        path: "profiles/travis-austin@1.0.0/rules.json",
        gitCommit: "17c6cd8",
      },
    ],
    // The property_improvement table of the property_improvement group has 2 rows (fixture);
    // 3 permits were captured, so 1 had no tcad_id.
    coverage: {
      permits_emitted: { count: 2, derivation: "published_rows" },
      permits_no_tcad_geoid: { count: 1, derivation: "aggregate_match" },
    },
    limitations: [],
    workTreeStatus: () => "",
  };
  return { input, runDir: p };
}

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}

describe("buildManifest (A-03)", () => {
  it("sorts table artifacts by code-unit order, not locale ('/' before '_'; code-review #5)", async () => {
    const { input } = await fixture({ countyTables: ["address_has_parcel", "address"] });
    const { manifest } = await buildManifest(input);
    const names = manifest.artifacts
      .filter((a) => a.kind === "table" && a.name.startsWith("tables/county/"))
      .map((a) => a.name);
    expect(names).toEqual([
      "tables/county/address/part-00000.parquet",
      "tables/county/address_has_parcel/part-00000.parquet",
    ]);
  });

  it("builds a RunManifestV1 with a published runId, previousManifestCid null, no pilot limitation", async () => {
    const { input } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(RunManifestV1.parse(manifest)).toEqual(manifest);
    expect(manifest.runId).toBe(RUN_ID);
    expect(manifest.runId).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(manifest.runId).not.toContain("pilot");
    expect(manifest.previousManifestCid).toBeNull();
    expect(manifest.limitations).not.toContain(PILOT_LIMITATION);
  });

  it("rejects a pilot runId and the pilot limitation: a published run is never the pilot", async () => {
    const { input } = await fixture();
    await expect(buildManifest({ ...input, runId: "travis-pilot-20261020" })).rejects.toThrow(
      /pilot/,
    );
    await expect(buildManifest({ ...input, limitations: [PILOT_LIMITATION] })).rejects.toThrow(
      /pilot/,
    );
    await expect(buildManifest({ ...input, runId: "Travis_Run" })).rejects.toThrow(/runId/);
  });

  it("gives every artifact a CIDv1, name, codec, size and sha256; car and directory carry carCid", async () => {
    const { input, runDir } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(manifest.artifacts.length).toBeGreaterThan(0);
    for (const a of manifest.artifacts) {
      expect(isCidV1(a.cid), a.name).toBe(true);
      expect(a.name.length).toBeGreaterThan(0);
      expect(["raw", "dag-pb", "dag-json"]).toContain(a.codec);
      expect(Number.isInteger(a.size) && a.size >= 0).toBe(true);
      expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
      if (a.kind === "car" || a.kind === "directory") {
        expect(a.carCid, `${a.kind} ${a.name} needs carCid`).toBeDefined();
        expect(isCidV1(a.carCid as string)).toBe(true);
      } else {
        expect(a.carCid).toBeUndefined();
      }
    }
    const kinds = manifest.artifacts.map((a) => a.kind);
    expect(kinds.filter((k) => k === "car")).toHaveLength(2);
    expect(kinds.filter((k) => k === "directory")).toHaveLength(2);
    expect(kinds.filter((k) => k === "table")).toHaveLength(4);
    for (const dir of manifest.artifacts.filter((a) => a.kind === "directory")) {
      expect(dir.carCid).toBe(await cidOfFile(join(runDir, dir.name, "tables.car")));
      expect(dir.codec).toBe("dag-json");
    }
    const car = manifest.artifacts.find((a) => a.name === "car/travis-county.car");
    expect(car).toMatchObject({ kind: "car", codec: "dag-json", cid: at(input.groups, 0).carRoot });
    // AM-05: the .car file itself is also added as a plain raw-leaves file; carCid is its CID.
    expect(car?.carCid).toBe(await cidOfFile(join(runDir, "car/travis-county.car")));
    expect(car?.carCid).not.toBe(car?.cid);
    expect(car?.size).toBe(readFileSync(join(runDir, "car/travis-county.car")).length);
    const part = manifest.artifacts.find(
      (a) => a.name === "tables/county/property/part-00000.parquet",
    );
    expect(part).toMatchObject({ kind: "table", codec: "raw" });
    const bytes = readFileSync(join(runDir, "tables/county/property/part-00000.parquet"));
    expect(part?.size).toBe(bytes.length);
    expect(part?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("bounds every table part at the 48m export size (ADR-0001 decision 3)", async () => {
    expect(PART_SIZE_BYTES).toBe(48 * 1024 * 1024);
    expect(PART_SIZE_BYTES).toBeLessThanOrEqual(50_331_648);
    const oversized = await fixture({ oversizedPart: true });
    await expect(buildManifest(oversized.input)).rejects.toThrow(/48m/);
    const otherPartSize = await fixture({ partSizeBytes: 1 << 30 });
    await expect(buildManifest(otherPartSize.input)).rejects.toThrow(/part_size_bytes/);
  });

  it("reads part CIDs from the CountyTables block and fails when a part does not re-derive", async () => {
    const { input } = await fixture({ corruptPart: true });
    await expect(buildManifest(input)).rejects.toThrow(/part CID mismatch/);
  });

  it("fails when the CountyTables county_root is not the group's CAR root", async () => {
    const { input } = await fixture({ wrongCountyRoot: true });
    await expect(buildManifest(input)).rejects.toThrow(/county_root/);
  });

  it("fails when the printed roots disagree with the files", async () => {
    const { input } = await fixture();
    at(input.groups, 0).tablesRoot = at(input.groups, 1).tablesRoot;
    await expect(buildManifest(input)).rejects.toThrow(/tables root/);
  });

  it("lists the sources in the fixed order: austin-3syk-w9eu then tcad-2026-certified-json", async () => {
    expect(SOURCE_ORDER).toEqual(["austin-3syk-w9eu", "tcad-2026-certified-json"]);
    const { input } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(manifest.sources.map((s) => s.name)).toEqual([...SOURCE_ORDER]);
    expect(manifest.sources[0]).toMatchObject({
      records: 3,
      added: 3,
      captured_at: "2026-10-21T14:00:03.000Z",
    });
    expect(manifest.sources[1]).toMatchObject({
      records: 3,
      captured_at: "2026-10-21T14:30:00.000Z",
    });
    const swapped = { ...input, sources: [at(input.sources, 1), at(input.sources, 0)] };
    await expect(buildManifest(swapped)).rejects.toThrow(/sources/);
    const one = { ...input, sources: [at(input.sources, 0)] };
    await expect(buildManifest(one)).rejects.toThrow(/sources/);
  });

  it("requires coverage.permits_emitted (published_rows) and permits_no_tcad_geoid (aggregate_match)", async () => {
    const { input } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(manifest.coverage.permits_emitted).toEqual({ count: 2, derivation: "published_rows" });
    expect(manifest.coverage.permits_no_tcad_geoid).toEqual({
      count: 1,
      derivation: "aggregate_match",
    });
    await expect(
      buildManifest({
        ...input,
        coverage: { permits_no_tcad_geoid: { count: 1, derivation: "aggregate_match" } },
      }),
    ).rejects.toThrow(/permits_emitted/);
    await expect(
      buildManifest({
        ...input,
        coverage: { permits_emitted: { count: 2, derivation: "published_rows" } },
      }),
    ).rejects.toThrow(/permits_no_tcad_geoid/);
    await expect(
      buildManifest({
        ...input,
        coverage: {
          permits_emitted: { count: 2, derivation: "aggregate_match" },
          permits_no_tcad_geoid: { count: 1, derivation: "aggregate_match" },
        },
      }),
    ).rejects.toThrow(/published_rows/);
    await expect(
      buildManifest({
        ...input,
        coverage: {
          permits_emitted: { count: 2, derivation: "published_rows" },
          permits_no_tcad_geoid: { count: 1, derivation: "published_rows" },
        },
      }),
    ).rejects.toThrow(/aggregate_match/);
  });

  it("checks permits_emitted against the published property_improvement rows", async () => {
    const { input } = await fixture();
    await expect(
      buildManifest({
        ...input,
        coverage: {
          permits_emitted: { count: 37, derivation: "published_rows" },
          permits_no_tcad_geoid: { count: 1, derivation: "aggregate_match" },
        },
      }),
    ).rejects.toThrow(/permits_emitted/);
  });

  it("fails on a dirty working tree and names the files", async () => {
    const { input } = await fixture();
    await expect(
      buildManifest({
        ...input,
        workTreeStatus: () => " M profiles/travis-austin@1.0.0/rules.json\n",
      }),
    ).rejects.toThrow(/dirty.*rules\.json/s);
  });

  it("returns exact JCS bytes with no trailing newline and their raw-leaves CIDv1, deterministically", async () => {
    const { input } = await fixture();
    const a = await buildManifest(input);
    const b = await buildManifest(input);
    expect(Buffer.from(a.bytes).equals(Buffer.from(jcsBytes(a.manifest)))).toBe(true);
    expect(a.bytes[a.bytes.length - 1]).not.toBe(0x0a);
    expect(a.cid).toBe(await cidOfBytes(a.bytes));
    expect(a.cid.startsWith("bafkrei")).toBe(true);
    expect(b.cid).toBe(a.cid);
    const text = Buffer.from(a.bytes).toString("utf8");
    expect(text).not.toMatch(/\/ip[fn]s\//);
    expect(text).not.toMatch(/ipns/i);
  });

  it("imports no database client (reads CLI outputs and receipts only)", () => {
    const src = readFileSync(new URL("../src/manifest.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["'](pg|postgres|@duckdb\/[^"']+)["']/);
  });
});

describe("the run index (RunsIndexV1, JCS)", () => {
  const first = {
    runId: RUN_ID,
    manifestCid: "bafkrei" + "a".repeat(52),
    finishedAt: "2026-10-21T15:00:00.000Z",
  };
  const second = {
    runId: "travis-202610-reroof-20261121t1000z",
    manifestCid: "bafkrei" + "b".repeat(52),
    finishedAt: "2026-11-21T10:00:00.000Z",
  };

  it("orders runs by finishedAt whatever the insertion order", () => {
    const index = addRun(addRun(emptyRunsIndex(), second), first);
    expect(RunsIndexV1.parse(index)).toEqual(index);
    expect(index.runs.map((r) => r.runId)).toEqual([first.runId, second.runId]);
  });

  it("rejects a duplicate runId or manifestCid and a pilot runId", () => {
    const index = addRun(emptyRunsIndex(), first);
    expect(() => addRun(index, { ...first, manifestCid: second.manifestCid })).toThrow(/runId/);
    expect(() => addRun(index, { ...second, manifestCid: first.manifestCid })).toThrow(
      /manifestCid/,
    );
    expect(() => addRun(index, { ...second, runId: "travis-pilot-20261020" })).toThrow(/pilot/);
  });

  it("serializes as JCS bytes with no trailing newline and parses back", () => {
    const index = addRun(emptyRunsIndex(), first);
    const bytes = runsIndexBytes(index);
    expect(Buffer.from(bytes).equals(Buffer.from(jcsBytes(index)))).toBe(true);
    expect(bytes[bytes.length - 1]).not.toBe(0x0a);
    expect(Buffer.from(bytes).toString("utf8")).toBe(
      `{"runs":[{"finishedAt":"${first.finishedAt}","manifestCid":"${first.manifestCid}","runId":"${first.runId}"}],"schema":"oracle-travis-runs-index.v1"}`,
    );
    expect(parseRunsIndex(bytes)).toEqual(index);
    expect(() =>
      parseRunsIndex(
        `{"schema":"oracle-travis-runs-index.v1","runs":[{"runId":"travis-pilot-1","manifestCid":"${first.manifestCid}","finishedAt":"${first.finishedAt}"}]}`,
      ),
    ).toThrow(/pilot/);
  });

  it("verifies committed runs: manifest.json is exact JCS bytes whose CID is in index.json", async () => {
    const { input } = await fixture();
    const built = await buildManifest(input);
    const runsDir = mkdtempSync(join(tmpdir(), "runs-"));
    write(join(runsDir, RUN_ID, "manifest.json"), built.bytes);
    const index = addRun(emptyRunsIndex(), {
      runId: RUN_ID,
      manifestCid: built.cid,
      finishedAt: built.manifest.finishedAt,
    });
    write(join(runsDir, "index.json"), runsIndexBytes(index));
    const ok = await verifyCommittedRuns(runsDir);
    expect(ok.ok).toBe(true);
    expect(ok.checks).toEqual([{ runId: RUN_ID, manifestCid: built.cid, ok: true }]);

    // A trailing newline changes the bytes and therefore the CID: refused.
    write(join(runsDir, RUN_ID, "manifest.json"), Buffer.concat([built.bytes, Buffer.from("\n")]));
    const bad = await verifyCommittedRuns(runsDir);
    expect(bad.ok).toBe(false);
    expect(at(bad.checks, 0).reason).toMatch(/JCS|CID/);

    // A pretty-printed manifest is the same JSON but not the committed bytes: refused.
    write(join(runsDir, RUN_ID, "manifest.json"), JSON.stringify(built.manifest, null, 2));
    expect((await verifyCommittedRuns(runsDir)).ok).toBe(false);
  });

  const committed = join(REPO_ROOT, "runs");
  it.skipIf(!existsSync(join(committed, "index.json")))(
    "every committed runs/<runId>/manifest.json recomputes to the CID in runs/index.json",
    async () => {
      const result = await verifyCommittedRuns(committed);
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.ok, JSON.stringify(result.checks, null, 2)).toBe(true);
    },
  );
});

describe("pipeline/publish stays free of the Query DB (A2, P0-2)", () => {
  it("package.json and src mention no pg, postgres, query-db package or database URL", () => {
    const pkgDir = fileURLToPath(new URL("..", import.meta.url));
    const banned = ["pg", "postgres", "@elephant-xyz/query-db", "DATABASE_URL"];
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const b of banned) expect(deps, `dependency ${b}`).not.toContain(b);
    const files = readdirSync(join(pkgDir, "src")).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(pkgDir, "src", f), "utf8");
      expect(src, f).not.toMatch(/from\s+["'](pg|postgres|@elephant-xyz\/query-db)["']/);
      expect(src, f).not.toMatch(/\bDATABASE_URL\b/);
      expect(src, f).not.toMatch(/\bpostgres\b/i);
    }
  });
});
