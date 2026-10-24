// A-11: the resumable permits re-export (scripts/reexport-permits.ts). No DB, no network: the
// writer and the DB digests are injected.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareRun,
  layoutFor,
  parsePids,
  runReexport,
  type ReexportDeps,
} from "../scripts/reexport-permits.js";

const CIDS = { seed: "bafkseed", propertyImprovement: "bafkpi" };
const PIDS = Array.from({ length: 12 }, (_, i) => String(100 + i)); // 100..111
const isEmptyPid = (p: string) => p.endsWith("5"); // 105 emits nothing

const roots: string[] = [];
const tmpRun = () => {
  const d = mkdtempSync(join(tmpdir(), "reexport-"));
  roots.push(d);
  return d;
};
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** Every file under dir -> content, relative paths, for byte comparison. */
function snapshot(
  dir: string,
  base = dir,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) snapshot(p, base, out);
    else out[p.slice(base.length)] = readFileSync(p, "utf8");
  }
  return out;
}

function makeDeps(
  opts: { version?: string; failOnCall?: number; digest?: (p: string) => string } = {},
) {
  const calls: string[][] = [];
  const deps: ReexportDeps = {
    codeHash: opts.version ?? "code-v1",
    cidsKey: "cids",
    dbDigests: async (pids) => new Map(pids.map((p) => [p, opts.digest?.(p) ?? `db-${p}`])),
    writeChunk: async (pids, out) => {
      calls.push([...pids]);
      let wrote = 0;
      for (const p of pids) {
        if (isEmptyPid(p)) continue;
        const d = join(out, p, "data");
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "property_improvement_1.json"), `permit ${p}`);
        writeFileSync(join(d, "address.json"), `addr ${p} ${opts.version ?? "code-v1"}`);
        wrote += 1;
        if (opts.failOnCall === calls.length && wrote === 2) throw new Error("killed mid-chunk");
      }
    },
  };
  return { deps, calls };
}

const opts = (run: string, pids = PIDS, concurrency = 2) => ({
  ...layoutFor(run),
  pids,
  chunk: 4,
  concurrency,
});

describe("parsePids", () => {
  it("dedupes, sorts numerically and rejects non-pIDs", () => {
    expect(parsePids("12\n3\n\n12\n")).toEqual(["3", "12"]);
    expect(() => parsePids("../x")).toThrow(/invalid pID/);
  });
});

