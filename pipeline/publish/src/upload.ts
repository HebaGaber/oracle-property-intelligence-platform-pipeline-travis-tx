// publishRun: the `upload` command (contracts/cli.md; research R-06; FR-001), after PO decision
// D-8 only. In order:
//   1 runPublish: the 12-step sequence (phase 1 for both groups, then the four uploads);
//   2 readback of every group (readback.ts): roots by digest, part count, every part by size and
//     SHA-256 from the Filebase gateway;
//   3 Kubo add of each .car (the archive and the tables.car of every group) as a plain pinned
//     file; the Hash must be the local raw-leaves CIDv1, which the manifest records as carCid
//     (AM-05, D-5);
//   4 buildManifest from the CLI outputs, the capture receipts and summary.json (never a
//     database); every carCid it records must be one of the adds of step 3;
//   5 Kubo add of the manifest's JCS bytes; the Hash must equal cidOfBytes;
//   6 runs/<runId>/manifest.json (the exact bytes) and runs/index.json (appendRun, exact JCS
//     bytes), written only now and read back from disk before the result says ok.
// A failure before step 6 leaves no manifest and no index. Pre-flight problems (no summary, no
// owners_redacted, a profile without a commit, a runId already in the index) throw before the
// first CLI call. Credentials live in `env` (the child env) only; reports/*.json carry CIDs,
// paths, sizes and digests, with every secret value redacted.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { CoverageCount, type ManifestProfile } from "@countylens/contract";
import { cidOfBytes, cidOfFile } from "./cid.js";
import {
  kuboAddBytes,
  kuboAddFile,
  kuboToken,
  type FetchLike,
  type KuboAddOptions,
} from "./kubo-add.js";
import { buildManifest, type BuildManifestInput, type BuiltManifest } from "./manifest.js";
import {
  listTableParts,
  readbackGroup,
  type ReadbackOptions,
  type ReadbackResult,
} from "./readback.js";
import { appendRun, emptyRunsIndex, parseRunsIndex, runsIndexBytes } from "./runs-index.js";
import {
  redact,
  runPublish,
  secretValues,
  type CliRunner,
  type DataGroup,
  type GroupResult,
  type SequenceReport,
} from "./sequence.js";

/** The data groups A-03 publishes, in CAR order (agent-design oracle § 2). */
export const DATA_GROUPS: readonly DataGroup[] = ["county", "property_improvement"];

const RUN_ID = /^[a-z0-9][a-z0-9-]*$/;

/** The parts of run-month.ts's summary.json the publication needs. */
export const RunSummaryFile = z
  .object({
    runId: z
      .string()
      .regex(RUN_ID)
      .refine((id) => !id.includes("pilot"), "a published run is never the pilot"),
    county: z.object({
      slug: z.string().min(1),
      state: z.string().regex(/^[A-Z]{2}$/),
      fips: z.string().regex(/^\d{5}$/),
    }),
    startedAt: z.string().min(1),
    finishedAt: z.string().min(1),
    coverage: z.record(z.string().min(1), CoverageCount),
    /** TCAD confidentiality redactions applied before validate (P0-15, T082); never defaulted. */
    owners_redacted: z.number().int().nonnegative(),
    sources: z.array(
      z
        .object({
          name: z.string().min(1),
          url: z.string().min(1),
          watermark: z.string().nullable(),
          receipts: z.string().min(1),
          limitations: z.array(z.string()),
        })
        .loose(),
    ),
    profiles: z.array(
      z
        .object({
          name: z.string().min(1),
          version: z.string().min(1),
          sha256: z.string().min(1),
          path: z.string().min(1),
          gitCommit: z.string().nullable(),
        })
        .loose(),
    ),
    groups: z.record(z.string(), z.string()),
    limitations: z.array(z.string()),
  })
  .loose();
export type RunSummaryFile = z.infer<typeof RunSummaryFile>;

/** summary.json of a finished run-month.ts run; its runId must name the run directory. */
export function loadRunSummary(runDir: string): RunSummaryFile {
  const path = join(runDir, "summary.json");
  if (!existsSync(path))
    throw new Error(`${path} is missing: run-month.ts did not finish this run`);
  const parsed = RunSummaryFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`${path} is not a run summary: ${parsed.error.message}`);
  if (parsed.data.runId !== basename(runDir))
    throw new Error(`${path} is the summary of ${parsed.data.runId}, not ${basename(runDir)}`);
  return parsed.data;
}

