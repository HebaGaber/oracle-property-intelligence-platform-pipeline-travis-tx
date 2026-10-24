// A-11: the reusable "build a run manifest from batched outputs" logic behind
// scripts/build-run-manifest.ts (the generalization of scripts/build-run1-manifest.ts, which
// hard-coded Run 1's facts). A follow-up run that captured nothing new (Run 2, the correction
// run) takes its *source* facts, profiles, coverage and limitations from a base manifest (Run 1's
// committed manifest) and only its artifacts, ids and times from the new batch directories.
//
// Every guard stays in the real buildManifest(): CAR root vs CountyTables.county_root, tables
// root, every part CID/size, the 48m bound, the clean-tree gate and `permits_emitted` vs the
// published rows. This module adds only checks that are about *carrying facts over*:
//   - previousManifestCid must equal the CID of the base manifest's bytes;
//   - the sources' watermark/records/captured_at must come out identical to the base's (no new
//     capture means those cannot change);
//   - the carried contractor/permit-link coverage keys must still be true: if the number of
//     published permits differs from the base's, the caller must supply those keys explicitly.
// The output bytes are `built.bytes` (RFC 8785 JCS) written verbatim, never re-serialized.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { RunManifestV1, type CoverageCount } from "@countylens/contract";
import { cidOfBytes } from "./cid.js";
import {
  buildManifest,
  manifestGroupInputsFromBatches,
  type BuildManifestInput,
  type BuiltManifest,
  type ManifestGroupInput,
} from "./manifest.js";
import { parseRunsIndex } from "./runs-index.js";

export const DEFAULT_BASE_MANIFEST = "runs/travis-full-run1-20261023/manifest.json";
export const DEFAULT_AUSTIN_RECEIPT = "specs/011-publish-and-runs/receipts/austin-run1.json";
export const DEFAULT_TCAD_RECEIPT = "specs/011-publish-and-runs/receipts/tcad-run1.json";
export const PILOT_MANIFEST_PATH = "specs/011-publish-and-runs/pilot/manifest.json";
/** Run 1's draft marker; it describes a pre-publish draft and must not travel into a published run. */
const DRAFT_LIMITATION_PREFIX = "DRAFT for Stage 6";

export const CORRECTION_NOTE =
  "Correction run, no new source capture: the Property Improvement group's shared property files were rebuilt so that each permit's property CID equals its County property CID (the previous run's did not join, so none of its permits linked to a County property). The County group's batches are reused unchanged from the previous run.";

const Cid = z.string().min(1);
const Dir = z.string().min(1);

export const RunManifestConfig = z
  .object({
    runId: z.string().min(1),
    startedAt: z.string().min(1),
    finishedAt: z.string().min(1),
    previousManifestCid: Cid,
    /** Directory holding `cars/` and `tables/` of the county batches. */
    countyDir: Dir,
    /** Directory holding `cars/` and `tables/` of the permits (property_improvement) batches. */
    permitsDir: Dir,
    /** Batch numbers; default: every `cars/travis-<group>-bNN.car` found, ascending. */
    countyBatches: z.array(z.number().int().positive()).optional(),
    permitsBatches: z.array(z.number().int().positive()).optional(),
    baseManifest: Dir.default(DEFAULT_BASE_MANIFEST),
    austinReceipt: Dir.default(DEFAULT_AUSTIN_RECEIPT),
    tcadReceipt: Dir.default(DEFAULT_TCAD_RECEIPT),
    /** Replaces carried-over coverage keys (never `permits_emitted`, which is computed). */
    coverageOverrides: z
      .record(
        z.string(),
        z.object({
          count: z.number().int().nonnegative(),
          derivation: z.enum(["published_rows", "capture_receipt", "aggregate_match"]),
          note: z.string().optional(),
        }),
      )
      .optional(),
    /** Linked-permit total for the A-16 #6 reconciliation (unpublished; see buildManifest). */
    linkedPermits: z.number().int().nonnegative().optional(),
    correctionNote: z.string().min(1).default(CORRECTION_NOTE),
  })
  .strict();
export type RunManifestConfig = z.input<typeof RunManifestConfig>;

/**
 * A limitation carried from the base run that states the base's published permit rows
 * ("(17387 rows)") restated with this run's count; any other text is carried unchanged. A
 * published manifest is immutable, so a stale count would stay wrong forever.
 */
export function restatePermitRows(
  limitation: string,
  baseRows: number | undefined,
  rows: number,
): string {
  if (baseRows === undefined || baseRows === rows) return limitation;
  return limitation.split(`(${baseRows} rows)`).join(`(${rows} rows)`);
}