describe("runReexport", () => {
  it("writes folders, treats no-emit pIDs as empty, and keeps markers outside the group dir", async () => {
    const run = tmpRun();
    const { deps } = makeDeps();
    const s = await runReexport(opts(run), deps);
    expect(s).toMatchObject({
      total: 12,
      done: 12,
      reused: 0,
      redone: 0,
      empty: 1,
      foldersWritten: 11,
      permitFiles: 11,
      failed: null,
    });
    const l = layoutFor(run);
    expect(readdirSync(l.groupDir)).not.toContain("105");
    for (const f of Object.keys(snapshot(l.groupDir)))
      expect(f).toMatch(/^\/\d+\/data\/[a-z_0-9]+\.json$/);
    expect(readdirSync(l.stateDir)).toHaveLength(12);
    expect(readdirSync(run).sort()).toEqual(["groups", "reexport-state"]); // tmp cleaned up
  });

  it("kill mid-run then resume gives a directory byte-identical to a clean run", async () => {
    const clean = tmpRun();
    await runReexport(opts(clean), makeDeps().deps);

    const run = tmpRun();
    const first = await runReexport(opts(run, PIDS, 1), makeDeps({ failOnCall: 2 }).deps);
    expect(first.failed).toMatch(/killed mid-chunk/);
    // chunk 1 is committed, the half-written chunk 2 never shows up in the group dir
    expect(readdirSync(layoutFor(run).groupDir).sort()).toEqual(["100", "101", "102", "103"]);

    const { deps, calls } = makeDeps();
    const second = await runReexport(opts(run), deps);
    expect(second.failed).toBeNull();
    expect(second.reused).toBe(4);
    expect(calls.flat()).not.toContain("100");
    expect(snapshot(layoutFor(run).groupDir)).toEqual(snapshot(layoutFor(clean).groupDir));
  });

  it("reuses everything on a second run with the same fingerprints (pilot then full)", async () => {
    const run = tmpRun();
    const pilot = PIDS.slice(0, 4);
    await runReexport(opts(run, pilot), makeDeps().deps);
    const { deps, calls } = makeDeps();
    const full = await runReexport(opts(run, PIDS), deps);
    expect(calls.flat().sort()).toEqual(PIDS.slice(4).sort()); // pilot pIDs not rewritten
    expect(full.reused).toBe(4);
    expect(full.done).toBe(8);

    const again = makeDeps();
    const third = await runReexport(opts(run, PIDS), again.deps);
    expect(again.calls).toHaveLength(0);
    expect(third).toMatchObject({ reused: 12, done: 0, redone: 0, empty: 1, foldersWritten: 0 });
  });

  it("redoes only the pIDs whose fingerprint changed; a code change redoes all", async () => {
    const run = tmpRun();
    await runReexport(opts(run), makeDeps().deps);
    const one = makeDeps({ digest: (p) => (p === "107" ? "db-changed" : `db-${p}`) });
    const s = await runReexport(opts(run), one.deps);
    expect(one.calls.flat()).toEqual(["107"]);
    expect(s).toMatchObject({ redone: 1, reused: 11 });

    const code = makeDeps({ version: "code-v2" });
    const s2 = await runReexport(opts(run), code.deps);
    expect(s2).toMatchObject({ redone: 12, reused: 0 });
    expect(
      readFileSync(join(layoutFor(run).groupDir, "100", "data", "address.json"), "utf8"),
    ).toContain("code-v2");
  });

  it("redoes a pID whose folder was deleted even if its fingerprint matches", async () => {
    const run = tmpRun();
    await runReexport(opts(run), makeDeps().deps);
    rmSync(join(layoutFor(run).groupDir, "103"), { recursive: true });
    const { deps, calls } = makeDeps();
    await runReexport(opts(run), deps);
    expect(calls.flat()).toEqual(["103"]);
  });
});

describe("compareRun", () => {
  const put = (dir: string, pid: string, files: Record<string, string>) => {
    const d = join(dir, pid, "data");
    mkdirSync(d, { recursive: true });
    for (const [n, t] of Object.entries(files)) writeFileSync(join(d, n), t);
  };
  const permitFiles = {
    "property_improvement_1.json": "p",
    "relationship_property_has_property_improvement_1.json": "r",
    "bafkpi.json": "root",
  };

  it("passes when permit-only files match and shared files differ", () => {
    const [a, b] = [tmpRun(), tmpRun()];
    put(a, "1", {
      ...permitFiles,
      "address.json": "new",
      "bafkseed.json": "new",
      "property.json": "same",
    });
    put(b, "1", {
      ...permitFiles,
      "address.json": "old",
      "bafkseed.json": "old",
      "property.json": "same",
    });
    const r = compareRun(a, b, ["1"], CIDS);
    expect(r.ok).toBe(true);
    expect(r.permitOnlySame).toBe(3);
    expect(r.sharedDiffs.sort()).toEqual(["1/address.json", "1/bafkseed.json"]);
  });

  it("fails when a permit-only file differs, is missing, or the folder set differs", () => {
    const [a, b] = [tmpRun(), tmpRun()];
    put(a, "1", { ...permitFiles, "property_improvement_1.json": "CHANGED" });
    put(b, "1", permitFiles);
    expect(compareRun(a, b, ["1"], CIDS)).toMatchObject({
      ok: false,
      permitOnlyDiffs: ["1/property_improvement_1.json"],
    });

    const [c, d] = [tmpRun(), tmpRun()];
    put(c, "2", permitFiles);
    put(d, "2", { ...permitFiles, "property_improvement_2.json": "x" });
    expect(compareRun(c, d, ["2"], CIDS).ok).toBe(false);

    const [e, f] = [tmpRun(), tmpRun()];
    put(f, "3", permitFiles);
    const r = compareRun(e, f, ["3"], CIDS);
    expect(r.ok).toBe(false);
    expect(r.folderSetDiffs[0]).toMatch(/missing here/);
  });
});
