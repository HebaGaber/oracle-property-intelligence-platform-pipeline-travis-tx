// A-04: writeGroupWith rewrites only the requested pIDs' zips into the given directory.
// Fake Query DB and an in-memory export; no database, no network.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { coordinateRows, writeGroupWith } from "../services/workflows/tcad-backbone.js";
import { a04Record } from "../../oracle-runtime/test/fixtures/a04/tcad/export.js";
import { sha256Text, type ExportRecordText } from "../../oracle-runtime/travis/tcad/export-stream.js";

const JOB = "travis-a04-20261022040000";
const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};

function fake(answer: (text: string, values: unknown[]) => unknown) {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray | unknown[], ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in strings)) return { helper: strings };
    const text = (strings as unknown as string[]).join("?").replace(/\s+/g, " ").trim();
    queries.push(text);
    return Promise.resolve(answer(text, values));
  }) as unknown as postgres.Sql;
  return { sql, queries };
}

const PIDS = [7001, 7002, 7003];
const rec = (pID: number, i: number): ExportRecordText => {
  const t = JSON.stringify(a04Record({ pID, geoID: `07000000${i}`, ownerName: "Sample Owner LLC" }), null, 1);
  return { ordinal: i, text: t, sha256: sha256Text(t), bytes: Buffer.byteLength(t) };
};

const store = () =>
  fake((text) => {
    if (text.includes("coordinate_source")) {
      return PIDS.map((p) => ({
        request_identifier: String(p),
        latitude: 30.3,
        longitude: -97.7,
        coordinate_source: "gis_centroid",
      }));
    }
    if (text.includes("as_of")) return [{ as_of: "2026-10-20" }];
    return [{ n: 0 }];
  });
const deps = (sql: postgres.Sql, defaultDir: string) => ({
  sql,
  cids: CIDS,
  records: async function* () {
    for (const [i, p] of PIDS.entries()) yield rec(p, i);
  },
  receipt: { sha256: "0".repeat(64), captured_at: "2026-10-20T00:00:00Z" },
  defaultDir,
});

describe("writeGroupWith", () => {
  it("writes the whole group into the default dir when no pIDs are given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grp-"));
    const out = await writeGroupWith(deps(store().sql, dir), JOB);
    expect(out.zips).toBe(3);
    expect(readdirSync(dir).sort()).toEqual(["7001.zip", "7002.zip", "7003.zip"]);
    expect(out.mailing_address_fallback).toBe(0);
    expect(out).not.toHaveProperty("missing_pids");
  });

  it("with pIDs and an out dir writes only those zips there, and names the missing ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grp-"));
    const outDir = mkdtempSync(join(tmpdir(), "regen-"));
    const f = store();
    const out = await writeGroupWith(deps(f.sql, dir), JOB, { pids: ["7002", "9999"], out: outDir });
    expect(out.zips).toBe(1);
    expect(readdirSync(outDir)).toEqual(["7002.zip"]);
    expect(readdirSync(dir)).toEqual([]);
    expect(out.missing_pids).toEqual(["9999"]);
    // the pID filter reaches the SQL, and the whole-run non-R count is not run
    expect(f.queries.some((q) => q.includes("request_identifier IN"))).toBe(true);
    expect(f.queries.some((q) => q.includes("prop_type <> 'R'"))).toBe(false);
  });

  it("counts the mailing addresses that took the unnormalized fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grp-"));
    const d = deps(store().sql, dir);
    d.records = async function* () {
      const raw = a04Record({ pID: 7001, geoID: "070000000" });
      ((raw.owners as Record<string, unknown>[])[0] as Record<string, unknown>).addrCity = "POTOSI SAN LUIS 78153";
      const t = JSON.stringify(raw, null, 1);
      yield { ordinal: 0, text: t, sha256: sha256Text(t), bytes: Buffer.byteLength(t) };
    };
    const out = await writeGroupWith(d, JOB);
    expect(out.mailing_address_fallback).toBe(1);
  });
});

describe("coordinateRows with pIDs", () => {
  it("adds the IN filter only when pIDs are given", async () => {
    const a = fake(() => []);
    await coordinateRows(a.sql, JOB);
    expect(a.queries[0]).not.toContain("IN");
    const b = fake(() => []);
    await coordinateRows(b.sql, JOB, ["1"]);
    expect(b.queries[0]).toContain("request_identifier IN");
  });
});
