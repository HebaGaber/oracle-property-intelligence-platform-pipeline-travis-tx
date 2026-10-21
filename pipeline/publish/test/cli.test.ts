// T039's entry point, exercised only with injected runners: `build` runs phase 1 and prints the
// roots, part counts, sizes, SHA-256s and the files that would go public (the D-8 input);
// `upload` loads the Filebase env file into the child env only and hands over to publishRun;
// `cid-copy` hands the manifest to the uploader. Nothing here touches the network, the real
// elephant-cli or ~/.config/assessment/filebase.env.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main, type CidCopyInput, type CliDeps } from "../src/cli.js";
import type { CliRunner } from "../src/sequence.js";
import type { PublishOptions, PublishResult } from "../src/upload.js";

const RUN_ID = "travis-202609-permits-20261021t160000z";
const CAR_ROOT = "baguqeerasords4njcts6vs7qvdjfcvgnume4hqohf65zsfguprqphs3icwea";
const TABLES_ROOT = "baguqeeraa5xaitdmh4ngbzsxbkfnjk5k6t2xd5v4wpxbs6vfzy2t3wnzqqia";
const MANIFEST_CID = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
const SEED = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
const COUNTY_DG = "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq";
/** Fake credentials with the real variable names; never the real values. */
const FAKE = {
  FILEBASE_ACCESS_KEY: "FAKEACCESSKEY000",
  FILEBASE_SECRET_KEY: "fake-secret-key-value-xyz",
  FILEBASE_BUCKET: "countylens-fake",
};

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function arg(argv: string[], flag: string): string {
  const i = argv.indexOf(flag);
  if (i < 0) throw new Error(`missing ${flag}`);
  return argv[i + 1] as string;
}

interface Repo {
  repoRoot: string;
  runDir: string;
  runsDir: string;
  envFile: string;
}

/** A repo root with one finished run (summary.json) and a fake Filebase env file. */
function setup(): Repo {
  const repoRoot = mkdtempSync(join(tmpdir(), "repo-"));
  const runDir = join(repoRoot, "pipeline/data/runs", RUN_ID);
  mkdirSync(join(runDir, "groups/county"), { recursive: true });
  mkdirSync(join(runDir, "groups/property_improvement"), { recursive: true });
  write(
    join(runDir, "summary.json"),
    JSON.stringify({
      runId: RUN_ID,
      county: { slug: "travis", state: "TX", fips: "48453" },
      startedAt: "2026-10-21T14:00:00.000Z",
      finishedAt: "2026-10-21T15:00:00.000Z",
      coverage: { permits_emitted: { count: 2, derivation: "published_rows" } },
      owners_redacted: 0,
      sources: [],
      profiles: [],
      groups: { county: "groups/county", property_improvement: "groups/property_improvement" },
      limitations: [],
    }),
  );
  const envFile = join(repoRoot, "secrets", "filebase.env");
  write(
    envFile,
    [
      "# Filebase (fake values for the test)",
      "",
      `FILEBASE_ACCESS_KEY=${FAKE.FILEBASE_ACCESS_KEY}`,
      `export FILEBASE_SECRET_KEY="${FAKE.FILEBASE_SECRET_KEY}"`,
      `FILEBASE_BUCKET='${FAKE.FILEBASE_BUCKET}'`,
      "",
    ].join("\n"),
  );
  return { repoRoot, runDir, runsDir: join(repoRoot, "runs"), envFile };
}

