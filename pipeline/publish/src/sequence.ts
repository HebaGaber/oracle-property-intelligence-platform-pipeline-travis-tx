// The fixed elephant-cli sequence per data group (oracle § A.3, FR-011):
//   validate <dir> → hash <dir> --output-zip --output-csv --output-car → validate <car>
//   → export-tables <car> --output --part-size 1g --output-json
// No upload and no --atlas-page in A-02 (A-03 adds them). A non-zero exit, a missing output
// or an unparseable printed root stops the whole sequence. The CLI is the workspace pin at
// the repository root (node_modules/.bin/elephant-cli), never a global or Homebrew copy.
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
} from "node:fs";
import { join, sep } from "node:path";

export type DataGroup = "county" | "property_improvement";
export type StepName = "validate" | "hash" | "validate-car" | "export-tables";

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

export interface StepRecord {
  group: DataGroup;
  step: StepName;
  argv: string[];
  exitCode: number;
  outputs: OutputDigest[];
  carRoot?: string;
  blocks?: number;
  tablesRoot?: string;
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
}

export interface SequenceReport {
  ok: boolean;
  steps: StepRecord[];
  groups: GroupResult[];
  failed?: { group: DataGroup; step: StepName; reason: string; stderr: string };
}

export interface SequenceOptions {
  /** County slug used in CAR names (`<county>-<group>.car`). */
  county: string;
  /** The pilot directory holding `groups/<group>/`. */
  pilotDir: string;
  groups: readonly DataGroup[];
  /** The CLI runner; defaults to spawning the workspace-pinned binary. */
  run?: CliRunner;
  repoRoot?: string;
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

/** Spawns the pinned CLI with ELEPHANT_IPFS_GATEWAYS removed (oracle F9). */
export function spawnRunner(bin: string): CliRunner {
  return (argv) =>
    new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.ELEPHANT_IPFS_GATEWAYS;
      const child = spawn(bin, argv, { env, stdio: ["ignore", "pipe", "pipe"] });
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

interface Planned {
  step: StepName;
  argv: string[];
  outputs: string[];
}

function plan(county: string, p: string, group: DataGroup): Planned[] {
  const dir = join(p, "groups", group);
  const car = join(p, "car", `${county}-${group}.car`);
  const tables = join(p, "tables", group);
  const report = (name: string) => join(p, "reports", `${group}-${name}`);
  return [
    {
      step: "validate",
      argv: ["validate", dir, "--output-csv", report("errors.csv")],
      outputs: [report("errors.csv")],
    },
    {
      step: "hash",
      argv: [
        "hash",
        dir,
        "--output-zip",
        // elephant-cli 44bb182 writes --output-zip as a directory of per-property zips.
        join(p, "hashed", group),
        "--output-csv",
        report("hash.csv"),
        "--output-car",
        car,
      ],
      outputs: [join(p, "hashed", group), report("hash.csv"), car],
    },
    {
      step: "validate-car",
      argv: ["validate", car, "--output-csv", report("car-errors.csv")],
      outputs: [report("car-errors.csv")],
    },
    {
      step: "export-tables",
      argv: [
        "export-tables",
        car,
        "--output",
        tables,
        "--part-size",
        "1g",
        "--output-json",
        report("tables-export.json"),
      ],
      outputs: [report("tables-export.json"), join(tables, "tables.car")],
    },
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

export async function runSequence(options: SequenceOptions): Promise<SequenceReport> {
  const run = options.run ?? spawnRunner(resolveCli(options.repoRoot ?? process.cwd()).bin);
  const p = options.pilotDir;
  for (const sub of ["reports", "hashed", "car", "tables"])
    mkdirSync(join(p, sub), { recursive: true });
  const steps: StepRecord[] = [];
  const groups: GroupResult[] = [];
  const stop = (group: DataGroup, step: StepName, reason: string, stderr = ""): SequenceReport => ({
    ok: false,
    steps,
    groups,
    failed: { group, step, reason, stderr },
  });

  for (const group of options.groups) {
    let carRoot = "";
    let blocks = 0;
    let tablesRoot = "";
    for (const planned of plan(options.county, p, group)) {
      const result = await run(planned.argv);
      const record: StepRecord = {
        group,
        step: planned.step,
        argv: planned.argv,
        exitCode: result.code,
        outputs: [],
      };
      steps.push(record);
      if (result.code !== 0)
        return stop(group, planned.step, `exit code ${result.code}`, result.stderr);
      for (const out of planned.outputs) {
        if (!existsSync(out))
          return stop(group, planned.step, `missing output ${out}`, result.stderr);
        record.outputs.push({ path: out, sha256: await sha256Output(out) });
      }
      if (planned.step === "hash") {
        const m = CAR_WRITTEN.exec(result.stdout);
        if (!m) return stop(group, "hash", "hash printed no CAR root", result.stderr);
        blocks = Number(m[1]);
        carRoot = m[2] as string;
        record.blocks = blocks;
        record.carRoot = carRoot;
      }
      if (planned.step === "export-tables") {
        const m = TABLES_WRITTEN.exec(result.stdout);
        if (!m)
          return stop(
            group,
            "export-tables",
            "export-tables printed no tables root",
            result.stderr,
          );
        tablesRoot = m[1] as string;
        record.tablesRoot = tablesRoot;
      }
    }
    const hashCsv = join(p, "reports", `${group}-hash.csv`);
    groups.push({
      group,
      groupDir: join(p, "groups", group),
      carPath: join(p, "car", `${options.county}-${group}.car`),
      carRoot,
      blocks,
      hashCsv,
      dataGroupCids: dataGroupCids(hashCsv),
      tablesDir: join(p, "tables", group),
      tablesRoot,
      tablesExportJson: join(p, "reports", `${group}-tables-export.json`),
    });
  }
  return { ok: true, steps, groups };
}
