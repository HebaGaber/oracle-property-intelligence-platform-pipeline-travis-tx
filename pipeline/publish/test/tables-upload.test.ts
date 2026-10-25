// ERR-33: the resilient tables uploader, against a fake Kubo RPC + gateway (node:http) on 127.0.0.1.
// No real network, no Filebase, nothing is pinned anywhere.
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CarWriter } from "@ipld/car";
import * as dagJson from "@ipld/dag-json";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { afterEach, describe, expect, it } from "vitest";
import { cidOfBytes } from "../src/cid.js";
import { TablesUploadFatal, describeError, uploadTables } from "../src/tables-upload.js";

const ENV = {
  FILEBASE_ACCESS_KEY: "FAKEACCESSKEY000",
  FILEBASE_SECRET_KEY: "fake-secret-key-value-xyz",
  FILEBASE_BUCKET: "countylens-fake",
};
const TOKEN = Buffer.from(
  `${ENV.FILEBASE_ACCESS_KEY}:${ENV.FILEBASE_SECRET_KEY}:${ENV.FILEBASE_BUCKET}`,
).toString("base64");

const PARTS = ["alpha-bytes-0", "bravo-bytes-1", "charlie-bytes-2"];

interface Fixture {
  dir: string;
  root: string;
  rootBytes: Uint8Array;
  countyRoot: string;
  partCids: string[];
}

async function fixture(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), "tables-upload-"));
  const partCids: string[] = [];
  for (const [i, body] of PARTS.entries()) {
    const file = join(dir, "property", `part-${String(i).padStart(5, "0")}.parquet`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    partCids.push(await cidOfBytes(Buffer.from(body)));
  }
  const countyRoot = CID.create(1, dagJson.code, await sha256.digest(Buffer.from("county")));
  const bytes = dagJson.encode({
    label: "CountyTables",
    version: 1,
    county_root: countyRoot,
    tables: {
      property: {
        parts: PARTS.map((body, i) => ({
          cid: CID.parse(partCids[i] as string),
          bytes: body.length,
        })),
      },
    },
  });
  const root = CID.create(1, dagJson.code, await sha256.digest(bytes));
  const { writer, out } = CarWriter.create([root]);
  const chunks: Uint8Array[] = [];
  const done = (async () => {
    for await (const c of out) chunks.push(c);
  })();
  await writer.put({ cid: root, bytes });
  await writer.close();
  await done;
  writeFileSync(join(dir, "tables.car"), Buffer.concat(chunks));
  return {
    dir,
    root: root.toString(),
    rootBytes: bytes,
    countyRoot: countyRoot.toString(),
    partCids,
  };
}

type Handler = (
  call: number,
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
) => boolean | Promise<boolean>;

interface Fake {
  url: string;
  addCalls: Map<string, number>;
  authHeaders: string[];
  importCalls: number;
  rootGets: number;
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
});