/** A fake phase-1 CLI: writes what each command writes, one part per table. */
function fakeCli(opts: { failAt?: number } = {}): { run: CliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CliRunner = async (argv) => {
    const index = calls.length;
    calls.push(argv);
    if (index === opts.failAt) return { code: 1, stdout: "", stderr: "validation failed" };
    const cmd = argv[0];
    if (cmd === "validate") write(arg(argv, "--output-csv"), "property_cid,file,error\n");
    if (cmd === "hash") {
      write(join(arg(argv, "--output-zip"), "100008.zip"), "zip");
      write(
        arg(argv, "--output-csv"),
        `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt\n${SEED},${COUNTY_DG},${CAR_ROOT},x/${COUNTY_DG}.json,\n`,
      );
      write(arg(argv, "--output-car"), "car");
      return {
        code: 0,
        stdout: `CAR written: ${arg(argv, "--output-car")} (12 blocks, root ${CAR_ROOT})\n`,
        stderr: "",
      };
    }
    if (cmd === "export-tables") {
      const out = arg(argv, "--output");
      write(join(out, "tables.car"), "tables");
      write(join(out, "property", "part-00000.parquet"), "PAR1 property");
      write(join(out, "structure", "part-00000.parquet"), "PAR1 structure");
      write(
        arg(argv, "--output-json"),
        JSON.stringify({
          root: TABLES_ROOT,
          tables: { property: { rows: 1, parts: 1 }, structure: { rows: 1, parts: 1 } },
        }),
      );
      return {
        code: 0,
        stdout: `Tables written: ${out} (2 tables, 2 parts, root ${TABLES_ROOT})\n`,
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

interface Output {
  out: () => string;
  err: () => string;
  deps: Pick<CliDeps, "stdout" | "stderr">;
}

function capture(): Output {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out: () => out.join(""),
    err: () => err.join(""),
    deps: { stdout: (t) => void out.push(t), stderr: (t) => void err.push(t) },
  };
}

const okResult = (repo: Repo): PublishResult => ({
  ok: true,
  runId: RUN_ID,
  sequence: { ok: true, phase: "publish", pinnedCli: null, steps: [], groups: [] },
  readback: [],
  carAdds: [],
  manifestCid: MANIFEST_CID,
  manifestPath: join(repo.runsDir, RUN_ID, "manifest.json"),
  indexPath: join(repo.runsDir, "index.json"),
});

describe("cli build", () => {
  it("runs phase 1 only and prints roots, part counts, sizes, SHA-256s and the public files", async () => {
    const repo = setup();
    const cli = fakeCli();
    const o = capture();
    const code = await main(["build", "--run", RUN_ID], {
      repoRoot: repo.repoRoot,
      run: cli.run,
      ...o.deps,
    });
    expect(o.err()).toBe("");
    expect(code).toBe(0);
    expect(cli.calls.map((c) => c[0])).toEqual([
      "validate",
      "hash",
      "validate",
      "export-tables",
      "validate",
      "hash",
      "validate",
      "export-tables",
    ]);
    expect(cli.calls.flat()).not.toContain("upload");
    const out = o.out();
    expect(out).toContain(`archive root ${CAR_ROOT}`);
    expect(out).toContain("12 blocks");
    expect(out).toContain(`tables root ${TABLES_ROOT}`);
    expect(out).toContain("2 parts");
    expect(out).toContain(`car/travis-county.car  3 B  sha256 ${sha("car")}`);
    expect(out).toContain(`tables/county/tables.car  6 B  sha256 ${sha("tables")}`);
    expect(out).toContain(
      `tables/county/property/part-00000.parquet  13 B  sha256 ${sha("PAR1 property")}`,
    );
    expect(out).toContain(`tables/property_improvement/structure/part-00000.parquet  14 B`);
    expect(out).toContain("files that would go public: 8");
    expect(out).toMatch(/nothing uploaded/i);
    expect(existsSync(join(repo.runDir, "reports/sequence.json"))).toBe(true);
  });

  it("exits non-zero and names the failed step; no public-files line", async () => {
    const repo = setup();
    const cli = fakeCli({ failAt: 1 });
    const o = capture();
    const code = await main(["build", "--run", RUN_ID], {
      repoRoot: repo.repoRoot,
      run: cli.run,
      ...o.deps,
    });
    expect(code).toBe(1);
    expect(cli.calls).toHaveLength(2);
    expect(o.err()).toMatch(/county hash/);
    expect(o.out()).not.toContain("files that would go public");
  });

  it("refuses a run id that is not a run id", async () => {
    const repo = setup();
    const cli = fakeCli();
    const o = capture();
    const code = await main(["build", "--run", "../etc"], {
      repoRoot: repo.repoRoot,
      run: cli.run,
      ...o.deps,
    });
    expect(code).toBe(1);
    expect(cli.calls).toHaveLength(0);
    expect(o.err()).toMatch(/run id/i);
  });
});

describe("cli upload", () => {
  it("loads the env file into the child env only and hands the run to publishRun", async () => {
    const repo = setup();
    const cli = fakeCli();
    const fetch = vi.fn<(input: string) => Promise<Response>>();
    const publish = vi.fn(async (_options: PublishOptions) => okResult(repo));
    const o = capture();
    expect(process.env.FILEBASE_SECRET_KEY).toBeUndefined();
    const code = await main(["upload", "--run", RUN_ID], {
      repoRoot: repo.repoRoot,
      envFile: repo.envFile,
      env: { PATH: "/usr/bin" },
      run: cli.run,
      fetch,
      publish,
      ...o.deps,
    });
    expect(o.err()).toBe("");
    expect(code).toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
    const options = publish.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      runDir: repo.runDir,
      runsDir: repo.runsDir,
      repoRoot: repo.repoRoot,
      run: cli.run,
      fetch,
    });
    expect(options?.env).toEqual({ PATH: "/usr/bin", ...FAKE });
    expect(process.env.FILEBASE_SECRET_KEY).toBeUndefined();
    expect(process.env.FILEBASE_ACCESS_KEY).toBeUndefined();
    const out = o.out();
    expect(out).toContain(`manifest ${MANIFEST_CID}`);
    expect(out).toContain(join("runs", RUN_ID, "manifest.json"));
    expect(out).toContain(join("runs", "index.json"));
    for (const value of Object.values(FAKE)) expect(out).not.toContain(value);
    expect(out).toContain("FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY, FILEBASE_BUCKET");
  });

  it("accepts credentials already in the env when the file is absent", async () => {
    const repo = setup();
    const publish = vi.fn(async (_options: PublishOptions) => okResult(repo));
    const o = capture();
    const code = await main(["upload", "--run", RUN_ID], {
      repoRoot: repo.repoRoot,
      envFile: join(repo.repoRoot, "absent.env"),
      env: { ...FAKE },
      run: fakeCli().run,
      publish,
      ...o.deps,
    });
    expect(code).toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]?.env).toEqual(FAKE);
  });

  it("stops before any step when the credentials are missing, naming the variables only", async () => {
    const repo = setup();
    const cli = fakeCli();
    const publish = vi.fn(async () => okResult(repo));
    const o = capture();
    const code = await main(["upload", "--run", RUN_ID], {
      repoRoot: repo.repoRoot,
      envFile: join(repo.repoRoot, "absent.env"),
      env: { PATH: "/usr/bin", FILEBASE_ACCESS_KEY: FAKE.FILEBASE_ACCESS_KEY },
      run: cli.run,
      publish,
      ...o.deps,
    });
    expect(code).toBe(1);
    expect(publish).not.toHaveBeenCalled();
    expect(cli.calls).toHaveLength(0);
    const err = o.err();
    expect(err).toContain("FILEBASE_SECRET_KEY");
    expect(err).toContain("FILEBASE_BUCKET");
    expect(err).toContain(join(repo.repoRoot, "absent.env"));
    expect(err).not.toContain(FAKE.FILEBASE_ACCESS_KEY);
  });

  it("exits non-zero with the stage and reason when publishRun fails, redacted", async () => {
    const repo = setup();
    const publish = vi.fn(async (): Promise<PublishResult> => ({
      ok: false,
      runId: RUN_ID,
      sequence: { ok: true, phase: "publish", pinnedCli: null, steps: [], groups: [] },
      readback: [],
      carAdds: [],
      failed: {
        stage: "readback",
        reason: `county: tables/county/property/part-00000.parquet sha256 differs (token ${FAKE.FILEBASE_SECRET_KEY})`,
      },
    }));
    const o = capture();
    const code = await main(["upload", "--run", RUN_ID], {
      repoRoot: repo.repoRoot,
      envFile: repo.envFile,
      env: {},
      run: fakeCli().run,
      publish,
      ...o.deps,
    });
    expect(code).toBe(1);
    expect(o.err()).toContain("readback");
    expect(o.err()).toContain("part-00000.parquet");
    expect(o.err()).toContain("[redacted]");
    expect(o.err()).not.toContain(FAKE.FILEBASE_SECRET_KEY);
    expect(o.out()).not.toContain("manifest ");
  });
});

