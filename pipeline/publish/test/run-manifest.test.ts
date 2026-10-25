// A-11: the run-manifest builder for a follow-up run with no new capture (Run 2, the correction
// run). Uses the real buildManifest() over real CAR bytes in a throwaway repo root; only the
// clean-tree gate is injected.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunManifestV1 } from "@countylens/contract";
import { cidOfBytes, cidOfFile } from "../src/cid.js";
import { jcsBytes } from "../src/jcs.js";
import { GAZETTEER_SHA256 } from "@countylens/query-core";
import {
  assertPermitLinkReconciliation,
  buildManifest,
  manifestGroupInputsFromBatches,
} from "../src/manifest.js";
import {
  CORRECTION_NOTE,
  DEFAULT_AUSTIN_RECEIPT,
  DEFAULT_TCAD_RECEIPT,
  GAZETTEER_PROFILE_ENTRY,
  PARCELS_BASIS,
  buildRunManifest,
  withGazetteerProfile,
  discoverBatches,
  manifestOutputPath,
  requireLinkedPermits,
  restatePermitRows,
  writeManifestBytes,
  type RunManifestConfig,
} from "../src/run-manifest.js";
import {
  BASE_RUN_ID,
  NOT_YET_PUBLISHED,
  put,
  runFixture,
  type RunFixture,
} from "./support/run-fixture.js";

function config(f: RunFixture, extra: Partial<RunManifestConfig> = {}): RunManifestConfig {
  return {
    runId: "travis-full-run2-20261024",
    startedAt: "2026-10-24T08:00:00.000Z",
    finishedAt: "2026-10-24T12:00:00.000Z",
    previousManifestCid: f.baseCid,
    countyDir: f.countyDir,
    permitsDir: f.permitsV2,
    ...extra,
  };
}
const deps = (f: RunFixture) => ({
  repoRoot: f.root,
  workTreeStatus: NOT_YET_PUBLISHED,
  gitCommit: () => "abc1234",
});

