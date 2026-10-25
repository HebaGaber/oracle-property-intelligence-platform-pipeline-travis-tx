// A-11 Run 3 (task B gap 2): v_property.owner_area_class from the owners' mailing addresses.
// Current owners = the persons/companies linked to the property (person_has_property /
// company_has_property, ERR-28; no sale needed); their address is reached
// through person_has_mailing_address / company_has_mailing_address; address.postal_code (when an
// export carries it) is looked up in the travis-places ZCTA list. Rows are synthetic fixtures.
import { afterAll, describe, expect, it } from "vitest";
import {
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
  type ManifestJson,
  type Row,
} from "./helpers/fixture-export.js";

type Missing = { field: string; reason: string }[];
const reasonOf = (row: Record<string, unknown> | undefined, field: string): string | undefined =>
  (row?.missing as Missing | undefined)?.find((m) => m.field === field)?.reason;
const edge = (from: string, to: string): Row => ({ from_cid: from, to_cid: to });
const sale = (cid: string, date = "2015-07-07"): Row => ({
  cid,
  ownership_transfer_date: date,
  request_identifier: "x",
});
const person = (cid: string): Row => ({
  cid,
  first_name: "Ann",
  last_name: cid,
  request_identifier: "x",
});

const IN = "baguqeeraown01"; // person, Travis ZIP
const REG = "baguqeeraown02"; // company, Williamson ZIP
const OUT = "baguqeeraown03"; // person, New York ZIP
const NOMAIL = "baguqeeraown04"; // owner without a mailing address
const NOZIP = "baguqeeraown05"; // mailing address without a ZIP
const MIXED = "baguqeeraown06"; // two co-owners: New York and Travis
const NOTZCTA = "baguqeeraown07"; // ZIP that is not a ZCTA
const NOSALE = "baguqeeraown08"; // no dated sale at all
const OLD = "baguqeeraown09"; // Travis ZIP on an OLD sale, New York on the latest
const PLUS4 = "baguqeeraown10"; // ZIP+4 text
const NOSALE_OWNED = "baguqeeraown11"; // no dated sale, but a current owner with a Travis ZIP

const ALL = [IN, REG, OUT, NOMAIL, NOZIP, MIXED, NOTZCTA, NOSALE, OLD, PLUS4, NOSALE_OWNED];

function tables(withZip: boolean): FixtureTables {
  const addr = (cid: string, zip: string | null): Row =>
    withZip ? { cid, request_identifier: "x", postal_code: zip } : { cid, request_identifier: "x" };
  return {
    county: {
      property: ALL.map((p) => propertyRows(p, 1990)),
      property_has_sales_history: [
        ...[IN, REG, OUT, NOMAIL, NOZIP, NOTZCTA, PLUS4].map((p) => edge(p, `s-${p}`)),
        edge(MIXED, "s-MIXED"),
        edge(OLD, "s-old"),
        edge(OLD, "s-new"),
      ],
      sales_history: [
        ...[IN, REG, OUT, NOMAIL, NOZIP, NOTZCTA, PLUS4].map((p) => sale(`s-${p}`)),
        sale("s-MIXED"),
        sale("s-old", "2001-01-01"),
        sale("s-new", "2020-01-01"),
      ],
      // p-old is a former owner (sold in 2001): not linked to the property any more.
      person_has_property: [
        edge("p-in", IN),
        edge("p-out", OUT),
        edge("p-nomail", NOMAIL),
        edge("p-nozip", NOZIP),
        edge("p-mixed-out", MIXED),
        edge("p-mixed-in", MIXED),
        edge("p-notzcta", NOTZCTA),
        edge("p-new", OLD),
        edge("p-plus4", PLUS4),
        edge("p-nosale", NOSALE_OWNED),
      ],
      person: [
        "p-in",
        "p-out",
        "p-nomail",
        "p-nozip",
        "p-mixed-out",
        "p-mixed-in",
        "p-notzcta",
        "p-old",
        "p-new",
        "p-plus4",
        "p-nosale",
      ].map(person),
      company_has_property: [edge("c-reg", REG)],
      company: [{ cid: "c-reg", name: "Reg Holdings LLC", request_identifier: "x" }],
      person_has_mailing_address: [
        edge("p-in", "a-in"),
        edge("p-out", "a-out"),
        edge("p-nozip", "a-nozip"),
        edge("p-mixed-out", "a-out"),
        edge("p-mixed-in", "a-in"),
        edge("p-notzcta", "a-notzcta"),
        edge("p-old", "a-in"),
        edge("p-new", "a-out"),
        edge("p-plus4", "a-plus4"),
        edge("p-nosale", "a-in"),
      ],
      company_has_mailing_address: [edge("c-reg", "a-reg")],
      address: [
        addr("a-in", "78701"),
        addr("a-reg", "78626"),
        addr("a-out", "10001"),
        addr("a-nozip", null),
        addr("a-notzcta", "99999"),
        addr("a-plus4", "78753-1234"),
      ],
    },
  };
}

