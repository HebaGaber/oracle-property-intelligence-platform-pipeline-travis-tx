// PO 2026-10-25: the carCid-file readback can run on Filebase only; Pinata deferred to A-16 item 14.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { uploadCarFile } from "../src/car-files.js";
import { READBACK_GATEWAYS } from "../src/gateway-readback.js";
import type { KuboAdded } from "../src/kubo-add.js";
import { FILEBASE_GATEWAY } from "../src/sequence.js";

const BYTES = 1234;

function target() {
  const dir = mkdtempSync(join(tmpdir(), "carfile-"));
  const path = join(dir, "travis-county-b01.car");
  writeFileSync(path, Buffer.alloc(BYTES, 1));
  return { name: "cars/travis-county-b01.car", kind: "car" as const, path, carCid: "bafkreitest" };
}

const add = async (): Promise<KuboAdded> => ({
  cid: "bafkreitest",
  name: "travis-county-b01.car",
  size: BYTES,
});

/** Filebase serves the file; any other gateway (Pinata) is too slow and errors. */
const fetchImpl = (async (url: string | URL | Request) => {
  if (String(url).startsWith(FILEBASE_GATEWAY)) return new Response(new Uint8Array(BYTES));
  throw new TypeError("fetch failed");
}) as typeof fetch;

describe("car-files readback gateways", () => {
  it("fails by default when one of the two gateways cannot serve the file", async () => {
    const result = await uploadCarFile(target(), { env: {}, add, fetch: fetchImpl });
    expect(READBACK_GATEWAYS.length).toBe(2);
    expect(result.ok).toBe(false);
  });

  it("passes on Filebase alone when Pinata is deferred, and logs the deferral", async () => {
    const lines: string[] = [];
    const result = await uploadCarFile(target(), {
      env: {},
      add,
      fetch: fetchImpl,
      readbackGateways: [FILEBASE_GATEWAY],
      log: (line) => lines.push(line),
    });
    expect(result.ok).toBe(true);
    expect(result.gateways.map((g) => g.gateway)).toEqual([FILEBASE_GATEWAY]);
    expect(lines.some((l) => l.startsWith("DEFER") && l.includes("A-16 item 14"))).toBe(true);
  });
});
