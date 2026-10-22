// A-07 T016 (Track A): the Loader `comptroller` track (migration 0401_comptroller_registry.sql)
// and the `identity` report section. A scripted postgres.js stand-in records every statement
// (synthetic test input; no database), following the permits track test's pattern. Must fail
// before T017 (services/tracks/comptroller.ts, services/report-sections/identity.ts) lands.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { COMPTROLLER_SOURCE_KEY, track } from "../../services/tracks/comptroller.js";
import { assembleIdentitySection, section } from "../../services/report-sections/identity.js";

const JOB = "travis-a07-identity-registry-202610220900";

interface Query {
  text: string;
  values: unknown[];
}

function fakeTx(answer: (text: string, values: unknown[]) => unknown[] = () => []) {
  const queries: Query[] = [];
  const fn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    return answer(text, values);
  }) as unknown as postgres.TransactionSql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return { tx: fn, queries };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function stagedArtifact(rows: Record<string, unknown>[]): { path: string; sha256: string } {
  const dir = mkdtempSync(join(tmpdir(), "a07-comptroller-track-"));
  dirs.push(dir);
  const path = join(dir, "registry-rows.json");
  const body = Buffer.from(JSON.stringify(rows));
  writeFileSync(path, body);
  return { path, sha256: createHash("sha256").update(body).digest("hex") };
}

describe("comptroller track: load_registry", () => {
  it("registers the comptroller track by name", () => {
    expect(track.name).toBe("comptroller");
  });

  it("upserts staged rows into comptroller_registry and records a load row, returning the watermark", async () => {
    const artifact = stagedArtifact([
      { taxpayerNumber: "32000000001", legalName: "SYNTHETIC ROOFING 1 CO", sosStatusCode: "ACTIVE", mailingAddress: null, sosFileNumber: "SOS-1" },
      { taxpayerNumber: "32000000002", legalName: "SYNTHETIC ROOFING 2 CO", sosStatusCode: "ACTIVE", mailingAddress: null, sosFileNumber: "SOS-2" },
    ]);
    const { tx, queries } = fakeTx((text) => {
      if (text.startsWith("INSERT INTO comptroller_registry")) {
        return [{ taxpayer_number: "32000000001" }, { taxpayer_number: "32000000002" }];
      }
      return [];
    });
    const input = {
      kind: "load_registry" as const,
      jobId: JOB,
      artifactPath: artifact.path,
      artifactSha256: artifact.sha256,
      scope: "travis" as const,
      watermark: "2026-10-19T21:00:00.000Z",
      sourceUrl: "https://data.texas.gov/resource/9cir-efmm.json",
      capturedAt: "2026-10-19T21:00:38.000Z",
    };
    const outcome = await track.merge(tx, input);
    expect(outcome.rowsWritten).toBe(2);
    expect(outcome.watermark?.sourceKey).toBe(COMPTROLLER_SOURCE_KEY);
    expect((outcome.watermark?.value as { rowCount: number }).rowCount).toBe(2);
    expect(queries.some((q) => q.text.startsWith("INSERT INTO comptroller_registry"))).toBe(true);
    expect(queries.some((q) => q.text.startsWith("INSERT INTO comptroller_registry_loads"))).toBe(true);
  });

  it("refuses an artifact whose body does not match its declared sha256", async () => {
    const artifact = stagedArtifact([
      { taxpayerNumber: "32000000003", legalName: "X", sosStatusCode: "ACTIVE", mailingAddress: null, sosFileNumber: null },
    ]);
    const { tx } = fakeTx();
    const input = {
      kind: "load_registry" as const,
      jobId: JOB,
      artifactPath: artifact.path,
      artifactSha256: "f".repeat(64),
      scope: "travis" as const,
      watermark: null,
      sourceUrl: "https://data.texas.gov/resource/9cir-efmm.json",
      capturedAt: "2026-10-19T21:00:38.000Z",
    };
    await expect(track.merge(tx, input)).rejects.toThrow(/sha256/);
  });
});

describe("identity report section", () => {
  it("has the key 'identity'", () => {
    expect(section.key).toBe("identity");
  });

  it("assembles the manifest-coverage shape from the loaded-registry data", () => {
    const result = assembleIdentitySection({
      registryLoaded: true,
      rowCount: 342_334,
      watermark: "2026-10-19T21:00:38.000Z",
      snapshotDigest: "a".repeat(64),
      sourceUrl: "https://data.texas.gov/resource/9cir-efmm.json",
      fiveStateTotals: { resolved: 0, candidate: 12, ambiguous: 1, conflicting: 0, unresolved: 22_071 },
      permitTotal: 22_084,
    });
    expect(result.registry_row_count).toBe(342_334);
    expect(result.five_state_totals).toEqual({ resolved: 0, candidate: 12, ambiguous: 1, conflicting: 0, unresolved: 22_071 });
    expect(result.five_state_sum_matches_permit_total).toBe(true);
    expect(result.derivation).toBe("aggregate_match");
  });
});