/** The known data groups the summary lists, in CAR order. */
export function runGroups(summary: RunSummaryFile): DataGroup[] {
  const unknown = Object.keys(summary.groups).filter(
    (g) => !(DATA_GROUPS as readonly string[]).includes(g),
  );
  if (unknown.length > 0)
    throw new Error(`summary.json lists unknown data groups: ${unknown.join(", ")}`);
  const groups = DATA_GROUPS.filter((g) => summary.groups[g] !== undefined);
  if (groups.length === 0) throw new Error("summary.json lists no data group");
  return groups;
}

/** The files of a group that go public: its archive CAR, its tables.car and every part. */
export function publicFiles(group: GroupResult): string[] {
  return [
    group.carPath,
    join(group.tablesDir, "tables.car"),
    ...listTableParts(group.tablesDir).map((p) => p.path),
  ];
}

export interface PublishOptions {
  /** pipeline/data/runs/<runId> (gitignored). */
  runDir: string;
  /** The committed runs/ directory (runs/<runId>/manifest.json, runs/index.json). */
  runsDir: string;
  repoRoot: string;
  /** The child env: credentials live here and nowhere else. */
  env: NodeJS.ProcessEnv;
  run?: CliRunner;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  workTreeStatus?: (repoRoot: string) => string;
  /** Kubo RPC API origin for the adds (default: Filebase). */
  api?: string;
}

export type PublishStage =
  "sequence" | "readback" | "car-add" | "manifest" | "manifest-add" | "index";

export interface PublishFailure {
  stage: PublishStage;
  /** Redacted: no secret value from the child environment survives in it. */
  reason: string;
}

export interface CarAdd {
  group: DataGroup;
  /** Path relative to the run directory (the manifest's artifact name). */
  name: string;
  cid: string;
  size: number;
}

export interface PublishResult {
  ok: boolean;
  runId: string;
  sequence: SequenceReport;
  readback: ReadbackResult[];
  carAdds: CarAdd[];
  manifestCid?: string;
  manifestPath?: string;
  indexPath?: string;
  failed?: PublishFailure;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function profilesOf(summary: RunSummaryFile): ManifestProfile[] {
  return summary.profiles.map((p) => {
    if (p.gitCommit === null)
      throw new Error(`profile ${p.name}@${p.version} has no gitCommit; run from a git checkout`);
    return {
      name: p.name,
      version: p.version,
      sha256: p.sha256,
      path: p.path,
      gitCommit: p.gitCommit,
    };
  });
}

export async function publishRun(options: PublishOptions): Promise<PublishResult> {
  // Pre-flight: everything that can be checked before the first CLI call.
  const summary = loadRunSummary(options.runDir);
  const groups = runGroups(summary);
  const profiles = profilesOf(summary);
  const indexPath = join(options.runsDir, "index.json");
  const index = existsSync(indexPath) ? parseRunsIndex(readFileSync(indexPath)) : emptyRunsIndex();
  if (index.runs.some((r) => r.runId === summary.runId))
    throw new Error(`run ${summary.runId} is already in ${indexPath}; a run is published once`);
  const previousManifestCid = index.runs.at(-1)?.manifestCid ?? null;

  const token = kuboToken(options.env);
  const secrets = [...secretValues(options.env), ...(token === undefined ? [] : [token])];
  const safe = (text: string): string => redact(text, secrets);
  const reportsDir = join(options.runDir, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const readback: ReadbackResult[] = [];
  const carAdds: CarAdd[] = [];
  const finish = (result: PublishResult): PublishResult => {
    writeFileSync(join(reportsDir, "publish.json"), `${safe(JSON.stringify(result, null, 2))}\n`);
    return result;
  };
  const fail = (sequence: SequenceReport, stage: PublishStage, reason: string): PublishResult =>
    finish({
      ok: false,
      runId: summary.runId,
      sequence,
      readback,
      carAdds,
      failed: { stage, reason: safe(reason) },
    });

  // 1 The sequence: phase 1 for every group, then the uploads.
  const sequence = await runPublish({
    county: summary.county.slug,
    runDir: options.runDir,
    groups,
    repoRoot: options.repoRoot,
    env: options.env,
    ...(options.run === undefined ? {} : { run: options.run }),
  });
  if (!sequence.ok) {
    const f = sequence.failed;
    return fail(
      sequence,
      "sequence",
      f === undefined
        ? "the sequence did not finish"
        : `${f.group} ${f.step}: ${f.reason}${f.stderr === "" ? "" : `\n${f.stderr}`}`,
    );
  }

  // 2 Readback of every group from the gateway, before any add.
  const readbackOptions: ReadbackOptions = {
    env: options.env,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.random === undefined ? {} : { random: options.random }),
  };
  for (const g of sequence.groups) readback.push(await readbackGroup(g, readbackOptions));
  writeFileSync(join(reportsDir, "readback.json"), `${safe(JSON.stringify(readback, null, 2))}\n`);
  const bad = readback.filter((r) => !r.ok);
  if (bad.length > 0)
    return fail(
      sequence,
      "readback",
      bad.map((r) => `${r.group}: ${r.problems.join("; ")}`).join("\n"),
    );

  // 3 Each .car as a plain pinned file: the manifest's carCid.
  const addOptions: KuboAddOptions = {
    env: options.env,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.api === undefined ? {} : { api: options.api }),
  };
  for (const g of sequence.groups) {
    for (const path of [g.carPath, join(g.tablesDir, "tables.car")]) {
      const name = relative(options.runDir, path);
      try {
        const added = await kuboAddFile(path, await cidOfFile(path), addOptions);
        carAdds.push({ group: g.group, name, cid: added.cid, size: added.size });
      } catch (error) {
        return fail(sequence, "car-add", `${name}: ${message(error)}`);
      }
    }
  }

