// ERR-73: five-state contractor totals over the published permits. No DB, no network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contractorCoverage, readPublishedPermits } from "../scripts/contractor-coverage.js";

const reg = (taxpayerNumber: string, legalName: string, sosStatusCode = "active") => ({
  taxpayerNumber,
  legalName,
  sosStatusCode,
  mailingAddress: null,
  sosFileNumber: null,
});
const ON = "2026-10-26T00:00:00.000Z";

describe("contractorCoverage", () => {
  it("counts each published permit once in exactly one of the five states", () => {
    const cov = contractorCoverage(
      [
        { pid: "1", permitNumber: "P1", name: "Alpha Roofing LLC" },
        { pid: "1", permitNumber: "P2", name: "Beta Roofing" },
        { pid: "2", permitNumber: "P3", name: "Gamma Roofing" },
        { pid: "2", permitNumber: "P4", name: "Nobody Known" },
        { pid: "3", permitNumber: "P5", name: null },
      ],
      [
        reg("1", "ALPHA ROOFING LLC"),
        reg("2", "Beta Roofing"),
        reg("3", "BETA ROOFING"),
        reg("4", "Gamma Roofing", "forfeited"),
      ],
      ON,
    );
    expect(cov.byState).toEqual({ resolved: 0, candidate: 1, ambiguous: 1, conflicting: 1, unresolved: 2 });
    expect(cov.unresolvedBy).toEqual({ contractor_not_printed: 1, no_match: 1 });
    expect(cov.permits).toBe(5);
    expect(cov.named).toBe(4);
    expect(cov.registryRows).toBe(4);
  });

  it("reports registry_unavailable for every permit when the registry is empty", () => {
    const cov = contractorCoverage([{ pid: "1", permitNumber: "P1", name: "Alpha" }], [], ON);
    expect(cov.byState.unresolved).toBe(1);
    expect(cov.unresolvedBy).toEqual({ registry_unavailable: 1 });
  });
});

describe("readPublishedPermits", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("pairs property_improvement_N with company_N and skips folders without data", () => {
    dir = mkdtempSync(join(tmpdir(), "contractor-coverage-"));
    const data = join(dir, "100", "data");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(dir, "101"));
    writeFileSync(join(data, "property_improvement_1.json"), JSON.stringify({ permit_number: "A" }));
    writeFileSync(join(data, "property_improvement_2.json"), JSON.stringify({ permit_number: "B" }));
    writeFileSync(join(data, "company_2.json"), JSON.stringify({ name: "Beta" }));
    writeFileSync(join(data, "property.json"), "{}");
    const got = readPublishedPermits(dir).sort((a, b) => a.permitNumber.localeCompare(b.permitNumber));
    expect(got).toEqual([
      { pid: "100", permitNumber: "A", name: null },
      { pid: "100", permitNumber: "B", name: "Beta" },
    ]);
  });
});