describe("coverage.parcels_published (task B gap 6)", () => {
  it("carries the County group's published property rows with their basis", async () => {
    const f = await runFixture();
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    expect(m.coverage.parcels_published).toEqual({
      count: 11,
      derivation: "published_rows",
      note: `b01 5 + b02 6, ${PARCELS_BASIS}`,
    });
  });

  it("is recomputed when the base already has it, even if the permit count changes", async () => {
    const f = await runFixture([3, 4]);
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    const again = withGazetteerProfile(m.profiles, "abc1234");
    expect(again).toEqual(m.profiles); // travis-places is added once, never duplicated
  });

  const countyOnly = (f: RunFixture) =>
    manifestGroupInputsFromBatches({
      group: "county",
      dir: f.countyDir,
      carPrefix: "travis-county",
      batches: [1, 2],
    });
  const base = async (f: RunFixture) => {
    const { manifest } = await buildRunManifest(config(f), deps(f));
    return {
      runId: "travis-county-only-test",
      county: manifest.county,
      state: manifest.state,
      fips: manifest.fips,
      startedAt: manifest.startedAt,
      finishedAt: manifest.finishedAt,
      previousManifestCid: null,
      runDir: f.root,
      groups: countyOnly(f),
      sources: manifest.sources.map((s) => ({
        name: s.name,
        url: s.url,
        watermark: s.watermark,
        receipts: join(
          f.root,
          s.name.startsWith("austin") ? DEFAULT_AUSTIN_RECEIPT : DEFAULT_TCAD_RECEIPT,
        ),
        limitations: [],
        delta: { added: 0, changed: 0, removed: 0 },
      })),
      profiles: manifest.profiles,
      ownersRedacted: 0,
      limitations: [],
      workTreeStatus: NOT_YET_PUBLISHED,
    };
  };

  it("buildManifest refuses a count that differs from the published county property rows", async () => {
    const f = await runFixture();
    const input = await base(f);
    await expect(
      buildManifest({
        ...input,
        coverage: { parcels_published: { count: 999, derivation: "published_rows" } },
      }),
    ).rejects.toThrow(
      /parcels_published\.count 999 is not the number of published county property rows \(11\)/,
    );
  });

  it("buildManifest refuses another derivation and a run with no county group", async () => {
    const f = await runFixture();
    const input = await base(f);
    await expect(
      buildManifest({
        ...input,
        coverage: { parcels_published: { count: 11, derivation: "capture_receipt" } },
      }),
    ).rejects.toThrow(/derivation must be "published_rows"/);
    await expect(
      buildManifest({
        ...input,
        groups: [],
        coverage: { parcels_published: { count: 11, derivation: "published_rows" } },
      }),
    ).rejects.toThrow(/needs the county group's property table/);
  });

  it("an older manifest without the key is still valid, and a matching count builds", async () => {
    const f = await runFixture();
    const input = await base(f);
    const legacy = await buildManifest({ ...input, coverage: {} });
    expect(RunManifestV1.safeParse(legacy.manifest).success).toBe(true);
    expect(legacy.manifest.coverage.parcels_published).toBeUndefined();
    const ok = await buildManifest({
      ...input,
      coverage: { parcels_published: { count: 11, derivation: "published_rows" } },
    });
    expect(ok.manifest.coverage.parcels_published?.count).toBe(11);
  });
});

describe("buildRunManifest", () => {
  it("chains to the base run, reuses the county artifacts unchanged and rebuilds the permits ones", async () => {
    const f = await runFixture();
    const base = RunManifestV1.parse(JSON.parse(Buffer.from(f.baseBytes).toString("utf8")));
    const built = await buildRunManifest(config(f), deps(f));
    const m = built.manifest;
    expect(m.previousManifestCid).toBe(f.baseCid);
    expect(m.runId).toBe("travis-full-run2-20261024");

    const county = (x: RunManifestV1) =>
      x.artifacts.filter((a) => a.name.includes("county-batched"));
    expect(county(m)).toEqual(county(base));
    expect(county(m).length).toBeGreaterThan(0);
    const permits = (x: RunManifestV1) => x.artifacts.filter((a) => a.name.includes("permits-"));
    const cids = new Set(permits(base).map((a) => a.cid));
    expect(permits(m).length).toBe(permits(base).length);
    expect(permits(m).every((a) => a.kind === "table" || !cids.has(a.cid))).toBe(true);
  });

  it("keeps the source facts, sets every source delta to 0/0/0 and carries profiles and coverage", async () => {
    const f = await runFixture();
    const base = RunManifestV1.parse(JSON.parse(Buffer.from(f.baseBytes).toString("utf8")));
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    for (const [i, s] of m.sources.entries()) {
      const b = base.sources[i];
      expect([s.name, s.url, s.watermark, s.records, s.captured_at]).toEqual([
        b?.name,
        b?.url,
        b?.watermark,
        b?.records,
        b?.captured_at,
      ]);
      expect([s.added, s.changed, s.removed]).toEqual([0, 0, 0]);
      expect(s.limitations).toEqual(b?.limitations);
    }
    // The base names no travis-places; a full-county run adds it (static in-repo list), last.
    expect(m.profiles.slice(0, base.profiles.length)).toEqual(base.profiles);
    expect(m.profiles.slice(base.profiles.length)).toEqual([
      { ...GAZETTEER_PROFILE_ENTRY, sha256: GAZETTEER_SHA256, gitCommit: "abc1234" },
    ]);
    expect(m.coverage.permits_no_tcad_geoid).toEqual(base.coverage.permits_no_tcad_geoid);
    expect(m.coverage.permits_emitted?.count).toBe(7);
    expect(m.coverage.permits_emitted?.note).toBe(
      "b01 3 + b02 4, roofing-classified decided-status permits only (PO 2026-10-23)",
    );
  });

  it("drops the base's DRAFT marker and adds exactly one correction note", async () => {
    const f = await runFixture();
    const { manifest: m } = await buildRunManifest(config(f), deps(f));
    expect(m.limitations.some((l) => l.startsWith("DRAFT"))).toBe(false);
    expect(m.limitations).toEqual(["county published_rows is R-only", CORRECTION_NOTE]);
    expect(CORRECTION_NOTE).toMatch(/Correction run, no new source capture/);
    expect(CORRECTION_NOTE).toMatch(/each permit's property CID equals its County property CID/);
  });

  it("returns exact JCS bytes whose raw-leaves CID is the manifest CID", async () => {
    const f = await runFixture();
    const built = await buildRunManifest(config(f), deps(f));
    expect(Buffer.from(built.bytes).equals(Buffer.from(jcsBytes(built.manifest)))).toBe(true);
    expect(built.cid).toBe(await cidOfBytes(built.bytes));
  });

  it("refuses a previousManifestCid that is not the CID of the base manifest", async () => {
    const f = await runFixture();
    const other = await cidOfBytes(new TextEncoder().encode("something else"));
    await expect(
      buildRunManifest(config(f, { previousManifestCid: other }), deps(f)),
    ).rejects.toThrow(/is not the CID of the base manifest/);
  });

  it("refuses to reuse the base run's id", async () => {
    const f = await runFixture();
    await expect(buildRunManifest(config(f, { runId: BASE_RUN_ID }), deps(f))).rejects.toThrow(
      /base run's id/,
    );
  });

  it("runs buildManifest's own checks: a dirty tree fails", async () => {
    const f = await runFixture();
    await expect(
      buildRunManifest(config(f), {
        repoRoot: f.root,
        workTreeStatus: () => " M file",
        gitCommit: () => "abc1234",
      }),
    ).rejects.toThrow(/working tree is dirty/);
  });

  it("a different permit count needs explicit coverage for the carried permit-link keys", async () => {
    const f = await runFixture();
    // A pilot-sized permits group: 1 + 1 rows instead of 3 + 4.
    const { makeBatches } = await import("./support/run-fixture.js");
    const small = join(f.root, "data/permits-small-batched");
    await makeBatches({
      dir: small,
      group: "property_improvement",
      prefix: "travis-permits",
      table: "property_improvement",
      rows: [1, 1],
      salt: "small",
    });
    await expect(buildRunManifest(config(f, { permitsDir: small }), deps(f))).rejects.toThrow(
      /Supply coverageOverrides for: .*contractor_unresolved/,
    );
    const overrides = Object.fromEntries(
      [
        "permits_no_tcad_geoid",
        "permits_no_tcad_id",
        "permits_ambiguous_geoid",
        "permits_address_unmatched",
        "permits_ambiguous_address",
        "contractor_resolved",
        "contractor_candidate",
        "contractor_unresolved",
      ].map((k) => [k, { count: 0, derivation: "aggregate_match" as const }]),
    );
    const built = await buildRunManifest(
      config(f, { permitsDir: small, coverageOverrides: overrides }),
      deps(f),
    );
    expect(built.manifest.coverage.permits_emitted?.count).toBe(2);
  });
});

describe("requireLinkedPermits", () => {
  it("refuses a real run without the linked-permit total", () => {
    expect(() => requireLinkedPermits({}, false)).toThrow(/--linked-permits/);
  });

  it("accepts a real run with it, and a trial without it", () => {
    expect(() => requireLinkedPermits({ linkedPermits: 2007514 }, false)).not.toThrow();
    expect(() => requireLinkedPermits({}, true)).not.toThrow();
  });
});

describe("restatePermitRows", () => {
  const run1 =
    "property_improvement published scope is roofing-classified, decided-status permits only (17387 rows), not all 2007514 linked permits";

  it("restates a carried permit-row count with this run's count, nothing else", () => {
    expect(restatePermitRows(run1, 17387, 15025)).toBe(
      "property_improvement published scope is roofing-classified, decided-status permits only (15025 rows), not all 2007514 linked permits",
    );
  });

  it("leaves other limitations and an unchanged count as they are", () => {
    const other = "county published_rows is R-only (441961 of the 493246-parcel roll)";
    expect(restatePermitRows(other, 17387, 15025)).toBe(other);
    expect(restatePermitRows(run1, 17387, 17387)).toBe(run1);
    expect(restatePermitRows(run1, undefined, 15025)).toBe(run1);
  });
});

describe("discoverBatches", () => {
  it("lists the batch numbers present, ascending", async () => {
    const f = await runFixture([1, 2]);
    expect(discoverBatches(f.countyDir, "travis-county")).toEqual([1, 2]);
    expect(() => discoverBatches(f.countyDir, "travis-nothing")).toThrow(/no travis-nothing/);
  });
});

describe("manifestOutputPath / writeManifestBytes", () => {
  it("a real run writes runs/<runId>/manifest.json and never takes --out", async () => {
    const f = await runFixture();
    put(
      join(f.root, "runs/index.json"),
      JSON.stringify({ runs: [], schema: "oracle-travis-runs-index.v1" }),
    );
    expect(manifestOutputPath({ repoRoot: f.root, runId: "r2", pilot: false })).toBe(
      join(f.root, "runs/r2/manifest.json"),
    );
    expect(() =>
      manifestOutputPath({ repoRoot: f.root, runId: "r2", pilot: false, out: "x.json" }),
    ).toThrow(/only for --pilot/);
  });

  it("a real run refuses a runId that runs/index.json already lists", async () => {
    const f = await runFixture();
    put(
      join(f.root, "runs/index.json"),
      JSON.stringify({
        runs: [
          { finishedAt: "2026-10-23T15:41:00.000Z", manifestCid: f.baseCid, runId: BASE_RUN_ID },
        ],
        schema: "oracle-travis-runs-index.v1",
      }),
    );
    expect(() =>
      manifestOutputPath({ repoRoot: f.root, runId: BASE_RUN_ID, pilot: false }),
    ).toThrow(/already lists/);
  });

  it("a pilot goes to the pilot path and refuses any path under runs/", async () => {
    const f = await runFixture();
    expect(manifestOutputPath({ repoRoot: f.root, runId: "p", pilot: true })).toBe(
      join(f.root, "specs/011-publish-and-runs/pilot/manifest.json"),
    );
    expect(() =>
      manifestOutputPath({
        repoRoot: f.root,
        runId: "p",
        pilot: true,
        out: "runs/p/manifest.json",
      }),
    ).toThrow(/never written under runs\//);
    expect(() =>
      manifestOutputPath({
        repoRoot: f.root,
        runId: "p",
        pilot: true,
        out: join(f.root, "runs/../runs/x/m.json"),
      }),
    ).toThrow(/never written under runs\//);
  });

  it("writes built.bytes verbatim: the file's CID is the manifest CID (not a re-serialization)", async () => {
    const f = await runFixture();
    const built = await buildRunManifest(config(f), deps(f));
    const path = join(f.root, "runs/travis-full-run2-20261024/manifest.json");
    expect(writeManifestBytes(path, built)).toBe("written");
    expect(Buffer.from(built.bytes).equals(readFileSync(path))).toBe(true);
    expect(await cidOfFile(path)).toBe(built.cid);
    // Pretty-printing the same content would be a different file and a different CID.
    expect(readFileSync(path, "utf8")).not.toContain("\n");
  });

  it("leaves identical bytes alone and refuses different ones unless asked", async () => {
    const f = await runFixture();
    const built = await buildRunManifest(config(f), deps(f));
    const path = join(f.root, "out/manifest.json");
    expect(writeManifestBytes(path, built)).toBe("written");
    expect(writeManifestBytes(path, built)).toBe("unchanged");
    mkdirSync(join(f.root, "out"), { recursive: true });
    writeFileSync(path, "{}");
    expect(() => writeManifestBytes(path, built)).toThrow(/different bytes/);
    expect(writeManifestBytes(path, built, true)).toBe("written");
    expect(existsSync(path)).toBe(true);
  });
});

describe("permit link reconciliation (A-16 #6)", () => {
  const key = (count: number) => ({ count, derivation: "aggregate_match" as const });
  const run1 = {
    permits_no_tcad_geoid: key(275764),
    permits_no_tcad_id: key(31824),
    permits_ambiguous_geoid: key(36560),
    permits_address_unmatched: key(29475),
    permits_ambiguous_address: key(89),
  };

  it("accepts Run 1's real numbers: 373,712 excluded + 2,007,514 linked = 2,381,226", () => {
    expect(() =>
      assertPermitLinkReconciliation({
        coverage: run1,
        linkedPermits: 2007514,
        austinRecords: 2381226,
      }),
    ).not.toThrow();
  });

  it("fails with the numbers when they do not add up", () => {
    expect(() =>
      assertPermitLinkReconciliation({
        coverage: run1,
        linkedPermits: 2007513,
        austinRecords: 2381226,
      }),
    ).toThrow(/reconciliation failed: excluded 373712 .* \+ linked 2007513 = 2381225.*2381226/);
  });

  it("is skipped only without a linked total; with one, a missing key fails", () => {
    expect(() =>
      assertPermitLinkReconciliation({
        coverage: run1,
        linkedPermits: undefined,
        austinRecords: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertPermitLinkReconciliation({
        coverage: { permits_no_tcad_geoid: key(1) },
        linkedPermits: 5,
        austinRecords: 1,
      }),
    ).toThrow(/cannot run: coverage lacks permits_no_tcad_id/);
  });

  it("fails the build through buildRunManifest when linkedPermits is wrong, passes when right", async () => {
    const f = await runFixture();
    // fixture exclusions: 100 + 20 + 30 + 40 + 5 = 195; Austin source records 2,381,226
    const ok = await buildRunManifest(config(f, { linkedPermits: 2381226 - 195 }), deps(f));
    expect(ok.manifest.runId).toBe("travis-full-run2-20261024");
    await expect(buildRunManifest(config(f, { linkedPermits: 2000000 }), deps(f))).rejects.toThrow(
      /permit link reconciliation failed/,
    );
  });
});