  // 4 The manifest, from CLI outputs, receipts and the summary.
  const input: BuildManifestInput = {
    runId: summary.runId,
    county: summary.county.slug,
    state: summary.county.state,
    fips: summary.county.fips,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    previousManifestCid,
    runDir: options.runDir,
    groups: sequence.groups.map((g) => ({
      group: g.group,
      carPath: g.carPath,
      carRoot: g.carRoot,
      tablesDir: g.tablesDir,
      tablesRoot: g.tablesRoot,
      tablesExportJson: g.tablesExportJson,
    })),
    sources: summary.sources.map((s) => ({
      name: s.name,
      url: s.url,
      watermark: s.watermark,
      receipts: isAbsolute(s.receipts) ? s.receipts : join(options.runDir, s.receipts),
      limitations: [...s.limitations],
    })),
    profiles,
    coverage: summary.coverage,
    ownersRedacted: summary.owners_redacted,
    limitations: [...summary.limitations],
    repoRoot: options.repoRoot,
    ...(options.workTreeStatus === undefined ? {} : { workTreeStatus: options.workTreeStatus }),
  };
  let built: BuiltManifest;
  try {
    built = await buildManifest(input);
  } catch (error) {
    return fail(sequence, "manifest", message(error));
  }
  const added = new Set(carAdds.map((a) => a.cid));
  const unpinned = built.manifest.artifacts.filter(
    (a) => (a.kind === "car" || a.kind === "directory") && !added.has(a.carCid ?? ""),
  );
  if (unpinned.length > 0)
    return fail(
      sequence,
      "manifest",
      `carCid not added for ${unpinned.map((a) => a.name).join(", ")}`,
    );

  // 5 The manifest itself, by its exact bytes; the Hash must be cidOfBytes.
  try {
    await kuboAddBytes(built.bytes, "manifest.json", built.cid, addOptions);
  } catch (error) {
    return fail(sequence, "manifest-add", message(error));
  }

  // 6 runs/<runId>/manifest.json and runs/index.json, then read back from disk.
  let next;
  try {
    next = appendRun(index, {
      runId: summary.runId,
      manifestCid: built.cid,
      finishedAt: built.manifest.finishedAt,
    });
  } catch (error) {
    return fail(sequence, "index", message(error));
  }
  const manifestPath = join(options.runsDir, summary.runId, "manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, built.bytes);
  writeFileSync(indexPath, runsIndexBytes(next));
  const writtenCid = await cidOfBytes(readFileSync(manifestPath));
  if (writtenCid !== built.cid)
    return fail(sequence, "index", `${manifestPath} reads back as ${writtenCid}, not ${built.cid}`);
  const listed = parseRunsIndex(readFileSync(indexPath)).runs.find(
    (r) => r.runId === summary.runId,
  );
  if (listed?.manifestCid !== built.cid)
    return fail(sequence, "index", `${indexPath} does not list ${summary.runId} with ${built.cid}`);
  return finish({
    ok: true,
    runId: summary.runId,
    sequence,
    readback,
    carAdds,
    manifestCid: built.cid,
    manifestPath,
    indexPath,
  });
}