function resolvePath(repoRoot: string, path: string): string {
  return isAbsolute(path) ? path : join(repoRoot, path);
}

/** Batch numbers present as `cars/<prefix>-bNN.car` under `dir`, ascending. */
export function discoverBatches(dir: string, carPrefix: string): number[] {
  const carsDir = join(dir, "cars");
  if (!existsSync(carsDir)) throw new Error(`${carsDir} does not exist`);
  const pattern = new RegExp(`^${carPrefix}-b(\\d+)\\.car$`);
  const numbers = readdirSync(carsDir)
    .map((f) => pattern.exec(f)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  if (numbers.length === 0) throw new Error(`no ${carPrefix}-bNN.car under ${carsDir}`);
  return numbers;
}

function ownersRedactedOf(base: RunManifestV1): number {
  const note = base.sources
    .flatMap((s) => s.limitations)
    .find((l) => l.startsWith("Confidential owner records redacted"));
  const n = note === undefined ? undefined : /:\s*(\d+)\s*$/.exec(note)?.[1];
  if (n === undefined)
    throw new Error("base manifest carries no 'Confidential owner records redacted: N' note");
  return Number(n);
}

/** Sum of `tables.property_improvement.rows` over the permits batches' export summaries. */
function publishedPermitRows(groups: readonly ManifestGroupInput[]): {
  total: number;
  perBatch: string;
} {
  const rows = groups.map((g) => {
    const summary = JSON.parse(readFileSync(g.tablesExportJson, "utf8")) as {
      tables?: Record<string, { rows?: number }>;
    };
    const n = summary.tables?.property_improvement?.rows;
    if (typeof n !== "number")
      throw new Error(`${g.tablesExportJson} has no tables.property_improvement.rows`);
    return n;
  });
  const perBatch = groups
    .map((g, i) => `${/-(b\d+)\.car$/.exec(g.carPath)?.[1] ?? `#${i + 1}`} ${rows[i]}`)
    .join(" + ");
  return { total: rows.reduce((a, b) => a + b, 0), perBatch };
}

export interface BuildRunManifestDeps {
  repoRoot: string;
  /** Injectable for tests; defaults to buildManifest's own `git status` gate. */
  workTreeStatus?: (repoRoot: string) => string;
}

/**
 * Builds the run manifest through the real buildManifest() (all its checks run). Returns the
 * built manifest whose `bytes` are the exact JCS bytes to write.
 */
export async function buildRunManifest(
  rawConfig: RunManifestConfig,
  deps: BuildRunManifestDeps,
): Promise<BuiltManifest> {
  const config = RunManifestConfig.parse(rawConfig);
  const { repoRoot } = deps;
  const basePath = resolvePath(repoRoot, config.baseManifest);
  const baseBytes = readFileSync(basePath);
  const base = RunManifestV1.parse(JSON.parse(baseBytes.toString("utf8")));
  const baseCid = await cidOfBytes(baseBytes);
  if (baseCid !== config.previousManifestCid) {
    throw new Error(
      `previousManifestCid ${config.previousManifestCid} is not the CID of the base manifest ${config.baseManifest} (${baseCid})`,
    );
  }
  if (config.runId === base.runId) throw new Error(`runId ${config.runId} is the base run's id`);

  const countyDir = resolvePath(repoRoot, config.countyDir);
  const permitsDir = resolvePath(repoRoot, config.permitsDir);
  const countyBatches = config.countyBatches ?? discoverBatches(countyDir, "travis-county");
  const permitsBatches = config.permitsBatches ?? discoverBatches(permitsDir, "travis-permits");
  const countyGroups = manifestGroupInputsFromBatches({
    group: "county",
    dir: countyDir,
    carPrefix: "travis-county",
    batches: countyBatches,
  });
  const permitsGroups = manifestGroupInputsFromBatches({
    group: "property_improvement",
    dir: permitsDir,
    carPrefix: "travis-permits",
    batches: permitsBatches,
  });

  // Coverage: carried from the base, `permits_emitted` recomputed from the permits tables.
  const emitted = publishedPermitRows(permitsGroups);
  const baseEmitted = base.coverage.permits_emitted?.count;
  const overrides = config.coverageOverrides ?? {};
  if (emitted.total !== baseEmitted) {
    const stale = Object.keys(base.coverage).filter(
      (k) => k !== "permits_emitted" && !(k in overrides),
    );
    if (stale.length > 0) {
      throw new Error(
        `${emitted.total} permits are published but the base manifest recorded ${String(baseEmitted)}; ` +
          `its other coverage keys no longer apply. Supply coverageOverrides for: ${stale.join(", ")}`,
      );
    }
  }
  const baseNote = base.coverage.permits_emitted?.note ?? "";
  const noteSuffix = baseNote.includes(", ")
    ? baseNote.slice(baseNote.indexOf(", ") + 2)
    : "roofing-classified decided-status permits only";
  const coverage: Record<string, CoverageCount> = {
    ...(base.coverage as Record<string, CoverageCount>),
    ...(overrides as Record<string, CoverageCount>),
    permits_emitted: {
      count: emitted.total,
      derivation: "published_rows",
      note: `${emitted.perBatch}, ${noteSuffix}`,
    },
  };

  const receiptFor = (name: string): string =>
    resolvePath(repoRoot, name.startsWith("austin") ? config.austinReceipt : config.tcadReceipt);
  const input: BuildManifestInput = {
    runId: config.runId,
    county: base.county,
    state: base.state,
    fips: base.fips,
    startedAt: config.startedAt,
    finishedAt: config.finishedAt,
    previousManifestCid: config.previousManifestCid,
    runDir: repoRoot,
    groups: [...countyGroups, ...permitsGroups],
    sources: base.sources.map((s) => ({
      name: s.name,
      url: s.url,
      watermark: s.watermark,
      receipts: receiptFor(s.name),
      limitations: [...s.limitations],
      // No new capture: nothing added, changed or removed since the base run.
      delta: { added: 0, changed: 0, removed: 0 },
    })),
    profiles: base.profiles,
    coverage,
    ownersRedacted: ownersRedactedOf(base),
    limitations: [
      ...base.limitations
        .filter((l) => !l.startsWith(DRAFT_LIMITATION_PREFIX))
        .map((l) => restatePermitRows(l, baseEmitted, emitted.total)),
      config.correctionNote,
    ],
    repoRoot,
    ...(config.linkedPermits === undefined ? {} : { linkedPermits: config.linkedPermits }),
    ...(deps.workTreeStatus === undefined ? {} : { workTreeStatus: deps.workTreeStatus }),
  };

  const built = await buildManifest(input);
  // No new capture: the source facts must come out exactly as the base recorded them.
  for (const [i, s] of built.manifest.sources.entries()) {
    const b = base.sources[i];
    if (
      b === undefined ||
      s.watermark !== b.watermark ||
      s.records !== b.records ||
      s.captured_at !== b.captured_at
    ) {
      throw new Error(
        `source ${s.name}: watermark/records/captured_at differ from the base manifest, but this run has no new capture`,
      );
    }
  }
  return built;
}

export interface OutputPathOptions {
  repoRoot: string;
  runId: string;
  pilot: boolean;
  /** Pilot only: override the default pilot path. */
  out?: string;
}

function isUnder(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Where the manifest goes. A real run: `runs/<runId>/manifest.json`, never overridable, and
 * refused when `runs/index.json` already lists the runId. A pilot: the pilot path, and any path
 * under `runs/` is refused.
 */
export function manifestOutputPath(options: OutputPathOptions): string {
  const runsDir = join(options.repoRoot, "runs");
  if (options.pilot) {
    const path = resolvePath(options.repoRoot, options.out ?? PILOT_MANIFEST_PATH);
    if (isUnder(runsDir, path))
      throw new Error(`a pilot manifest is never written under runs/: ${path}`);
    return path;
  }
  if (options.out !== undefined)
    throw new Error(
      "--out is only for --pilot; a real run is written to runs/<runId>/manifest.json",
    );
  const indexPath = join(runsDir, "index.json");
  if (existsSync(indexPath)) {
    const index = parseRunsIndex(readFileSync(indexPath));
    if (index.runs.some((r) => r.runId === options.runId))
      throw new Error(
        `runs/index.json already lists ${options.runId}; a published manifest never changes`,
      );
  }
  return join(runsDir, options.runId, "manifest.json");
}

export type WriteOutcome = "written" | "unchanged";

/**
 * Writes `built.bytes` verbatim (the exact JCS bytes the manifest CID names). An existing file
 * with identical bytes is left alone; one with different bytes is refused unless `overwrite`.
 */
export function writeManifestBytes(
  path: string,
  built: Pick<BuiltManifest, "bytes">,
  overwrite = false,
): WriteOutcome {
  if (existsSync(path)) {
    const existing = readFileSync(path);
    if (Buffer.from(built.bytes).equals(existing)) return "unchanged";
    if (!overwrite)
      throw new Error(`${path} exists with different bytes; pass --overwrite to replace`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, built.bytes);
  return "written";
}