const openFixtures: Fixture[] = [];
afterAll(() => openFixtures.forEach((f) => f.close()));
async function rowsOf(
  t: FixtureTables,
  mutate?: (m: ManifestJson) => void,
): Promise<(cid: string) => Record<string, unknown> | undefined> {
  const fx = await bindFixture(t, (m) => {
    m.coverage = Object.fromEntries(
      Object.entries(m.coverage).filter(([k]) => !k.startsWith("owner_")),
    );
    mutate?.(m);
  });
  openFixtures.push(fx);
  const rows = await fx.rows("SELECT * FROM v_property");
  return (cid) => rows.find((r) => r.property_cid === cid);
}

describe("owner_area_class when the export carries address.postal_code", () => {
  it("classifies in_county, regional, out_of_area and sets owner_is_out_of_area", async () => {
    const p = await rowsOf(tables(true));
    expect(p(IN)).toMatchObject({ owner_area_class: "in_county", owner_is_out_of_area: false });
    expect(p(REG)).toMatchObject({ owner_area_class: "regional", owner_is_out_of_area: true });
    expect(p(OUT)).toMatchObject({ owner_area_class: "out_of_area", owner_is_out_of_area: true });
    expect(p(PLUS4)).toMatchObject({ owner_area_class: "in_county", owner_is_out_of_area: false });
    for (const c of [IN, REG, OUT, PLUS4])
      expect(reasonOf(p(c), "owner_area_class")).toBeUndefined();
  });

  it("a company owner is classified through company_has_mailing_address", async () => {
    const p = await rowsOf(tables(true));
    expect(p(REG)?.owner_kind).toBe("company");
    expect(p(REG)?.owner_area_class).toBe("regional");
  });

  it("co-owners from different areas: the most local class wins (a local co-owner is not absentee)", async () => {
    const p = await rowsOf(tables(true));
    expect(p(MIXED)).toMatchObject({ owner_area_class: "in_county", owner_is_out_of_area: false });
  });

  it("only the property's current owners count (a former owner is not linked)", async () => {
    const p = await rowsOf(tables(true));
    expect(p(OLD)).toMatchObject({ owner_area_class: "out_of_area", owner_is_out_of_area: true });
  });

  it("stays unknown, each with its own reason", async () => {
    const p = await rowsOf(tables(true));
    expect(p(NOMAIL)).toMatchObject({ owner_area_class: "unknown", owner_is_out_of_area: null });
    expect(reasonOf(p(NOMAIL), "owner_area_class")).toBe("no_mailing_address");
    expect(reasonOf(p(NOMAIL), "owner_is_out_of_area")).toBe("no_mailing_address");
    expect(reasonOf(p(NOZIP), "owner_area_class")).toBe("no_mailing_address");
    expect(reasonOf(p(NOTZCTA), "owner_area_class")).toBe("zip_not_zcta");
    // no owner at all: the owner reason is the area reason
    expect(p(NOSALE)?.owner_area_class).toBe("unknown");
    expect(reasonOf(p(NOSALE), "owner_area_class")).toBe("no_owner_record");
  });

  it("a property with no dated sale still gets its owner area from the property edge", async () => {
    const p = await rowsOf(tables(true));
    expect(p(NOSALE_OWNED)).toMatchObject({
      owner_area_class: "in_county",
      owner_is_out_of_area: false,
      last_ownership_transfer_date: null,
    });
  });
});

describe("owner_area_class on today's export (address has no postal_code)", () => {
  it("is unknown/not_in_export for an owner with a mailing address, no_mailing_address without one", async () => {
    const p = await rowsOf(tables(false));
    for (const c of [IN, REG, OUT, MIXED, OLD, PLUS4, NOZIP, NOTZCTA]) {
      expect(p(c)?.owner_area_class, c).toBe("unknown");
      expect(reasonOf(p(c), "owner_area_class"), c).toBe("not_in_export");
      expect(p(c)?.owner_is_out_of_area, c).toBeNull();
    }
    expect(reasonOf(p(NOMAIL), "owner_area_class")).toBe("no_mailing_address");
  });

  it("also binds when no address table is emitted at all", async () => {
    const t = tables(false);
    delete (t.county as Record<string, unknown>).address;
    const p = await rowsOf(t);
    expect(reasonOf(p(IN), "owner_area_class")).toBe("not_in_export");
  });
});

describe("a manifest with no travis-places profile", () => {
  it("keeps ZIPs unclassified with the out_of_scope reason (never the in-repo list silently)", async () => {
    const p = await rowsOf(tables(true), (m) => {
      m.profiles = m.profiles.filter((x) => x.name !== "travis-places");
    });
    expect(p(IN)?.owner_area_class).toBe("unknown");
    expect(reasonOf(p(IN), "owner_area_class")).toBe("out_of_scope");
    expect(p(IN)?.area_list_sha256).toBeNull();
  });
});
