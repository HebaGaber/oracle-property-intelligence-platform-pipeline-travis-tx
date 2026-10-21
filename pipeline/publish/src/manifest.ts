// buildManifest(): the run manifest from CLI outputs and capture receipts only (oracle § 5,
// research R-08). No database is read. Part CIDs come from the `CountyTables` block in each
// tables.car and are re-derived from the part files (raw-leaves CIDv1); any mismatch fails.
// A-03: a published run is never the pilot (no pilot runId, no pilot limitation), the sources
// are listed in a fixed order, coverage carries `permits_emitted` (published_rows, checked
// against the published property_improvement rows) and `permits_no_tcad_geoid`
// (aggregate_match), every `car` and `directory` artifact carries `carCid` (AM-05), every table
// part is within the 48m export bound, and the working tree must be clean. The manifest CID is
// the raw-leaves CIDv1 of its RFC 8785 JCS bytes.
// Fixed limitation notes (FR-001, TC-003; plan § "Fixed texts and config keys", verbatim):
// `sources[0].limitations` (Austin) carries `Comptroller baseline not loaded (A-07)` (addendum
// A5: why every permit is `contractor_unresolved`); `sources[1].limitations` (TCAD) carries
// `Confidential owner records redacted (Texas Tax Code §25.025): {n}` with `n` = the run
// summary's `owners_redacted` (P0-15: the redaction precedes `validate`). Each note is added
// once, after the source's own notes.
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CarBlockIterator, CarReader } from "@ipld/car";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { z } from "zod";
import {
  PILOT_LIMITATION,
  RunManifestV1,
  type CoverageCount,
  type ManifestArtifact,
  type ManifestProfile,
  type ManifestSource,
} from "@countylens/contract";
import { cidOfBytes, cidOfFile, codecName, sameDigest } from "./cid.js";
import { jcsBytes } from "./jcs.js";
import { PART_SIZE, PART_SIZE_BYTES, sha256File, type DataGroup } from "./sequence.js";

/** The display order of `sources[]` (data-model.md): Austin permits first, then TCAD. */
export const SOURCE_ORDER = ["austin-3syk-w9eu", "tcad-2026-certified-json"] as const;

/** The Austin source's fixed limitation note (addendum A5; plan § "Fixed texts"). */
export const COMPTROLLER_LIMITATION = "Comptroller baseline not loaded (A-07)";

/** The TCAD source's fixed limitation note (P0-15; plan § "Fixed texts"); `n` = owners_redacted. */
export function confidentialLimitation(ownersRedacted: number): string {
  return `Confidential owner records redacted (Texas Tax Code §25.025): ${ownersRedacted}`;
}

/** The fixed note of a source in SOURCE_ORDER. */
function fixedLimitation(name: string, ownersRedacted: number): string {
  switch (name) {
    case SOURCE_ORDER[0]:
      return COMPTROLLER_LIMITATION;
    case SOURCE_ORDER[1]:
      return confidentialLimitation(ownersRedacted);
    default:
      throw new Error(`no fixed limitation note for source ${name}`);
  }
}

const RUN_ID = /^[a-z0-9][a-z0-9-]*$/;

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
  runDir?: string;
  /** @deprecated A-02 name of `runDir`, kept while travis/pilot/run-pilot.ts calls it. */
  pilotDir?: string;
  groups: ManifestGroupInput[];
  sources: ManifestSourceInput[];
  profiles: ManifestProfile[];
  coverage: Record<string, CoverageCount>;
  /**
   * The run summary's `owners_redacted`: TCAD confidentiality redactions applied before
   * `validate` (P0-15). Written into the TCAD source's limitation note; never defaulted.
   */
  ownersRedacted: number;
  limitations: string[];
  /** Where `git status` runs (default: the current directory). */
  repoRoot?: string;
  /** `git status --porcelain --untracked-files=no` output; injectable for tests. */
  workTreeStatus?: (repoRoot: string) => string;
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
  runDir: string,
  path: string,
  kind: ManifestArtifact["kind"],
  cid: string,
): Promise<ManifestArtifact> {
  return {
    name: relative(runDir, path),
    cid,
    codec: codecName(cid),
    size: statSync(path).size,
    sha256: await sha256File(path),
    kind,
  };
}

interface GroupArtifacts {
  artifacts: ManifestArtifact[];
  /** Rows per table, from the CountyTables block (what the published Parquet holds). */
  rows: Record<string, number>;
}

