// A-16 T079 (AM-10): the Pinata second-copy tool over a fake Pinata API. No network, no real JWT.
// The fake answers pinFileToIPFS with the raw-leaves CIDv1 of the uploaded bytes (what the
// 2026-10-26 probe showed Pinata does with cidVersion 1), unless a test makes it answer another
// CID. Cases: match, mismatch -> unpin at once (+ stop for a manifest), budget stop, already-pinned
// skip, local SHA-256 mismatch skip, --first-only, --dry-run, older manifests checked against
// runs/index.json, 429 backoff, and the JWT never appearing in any output, receipt or summary.
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
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { cidOfBytes } from "../src/cid.js";
import { jcsBytes } from "../src/jcs.js";
import {
  PreconditionError,
  localPathFor,
  runPinataCopy,
  safeName,
  type PinataCopyOptions,
} from "../src/pinata-copy.js";
import type { FetchLike } from "../src/pinata-pin.js";
import { main } from "../scripts/pinata-copy.js";

const JWT = "fake.pinata.jwt-value-that-must-never-appear";
const RUN_ID = "travis-full-run3-20261025";
const sha256Hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

interface Fixture {
  root: string;
  filesRoot: string;
  manifestPath: string;
  manifestCid: string;
  receiptsRoot: string;
  tables: Array<{ name: string; cid: string; size: number; bytes: Uint8Array }>;
}

