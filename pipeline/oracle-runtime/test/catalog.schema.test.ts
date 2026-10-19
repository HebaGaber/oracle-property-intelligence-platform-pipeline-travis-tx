// T006 schema tests. Synthetic values only (test-only).
import { describe, expect, it } from "vitest";
import {
  CatalogSchema,
  DECISIONS,
  JurisdictionSchema,
  MeasurementSchema,
  SOURCE_KEYS,
  SourceSchema,
} from "../travis/discovery/catalog.schema.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { must } from "./helpers.js";

const okMeasurement = {
  value: 12,
  source_url: "https://example.test/q",
  captured_at: "2026-01-01T00:00:00Z",
};

describe("Measurement", () => {
  it("accepts a value with source_url and UTC captured_at", () => {
    expect(MeasurementSchema.safeParse(okMeasurement).success).toBe(true);
    expect(
      MeasurementSchema.safeParse({ ...okMeasurement, captured_at: "2026-01-01T00:00:00.123Z" })
        .success,
    ).toBe(true);
  });

  it("requires source_url", () => {
    const { source_url: _omit, ...rest } = okMeasurement;
    expect(MeasurementSchema.safeParse(rest).success).toBe(false);
  });

  it("requires captured_at", () => {
    const { captured_at: _omit, ...rest } = okMeasurement;
    expect(MeasurementSchema.safeParse(rest).success).toBe(false);
  });

  it("requires captured_at to be UTC ISO-8601", () => {
    for (const captured_at of ["2026-01-01T02:00:00+02:00", "2026-01-01", "yesterday", ""]) {
      expect(MeasurementSchema.safeParse({ ...okMeasurement, captured_at }).success).toBe(false);
    }
  });

  it("value null requires missing_reason", () => {
    expect(MeasurementSchema.safeParse({ ...okMeasurement, value: null }).success).toBe(false);
    expect(
      MeasurementSchema.safeParse({ ...okMeasurement, value: null, missing_reason: "  " }).success,
    ).toBe(false);
    expect(
      MeasurementSchema.safeParse({
        ...okMeasurement,
        value: null,
        missing_reason: "TCAD blocked: HTTP 403",
      }).success,
    ).toBe(true);
  });
});

describe("Source", () => {
  const base = must(syntheticCatalog().sources[0]);

  it("decision is one of bulk download | ingest | runtime retrieval", () => {
    expect([...DECISIONS]).toEqual(["bulk download", "ingest", "runtime retrieval"]);
    for (const decision of DECISIONS) {
      expect(SourceSchema.safeParse({ ...base, decision }).success).toBe(true);
    }
    for (const decision of ["scrape", "Ingest", "bulk", ""]) {
      expect(SourceSchema.safeParse({ ...base, decision }).success).toBe(false);
    }
  });

  it("key is one of the 9 data-model keys", () => {
    expect([...SOURCE_KEYS].sort()).toEqual(
      [
        "tcad_certified",
        "tcad_supplemental",
        "tcad_gis",
        "austin_permits",
        "other_jurisdictions",
        "tx_comptroller",
        "bbb",
        "overture",
        "contractor_licensing",
      ].sort(),
    );
    for (const key of SOURCE_KEYS) {
      expect(SourceSchema.safeParse({ ...base, key }).success).toBe(true);
    }
    expect(SourceSchema.safeParse({ ...base, key: "zillow" }).success).toBe(false);
  });

  it("a blocked source requires blocked_evidence", () => {
    const blocked = must(syntheticCatalog().sources[1]);
    expect(SourceSchema.safeParse(blocked).success).toBe(true);
    const { blocked_evidence: _omit, ...rest } = blocked;
    expect(SourceSchema.safeParse(rest).success).toBe(false);
  });

  it("Overture's null denominator with its reason is valid", () => {
    expect(
      SourceSchema.safeParse({
        key: "overture",
        url: "https://example.test/overture",
        status: "available",
        captured_at: "2026-01-01T00:00:00Z",
        denominator: {
          value: null,
          missing_reason: "not measured in A-01: optional source; licence gate decided in A-09",
          source_url: "https://example.test/overture/licence",
          captured_at: "2026-01-01T00:00:00Z",
        },
      }).success,
    ).toBe(true);
  });
});

describe("Jurisdiction", () => {
  const row = must(must(syntheticCatalog().permits).jurisdictions[0]);

  it("historical_records is required on every jurisdiction row", () => {
    expect(JurisdictionSchema.safeParse(row).success).toBe(true);
    const { historical_records: _omit, ...rest } = row;
    expect(JurisdictionSchema.safeParse(rest).success).toBe(false);
    expect(JurisdictionSchema.safeParse({ ...row, historical_records: "yes" }).success).toBe(false);
  });

  it("a catalog with one row missing historical_records fails", () => {
    const catalog = syntheticCatalog();
    const { historical_records: _omit, ...rest } = must(must(catalog.permits).jurisdictions[1]);
    const broken = {
      ...catalog,
      permits: {
        ...must(catalog.permits),
        jurisdictions: [must(must(catalog.permits).jurisdictions[0]), rest],
      },
    };
    expect(CatalogSchema.safeParse(broken).success).toBe(false);
  });
});

describe("Catalog", () => {
  it("the synthetic catalog parses", () => {
    const result = CatalogSchema.safeParse(syntheticCatalog());
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it("fips must be the 5-digit string, not a number", () => {
    expect(CatalogSchema.safeParse({ ...syntheticCatalog(), fips: 48453 }).success).toBe(false);
    expect(CatalogSchema.safeParse({ ...syntheticCatalog(), fips: "4845" }).success).toBe(false);
  });

  it("parcel counts stay plain numbers the validator reads, with a Measurement alongside", () => {
    const c = syntheticCatalog();
    expect(
      CatalogSchema.safeParse({
        ...c,
        parcel: { ...must(c.parcel), assessed_parcel_count: { value: 1 } },
      }).success,
    ).toBe(false);
    expect(
      CatalogSchema.safeParse({
        ...c,
        parcel: { ...must(c.parcel), assessed_parcel_count: 999 },
      }).success,
    ).toBe(false);
  });
});