async function groupArtifacts(runDir: string, g: ManifestGroupInput): Promise<GroupArtifacts> {
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
  if (countyTables.part_size_bytes !== PART_SIZE_BYTES) {
    throw new Error(
      `${g.group}: tables.car part_size_bytes ${countyTables.part_size_bytes} is not --part-size ${PART_SIZE} (${PART_SIZE_BYTES})`,
    );
  }
  const summary = TablesExportSummary.parse(JSON.parse(readFileSync(g.tablesExportJson, "utf8")));
  if (summary.root !== g.tablesRoot)
    throw new Error(`${g.group}: tables root in ${g.tablesExportJson} differs`);
  if (summary.countyRoot !== g.carRoot)
    throw new Error(`${g.group}: countyRoot in ${g.tablesExportJson} differs`);

  const tables: ManifestArtifact[] = [];
  const rows: Record<string, number> = {};
  for (const [name, table] of Object.entries(countyTables.tables)) {
    const listed = summary.tables[name];
    if (!listed || listed.rows !== table.rows || listed.parts !== table.parts.length) {
      throw new Error(
        `${g.group}: table ${name} rows/parts disagree between tables.car and the export summary`,
      );
    }
    rows[name] = table.rows;
    for (const [i, part] of table.parts.entries()) {
      if (part.bytes > PART_SIZE_BYTES) {
        throw new Error(
          `${g.group}: table ${name} part ${i} is ${part.bytes} bytes, above the --part-size ${PART_SIZE} bound (${PART_SIZE_BYTES})`,
        );
      }
      const file = join(g.tablesDir, name, `part-${String(i).padStart(5, "0")}.parquet`);
      const derived = await cidOfFile(file);
      if (derived !== part.cid.toString()) {
        throw new Error(
          `${g.group}: part CID mismatch for ${file}: tables.car ${part.cid.toString()}, file ${derived}`,
        );
      }
      const artifact = await fileArtifact(runDir, file, "table", derived);
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
    name: relative(runDir, g.tablesDir),
    cid: g.tablesRoot,
    codec: codecName(g.tablesRoot),
    size: statSync(tablesCar).size,
    sha256: await sha256File(tablesCar),
    kind: "directory",
    carCid: await cidOfFile(tablesCar),
  };
  // AM-05: the .car file is also added to IPFS as a plain raw-leaves file; carCid is that CID,
  // so verify-manifest can check the file's size and SHA-256 (its `cid` is the DAG root).
  const car: ManifestArtifact = {
    ...(await fileArtifact(runDir, g.carPath, "car", g.carRoot)),
    carCid: await cidOfFile(g.carPath),
  };
  return { artifacts: [car, directory, ...tables], rows };
}

/** The source entry, with its fixed limitation note added once after the source's own notes. */
function source(input: ManifestSourceInput, fixedNote: string): ManifestSource {
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
    limitations: input.limitations.includes(fixedNote)
      ? [...input.limitations]
      : [...input.limitations, fixedNote],
  };
}

function gitStatus(repoRoot: string): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

/** Checks that need no file: identity, source order, coverage shape, clean tree. */
function checkInput(input: BuildManifestInput): void {
  if (!RUN_ID.test(input.runId))
    throw new Error(`runId "${input.runId}" must match ${RUN_ID.source}`);
  if (input.runId.includes("pilot"))
    throw new Error(`runId "${input.runId}" names the pilot; a published run is never the pilot`);
  if (input.limitations.includes(PILOT_LIMITATION))
    throw new Error("a published run carries no pilot limitation");
  // P0-15: the redaction count is stated, never assumed; a missing or malformed count fails.
  if (!Number.isInteger(input.ownersRedacted) || input.ownersRedacted < 0) {
    throw new Error(
      `ownersRedacted (the run summary's owners_redacted) must be a non-negative integer, got ${String(input.ownersRedacted)}`,
    );
  }
  const names = input.sources.map((s) => s.name);
  if (names.length !== SOURCE_ORDER.length || names.some((n, i) => n !== SOURCE_ORDER[i])) {
    throw new Error(
      `sources must be exactly, in order: ${SOURCE_ORDER.join(", ")}; got ${names.join(", ") || "none"}`,
    );
  }
  const required: ReadonlyArray<[string, CoverageCount["derivation"]]> = [
    ["permits_emitted", "published_rows"],
    ["permits_no_tcad_geoid", "aggregate_match"],
  ];
  for (const [key, derivation] of required) {
    const count = input.coverage[key];
    if (!count) throw new Error(`coverage.${key} is required`);
    if (count.derivation !== derivation)
      throw new Error(
        `coverage.${key}.derivation must be "${derivation}", not "${count.derivation}"`,
      );
  }
  const status = (input.workTreeStatus ?? gitStatus)(input.repoRoot ?? process.cwd()).trim();
  if (status !== "") throw new Error(`working tree is dirty; commit before publishing:\n${status}`);
}

export async function buildManifest(input: BuildManifestInput): Promise<BuiltManifest> {
  const runDir = input.runDir ?? input.pilotDir;
  if (!runDir) throw new Error("runDir is required");
  checkInput(input);
  const artifacts: ManifestArtifact[] = [];
  const rows = new Map<DataGroup, Record<string, number>>();
  for (const g of input.groups) {
    const built = await groupArtifacts(runDir, g);
    artifacts.push(...built.artifacts);
    rows.set(g.group, built.rows);
  }
  // `published_rows`: the count is literally the number of published property_improvement rows.
  const published = rows.get("property_improvement")?.property_improvement;
  const emitted = input.coverage.permits_emitted as CoverageCount;
  if (published === undefined)
    throw new Error("coverage.permits_emitted needs the property_improvement group's table");
  if (emitted.count !== published) {
    throw new Error(
      `coverage.permits_emitted.count ${emitted.count} is not the number of published property_improvement rows (${published})`,
    );
  }
  const manifest = RunManifestV1.parse({
    schema: "oracle-travis-run-manifest.v1",
    runId: input.runId,
    county: input.county,
    state: input.state,
    fips: input.fips,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    previousManifestCid: input.previousManifestCid,
    sources: input.sources.map((s) => source(s, fixedLimitation(s.name, input.ownersRedacted))),
    artifacts,
    profiles: input.profiles,
    coverage: input.coverage,
    limitations: input.limitations,
  });
  const bytes = jcsBytes(manifest);
  return { manifest, bytes, cid: await cidOfBytes(bytes) };
}