async function fixture(sizes = [1000, 2000, 3000]): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "pinata-copy-"));
  const filesRoot = join(root, "repo");
  const tables: Fixture["tables"] = [];
  for (const [i, size] of sizes.entries()) {
    const bytes = new Uint8Array(size).fill(i + 1);
    const name = `pipeline/data/runs/${RUN_ID}/tables/t/part-0000${i}.parquet`;
    const path = join(filesRoot, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    tables.push({ name, cid: await cidOfBytes(bytes), size, bytes });
  }
  const manifest = {
    schema: "oracle-travis-run-manifest.v1",
    runId: RUN_ID,
    artifacts: [
      {
        name: "car/county.car",
        cid: "bafyreicarrootxx",
        kind: "car",
        carCid: "bafkreicarfile",
        size: 1,
        sha256: "0".repeat(64),
      },
      ...tables.map((t) => ({
        name: t.name,
        cid: t.cid,
        kind: "table",
        size: t.size,
        sha256: sha256Hex(t.bytes),
      })),
    ],
  };
  const bytes = jcsBytes(manifest);
  const manifestPath = join(filesRoot, "runs", RUN_ID, "manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, bytes);
  return {
    root,
    filesRoot,
    manifestPath,
    manifestCid: await cidOfBytes(bytes),
    receiptsRoot: join(root, "receipts"),
    tables,
  };
}

interface FakeOptions {
  pinned?: string[];
  usage?: { pin_count: number; pin_size_total: number };
  /** Override the CID Pinata answers for an upload named `name`. */
  answer?: (name: string, realCid: string) => string;
  /** Statuses to answer for the first uploads of `name` before succeeding. */
  uploadStatuses?: (name: string) => number[];
  /** Echo the JWT in an error body (to prove redaction). */
  echoJwtOn?: (name: string) => boolean;
}

function fakePinata(opts: FakeOptions = {}) {
  const pinned = new Set(opts.pinned ?? []);
  const uploads: string[] = [];
  const unpins: string[] = [];
  const attempts = new Map<string, number>();
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${JWT}`)
      return new Response("unauthorized", { status: 401 });
    if (url.pathname === "/data/userPinnedDataTotal")
      return Response.json(opts.usage ?? { pin_count: 0, pin_size_total: 0 });
    if (url.pathname === "/data/pinList") {
      const cid = url.searchParams.get("hashContains") ?? "";
      return Response.json({ count: pinned.has(cid) ? 1 : 0, rows: pinned.has(cid) ? [{}] : [] });
    }
    if (url.pathname.startsWith("/pinning/unpin/")) {
      const cid = decodeURIComponent(url.pathname.slice("/pinning/unpin/".length));
      unpins.push(cid);
      pinned.delete(cid);
      return new Response("OK");
    }
    if (url.pathname === "/pinning/pinFileToIPFS") {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 2));
        const form = init?.body as FormData;
        const options = JSON.parse(String(form.get("pinataOptions")));
        if (options.cidVersion !== 1) return new Response("want v1", { status: 400 });
        const name = (JSON.parse(String(form.get("pinataMetadata"))) as { name: string }).name;
        const n = (attempts.get(name) ?? 0) + 1;
        attempts.set(name, n);
        const statuses = opts.uploadStatuses?.(name) ?? [];
        if (n <= statuses.length)
          return new Response(opts.echoJwtOn?.(name) ? `bad token ${JWT}` : "slow down", {
            status: statuses[n - 1] as number,
            headers: { "retry-after": "1" },
          });
        const file = form.get("file") as File;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const real = await cidOfBytes(bytes);
        const cid = opts.answer ? opts.answer(name, real) : real;
        uploads.push(name);
        pinned.add(cid);
        return Response.json({
          IpfsHash: cid,
          PinSize: bytes.length + 11,
          Timestamp: "2026-10-26T10:00:00.000Z",
          ID: `id-${uploads.length}`,
        });
      } finally {
        inFlight -= 1;
      }
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, pinned, uploads, unpins, attempts, maxInFlight: () => maxInFlight };
}

function base(
  f: Fixture,
  fetch: FetchLike,
  lines: string[],
  over: Partial<PinataCopyOptions> = {},
) {
  return {
    jwt: JWT,
    manifestPath: f.manifestPath,
    runId: RUN_ID,
    filesRoot: f.filesRoot,
    receiptsRoot: f.receiptsRoot,
    fetch,
    sleep: async () => {},
    random: () => 0.5,
    now: () => new Date("2026-10-26T10:00:00Z"),
    log: (l: string) => lines.push(l),
    ...over,
  } satisfies PinataCopyOptions;
}

function tbl(f: Fixture, i: number): Fixture["tables"][number] {
  const t = f.tables[i];
  if (t === undefined) throw new Error(`fixture has no table ${i}`);
  return t;
}

function receiptFiles(f: Fixture): string[] {
  const dir = join(f.receiptsRoot, RUN_ID);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe("pinata-copy: match", () => {
  it("uploads the manifest first, then every table, and records a receipt per file", async () => {
    const f = await fixture();
    const gw = fakePinata();
    const lines: string[] = [];
    const result = await runPinataCopy(base(f, gw.fetch, lines));
    expect(result.exitCode).toBe(0);
    expect(gw.uploads[0]).toBe(`runs/${RUN_ID}/manifest.json`);
    expect(gw.uploads.slice(1).sort()).toEqual(f.tables.map((t) => t.name).sort());
    expect(gw.uploads).not.toContain("car/county.car");
    expect(result.summary.counts.pinned).toBe(4);
    expect(result.summary.mismatches).toEqual([]);
    expect(result.summary.usage_before).toEqual({ pinCount: 0, pinSizeTotal: 0 });
    expect(result.summary.usage_after).not.toBeNull();
    expect(receiptFiles(f)).toEqual(
      [
        ...f.tables.map((t) => `${safeName(t.name)}.json`),
        `${safeName(`runs/${RUN_ID}/manifest.json`)}.json`,
        "summary.json",
      ].sort(),
    );
    const receipt = JSON.parse(
      readFileSync(join(f.receiptsRoot, RUN_ID, `${safeName(tbl(f, 0).name)}.json`), "utf8"),
    );
    expect(receipt).toMatchObject({
      cid: tbl(f, 0).cid,
      name: tbl(f, 0).name,
      size: 1000,
      sha256: sha256Hex(tbl(f, 0).bytes),
      pinata_cid: tbl(f, 0).cid,
      match: true,
      pinned_at: "2026-10-26T10:00:00.000Z",
      pin_size: 1011,
      status: "pinned",
    });
    expect(gw.maxInFlight()).toBeLessThanOrEqual(3);
  });
});

describe("pinata-copy: mismatch", () => {
  it("unpins a table whose Pinata CID differs, records it, continues, and exits 1", async () => {
    const f = await fixture();
    const bad = tbl(f, 1);
    const gw = fakePinata({
      answer: (name, real) => (name === bad.name ? "bafkreiwrongcid" : real),
    });
    const lines: string[] = [];
    const result = await runPinataCopy(base(f, gw.fetch, lines));
    expect(result.exitCode).toBe(1);
    expect(gw.unpins).toEqual(["bafkreiwrongcid"]);
    expect(gw.pinned.has("bafkreiwrongcid")).toBe(false);
    expect(result.summary.mismatches).toEqual([
      { name: bad.name, cid: bad.cid, pinata_cid: "bafkreiwrongcid", unpinned: true },
    ]);
    expect(result.summary.counts.pinned).toBe(3);
    const receipt = result.receipts.find((r) => r.name === bad.name);
    expect(receipt).toMatchObject({ status: "mismatch_unpinned", match: false });
    expect(lines.some((l) => l.startsWith("FAIL MISMATCH") && l.includes(bad.name))).toBe(true);
  });

  it("stops after a manifest mismatch (default) and uploads nothing else", async () => {
    const f = await fixture();
    const gw = fakePinata({
      answer: (name, real) => (name.endsWith("manifest.json") ? "QmV0" : real),
    });
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(result.exitCode).toBe(1);
    expect(gw.uploads).toEqual([`runs/${RUN_ID}/manifest.json`]);
    expect(gw.unpins).toEqual(["QmV0"]);
    expect(result.summary.stopped).toBe("mismatch");
    expect(result.summary.left.map((l) => l.status)).toEqual(Array(3).fill("left_stopped"));
  });

  it("--stop-on-mismatch also stops after a table mismatch", async () => {
    const f = await fixture();
    const gw = fakePinata({
      answer: (name, real) => (name === tbl(f, 0).name ? "bafkreiother" : real),
    });
    const result = await runPinataCopy(
      base(f, gw.fetch, [], { stopOnMismatchTable: true, concurrency: 1 }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.summary.stopped).toBe("mismatch");
    expect(result.summary.counts.left_stopped).toBe(2);
  });
});

describe("pinata-copy: budget", () => {
  it("stops cleanly before the first file that does not fit and reports what was left", async () => {
    const f = await fixture([1000, 2000, 3000]);
    const gw = fakePinata();
    const lines: string[] = [];
    const manifestSize = readFileSync(f.manifestPath).length;
    const result = await runPinataCopy(
      base(f, gw.fetch, lines, { budgetBytes: manifestSize + 1000 + 1999, concurrency: 1 }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.summary.stopped).toBe("budget");
    expect(gw.uploads).toEqual([`runs/${RUN_ID}/manifest.json`, tbl(f, 0).name]);
    expect(result.summary.left.map((l) => l.name)).toEqual([tbl(f, 1).name, tbl(f, 2).name]);
    expect(result.summary.bytes.left).toBe(5000);
    expect(lines.some((l) => l.startsWith("stop budget:"))).toBe(true);
  });

  it("defaults the budget to 950 MB minus current usage, and to 500 files minus the pin count", async () => {
    const f = await fixture();
    const gw = fakePinata({ usage: { pin_count: 498, pin_size_total: 949_000_000 } });
    const result = await runPinataCopy(base(f, gw.fetch, [], { concurrency: 1 }));
    expect(result.summary.budget).toEqual({ bytes: 1_000_000, files: 2, source: "usage" });
    expect(result.summary.counts.pinned).toBe(2);
    expect(result.summary.counts.left_budget).toBe(2);
  });
});

describe("pinata-copy: idempotent and local checks", () => {
  it("skips a CID Pinata already lists as pinned", async () => {
    const f = await fixture();
    const gw = fakePinata({ pinned: [f.manifestCid, tbl(f, 2).cid] });
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(result.exitCode).toBe(0);
    expect(gw.uploads.sort()).toEqual([tbl(f, 0).name, tbl(f, 1).name].sort());
    expect(result.summary.counts.already_pinned).toBe(2);
    expect(result.receipts.find((r) => r.cid === f.manifestCid)?.status).toBe("already_pinned");
  });

  it("skips (never uploads) a table whose bytes on disk differ from the manifest, or that is missing", async () => {
    const f = await fixture();
    writeFileSync(join(f.filesRoot, tbl(f, 0).name), new Uint8Array(1000).fill(9));
    const { rmSync } = await import("node:fs");
    rmSync(join(f.filesRoot, tbl(f, 1).name));
    const gw = fakePinata();
    const result = await runPinataCopy(base(f, gw.fetch, []));
    expect(gw.uploads).not.toContain(tbl(f, 0).name);
    expect(gw.uploads).not.toContain(tbl(f, 1).name);
    const reasons = Object.fromEntries(result.summary.skipped.map((s) => [s.name, s.reason]));
    expect(reasons[tbl(f, 0).name]).toMatch(/sha256 on disk/);
    expect(reasons[tbl(f, 1).name]).toMatch(/missing on disk/);
    expect(result.summary.counts.skipped_local).toBe(2);
    expect(result.exitCode).toBe(0);
  });

  it("refuses a manifest that is not its own exact JCS bytes, before any request", async () => {
    const f = await fixture();
    writeFileSync(f.manifestPath, `${readFileSync(f.manifestPath, "utf8")}\n`);
    const gw = fakePinata();
    await expect(runPinataCopy(base(f, gw.fetch, []))).rejects.toBeInstanceOf(PreconditionError);
    expect(gw.uploads).toEqual([]);
  });

  it("checks older manifests against runs/index.json and skips one that does not match", async () => {
    const f = await fixture();
    const good = jcsBytes({ runId: "travis-full-run1-20261023", artifacts: [] });
    const bad = jcsBytes({ runId: "travis-full-run2-20261024", artifacts: [] });
    const goodPath = join(f.root, "run1.json");
    const badPath = join(f.root, "run2.json");
    writeFileSync(goodPath, good);
    writeFileSync(badPath, bad);
    const indexPath = join(f.root, "index.json");
    writeFileSync(
      indexPath,
      JSON.stringify({
        runs: [
          { runId: "travis-full-run1-20261023", manifestCid: await cidOfBytes(good) },
          { runId: "travis-full-run2-20261024", manifestCid: "bafkreinotthisone" },
        ],
      }),
    );
    const gw = fakePinata();
    const result = await runPinataCopy(
      base(f, gw.fetch, [], {
        kinds: ["manifest"],
        runsIndexPath: indexPath,
        extraManifests: [
          { path: goodPath },
          { path: badPath },
          { path: join(f.root, "nope.json") },
        ],
      }),
    );
    expect(gw.uploads).toEqual([
      `runs/${RUN_ID}/manifest.json`,
      "runs/travis-full-run1-20261023/manifest.json",
    ]);
    expect(result.summary.skipped.map((s) => s.reason)).toEqual([
      expect.stringMatching(/runs\/index.json names bafkreinotthisone/),
      "missing on disk",
    ]);
  });

  it("refuses an artifact name that escapes --files-root", () => {
    expect(localPathFor("/a/b", "../c")).toBeNull();
    expect(localPathFor("/a/b", "/etc/passwd")).toBeNull();
    expect(localPathFor("/a/b", "x/y")).toBe("/a/b/x/y");
  });
});

describe("pinata-copy: probe and dry run", () => {
  it("--first-only uploads just the run manifest and stops", async () => {
    const f = await fixture();
    const gw = fakePinata();
    const result = await runPinataCopy(base(f, gw.fetch, [], { firstOnly: true }));
    expect(result.exitCode).toBe(0);
    expect(gw.uploads).toEqual([`runs/${RUN_ID}/manifest.json`]);
    expect(result.summary.first_only).toBe(true);
  });

  it("--dry-run makes no request and writes nothing", async () => {
    const f = await fixture();
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return new Response("", { status: 500 });
    };
    const result = await runPinataCopy(base(f, fetch, [], { dryRun: true, jwt: "" }));
    expect(calls).toBe(0);
    expect(result.summary.counts.planned).toBe(4);
    expect(receiptFiles(f)).toEqual([]);
  });
});

describe("pinata-copy: 429 backoff and JWT redaction", () => {
  it("retries a 429 upload with backoff, then succeeds", async () => {
    const f = await fixture();
    const gw = fakePinata({ uploadStatuses: (n) => (n === tbl(f, 0).name ? [429, 429] : []) });
    const sleeps: number[] = [];
    const result = await runPinataCopy(
      base(f, gw.fetch, [], { sleep: async (ms) => void sleeps.push(ms) }),
    );
    expect(result.exitCode).toBe(0);
    expect(gw.attempts.get(tbl(f, 0).name)).toBe(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("never prints, stores or returns the JWT, even when Pinata echoes it", async () => {
    const f = await fixture();
    const gw = fakePinata({
      uploadStatuses: (n) => (n === tbl(f, 0).name ? [401] : []),
      echoJwtOn: () => true,
    });
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(
      [
        "--manifest",
        f.manifestPath,
        "--run-id",
        RUN_ID,
        "--files-root",
        f.filesRoot,
        "--receipts-root",
        f.receiptsRoot,
        "--runs-index",
        join(f.root, "none.json"),
      ],
      { PINATA_JWT: JWT },
      { out: (l) => out.push(l), err: (l) => err.push(l) },
      { fetch: gw.fetch, sleep: async () => {} },
    );
    expect(code).toBe(1);
    const everything = [
      ...out,
      ...err,
      ...receiptFiles(f).map((n) => readFileSync(join(f.receiptsRoot, RUN_ID, n), "utf8")),
    ].join("\n");
    expect(everything).toContain("[redacted]");
    expect(everything).not.toContain(JWT);
  });

  it("refuses without PINATA_JWT (exit 2) and prints usage on a bad flag", async () => {
    const f = await fixture();
    const err: string[] = [];
    const io = { out: () => {}, err: (l: string) => err.push(l) };
    const args = ["--manifest", f.manifestPath, "--run-id", RUN_ID, "--files-root", f.filesRoot];
    expect(await main(args, {}, io)).toBe(2);
    expect(err.join("\n")).toMatch(/PINATA_JWT is not set/);
    expect(await main([...args, "--kinds", "car"], { PINATA_JWT: JWT }, io)).toBe(2);
  });
});
