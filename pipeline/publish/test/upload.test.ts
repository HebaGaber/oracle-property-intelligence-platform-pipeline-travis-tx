// T028: publishRun, the `upload` command's whole phase 2, against a fake CLI and a fake Kubo RPC:
// sequence (12 steps) → readback (roots by digest, part count, every part by size + SHA-256)
// → Kubo add of each .car (carCid) → manifest → manifest add (CID = cidOfBytes)
// → runs/<runId>/manifest.json + runs/index.json. Any mismatch leaves no manifest and no index.
// No network, no elephant-cli, no credential read from disk: the fake values below carry the
// real variable names only.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { CarWriter } from "@ipld/car/writer";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { describe, expect, it } from "vitest";
import { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { cidOfBytes, cidOfFile } from "../src/cid.js";
import { COMPTROLLER_LIMITATION } from "../src/manifest.js";
import { emptyRunsIndex, appendRun, parseRunsIndex, runsIndexBytes } from "../src/runs-index.js";
import { PART_SIZE_BYTES, planPublish, type CliRunner, type DataGroup } from "../src/sequence.js";
import { RunSummaryFile, loadRunSummary, publicFiles, publishRun } from "../src/upload.js";
import type { FetchLike } from "../src/kubo-add.js";

const RUN_ID = "travis-202609-permits-20261021t160000z";
const GROUPS: readonly DataGroup[] = ["county", "property_improvement"];
const SEED = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
const COUNTY_DG = "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq";
/** Fake credentials with the real variable names; never the real values. */
const ENV = {
  FILEBASE_ACCESS_KEY: "FAKEACCESSKEY000",
  FILEBASE_SECRET_KEY: "fake-secret-key-value-xyz",
  FILEBASE_BUCKET: "countylens-fake",
};
const TOKEN = Buffer.from(
  `${ENV.FILEBASE_ACCESS_KEY}:${ENV.FILEBASE_SECRET_KEY}:${ENV.FILEBASE_BUCKET}`,
).toString("base64");
const SECRETS = [TOKEN, ENV.FILEBASE_SECRET_KEY, ENV.FILEBASE_ACCESS_KEY];

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

function write(path: string, body: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function arg(argv: string[], flag: string): string {
  const i = argv.indexOf(flag);
  if (i < 0) throw new Error(`missing ${flag}`);
  return argv[i + 1] as string;
}

/** The element at `i`, failing the test when it is absent. */
function at<T>(xs: readonly T[], i: number): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at ${i}`);
  return v;
}

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
  write(path, Buffer.concat(chunks));
  return root;
}

interface Add {
  name: string;
  cid: string;
  returned: string;
  bytes: Uint8Array;
  authorization: string | null;
  url: URL;
}

interface Net {
  fetch: FetchLike;
  /** Bytes the fake gateway serves, by CID (filled by the fake CLI's part adds and by `add`). */
  store: Map<string, Uint8Array>;
  adds: Add[];
  gets: string[];
  /** `GET <cid>` and `ADD <name>` in call order. */
  events: string[];
}

interface NetOptions {
  /** Rewrites the Hash `add` returns for one file (default: the local CID of its bytes). */
  addHash?: (name: string, cid: string) => string;
}

/** A fake Filebase: Kubo RPC `add` plus the gateway serving whatever was added. */
function fakeNetwork(opts: NetOptions = {}): Net {
  const store = new Map<string, Uint8Array>();
  const adds: Add[] = [];
  const gets: string[] = [];
  const events: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    if ((init?.method ?? "GET") === "POST") {
      const form = init?.body;
      if (!(form instanceof FormData)) throw new Error("expected a FormData body");
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("expected a `file` field");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const cid = await cidOfBytes(bytes);
      const returned = opts.addHash?.(file.name, cid) ?? cid;
      store.set(cid, bytes);
      adds.push({
        name: file.name,
        cid,
        returned,
        bytes,
        authorization: new Headers(init?.headers ?? {}).get("authorization"),
        url,
      });
      events.push(`ADD ${file.name}`);
      const line = JSON.stringify({ Name: file.name, Hash: returned, Size: String(bytes.length) });
      return new Response(`${line}\n`, { status: 200 });
    }
    const cid = url.pathname.replace(/^\/ipfs\//, "");
    gets.push(url.href);
    events.push(`GET ${cid}`);
    const bytes = store.get(cid);
    return bytes ? new Response(bytes, { status: 200 }) : new Response("", { status: 404 });
  };
  return { fetch, store, adds, gets, events };
}

interface FakeCliOptions {
  /** Fail the call with this zero-based index. */
  failAt?: number;
  /** Serve other bytes for the county `property` part (a readback mismatch). */
  tamperPart?: boolean;
}

/** A fake elephant-cli writing real CARs and tables so the manifest can be built from them. */
function fakeCli(net: Net, opts: FakeCliOptions = {}): { run: CliRunner; calls: string[][] } {
  const calls: string[][] = [];
  const roots = new Map<string, string>();
  const ok = { code: 0, stdout: "", stderr: "" };
  const run: CliRunner = async (argv) => {
    const index = calls.length;
    calls.push(argv);
    if (index === opts.failAt) return { code: 1, stdout: "", stderr: "upload failed: 503" };
    const cmd = argv[0];
    const input = argv[1] as string;
    if (cmd === "validate") {
      write(arg(argv, "--output-csv"), "property_cid,file,error\n");
      return ok;
    }
    if (cmd === "hash") {
      const car = arg(argv, "--output-car");
      write(join(arg(argv, "--output-zip"), "100008.zip"), "zip");
      const root = await writeCar(car, { label: "CountyIndex", group: basename(input) });
      write(
        arg(argv, "--output-csv"),
        `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt\n${SEED},${COUNTY_DG},${root.toString()},x/${COUNTY_DG}.json,\n`,
      );
      roots.set(car, root.toString());
      return { ...ok, stdout: `CAR written: ${car} (1 blocks, root ${root.toString()})\n` };
    }
    if (cmd === "export-tables") {
      const out = arg(argv, "--output");
      const group = basename(out);
      const countyRoot = CID.parse(roots.get(input) as string);
      const names =
        group === "county" ? ["property", "structure"] : ["property", "property_improvement"];
      const tables: Record<string, unknown> = {};
      const summary: Record<string, { rows: number; parts: number }> = {};
      for (const [i, name] of names.entries()) {
        const bytes = text(`PAR1 ${group} ${name} ${i}`);
        write(join(out, name, "part-00000.parquet"), bytes);
        tables[name] = {
          rows: i + 1,
          parts: [{ cid: CID.parse(await cidOfBytes(bytes)), rows: i + 1, bytes: bytes.length }],
        };
        summary[name] = { rows: i + 1, parts: 1 };
      }
      const root = await writeCar(join(out, "tables.car"), {
        label: "CountyTables",
        version: 1,
        county_root: countyRoot,
        part_size_bytes: PART_SIZE_BYTES,
        codec: "zstd",
        tables,
      });
      write(
        arg(argv, "--output-json"),
        JSON.stringify({
          output: out,
          car: join(out, "tables.car"),
          root: root.toString(),
          countyRoot: countyRoot.toString(),
          partSizeBytes: PART_SIZE_BYTES,
          codec: "zstd",
          tables: summary,
          parts: names.length,
          exportedAt: "2026-10-21T15:30:00.000Z",
        }),
      );
      roots.set(out, root.toString());
      return {
        ...ok,
        stdout: `Tables written: ${out} (${names.length} tables, ${names.length} parts, root ${root.toString()})\n`,
      };
    }
    if (cmd === "upload") {
      const summary = arg(argv, "--output-json");
      const api = arg(argv, "--api");
      const gateway = arg(argv, "--gateway");
      const uploadedAt = "2026-10-21T16:10:00.000Z";
      if (input.endsWith(".car")) {
        const root = roots.get(input) as string;
        write(
          summary,
          JSON.stringify({
            api,
            root,
            blocks: 1,
            gatewayUrl: `${gateway}/ipfs/${root}`,
            uploadedAt,
          }),
        );
        return { ...ok, stdout: `Uploaded ${input} (root ${root})\n` };
      }
      // The real CLI adds every part through Kubo: from here on the gateway serves them.
      const parts = (readdirSync(input, { recursive: true }) as string[])
        .map((f) => f.split(sep).join("/"))
        .filter((f) => f.endsWith(".parquet"))
        .sort();
      for (const part of parts) {
        const path = join(input, part);
        const bytes = readFileSync(path);
        const tampered = opts.tamperPart && part === "property/part-00000.parquet";
        net.store.set(await cidOfFile(path), tampered ? text("PAR1 county property X") : bytes);
      }
      const root = roots.get(input) as string;
      const runDir = dirname(dirname(input));
      const countyRoot = roots.get(join(runDir, "car", `travis-${basename(input)}.car`)) as string;
      write(
        summary,
        JSON.stringify({
          api,
          root,
          countyRoot,
          parts: parts.length,
          gatewayUrl: `${gateway}/ipfs/${root}`,
          uploadedAt,
        }),
      );
      return { ...ok, stdout: `Uploaded ${input} (root ${root})\n` };
    }
    return ok;
  };
  return { run, calls };
}

interface Setup {
  repoRoot: string;
  runDir: string;
  runsDir: string;
}

interface SetupOptions {
  /** `null` leaves `owners_redacted` out of the summary. */
  ownersRedacted?: number | null;
}

/** A run directory as run-month.ts leaves it: groups/, capture receipts and summary.json. */
function setup(opts: SetupOptions = {}): Setup {
  const repoRoot = mkdtempSync(join(tmpdir(), "repo-"));
  const runDir = join(repoRoot, "pipeline/data/runs", RUN_ID);
  for (const g of GROUPS) mkdirSync(join(runDir, "groups", g), { recursive: true });
  write(
    join(runDir, "capture/austin/receipts.jsonl"),
    ["A", "B", "C"]
      .map((p, i) =>
        JSON.stringify({
          url: `https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=${p}`,
          captured_at: `2026-10-21T14:00:0${i + 1}.000Z`,
          outcome: "ok",
        }),
      )
      .join("\n") + "\n",
  );
  write(
    join(runDir, "capture/tcad/receipt.json"),
    JSON.stringify({ captured_at: "2026-10-21T14:30:00.000Z", records: 2 }),
  );
  const ownersRedacted = opts.ownersRedacted === undefined ? 1 : opts.ownersRedacted;
  const summary = {
    runId: RUN_ID,
    month: "2026-09",
    jobId: "austin-2026-09",
    county: { slug: "travis", state: "TX", fips: "48453" },
    startedAt: "2026-10-21T14:00:00.000Z",
    finishedAt: "2026-10-21T15:00:00.000Z",
    status: "ok",
    counts: { captured: 3, accepted: 3, excluded: 0, emitted: 2, no_tcad: 1 },
    excluded_by_reason: {},
    needs_review_by_reason: {},
    coverage: {
      permits_captured: { count: 3, derivation: "capture_receipt" },
      permits_emitted: { count: 2, derivation: "published_rows" },
      permits_no_tcad_geoid: { count: 1, derivation: "aggregate_match" },
    },
    ...(ownersRedacted === null ? {} : { owners_redacted: ownersRedacted }),
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-10-20T12:36:38.000Z",
        captured_at: "2026-10-21T14:00:03.000Z",
        records: 3,
        receipts: join(runDir, "capture/austin/receipts.jsonl"),
        limitations: ["one month of issue dates (2026-09); one GET per permit"],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation",
        watermark: `entry@sha256:${"d".repeat(64)}`,
        captured_at: "2026-10-21T14:30:00.000Z",
        records: 2,
        receipts: join(runDir, "capture/tcad/receipt.json"),
        limitations: ["subset: only the parcels the emitted permits point to (geoID = tcad_id)"],
      },
    ],
    profiles: [
      {
        name: "travis-austin",
        version: "1.0.0",
        sha256: "c".repeat(64),
        path: "profiles/travis-austin@1.0.0",
        gitCommit: "17c6cd8",
      },
    ],
    groups: { county: "groups/county", property_improvement: "groups/property_improvement" },
    artifacts: {},
    limitations: ["finishedAt is the end of the capture phase (the data's as-of instant)"],
  };
  write(join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return { repoRoot, runDir, runsDir: join(repoRoot, "runs") };
}

function publish(
  s: Setup,
  net: Net,
  cli: { run: CliRunner },
  extra: Partial<Parameters<typeof publishRun>[0]> = {},
): ReturnType<typeof publishRun> {
  return publishRun({
    runDir: s.runDir,
    runsDir: s.runsDir,
    repoRoot: s.repoRoot,
    env: { PATH: "/usr/bin", ...ENV },
    run: cli.run,
    fetch: net.fetch,
    sleep: async () => {},
    workTreeStatus: () => "",
    ...extra,
  });
}

function expectNoSecret(path: string): void {
  const body = readFileSync(path, "utf8");
  for (const secret of SECRETS)
    expect(body, `${basename(path)} carries a secret`).not.toContain(secret);
}

describe("publishRun: sequence → readback → carCid adds → manifest → manifest add → runs/", () => {
  it("publishes both groups and writes the manifest and the index only after every check", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    expect(result.failed).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.runId).toBe(RUN_ID);

    // 1. The 12-step sequence, county from summary.json.
    expect(cli.calls).toEqual(planPublish("travis", s.runDir, GROUPS).map((p) => p.argv));
    expect(result.sequence.ok).toBe(true);

    // 2. Readback of every part from the Filebase gateway, before any add.
    expect(result.readback.map((r) => [r.group, r.ok, r.partCount])).toEqual([
      ["county", true, 2],
      ["property_improvement", true, 2],
    ]);
    const groups = result.sequence.groups;
    const partPaths = groups.flatMap((g) => publicFiles(g).filter((f) => f.endsWith(".parquet")));
    expect(partPaths).toHaveLength(4);
    const partCids = await Promise.all(partPaths.map((p) => cidOfFile(p)));
    // Two parts are in flight at a time, so the GET order within a group is not fixed.
    expect([...net.gets].sort()).toEqual(
      partCids.map((c) => `https://ipfs.filebase.io/ipfs/${c}`).sort(),
    );
    const firstAdd = net.events.findIndex((e) => e.startsWith("ADD"));
    expect(firstAdd).toBe(4);
    expect(net.events.slice(0, 4).every((e) => e.startsWith("GET"))).toBe(true);

    // 3. Each .car (archive and tables.car) is added as a plain file; the Hash is the local CID.
    expect(net.adds.map((a) => a.name)).toEqual([
      "travis-county.car",
      "tables.car",
      "travis-property_improvement.car",
      "tables.car",
      "manifest.json",
    ]);
    for (const add of net.adds) {
      expect(add.authorization).toBe(`Bearer ${TOKEN}`);
      expect(add.url.pathname).toBe("/api/v0/add");
      expect(add.url.searchParams.get("cid-version")).toBe("1");
      expect(add.url.searchParams.get("raw-leaves")).toBe("true");
      expect(add.url.searchParams.get("pin")).toBe("true");
    }
    expect(result.carAdds.map((a) => [a.group, a.name])).toEqual([
      ["county", "car/travis-county.car"],
      ["county", "tables/county/tables.car"],
      ["property_improvement", "car/travis-property_improvement.car"],
      ["property_improvement", "tables/property_improvement/tables.car"],
    ]);
    for (const a of result.carAdds) expect(a.cid).toBe(await cidOfFile(join(s.runDir, a.name)));

    // 4. The manifest: exact JCS bytes, CID = cidOfBytes = the add's Hash, carCids all added.
    const manifestPath = join(s.runsDir, RUN_ID, "manifest.json");
    expect(result.manifestPath).toBe(manifestPath);
    const bytes = readFileSync(manifestPath);
    expect(bytes.at(-1)).not.toBe(0x0a);
    expect(await cidOfBytes(bytes)).toBe(result.manifestCid);
    expect(Buffer.from(at(net.adds, 4).bytes).equals(bytes)).toBe(true);
    expect(at(net.adds, 4).returned).toBe(result.manifestCid);
    const manifest = RunManifestV1.parse(JSON.parse(bytes.toString("utf8")));
    expect(manifest.runId).toBe(RUN_ID);
    expect(manifest.previousManifestCid).toBeNull();
    const added = new Set(result.carAdds.map((a) => a.cid));
    for (const a of manifest.artifacts.filter((x) => x.kind === "car" || x.kind === "directory"))
      expect(added.has(a.carCid as string), `${a.name} carCid was not added`).toBe(true);
    expect(manifest.sources[0]?.limitations).toContain(COMPTROLLER_LIMITATION);
    expect(manifest.sources[1]?.limitations).toContain(
      "Confidential owner records redacted (Texas Tax Code §25.025): 1",
    );
    expect(manifest.coverage.permits_emitted).toEqual({ count: 2, derivation: "published_rows" });

    // 5. The index: exact JCS bytes, the one run, ordered by finishedAt.
    const indexPath = join(s.runsDir, "index.json");
    expect(result.indexPath).toBe(indexPath);
    const indexBytes = readFileSync(indexPath);
    const index = parseRunsIndex(indexBytes);
    expect(indexBytes.equals(Buffer.from(runsIndexBytes(index)))).toBe(true);
    expect(RunsIndexV1.parse(index).runs).toEqual([
      { runId: RUN_ID, manifestCid: result.manifestCid, finishedAt: "2026-10-21T15:00:00.000Z" },
    ]);

    // 6. Reports without secrets.
    for (const name of ["sequence.json", "readback.json", "publish.json"])
      expectNoSecret(join(s.runDir, "reports", name));
    expectNoSecret(manifestPath);
    expectNoSecret(indexPath);
  });

  it("lists the files that go public for a group: the CAR, tables.car and every part", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    const county = at(result.sequence.groups, 0);
    expect(publicFiles(county)).toEqual([
      join(s.runDir, "car/travis-county.car"),
      join(s.runDir, "tables/county/tables.car"),
      join(s.runDir, "tables/county/property/part-00000.parquet"),
      join(s.runDir, "tables/county/structure/part-00000.parquet"),
    ]);
  });

  it("writes no manifest and makes no add when a part reads back with other bytes", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net, { tamperPart: true });
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("readback");
    expect(result.failed?.reason).toMatch(/county.*property\/part-00000\.parquet/);
    expect(result.readback[0]?.ok).toBe(false);
    expect(net.adds).toHaveLength(0);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
    expect(existsSync(join(s.runDir, "reports/readback.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(s.runDir, "reports/publish.json"), "utf8"))).toMatchObject({
      ok: false,
      failed: { stage: "readback" },
    });
  });

  it("stops at the first .car whose add returns another CID; no manifest", async () => {
    const s = setup();
    const other = await cidOfBytes(text("other"));
    const net = fakeNetwork({ addHash: (name, cid) => (name === "tables.car" ? other : cid) });
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("car-add");
    expect(result.failed?.reason).toContain("tables/county/tables.car");
    expect(net.adds.map((a) => a.name)).toEqual(["travis-county.car", "tables.car"]);
    expect(result.carAdds).toHaveLength(1);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });

  it("writes neither file when the manifest add does not return cidOfBytes", async () => {
    const s = setup();
    const other = await cidOfBytes(text("other"));
    const net = fakeNetwork({ addHash: (name, cid) => (name === "manifest.json" ? other : cid) });
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(false);
    expect(result.failed?.stage).toBe("manifest-add");
    expect(net.adds).toHaveLength(5);
    expect(result.manifestCid).toBeUndefined();
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(existsSync(join(s.runsDir, "index.json"))).toBe(false);
  });

  it("reads nothing back and adds nothing when a sequence step fails", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net, { failAt: 9 });
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(false);
    expect(result.failed).toMatchObject({ stage: "sequence" });
    expect(result.failed?.reason).toMatch(/county upload-tables/);
    expect(cli.calls).toHaveLength(10);
    expect(net.gets).toHaveLength(0);
    expect(net.adds).toHaveLength(0);
    expect(result.readback).toEqual([]);
    expect(existsSync(join(s.runsDir, RUN_ID, "manifest.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(s.runDir, "reports/sequence.json"), "utf8"))).toMatchObject(
      {
        ok: false,
      },
    );
  });

  it("appends to an existing index, keeps the earlier entry byte-identical and links the previous manifest", async () => {
    const s = setup();
    const earlier = {
      runId: "travis-202608-permits-20260920t100000z",
      manifestCid: await cidOfBytes(text("an earlier manifest")),
      finishedAt: "2026-09-20T10:00:00.000Z",
    };
    const before = runsIndexBytes(appendRun(emptyRunsIndex(), earlier));
    write(join(s.runsDir, "index.json"), before);
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(true);
    const index = parseRunsIndex(readFileSync(join(s.runsDir, "index.json")));
    expect(index.runs).toHaveLength(2);
    expect(JSON.stringify(index.runs[0])).toBe(JSON.stringify(earlier));
    expect(index.runs[1]).toEqual({
      runId: RUN_ID,
      manifestCid: result.manifestCid,
      finishedAt: "2026-10-21T15:00:00.000Z",
    });
    const manifest = RunManifestV1.parse(
      JSON.parse(readFileSync(result.manifestPath as string, "utf8")),
    );
    expect(manifest.previousManifestCid).toBe(earlier.manifestCid);
  });

  it("refuses a run already in the index before any step, leaving the committed files alone", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    const first = await publish(s, net, cli);
    expect(first.ok).toBe(true);
    const manifestBefore = readFileSync(first.manifestPath as string);
    const indexBefore = readFileSync(first.indexPath as string);
    const again = fakeCli(net);
    await expect(publish(s, net, again)).rejects.toThrow(RUN_ID);
    expect(again.calls).toHaveLength(0);
    expect(readFileSync(first.manifestPath as string).equals(manifestBefore)).toBe(true);
    expect(readFileSync(first.indexPath as string).equals(indexBefore)).toBe(true);
  });

  it("keeps the credentials in the child env: not in process.env, argv or any report", async () => {
    const s = setup();
    const net = fakeNetwork();
    const cli = fakeCli(net);
    expect(process.env.FILEBASE_SECRET_KEY).toBeUndefined();
    const result = await publish(s, net, cli);
    expect(result.ok).toBe(true);
    expect(process.env.FILEBASE_SECRET_KEY).toBeUndefined();
    expect(process.env.FILEBASE_ACCESS_KEY).toBeUndefined();
    const flat = cli.calls.flat();
    for (const secret of SECRETS) expect(flat.some((a) => a.includes(secret))).toBe(false);
    for (const name of ["sequence.json", "readback.json", "publish.json"])
      expectNoSecret(join(s.runDir, "reports", name));
    expect(JSON.stringify(result)).not.toContain(ENV.FILEBASE_SECRET_KEY);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("fails before the first CLI call when summary.json lacks owners_redacted (P0-15)", async () => {
    const s = setup({ ownersRedacted: null });
    const net = fakeNetwork();
    const cli = fakeCli(net);
    await expect(publish(s, net, cli)).rejects.toThrow(/owners_redacted/);
    expect(cli.calls).toHaveLength(0);
    expect(net.adds).toHaveLength(0);
  });
});

describe("the run summary", () => {
  it("is read from summary.json with the fields the manifest needs", () => {
    const s = setup({ ownersRedacted: 3 });
    const summary = loadRunSummary(s.runDir);
    expect(summary.runId).toBe(RUN_ID);
    expect(summary.county).toEqual({ slug: "travis", state: "TX", fips: "48453" });
    expect(summary.owners_redacted).toBe(3);
    expect(summary.sources.map((x) => x.name)).toEqual([
      "austin-3syk-w9eu",
      "tcad-2026-certified-json",
    ]);
    expect(RunSummaryFile.safeParse({ ...summary, owners_redacted: -1 }).success).toBe(false);
    expect(RunSummaryFile.safeParse({ ...summary, runId: "travis-pilot" }).success).toBe(false);
  });

  it("digests are what the gateway must serve", async () => {
    const bytes = text("PAR1 county property 0");
    expect(sha(bytes)).toMatch(/^[a-f0-9]{64}$/);
  });
});
