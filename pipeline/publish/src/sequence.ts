// The fixed elephant-cli publish order per data group (use-oracle car-publication, FR-001, P0-2):
//   phase 1 (build):   validate <dir> → hash <dir> --output-zip --output-csv --output-car
//                      → validate <car> → export-tables <car> --output --part-size 48m --output-json
//   phase 2 (publish): upload <car> → upload <tables dir>   (Filebase Kubo RPC, --output-json)
// Phase 1 runs for every group before any upload, so no group's CAR is ever public on its own.
// The steps are a fixed plan computed from paths alone: nothing in the options or the
// environment drops one. A non-zero exit, a missing output or an unparseable printed root stops
// every later step. Credentials (FILEBASE_*, IPFS_API_TOKEN) reach the CLI only through the child
// process environment, because argv is written to reports/sequence.json. No --atlas-page: Atlas
// registration is A-11. The CLI is the workspace pin at node_modules/.bin/elephant-cli, commit
// 44bb182 (asserted before the first step), never a global or Homebrew copy.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";

export type DataGroup = "county" | "property_improvement";
export type StepName =
  "validate" | "hash" | "validate-car" | "export-tables" | "upload-car" | "upload-tables";
/** 1 = build (local), 2 = publish (uploads). */
export type Phase = 1 | 2;
export type SequencePhase = "build" | "publish";

/** The pinned elephant-cli commit (root package.json, pnpm-lock.yaml). */
export const CLI_COMMIT = "44bb182";
/** `export-tables --part-size` (ADR-0001 decision 3, D-4): every part stays within 48 MiB. */
export const PART_SIZE = "48m";
export const PART_SIZE_BYTES = 48 * 1024 * 1024;
export const FILEBASE_RPC_API = "https://rpc.filebase.io";
export const FILEBASE_GATEWAY = "https://ipfs.filebase.io";
export const UPLOAD_TIMEOUT_SECONDS = "300";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type CliRunner = (argv: string[]) => Promise<CliResult>;

export interface OutputDigest {
  path: string;
  sha256: string;
}

export interface PlannedStep {
  group: DataGroup;
  step: StepName;
  phase: Phase;
  argv: string[];
  /** Files or directories the step must leave behind. */
  outputs: string[];
}

export interface StepRecord {
  group: DataGroup;
  step: StepName;
  phase: Phase;
  argv: string[];
  exitCode: number;
  outputs: OutputDigest[];
  carRoot?: string;
  blocks?: number;
  tablesRoot?: string;
}

export interface GroupUploads {
  /** `upload <car> --output-json` summary. */
  archiveJson: string;
  /** `upload <tables dir> --output-json` summary. */
  tablesJson: string;
}

export interface GroupResult {
  group: DataGroup;
  groupDir: string;
  carPath: string;
  carRoot: string;
  blocks: number;
  hashCsv: string;
  /** Distinct dataGroupCid values from hash.csv. */
  dataGroupCids: string[];
  tablesDir: string;
  tablesRoot: string;
  tablesExportJson: string;
  /** Present only after both phase-2 uploads of the group succeeded. */
  uploads?: GroupUploads;
}

export interface SequenceFailure {
  group: DataGroup;
  step: StepName;
  reason: string;
  /** Redacted: no secret value from the child environment survives in it. */
  stderr: string;
}

export interface SequenceReport {
  ok: boolean;
  phase: SequencePhase;
  /** The spawned CLI, or null when a runner was injected. */
  pinnedCli: { bin: string; commit: string } | null;
  steps: StepRecord[];
  groups: GroupResult[];
  failed?: SequenceFailure;
}

export interface SequenceOptions {
  /** County slug used in CAR names (`<county>-<group>.car`). */
  county: string;
  /** The run directory holding `groups/<group>/` (pipeline/data/runs/<runId>, gitignored). */
  runDir?: string;
  /** @deprecated A-02 name of `runDir`, kept while travis/pilot/run-pilot.ts calls it. */
  pilotDir?: string;
  groups: readonly DataGroup[];
  /** The CLI runner; defaults to spawning the pinned binary in `runDir` with `env`. */
  run?: CliRunner;
  repoRoot?: string;
  /** The child environment (default process.env). Secret values in it never reach argv or reports. */
  env?: NodeJS.ProcessEnv;
}

