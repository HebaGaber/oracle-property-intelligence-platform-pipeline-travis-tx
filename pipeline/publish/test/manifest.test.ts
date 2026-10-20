// T033: buildManifest() from fixture CLI outputs (real CAR and dag-json bytes built here).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { CarWriter } from "@ipld/car/writer";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import { PILOT_LIMITATION, RunManifestV1 } from "@countylens/contract";
import { buildManifest, type BuildManifestInput } from "../src/manifest.js";
import { cidOfBytes, cidOfFile } from "../src/cid.js";
import { jcsBytes } from "../src/jcs.js";

const SHA = "c".repeat(64);

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
  pilotDir: string;
}

async function fixture(
  opts: { corruptPart?: boolean; wrongCountyRoot?: boolean } = {},
): Promise<Fixture> {
  const p = mkdtempSync(join(tmpdir(), "pilot-"));
  const groups: BuildManifestInput["groups"] = [];
  for (const group of ["county", "property_improvement"] as const) {
    const carPath = join(p, `car/travis-${group}.car`);
    const countyRoot = await writeCar(carPath, { label: "CountyIndex", group });
    const tablesDir = join(p, `tables/${group}`);
    const tableNames =
      group === "county" ? ["property", "structure"] : ["property", "property_improvement"];
    const tables: Record<
      string,
      { rows: number; parts: Array<{ cid: CID; rows: number; bytes: number }> }
    > = {};
    for (const [i, name] of tableNames.entries()) {
      const bytes = new TextEncoder().encode(`PAR1 ${group} ${name} ${i}`);
      write(join(tablesDir, name, "part-00000.parquet"), bytes);
      tables[name] = {
        rows: i + 1,
        parts: [{ cid: CID.parse(await cidOfBytes(bytes)), rows: i + 1, bytes: bytes.length }],
      };
    }
    if (opts.corruptPart && group === "county")
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
      part_size_bytes: 1 << 30,
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
        partSizeBytes: 1 << 30,
        codec: "zstd",
        tables: Object.fromEntries(
          Object.entries(tables).map(([k, v]) => [k, { rows: v.rows, parts: v.parts.length }]),
        ),
        parts: tableNames.length,
        exportedAt: "2026-10-20T23:00:00.000Z",
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
        captured_at: "2026-10-20T22:00:01.000Z",
        outcome: "ok",
      },
      {
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=B",
        captured_at: "2026-10-20T22:00:02.000Z",
        outcome: "ok",
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n",
  );
  write(
    join(p, "capture/tcad/receipt.json"),
    JSON.stringify({ captured_at: "2026-10-20T22:30:00.000Z", records: [{}, {}, {}] }),
  );
  const input: BuildManifestInput = {
    runId: "travis-pilot-20261020",
    county: "travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-20T22:00:00.000Z",
    finishedAt: "2026-10-20T23:00:00.000Z",
    previousManifestCid: null,
    pilotDir: p,
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
        watermark: null,
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
    coverage: { permits_published: { count: 2, derivation: "published_rows" } },
    limitations: [PILOT_LIMITATION],
  };
  return { input, pilotDir: p };
}

describe("buildManifest", () => {
  it("builds a RunManifestV1 for the pilot", async () => {
    const { input } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(RunManifestV1.parse(manifest)).toEqual(manifest);
    expect(manifest.runId).toBe("travis-pilot-20261020");
    expect(manifest.previousManifestCid).toBeNull();
    expect(manifest.limitations).toContain(PILOT_LIMITATION);
  });

  it("lists 2 car, n table parts and 2 directory entries with carCid", async () => {
    const { input, pilotDir } = await fixture();
    const { manifest } = await buildManifest(input);
    const kinds = manifest.artifacts.map((a) => a.kind);
    expect(kinds.filter((k) => k === "car")).toHaveLength(2);
    expect(kinds.filter((k) => k === "directory")).toHaveLength(2);
    expect(kinds.filter((k) => k === "table")).toHaveLength(4);
    for (const dir of manifest.artifacts.filter((a) => a.kind === "directory")) {
      expect(dir.carCid).toBe(await cidOfFile(join(pilotDir, dir.name, "tables.car")));
      expect(dir.codec).toBe("dag-json");
    }
    const part = manifest.artifacts.find(
      (a) => a.name === "tables/county/property/part-00000.parquet",
    );
    expect(part).toMatchObject({ kind: "table", codec: "raw" });
    const bytes = readFileSync(join(pilotDir, "tables/county/property/part-00000.parquet"));
    expect(part?.size).toBe(bytes.length);
    expect(part?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const car = manifest.artifacts.find((a) => a.name === "car/travis-county.car");
    expect(car).toMatchObject({ kind: "car", codec: "dag-json", cid: at(input.groups, 0).carRoot });
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

  it("derives sources from the capture receipts", async () => {
    const { input } = await fixture();
    const { manifest } = await buildManifest(input);
    expect(manifest.sources[0]).toMatchObject({
      records: 2,
      added: 2,
      captured_at: "2026-10-20T22:00:02.000Z",
    });
    expect(manifest.sources[1]).toMatchObject({
      records: 3,
      captured_at: "2026-10-20T22:30:00.000Z",
    });
  });

  it("returns the JCS bytes and their raw-leaves CIDv1, and is deterministic", async () => {
    const { input } = await fixture();
    const a = await buildManifest(input);
    const b = await buildManifest(input);
    expect(Buffer.from(a.bytes).equals(Buffer.from(jcsBytes(a.manifest)))).toBe(true);
    expect(a.cid).toBe(await cidOfBytes(a.bytes));
    expect(a.cid.startsWith("bafkrei")).toBe(true);
    expect(b.cid).toBe(a.cid);
  });

  it("imports no database client (reads CLI outputs and receipts only)", () => {
    const src = readFileSync(new URL("../src/manifest.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["'](pg|postgres|@duckdb\/[^"']+)["']/);
  });
});

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}
