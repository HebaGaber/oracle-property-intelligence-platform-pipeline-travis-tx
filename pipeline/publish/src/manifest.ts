// buildManifest(): the run manifest from CLI outputs and capture receipts only (oracle § C,
// research R-06). No database is read. Part CIDs come from the `CountyTables` block in each
// tables.car and are re-derived from the part files (raw-leaves CIDv1); any mismatch fails.
// The manifest CID is the raw-leaves CIDv1 of its RFC 8785 JCS bytes.
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CarBlockIterator, CarReader } from "@ipld/car";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { z } from "zod";
import {
  RunManifestV1,
  type CoverageCount,
  type ManifestArtifact,
  type ManifestProfile,
  type ManifestSource,
} from "@countylens/contract";
import { cidOfBytes, cidOfFile, codecName, sameDigest } from "./cid.js";
import { jcsBytes } from "./jcs.js";
import { sha256File, type DataGroup } from "./sequence.js";

export interface ManifestGroupInput {
  group: DataGroup;
  carPath: string;
  /** Archive root printed by `hash`. */
  carRoot: string;
  tablesDir: string;
  /** Tables root printed by `export-tables`. */
  tablesRoot: string;
  tablesExportJson: string;
}

export interface ManifestSourceInput {
  name: string;
  url: string;
  watermark: string | null;
  /** A `.jsonl` of capture receipts, or a `.json` receipt with `captured_at` and `records`. */
  receipts: string;
  limitations: string[];
}

export interface BuildManifestInput {
  runId: string;
  county: string;
  state: string;
  fips: string;
  startedAt: string;
  finishedAt: string;
  previousManifestCid: string | null;
  /** Artifact names are paths relative to this directory. */
  pilotDir: string;
  groups: ManifestGroupInput[];
  sources: ManifestSourceInput[];
  profiles: ManifestProfile[];
  coverage: Record<string, CoverageCount>;
  limitations: string[];
}

export interface BuiltManifest {
  manifest: RunManifestV1;
  /** The exact JCS bytes to write and commit. */
  bytes: Uint8Array;
  cid: string;
}

const CidLink = z.custom<CID>((v) => CID.asCID(v) !== null, "expected a CID link");

const CountyTablesBlock = z.object({
  label: z.literal("CountyTables"),
  version: z.number().int(),
  county_root: CidLink,
  part_size_bytes: z.number().int().positive(),
  codec: z.string(),
  tables: z.record(
    z.string(),
    z.object({
      rows: z.number().int().nonnegative(),
      parts: z.array(
        z.object({
          cid: CidLink,
          rows: z.number().int().nonnegative(),
          bytes: z.number().int().nonnegative(),
        }),
      ),
    }),
  ),
});

const TablesExportSummary = z.object({
  root: z.string(),
  countyRoot: z.string(),
  tables: z.record(z.string(), z.object({ rows: z.number().int(), parts: z.number().int() })),
});

const Receipt = z.object({ captured_at: z.string(), outcome: z.string().optional() }).loose();
const ReceiptFile = z
  .object({ captured_at: z.string(), records: z.union([z.number().int(), z.array(z.unknown())]) })
  .loose();

async function carRoots(path: string): Promise<CID[]> {
  const stream = createReadStream(path);
  try {
    const it = await CarBlockIterator.fromIterable(stream);
    return await it.getRoots();
  } finally {
    stream.destroy();
  }
}

async function fileArtifact(
  pilotDir: string,
  path: string,
  kind: ManifestArtifact["kind"],
  cid: string,
): Promise<ManifestArtifact> {
  return {
    name: relative(pilotDir, path),
    cid,
    codec: codecName(cid),
    size: statSync(path).size,
    sha256: await sha256File(path),
    kind,
  };
}