const CAR_WRITTEN = /CAR written: .* \((\d+) blocks, root (b[a-z2-7]+)\)/;
const TABLES_WRITTEN = /Tables written: .*root (b[a-z2-7]+)\)/;

export interface ResolvedCli {
  bin: string;
  realPath: string;
  commit: string | null;
}

/** The pinned commit, read from the pnpm store path of the GitHub tarball install. */
export function cliCommitFromPath(path: string): string | null {
  const m = /elephant-cli\+tar\.gz\+([0-9a-f]{7,40})/.exec(path);
  return m ? (m[1] as string) : null;
}

/** The workspace-pinned elephant-cli at the repository root. */
export function resolveCli(repoRoot: string): ResolvedCli {
  const bin = join(repoRoot, "node_modules", ".bin", "elephant-cli");
  if (!existsSync(bin)) {
    throw new Error(
      `elephant-cli is not installed at ${bin}; run pnpm install at the repository root`,
    );
  }
  const pkg = join(repoRoot, "node_modules", "elephant-cli");
  const realPath = existsSync(pkg) ? realpathSync(pkg) : realpathSync(bin);
  return { bin, realPath, commit: cliCommitFromPath(realPath) };
}

/** Throws unless the resolved CLI is the workspace pin at CLI_COMMIT. */
export function assertPinnedCli(cli: ResolvedCli): ResolvedCli {
  if (!cli.commit?.startsWith(CLI_COMMIT)) {
    throw new Error(
      `elephant-cli at ${cli.bin} resolves to ${cli.realPath} (commit ${cli.commit ?? "unknown"}); ` +
        `the publish sequence requires the workspace pin ${CLI_COMMIT}`,
    );
  }
  return cli;
}

const SECRET_NAME = /TOKEN|SECRET|JWT|PASSWORD|ACCESS_KEY|API_KEY|PRIVATE/i;

/** Values of the credential-looking variables in `env` (FILEBASE_SECRET_KEY, IPFS_API_TOKEN, …). */
export function secretValues(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && typeof value === "string" && value !== "")
    .map(([, value]) => value as string);
}

/** `text` with every secret value replaced by `[redacted]`. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}

const CREDENTIAL_FLAGS = new Set(["--token", "--pinata-jwt"]);

/** Argv is recorded in reports: it may carry neither a credential flag nor a secret value. */
function assertCleanArgv(argv: readonly string[], secrets: readonly string[]): void {
  for (const a of argv) {
    if (CREDENTIAL_FLAGS.has(a) || a === "--atlas-page")
      throw new Error(`refusing to pass ${a} to elephant-cli`);
    if (secrets.some((s) => a.includes(s)))
      throw new Error("refusing to pass a credential on argv; credentials go in the child env");
  }
}

/** The child environment: `base` without ELEPHANT_IPFS_GATEWAYS (oracle F9). Credentials stay in it. */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ELEPHANT_IPFS_GATEWAYS;
  return env;
}

