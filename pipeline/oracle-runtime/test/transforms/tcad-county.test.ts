// T036 (with T047's seed builders): the County data group for one TCAD property, written to
// the build-county-transform output contract.
import { describe, expect, it } from "vitest";
import { buildSeedRow, parseSeedCsv, seedCsv } from "../../travis/pilot/build-seed.js";
import {
  TCAD_EXPORT_REQUEST,
  buildSharedFiles,
  parseTcadRecord,
  propertyFields,
} from "../../travis/transforms/shared-seed.js";
import {
  transformTcadCounty,
  type CountyTransformInput,
} from "../../travis/transforms/tcad-county.js";
import { tcadRecord } from "../fixtures/tcad-records.js";

const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};

function input(
  over: Parameters<typeof tcadRecord>[0] = { pID: 100008, geoID: "0100030105" },
  roofDate: string | null = "2026-09-20",
): CountyTransformInput {
  const record = parseTcadRecord(tcadRecord(over));
  return {
    record,
    seed: buildSeedRow(record, "0100030105"),
    cids: CIDS,
    roofAge: roofDate === null ? null : { pID: String(over.pID), roof_date: roofDate },
  };
}

type Json = Record<string, unknown>;
const parse = (files: Record<string, string>, name: string): Json =>
  JSON.parse(files[name] as string) as Json;

function isRelationship(v: Json): boolean {
  return Object.keys(v).sort().join(",") === "from,to";
}
function isRoot(v: Json): boolean {
  return Object.keys(v).sort().join(",") === "label,relationships";
}

/** Every relative link target reachable from the roots, following relationships. */
function linkedFiles(files: Record<string, string>): Set<string> {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const v = parse(files, name);
    const links: string[] = [];
    const collect = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(collect);
      else if (x && typeof x === "object") {
        const slash = (x as Json)["/"];
        if (typeof slash === "string") links.push(slash.replace(/^\.\//, ""));
        else Object.values(x as Json).forEach(collect);
      }
    };
    if (isRoot(v)) collect(v.relationships);
    else if (isRelationship(v)) collect([v.from, v.to]);
    for (const l of links) {
      expect(files[l], `link target ${l} from ${name}`).toBeDefined();
      visit(l);
    }
  };
  for (const [name, text] of Object.entries(files))
    if (isRoot(JSON.parse(text) as Json)) visit(name);
  return seen;
}

describe("transformTcadCounty: layout (oracle § A.2)", () => {
  it("writes the seed files, the County root and the entities", () => {
    const out = transformTcadCounty(input());
    const names = Object.keys(out.files).sort();
    for (const required of [
      "address.json",
      "parcel.json",
      "address_has_parcel.json",
      `${CIDS.seed}.json`,
      `${CIDS.county}.json`,
      "property.json",
      "geometry.json",
      "structure.json",
      "sales_history_1.json",
      "company_1.json",
      "mailing_address_1.json",
    ]) {
      expect(names, required).toContain(required);
    }
    expect(out.dir).toBe("100008/data");
  });

  it("names the roots by the manifest CIDs and labels them", () => {
    const out = transformTcadCounty(input());
    expect(parse(out.files, `${CIDS.seed}.json`)).toEqual({
      label: "Seed",
      relationships: { address_has_parcel: { "/": "./address_has_parcel.json" } },
    });
    const county = parse(out.files, `${CIDS.county}.json`);
    expect(county.label).toBe("County");
    expect(Object.keys(county.relationships as Json).sort()).toEqual([
      "company_has_mailing_address",
      "parcel_has_geometry",
      "property_has_address",
      "property_has_parcel",
      "property_has_sales_history",
      "property_has_structure",
      "sales_history_has_company",
    ]);
  });

  it("relationships are only {from, to} with relative links", () => {
    const out = transformTcadCounty(input());
    for (const [name, text] of Object.entries(out.files)) {
      const v = JSON.parse(text) as Json;
      if (!isRelationship(v)) continue;
      expect((v.from as Json)["/"], name).toMatch(/^\.\/[a-z0-9_]+\.json$/);
      expect((v.to as Json)["/"], name).toMatch(/^\.\/[a-z0-9_]+\.json$/);
    }
  });
});