async function fake(
  fx: Fixture,
  hooks: {
    add?: Handler;
    rootNotFound?: number;
    hash?: (name: string, cid: string) => string;
  } = {},
): Promise<Fake> {
  const state: Fake = {
    url: "",
    addCalls: new Map(),
    authHeaders: [],
    importCalls: 0,
    rootGets: 0,
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://x");
        if (req.headers.authorization !== undefined)
          state.authHeaders.push(req.headers.authorization);
        if (url.pathname === "/api/v0/add") {
          const body = Buffer.concat(chunks).toString("latin1");
          const name = /filename="([^"]+)"/.exec(body)?.[1] ?? "";
          const call = (state.addCalls.get(name) ?? 0) + 1;
          state.addCalls.set(name, call);
          if (hooks.add !== undefined && (await hooks.add(call, req, res, name))) return;
          const index = Number(/part-(\d+)/.exec(name)?.[1]);
          const cid = fx.partCids[index] as string;
          res.end(
            `${JSON.stringify({ Name: name, Hash: hooks.hash?.(name, cid) ?? cid, Size: "1" })}\n`,
          );
        } else if (url.pathname === "/api/v0/dag/import") {
          state.importCalls += 1;
          res.end(
            `${JSON.stringify({ Root: { Cid: { "/": fx.root }, PinErrorMsg: "" } })}\n${JSON.stringify({ Stats: { BlockCount: 1 } })}\n`,
          );
        } else if (url.pathname === `/ipfs/${fx.root}`) {
          state.rootGets += 1;
          if (state.rootGets <= (hooks.rootNotFound ?? 0)) {
            res.statusCode = 404;
            res.end("not found");
          } else res.end(Buffer.from(fx.rootBytes));
        } else if (url.pathname.startsWith("/ipfs/")) {
          const cid = url.pathname.slice("/ipfs/".length);
          const index = fx.partCids.indexOf(cid);
          if (index < 0) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const size = (PARTS[index] as string).length;
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes 0-0/${size}`);
          res.end("x");
        } else {
          res.statusCode = 404;
          res.end();
        }
      })();
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}

function run(fx: Fixture, f: Fake, extra: Partial<Parameters<typeof uploadTables>[0]> = {}) {
  const logs: string[] = [];
  const promise = uploadTables({
    input: fx.dir,
    env: ENV,
    api: f.url,
    gateway: f.url,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 3))),
    log: (l) => logs.push(l),
    requestTimeoutMs: 400,
    readbackIntervalMs: 5,
    readbackTimeoutMs: 5_000,
    ...extra,
  });
  return { promise, logs };
}

describe("uploadTables", () => {
  it("adds every part, imports tables.car and returns the CLI summary shape", async () => {
    const fx = await fixture();
    const f = await fake(fx);
    const { promise, logs } = run(fx, f);
    const summary = await promise;
    expect(Object.keys(summary).sort()).toEqual(
      ["api", "countyRoot", "gatewayUrl", "parts", "root", "uploadedAt"].sort(),
    );
    expect(summary).toMatchObject({
      api: f.url,
      root: fx.root,
      countyRoot: fx.countyRoot,
      parts: 3,
      gatewayUrl: `${f.url}/ipfs/${fx.root}`,
    });
    expect(f.importCalls).toBe(1);
    expect([...f.addCalls.values()]).toEqual([1, 1, 1]);
    expect(new Set(f.authHeaders)).toEqual(new Set([`Bearer ${TOKEN}`]));
    expect(logs.join("\n")).not.toContain(TOKEN);
  });

  it("retries an add that stalls past the per-request timeout", async () => {
    const fx = await fixture();
    const f = await fake(fx, {
      add: (call, _req, _res, name) => name === "part-00001.parquet" && call === 1, // never answers
    });
    const { promise, logs } = run(fx, f, { requestTimeoutMs: 250 });
    await promise;
    expect(f.addCalls.get("part-00001.parquet")).toBe(2);
    const retry = logs.find((l) => l.startsWith("retry add property/part-00001.parquet"));
    expect(retry).toMatch(/failed after \d+\.\ds: .*TimeoutError/);
  });

  it("retries a 503 twice, then succeeds", async () => {
    const fx = await fixture();
    const f = await fake(fx, {
      add: (call, _req, res, name) => {
        if (name !== "part-00000.parquet" || call > 2) return false;
        res.statusCode = 503;
        res.end("busy");
        return true;
      },
    });
    const { promise, logs } = run(fx, f);
    await promise;
    expect(f.addCalls.get("part-00000.parquet")).toBe(3);
    expect(logs.filter((l) => l.includes("HTTP 503"))).toHaveLength(2);
  });

  it("retries a connection reset and logs the cause code", async () => {
    const fx = await fixture();
    const f = await fake(fx, {
      add: (call, req, _res, name) => {
        if (name !== "part-00002.parquet" || call > 1) return false;
        req.socket.destroy();
        return true;
      },
    });
    const { promise, logs } = run(fx, f);
    await promise;
    expect(f.addCalls.get("part-00002.parquet")).toBe(2);
    expect(logs.find((l) => l.startsWith("retry add"))).toMatch(/UND_ERR_SOCKET|ECONNRESET/);
  });

  it("does not retry a hash mismatch and says so", async () => {
    const fx = await fixture();
    const f = await fake(fx, {
      hash: (name, cid) => (name === "part-00001.parquet" ? (fx.partCids[0] as string) : cid),
    });
    const { promise } = run(fx, f);
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TablesUploadFatal);
    expect((error as Error).message).toMatch(
      /add returned .* for property\/part-00001.parquet but the index records .*; not retried/,
    );
    expect(f.addCalls.get("part-00001.parquet")).toBe(1);
    expect(f.importCalls).toBe(0);
  });

  it("does not retry a 401", async () => {
    const fx = await fixture();
    const f = await fake(fx, {
      add: (_c, _r, res) => {
        res.statusCode = 401;
        res.end("no");
        return true;
      },
    });
    await expect(run(fx, f).promise).rejects.toBeInstanceOf(TablesUploadFatal);
    expect(f.addCalls.get("part-00000.parquet")).toBe(1);
  });

  it("gives up after the retry budget with the last cause", async () => {
    const fx = await fixture();
    const f = await fake(fx, {
      add: (_c, _r, res) => {
        res.statusCode = 500;
        res.end("x");
        return true;
      },
    });
    await expect(run(fx, f, { retries: 2 }).promise).rejects.toThrow(
      /failed after 3 tries \(last: .*HTTP 500/,
    );
    expect(f.addCalls.get("part-00000.parquet")).toBe(3);
  });

  it("waits through gateway 404s and network errors on readback", async () => {
    const fx = await fixture();
    const f = await fake(fx, { rootNotFound: 3 });
    const { promise } = run(fx, f);
    await promise;
    expect(f.rootGets).toBe(4);
  });

  it("fails readback with a clear message after the deadline", async () => {
    const fx = await fixture();
    const f = await fake(fx, { rootNotFound: 1_000_000 });
    await expect(run(fx, f, { readbackTimeoutMs: 80 }).promise).rejects.toThrow(
      /Timed out after \d+s waiting for .* to resolve: gateway answered not found/,
    );
  });

  it("skips parts a sidecar records and keeps the sidecar until success", async () => {
    const fx = await fixture();
    const statePath = join(mkdtempSync(join(tmpdir(), "tables-state-")), "b01.parts.state");
    // First run: part 2 always fails; parts 0 and 1 end up in the sidecar.
    let broken = true;
    const failing = await fake(fx, {
      add: (_c, _r, res, name) => {
        if (!broken || name !== "part-00002.parquet") return false;
        res.statusCode = 500;
        res.end("x");
        return true;
      },
    });
    await expect(run(fx, failing, { retries: 0, statePath }).promise).rejects.toThrow(
      /failed after 1 tries/,
    );
    expect(JSON.parse(readFileSync(statePath, "utf8")).parts).toHaveLength(2);
    // Second run against the same server: only part 2 is added.
    broken = false;
    failing.addCalls.clear();
    const ok = failing;
    const { promise, logs } = run(fx, ok, { statePath });
    await promise;
    expect([...ok.addCalls.keys()]).toEqual(["part-00002.parquet"]);
    expect(logs.filter((l) => l.startsWith("skip "))).toHaveLength(2);
    expect(existsSync(statePath)).toBe(false);
  });

  it("rejects a part whose size differs from the index before any add", async () => {
    const fx = await fixture();
    writeFileSync(join(fx.dir, "property", "part-00001.parquet"), "short");
    const f = await fake(fx);
    await expect(run(fx, f).promise).rejects.toThrow(/is 5 bytes but .* records 13/);
    expect(f.addCalls.size).toBe(0);
  });

  it("adds in parallel when concurrency is raised", async () => {
    const fx = await fixture();
    const f = await fake(fx);
    await run(fx, f, { concurrency: 3 }).promise;
    expect(f.addCalls.size).toBe(3);
  });
});

describe("describeError", () => {
  it("names the cause code", () => {
    const error = new TypeError("fetch failed", {
      cause: Object.assign(new Error("x"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
    });
    expect(describeError(error)).toBe("TypeError UND_ERR_HEADERS_TIMEOUT: fetch failed");
  });
});