async function groupArtifacts(
  pilotDir: string,
  g: ManifestGroupInput,
): Promise<ManifestArtifact[]> {
  const [carRoot] = await carRoots(g.carPath);
  if (!carRoot || carRoot.toString() !== g.carRoot) {
    throw new Error(
      `${g.group}: archive root ${carRoot?.toString()} in ${g.carPath} is not the hash root ${g.carRoot}`,
    );
  }
  const tablesCar = join(g.tablesDir, "tables.car");
  const reader = await CarReader.fromIterable(createReadStream(tablesCar));
  const [tablesRoot] = await reader.getRoots();
  if (!tablesRoot || tablesRoot.toString() !== g.tablesRoot) {
    throw new Error(
      `${g.group}: tables root ${tablesRoot?.toString()} in ${tablesCar} is not the printed root ${g.tablesRoot}`,
    );
  }
  const block = await reader.get(tablesRoot);
  if (!block) throw new Error(`${g.group}: tables.car has no block for its root`);
  const recomputed = CID.create(1, dagJson.code, await sha256.digest(block.bytes));
  if (!recomputed.equals(tablesRoot))
    throw new Error(`${g.group}: tables root block does not hash to its CID`);
  const countyTables = CountyTablesBlock.parse(dagJson.decode(block.bytes));
  if (!sameDigest(countyTables.county_root.toString(), g.carRoot)) {
    throw new Error(
      `${g.group}: CountyTables county_root ${countyTables.county_root.toString()} is not the CAR root ${g.carRoot}`,
    );
  }
  const summary = TablesExportSummary.parse(JSON.parse(readFileSync(g.tablesExportJson, "utf8")));
  if (summary.root !== g.tablesRoot)
    throw new Error(`${g.group}: tables root in ${g.tablesExportJson} differs`);
  if (summary.countyRoot !== g.carRoot)
    throw new Error(`${g.group}: countyRoot in ${g.tablesExportJson} differs`);

  const tables: ManifestArtifact[] = [];
  for (const [name, table] of Object.entries(countyTables.tables)) {
    const listed = summary.tables[name];
    if (!listed || listed.rows !== table.rows || listed.parts !== table.parts.length) {
      throw new Error(
        `${g.group}: table ${name} rows/parts disagree between tables.car and the export summary`,
      );
    }
    for (const [i, part] of table.parts.entries()) {
      const file = join(g.tablesDir, name, `part-${String(i).padStart(5, "0")}.parquet`);
      const derived = await cidOfFile(file);
      if (derived !== part.cid.toString()) {
        throw new Error(
          `${g.group}: part CID mismatch for ${file}: tables.car ${part.cid.toString()}, file ${derived}`,
        );
      }
      const artifact = await fileArtifact(pilotDir, file, "table", derived);
      if (artifact.size !== part.bytes)
        throw new Error(
          `${g.group}: ${file} is ${artifact.size} bytes, tables.car says ${part.bytes}`,
        );
      tables.push(artifact);
    }
  }
  // Code-unit order: byte-stable across locales (code-review #5).
  tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const directory: ManifestArtifact = {
    name: relative(pilotDir, g.tablesDir),
    cid: g.tablesRoot,
    codec: codecName(g.tablesRoot),
    size: statSync(tablesCar).size,
    sha256: await sha256File(tablesCar),
    kind: "directory",
    carCid: await cidOfFile(tablesCar),
  };
  return [await fileArtifact(pilotDir, g.carPath, "car", g.carRoot), directory, ...tables];
}

function source(input: ManifestSourceInput): ManifestSource {
  const text = readFileSync(input.receipts, "utf8");
  let records: number;
  let capturedAt: string;
  if (input.receipts.endsWith(".jsonl")) {
    const rows = text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => Receipt.parse(JSON.parse(l)));
    const ok = rows.filter(
      (r) => r.outcome === undefined || r.outcome === "ok" || r.outcome === "throttled-then-ok",
    );
    if (ok.length === 0)
      throw new Error(`${input.name}: no successful capture receipt in ${input.receipts}`);
    records = ok.length;
    capturedAt = ok
      .map((r) => r.captured_at)
      .sort()
      .at(-1) as string;
  } else {
    const receipt = ReceiptFile.parse(JSON.parse(text));
    records = typeof receipt.records === "number" ? receipt.records : receipt.records.length;
    capturedAt = receipt.captured_at;
  }
  return {
    name: input.name,
    url: input.url,
    watermark: input.watermark,
    captured_at: capturedAt,
    records,
    // First run of this contract: everything is new.
    added: records,
    changed: 0,
    removed: 0,
    limitations: input.limitations,
  };
}

export async function buildManifest(input: BuildManifestInput): Promise<BuiltManifest> {
  const artifacts: ManifestArtifact[] = [];
  for (const g of input.groups) artifacts.push(...(await groupArtifacts(input.pilotDir, g)));
  const manifest = RunManifestV1.parse({
    schema: "oracle-travis-run-manifest.v1",
    runId: input.runId,
    county: input.county,
    state: input.state,
    fips: input.fips,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    previousManifestCid: input.previousManifestCid,
    sources: input.sources.map(source),
    artifacts,
    profiles: input.profiles,
    coverage: input.coverage,
    limitations: input.limitations,
  });
  const bytes = jcsBytes(manifest);
  return { manifest, bytes, cid: await cidOfBytes(bytes) };
}