/** Spawns the pinned CLI in `cwd` (the run dir, so elephant-cli.log lands there) with `env`. */
export function spawnRunner(
  bin: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): CliRunner {
  const env = childEnv(opts.env);
  const cwd = opts.cwd;
  return (argv) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, argv, {
        ...(cwd === undefined ? {} : { cwd }),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * SHA-256 of a file, or of a directory as the sorted lines "<relative path>\t<sha256>\n"
 * of every file beneath it.
 */
export async function sha256Output(path: string): Promise<string> {
  if (!statSync(path).isDirectory()) return sha256File(path);
  const files = (readdirSync(path, { recursive: true }) as string[])
    .map((f) => f.split(sep).join("/"))
    .filter((f) => statSync(join(path, f)).isFile())
    .sort();
  const lines: string[] = [];
  for (const f of files) lines.push(`${f}\t${await sha256File(join(path, f))}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/** The six steps of one group, phase 1 then phase 2. A pure function of the paths. */
function groupPlan(county: string, runDir: string, group: DataGroup): PlannedStep[] {
  const dir = join(runDir, "groups", group);
  const car = join(runDir, "car", `${county}-${group}.car`);
  const tables = join(runDir, "tables", group);
  const report = (name: string) => join(runDir, "reports", `${group}-${name}`);
  const upload = (input: string, summary: string): string[] => [
    "upload",
    input,
    "--api",
    FILEBASE_RPC_API,
    "--gateway",
    FILEBASE_GATEWAY,
    "--timeout",
    UPLOAD_TIMEOUT_SECONDS,
    "--output-json",
    summary,
  ];
  return [
    {
      group,
      step: "validate",
      phase: 1,
      argv: ["validate", dir, "--output-csv", report("errors.csv")],
      outputs: [report("errors.csv")],
    },
    {
      group,
      step: "hash",
      phase: 1,
      argv: [
        "hash",
        dir,
        "--output-zip",
        // elephant-cli 44bb182 writes --output-zip as a directory of per-property zips.
        join(runDir, "hashed", group),
        "--output-csv",
        report("hash.csv"),
        "--output-car",
        car,
      ],
      outputs: [join(runDir, "hashed", group), report("hash.csv"), car],
    },
    {
      group,
      step: "validate-car",
      phase: 1,
      argv: ["validate", car, "--output-csv", report("car-errors.csv")],
      outputs: [report("car-errors.csv")],
    },
    {
      group,
      step: "export-tables",
      phase: 1,
      argv: [
        "export-tables",
        car,
        "--output",
        tables,
        "--part-size",
        PART_SIZE,
        "--output-json",
        report("tables-export.json"),
      ],
      outputs: [report("tables-export.json"), join(tables, "tables.car")],
    },
    {
      group,
      step: "upload-car",
      phase: 2,
      argv: upload(car, report("archive-upload.json")),
      outputs: [report("archive-upload.json")],
    },
    {
      group,
      step: "upload-tables",
      phase: 2,
      argv: upload(tables, report("tables-upload.json")),
      outputs: [report("tables-upload.json")],
    },
  ];
}

/** Phase 1 for every group: 4 steps per group, nothing uploaded. The `build` command. */
export function planBuild(
  county: string,
  runDir: string,
  groups: readonly DataGroup[],
): PlannedStep[] {
  return groups.flatMap((g) => groupPlan(county, runDir, g).filter((s) => s.phase === 1));
}

/** Phase 1 for every group, then phase 2 for every group: the 12-step publish order. */
export function planPublish(
  county: string,
  runDir: string,
  groups: readonly DataGroup[],
): PlannedStep[] {
  return [
    ...planBuild(county, runDir, groups),
    ...groups.flatMap((g) => groupPlan(county, runDir, g).filter((s) => s.phase === 2)),
  ];
}

/** RFC 4180 CSV: quoted fields (commas, CR/LF and doubled quotes inside), CRLF or LF rows.
 *  Blank lines are dropped. A small hand parser: no CSV dependency in this package. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = (): void => {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    field = "";
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      endRow();
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
    } else field += ch;
    i += 1;
  }
  if (quoted) throw new Error("parseCsv: unterminated quoted field");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Distinct dataGroupCid values of a hash.csv, read by header name, in first-seen order. */
export function dataGroupCids(hashCsv: string): string[] {
  const [header, ...rows] = parseCsv(readFileSync(hashCsv, "utf8"));
  const col = header?.indexOf("dataGroupCid") ?? -1;
  if (col < 0) throw new Error(`${hashCsv}: no dataGroupCid column`);
  return [...new Set(rows.map((r) => r[col] ?? "").filter((v) => v !== ""))];
}

interface GroupState {
  carRoot: string;
  blocks: number;
  tablesRoot: string;
  archiveJson: string;
}

async function execute(phase: SequencePhase, options: SequenceOptions): Promise<SequenceReport> {
  const runDir = options.runDir ?? options.pilotDir;
  if (!runDir) throw new Error("runDir is required");
  const env = options.env ?? process.env;
  const secrets = secretValues(env);
  let pinnedCli: SequenceReport["pinnedCli"] = null;
  let run = options.run;
  if (!run) {
    const pinned = assertPinnedCli(resolveCli(options.repoRoot ?? process.cwd()));
    pinnedCli = { bin: pinned.bin, commit: pinned.commit as string };
    run = spawnRunner(pinned.bin, { cwd: runDir, env });
  }
  for (const sub of ["reports", "hashed", "car", "tables"])
    mkdirSync(join(runDir, sub), { recursive: true });

  const planned =
    phase === "build"
      ? planBuild(options.county, runDir, options.groups)
      : planPublish(options.county, runDir, options.groups);
  const steps: StepRecord[] = [];
  const groups: GroupResult[] = [];
  const state = new Map<DataGroup, GroupState>();
  const finish = (report: SequenceReport): SequenceReport => {
    // argv and redacted stderr; never a credential (those live in the child env).
    writeFileSync(join(runDir, "reports", "sequence.json"), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  };
  const stop = (p: PlannedStep, reason: string, stderr = ""): SequenceReport =>
    finish({
      ok: false,
      phase,
      pinnedCli,
      steps,
      groups,
      failed: { group: p.group, step: p.step, reason, stderr: redact(stderr, secrets) },
    });

  for (const p of planned) {
    assertCleanArgv(p.argv, secrets);
    const result = await run(p.argv);
    const record: StepRecord = {
      group: p.group,
      step: p.step,
      phase: p.phase,
      argv: p.argv,
      exitCode: result.code,
      outputs: [],
    };
    steps.push(record);
    if (result.code !== 0) return stop(p, `exit code ${result.code}`, result.stderr);
    for (const out of p.outputs) {
      if (!existsSync(out)) return stop(p, `missing output ${out}`, result.stderr);
      record.outputs.push({ path: out, sha256: await sha256Output(out) });
    }
    const current = state.get(p.group) ?? {
      carRoot: "",
      blocks: 0,
      tablesRoot: "",
      archiveJson: "",
    };
    state.set(p.group, current);
    if (p.step === "hash") {
      const m = CAR_WRITTEN.exec(result.stdout);
      if (!m) return stop(p, "hash printed no CAR root", result.stderr);
      current.blocks = Number(m[1]);
      current.carRoot = m[2] as string;
      record.blocks = current.blocks;
      record.carRoot = current.carRoot;
    }
    if (p.step === "export-tables") {
      const m = TABLES_WRITTEN.exec(result.stdout);
      if (!m) return stop(p, "export-tables printed no tables root", result.stderr);
      current.tablesRoot = m[1] as string;
      record.tablesRoot = current.tablesRoot;
      const hashCsv = join(runDir, "reports", `${p.group}-hash.csv`);
      groups.push({
        group: p.group,
        groupDir: join(runDir, "groups", p.group),
        carPath: join(runDir, "car", `${options.county}-${p.group}.car`),
        carRoot: current.carRoot,
        blocks: current.blocks,
        hashCsv,
        dataGroupCids: dataGroupCids(hashCsv),
        tablesDir: join(runDir, "tables", p.group),
        tablesRoot: current.tablesRoot,
        tablesExportJson: join(runDir, "reports", `${p.group}-tables-export.json`),
      });
    }
    if (p.step === "upload-car") current.archiveJson = p.outputs[0] as string;
    if (p.step === "upload-tables") {
      const group = groups.find((g) => g.group === p.group);
      if (!group) return stop(p, "upload-tables ran before the group's build steps");
      group.uploads = { archiveJson: current.archiveJson, tablesJson: p.outputs[0] as string };
    }
  }
  return finish({ ok: true, phase, pinnedCli, steps, groups });
}

/** Phase 1 for every group (the `build` command): never uploads. Writes reports/sequence.json. */
export function runBuild(options: SequenceOptions): Promise<SequenceReport> {
  return execute("build", options);
}

/**
 * The full publish order: phase 1 for every group, then the uploads (the `upload` command,
 * gated on PO decision D-8). Writes reports/sequence.json. Readback, the carCid adds and the
 * manifest come after this (upload.ts, readback.ts, kubo-add.ts, manifest.ts).
 */
export function runPublish(options: SequenceOptions): Promise<SequenceReport> {
  return execute("publish", options);
}

/** @deprecated A-02 name of `runBuild`, kept while travis/pilot/run-pilot.ts calls it. */
export const runSequence = runBuild;
