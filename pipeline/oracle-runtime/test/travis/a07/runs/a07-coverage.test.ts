// A-07 T052 (Track D, contracts/report.md, data-model.md § "Manifest coverage contribution"):
// proves the shape `runs/a07-coverage.ts` must assemble from each track's report JSON files,
// on fixtures only. `runs/a07-coverage.ts` itself is Wave-5 work (T053) and is NOT built in
// this wave — this test is intentionally left red until T053 lands; it exists now so T053
// cannot land without first making it pass (constitution X/XXI/XXII, tests-first).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleA07Coverage } from "../../../../travis/runs/a07-coverage.js";

let tmp: string | undefined;
afterEach(() => {
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function write(dir: string, name: string, body: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

describe("assembleA07Coverage", () => {
  it("assembles one manifest-coverage row per required metric, each carrying a derivation", () => {
    tmp = mkdtempSync(join(tmpdir(), "a07-coverage-"));
    const identityReport = write(tmp, "resolution-report.json", {
      resolved: 0,
      candidate: 2,
      ambiguous: 1,
      conflicting: 0,
      unresolved: 22_081,
      permitTotal: 22_084,
    });
    const bbbReport = write(tmp, "status-report.json", { resolved: 0, counts: {}, coveragePct: null });
    const businessReport = write(tmp, "business-coverage-report.json", {
      loadedCount: 150_000,
      sourceCount: 150_000,
    });
    const placesReport = write(tmp, "overture-probe-report.json", {
      licenceGatePassed: false,
      reason: "licence_gate_failed",
    });
    const mergeReport = write(tmp, "merge-property-owner-report.json", {
      property: { inputRecords: 493_246, canonical: 493_246 },
      owner: { inputRecords: 493_246, canonical: 493_246 },
      contractor: { inputRecords: 0, canonical: 0 },
    });
    const roofAgeReport = write(tmp, "full-roll-report.json", {
      byBasis: { permit: 100, new_construction: 20, built_year: 300, unknown: 50 },
      byConfidence: { high: 100, medium: 20, low: 300, none: 50 },
    });

    const rows = assembleA07Coverage({
      identityReportPath: identityReport,
      bbbReportPath: bbbReport,
      businessReportPath: businessReport,
      placesReportPath: placesReport,
      mergeReportPath: mergeReport,
      roofAgeReportPath: roofAgeReport,
    });

    const metrics = rows.map((r) => r.metric).sort();
    expect(metrics).toEqual(
      [
        "bbb_status_counts",
        "business_count",
        "contractor_five_state_totals",
        "merge_counts",
        "places_count_by_category",
        "roof_age_coverage",
      ].sort(),
    );
    for (const row of rows) {
      expect(row).toHaveProperty("derivation");
      expect(["published_rows", "capture_receipt", "aggregate_match"]).toContain(row.derivation);
      expect(row.limitation === null || typeof row.limitation === "string").toBe(true);
    }

    const totals = rows.find((r) => r.metric === "contractor_five_state_totals");
    expect(totals?.value).toEqual({
      resolved: 0,
      candidate: 2,
      ambiguous: 1,
      conflicting: 0,
      unresolved: 22_081,
    });

    const places = rows.find((r) => r.metric === "places_count_by_category");
    expect(places?.limitation).toBe("Places: not loaded · licence_gate_failed");

    const bbb = rows.find((r) => r.metric === "bbb_status_counts");
    expect(bbb?.limitation).toBe("not computable: 0 resolved companies");
  });
});