describe("transformTcadCounty: provenance and links", () => {
  it("every entity carries source_http_request and request_identifier = pID as printed", () => {
    const out = transformTcadCounty(input());
    for (const [name, text] of Object.entries(out.files)) {
      const v = JSON.parse(text) as Json;
      if (isRoot(v) || isRelationship(v)) continue;
      expect(v.request_identifier, name).toBe("100008");
      expect(v.source_http_request, name).toEqual(TCAD_EXPORT_REQUEST);
      expect(Object.keys(v.source_http_request as Json).sort(), name).toEqual(["method", "url"]);
    }
  });

  it("every file is reachable from a root (no 'Unused data JSON file')", () => {
    const out = transformTcadCounty(input());
    expect([...linkedFiles(out.files)].sort()).toEqual(Object.keys(out.files).sort());
  });

  it("writes only lexicon properties (no source_payload, no raw TCAD keys)", () => {
    const out = transformTcadCounty(input());
    const property = parse(out.files, "property.json");
    expect(property).toMatchObject({
      parcel_identifier: "100008",
      property_type: "SingleFamily",
      property_usage_type: "Residential",
      property_structure_built_year: 1985,
      property_legal_description_text: "LOT 1 BLK A TEST ADDN 100008",
    });
    for (const text of Object.values(out.files)) {
      expect(text).not.toMatch(/"(pID|geoID|propType|salePrice|source_payload)"/);
    }
  });

  it("puts the TCAD point on the geometry and the seed address", () => {
    const out = transformTcadCounty(input());
    expect(parse(out.files, "geometry.json")).toMatchObject({
      latitude: 30.2545186553,
      longitude: -97.7620645363,
    });
    const address = parse(out.files, "address.json");
    expect(address).toMatchObject({
      unnormalized_address: "1201 TESTING DR, AUSTIN, TX 78704",
      latitude: 30.2545186553,
      longitude: -97.7620645363,
    });
    // The live address.county_name enum (lexicon 2026-10-20) has no "Travis"; the field is
    // optional, so it is not written (lexicon gap, ADR-0002).
    expect(address).not.toHaveProperty("county_name");
  });

  it("propertyFields reports an unmapped TCAD state code and leaves property_type null", () => {
    const record = parseTcadRecord(tcadRecord({ pID: 100010, geoID: "0100030105" }));
    record.propertyProfile = [{ stateCd: "E1", imprvActualYearBuilt: 0 }];
    expect(propertyFields(record)).toMatchObject({
      property_type: null,
      warnings: ["unmapped_state_code:E1"],
    });
  });

  it("dates sales from saleDt as YYYY-MM-DD and links the current owner to the latest dated sale", () => {
    const out = transformTcadCounty(input());
    expect(parse(out.files, "sales_history_1.json")).toMatchObject({
      ownership_transfer_date: "2015-07-07",
    });
    expect(parse(out.files, "relationship_sales_history_has_company_1.json")).toEqual({
      from: { "/": "./sales_history_1.json" },
      to: { "/": "./company_1.json" },
    });
    expect(parse(out.files, "company_1.json")).toMatchObject({ name: "SAMPLE OWNER LLC" });
    expect(parse(out.files, "mailing_address_1.json")).toMatchObject({
      postal_code: "78676",
      plus_four_postal_code: "2530",
      state_code: "TX",
    });
    expect(out.counts.owner).toBe("company");
  });

  it("writes a person when TCAD prints first and last names, title-cased for the lexicon", () => {
    const out = transformTcadCounty(
      input({
        pID: 100009,
        geoID: "0100030105",
        ownerName: "DOE JANE",
        firstName: "JANE",
        lastName: "DOE",
      }),
    );
    expect(parse(out.files, "person_1.json")).toMatchObject({
      first_name: "Jane",
      last_name: "Doe",
    });
    expect(out.counts.owner).toBe("person");
  });

  it("does not guess a person from an unsplit name", () => {
    const out = transformTcadCounty(
      input({ pID: 100010, geoID: "0100030105", ownerName: "DOE JANE" }),
    );
    expect(Object.keys(out.files).some((n) => /^(person|company|mailing_address)_/.test(n))).toBe(
      false,
    );
    expect(out.counts.owner).toBe("unparsed");
  });

  it("with no dated sale, writes no sales history and no owner", () => {
    const out = transformTcadCounty(input({ pID: 100011, geoID: "0100030105", saleDt: null }));
    expect(Object.keys(out.files).some((n) => n.startsWith("sales_history"))).toBe(false);
    expect(out.counts.owner).toBe("no_dated_sale");
  });
});