describe("cli cid-copy", () => {
  it("hands the manifest, its run directory and the env to the uploader", async () => {
    const repo = setup();
    const manifest = join(repo.runsDir, RUN_ID, "manifest.json");
    write(manifest, `{"runId":"${RUN_ID}"}`);
    const cidCopy = vi.fn(async (_input: CidCopyInput) => ({
      ok: true,
      summary: "4 objects written, 0 skipped",
    }));
    const o = capture();
    const code = await main(["cid-copy", "--manifest", join("runs", RUN_ID, "manifest.json")], {
      repoRoot: repo.repoRoot,
      env: { AWS_PROFILE: "assess-cid-writer" },
      cidCopy,
      ...o.deps,
    });
    expect(code).toBe(0);
    expect(cidCopy).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestPath: manifest,
        runDir: repo.runDir,
        repoRoot: repo.repoRoot,
        env: { AWS_PROFILE: "assess-cid-writer" },
      }),
    );
    cidCopy.mock.calls[0]?.[0]?.log("ipfs/bafkreiexample written");
    expect(o.out()).toContain("ipfs/bafkreiexample written");
    expect(o.out()).toContain("4 objects written");
    const failing = vi.fn(async () => ({
      ok: false,
      summary: "ipfs/bafk… exists with other bytes",
    }));
    const o2 = capture();
    expect(
      await main(["cid-copy", "--manifest", join("runs", RUN_ID, "manifest.json")], {
        repoRoot: repo.repoRoot,
        env: {},
        cidCopy: failing,
        ...o2.deps,
      }),
    ).toBe(1);
    expect(o2.err()).toContain("exists with other bytes");
  });

  it("refuses a manifest path outside runs/ or a missing file", async () => {
    const repo = setup();
    const cidCopy = vi.fn(async () => ({ ok: true, summary: "" }));
    const o = capture();
    expect(
      await main(["cid-copy", "--manifest", join(repo.runDir, "summary.json")], {
        repoRoot: repo.repoRoot,
        env: {},
        cidCopy,
        ...o.deps,
      }),
    ).toBe(1);
    expect(
      await main(["cid-copy", "--manifest", join("runs", "nope", "manifest.json")], {
        repoRoot: repo.repoRoot,
        env: {},
        cidCopy,
        ...o.deps,
      }),
    ).toBe(1);
    expect(cidCopy).not.toHaveBeenCalled();
  });
});

describe("cli usage", () => {
  it("prints usage and exits 1 on no command, an unknown command, a missing --run or a credential flag", async () => {
    const repo = setup();
    const cli = fakeCli();
    for (const argv of [
      [],
      ["publish", "--run", RUN_ID],
      ["build"],
      ["build", "--run"],
      ["upload", "--run", RUN_ID, "--token", "x"],
      ["build", "--run", RUN_ID, "--atlas-page", "x"],
      ["build", "--run", RUN_ID, "--skip", "validate"],
    ]) {
      const o = capture();
      const code = await main(argv, { repoRoot: repo.repoRoot, run: cli.run, ...o.deps });
      expect(code, argv.join(" ")).toBe(1);
      expect(o.err(), argv.join(" ")).toMatch(/usage/i);
    }
    expect(cli.calls).toHaveLength(0);
    expect(readFileSync(join(repo.runDir, "summary.json"), "utf8")).toContain(RUN_ID);
  });
});
