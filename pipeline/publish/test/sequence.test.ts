// T031: the fixed elephant-cli order per data group, no upload, no --atlas-page, stop on non-zero.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cliCommitFromPath, resolveCli, runSequence, type CliRunner } from "../src/sequence.js";

const CAR_ROOT = "baguqeerasords4njcts6vs7qvdjfcvgnume4hqohf65zsfguprqphs3icwea";
const TABLES_ROOT = "baguqeeraa5xaitdmh4ngbzsxbkfnjk5k6t2xd5v4wpxbs6vfzy2t3wnzqqia";
const SEED = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
const COUNTY = "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq";

function arg(argv: string[], flag: string): string {
  const i = argv.indexOf(flag);
  if (i < 0) throw new Error(`missing ${flag}`);
  return argv[i + 1] as string;
}

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** A fake CLI that writes the files each command would write. */
function fakeCli(failOn?: (argv: string[]) => boolean): { run: CliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CliRunner = async (argv) => {
    calls.push(argv);
    if (failOn?.(argv)) return { code: 1, stdout: "", stderr: "validation failed" };
    const cmd = argv[0];
    if (cmd === "validate") write(arg(argv, "--output-csv"), "property_cid,file,error\n");
    if (cmd === "hash") {
      // elephant-cli 44bb182 writes --output-zip as a directory of per-property zips.
      write(join(arg(argv, "--output-zip"), "100008.zip"), "zip");
      write(
        arg(argv, "--output-csv"),
        `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt\n${SEED},${COUNTY},${CAR_ROOT},x/${COUNTY}.json,\n`,
      );
      write(arg(argv, "--output-car"), "car");
      return {
        code: 0,
        stdout: `CAR written: ${arg(argv, "--output-car")} (12 blocks, root ${CAR_ROOT})\n`,
        stderr: "",
      };
    }
    if (cmd === "export-tables") {
      mkdirSync(arg(argv, "--output"), { recursive: true });
      write(join(arg(argv, "--output"), "tables.car"), "tables");
      write(arg(argv, "--output-json"), JSON.stringify({ root: TABLES_ROOT }));
      return {
        code: 0,
        stdout: `Tables written: ${arg(argv, "--output")} (5 tables, 5 parts, root ${TABLES_ROOT})\n`,
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

function setup(): string {
  const p = mkdtempSync(join(tmpdir(), "pilot-"));
  mkdirSync(join(p, "groups/county"), { recursive: true });
  mkdirSync(join(p, "groups/property_improvement"), { recursive: true });
  return p;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("runSequence", () => {
  it("runs validate → hash → validate CAR → export-tables per group, in that order", async () => {
    const p = setup();
    const cli = fakeCli();
    const report = await runSequence({
      county: "travis",
      pilotDir: p,
      groups: ["county", "property_improvement"],
      run: cli.run,
    });
    expect(report.ok).toBe(true);
    expect(cli.calls).toEqual([
      ["validate", `${p}/groups/county`, "--output-csv", `${p}/reports/county-errors.csv`],
      [
        "hash",
        `${p}/groups/county`,
        "--output-zip",
        `${p}/hashed/county`,
        "--output-csv",
        `${p}/reports/county-hash.csv`,
        "--output-car",
        `${p}/car/travis-county.car`,
      ],
      [
        "validate",
        `${p}/car/travis-county.car`,
        "--output-csv",
        `${p}/reports/county-car-errors.csv`,
      ],
      [
        "export-tables",
        `${p}/car/travis-county.car`,
        "--output",
        `${p}/tables/county`,
        "--part-size",
        "1g",
        "--output-json",
        `${p}/reports/county-tables-export.json`,
      ],
      [
        "validate",
        `${p}/groups/property_improvement`,
        "--output-csv",
        `${p}/reports/property_improvement-errors.csv`,
      ],
      [
        "hash",
        `${p}/groups/property_improvement`,
        "--output-zip",
        `${p}/hashed/property_improvement`,
        "--output-csv",
        `${p}/reports/property_improvement-hash.csv`,
        "--output-car",
        `${p}/car/travis-property_improvement.car`,
      ],
      [
        "validate",
        `${p}/car/travis-property_improvement.car`,
        "--output-csv",
        `${p}/reports/property_improvement-car-errors.csv`,
      ],
      [
        "export-tables",
        `${p}/car/travis-property_improvement.car`,
        "--output",
        `${p}/tables/property_improvement`,
        "--part-size",
        "1g",
        "--output-json",
        `${p}/reports/property_improvement-tables-export.json`,
      ],
    ]);
  });

  it("never uploads and never passes --atlas-page", async () => {
    const p = setup();
    const cli = fakeCli();
    await runSequence({ county: "travis", pilotDir: p, groups: ["county"], run: cli.run });
    const flat = cli.calls.flat();
    expect(flat).not.toContain("upload");
    expect(flat).not.toContain("--atlas-page");
    expect(cli.calls.map((c) => c[0])).toEqual(["validate", "hash", "validate", "export-tables"]);
  });

  it("stops at the first non-zero exit and records it", async () => {
    const p = setup();
    const cli = fakeCli((argv) => argv[0] === "validate" && at(argv, 1).endsWith("groups/county"));
    const report = await runSequence({
      county: "travis",
      pilotDir: p,
      groups: ["county", "property_improvement"],
      run: cli.run,
    });
    expect(report.ok).toBe(false);
    expect(cli.calls).toHaveLength(1);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]).toMatchObject({ group: "county", step: "validate", exitCode: 1 });
    expect(report.failed).toMatchObject({ group: "county", step: "validate" });
  });

  it("stops when export-tables fails, before the next group", async () => {
    const p = setup();
    const cli = fakeCli((argv) => argv[0] === "export-tables");
    const report = await runSequence({
      county: "travis",
      pilotDir: p,
      groups: ["county", "property_improvement"],
      run: cli.run,
    });
    expect(report.ok).toBe(false);
    expect(cli.calls.map((c) => c[0])).toEqual(["validate", "hash", "validate", "export-tables"]);
  });

  it("records argv, exit codes, printed roots, dataGroupCid and output sha256 values", async () => {
    const p = setup();
    const cli = fakeCli();
    const report = await runSequence({
      county: "travis",
      pilotDir: p,
      groups: ["county"],
      run: cli.run,
    });
    const [validate, hash, validateCar, exportTables] = report.steps;
    expect(validate).toMatchObject({ step: "validate", exitCode: 0 });
    expect(validate?.outputs).toEqual([
      { path: `${p}/reports/county-errors.csv`, sha256: sha("property_cid,file,error\n") },
    ]);
    expect(hash).toMatchObject({ step: "hash", exitCode: 0, carRoot: CAR_ROOT, blocks: 12 });
    expect(hash?.argv[0]).toBe("hash");
    expect(hash?.outputs.map((o) => o.path)).toEqual([
      `${p}/hashed/county`,
      `${p}/reports/county-hash.csv`,
      `${p}/car/travis-county.car`,
    ]);
    // A directory output is digested as sorted "<relative path>\t<sha256>\n" lines.
    expect(hash?.outputs[0]?.sha256).toBe(sha(`100008.zip\t${sha("zip")}\n`));
    expect(validateCar).toMatchObject({ step: "validate-car", exitCode: 0 });
    expect(exportTables).toMatchObject({
      step: "export-tables",
      exitCode: 0,
      tablesRoot: TABLES_ROOT,
    });
    expect(exportTables?.outputs.map((o) => o.path)).toEqual([
      `${p}/reports/county-tables-export.json`,
      `${p}/tables/county/tables.car`,
    ]);
    expect(report.groups).toEqual([
      {
        group: "county",
        groupDir: `${p}/groups/county`,
        carPath: `${p}/car/travis-county.car`,
        carRoot: CAR_ROOT,
        blocks: 12,
        hashCsv: `${p}/reports/county-hash.csv`,
        dataGroupCids: [COUNTY],
        tablesDir: `${p}/tables/county`,
        tablesRoot: TABLES_ROOT,
        tablesExportJson: `${p}/reports/county-tables-export.json`,
      },
    ]);
  });

  it("fails a step whose expected output is missing even with exit 0", async () => {
    const p = setup();
    const run: CliRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    const report = await runSequence({ county: "travis", pilotDir: p, groups: ["county"], run });
    expect(report.ok).toBe(false);
    expect(report.failed?.reason).toMatch(/missing output/);
  });

  it("fails when hash prints no CAR root", async () => {
    const p = setup();
    const cli = fakeCli();
    const run: CliRunner = async (argv) => {
      const r = await cli.run(argv);
      return argv[0] === "hash" ? { ...r, stdout: "done\n" } : r;
    };
    const report = await runSequence({ county: "travis", pilotDir: p, groups: ["county"], run });
    expect(report.ok).toBe(false);
    expect(report.failed).toMatchObject({ step: "hash" });
  });
});

describe("resolveCli", () => {
  it("uses the workspace-pinned binary at the repo root, never a global one", () => {
    const root = mkdtempSync(join(tmpdir(), "repo-"));
    write(join(root, "node_modules/.bin/elephant-cli"), "#!/bin/sh\n");
    expect(resolveCli(root).bin).toBe(join(root, "node_modules/.bin/elephant-cli"));
  });

  it("throws when the workspace pin is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "repo-"));
    expect(existsSync(join(root, "node_modules"))).toBe(false);
    expect(() => resolveCli(root)).toThrow(/pnpm install/);
  });

  it("reads the pinned commit from the pnpm store path", () => {
    expect(
      cliCommitFromPath(
        "/r/node_modules/.pnpm/@elephant-xyz+cli@https+++codeload.github.com+elephant-xyz+elephant-cli+tar.gz+44bb182b_7205/node_modules/@elephant-xyz/cli",
      ),
    ).toBe("44bb182b");
    expect(cliCommitFromPath("/opt/homebrew/lib/node_modules/@elephant-xyz/cli")).toBeNull();
  });
});

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}