describe("transformTcadCounty: confidentiality (P0-15)", () => {
  it("suppresses owner name and mailing before validate when a confidentialCode is set, and counts it", () => {
    const out = transformTcadCounty(
      input({ pID: 100012, geoID: "0100030105", confidentialCode: "Q" }),
    );
    expect(Object.keys(out.files).some((n) => /^(person|company|mailing_address)_/.test(n))).toBe(
      false,
    );
    for (const text of Object.values(out.files)) expect(text).not.toContain("SAMPLE OWNER");
    expect(out.counts).toMatchObject({
      owner: "suppressed",
      confidential: true,
      confidential_basis: ["sales[].confidentialCode"],
    });
    // The dated transfer itself is not an owner identity and stays.
    expect(parse(out.files, "sales_history_1.json")).toMatchObject({
      ownership_transfer_date: "2015-07-07",
    });
  });
});

describe("transformTcadCounty: roof date (kit estimator ledger only)", () => {
  it("writes structure.roof_date from the ledger row", () => {
    const out = transformTcadCounty(input(undefined, "2026-09-20"));
    const s = parse(out.files, "structure.json");
    expect(s.roof_date).toBe("2026-09-20");
    expect(s.roof_age_years).toBeNull();
  });

  it("writes roof_date null when the ledger has no date for the property", () => {
    const out = transformTcadCounty(input(undefined, null));
    expect(parse(out.files, "structure.json").roof_date).toBeNull();
  });

  it("refuses a ledger row for another property", () => {
    const i = input();
    i.roofAge = { pID: "999", roof_date: "2020" };
    expect(() => transformTcadCounty(i)).toThrow(/roof-age/);
  });
});

describe("shared seed files (one builder for both groups, oracle R11)", () => {
  it("the County group's seed files and property.json are byte-identical to the shared builder's", () => {
    const i = input();
    const out = transformTcadCounty(i);
    const shared = buildSharedFiles({ record: i.record, seed: i.seed, seedCid: CIDS.seed });
    for (const [name, text] of Object.entries(shared)) expect(out.files[name], name).toBe(text);
    expect(Object.keys(shared).sort()).toEqual(
      [
        "address.json",
        "address_has_parcel.json",
        "parcel.json",
        "property.json",
        `${CIDS.seed}.json`,
      ].sort(),
    );
  });

  it("is deterministic", () => {
    const i = input();
    expect(buildSharedFiles({ record: i.record, seed: i.seed, seedCid: CIDS.seed })).toEqual(
      buildSharedFiles({ record: i.record, seed: i.seed, seedCid: CIDS.seed }),
    );
  });
});

describe("build-seed (county-seed-data contract)", () => {
  it("keys the seed by pID as printed and keeps geo_id as an extra column", () => {
    const record = parseTcadRecord(tcadRecord({ pID: 100008, geoID: "0100030105" }));
    const row = buildSeedRow(record, "0100030105");
    expect(row).toMatchObject({
      parcel_id: "100008",
      source_identifier: "100008",
      situs_address: "1201 TESTING DR, AUSTIN, TX 78704",
      geo_id: "0100030105",
      county: "Travis",
    });
  });

  it("round-trips through CSV with parcel_id first and quoted addresses", () => {
    const rows = [
      buildSeedRow(parseTcadRecord(tcadRecord({ pID: 100008, geoID: "0100030105" })), "0100030105"),
      buildSeedRow(
        parseTcadRecord(tcadRecord({ pID: 100012, geoID: "0100030106", streetName: 'O"NEIL' })),
        "0100030106",
      ),
    ];
    const csv = seedCsv(rows);
    expect(csv.split("\n")[0]).toBe(
      "parcel_id,source_identifier,situs_address,geo_id,county,latitude,longitude,method,url",
    );
    expect(parseSeedCsv(csv)).toEqual(rows);
  });

  it("rejects duplicate parcel ids", () => {
    const r = buildSeedRow(
      parseTcadRecord(tcadRecord({ pID: 100008, geoID: "0100030105" })),
      "0100030105",
    );
    expect(() => seedCsv([r, r])).toThrow(/duplicate/);
  });
});
