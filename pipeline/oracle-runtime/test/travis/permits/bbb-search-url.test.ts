// A-11 Run 3 (ERR-32): the printed contractor name and the BBB SEARCH link. Pure functions; no
// bbb.org request is made anywhere. The URL shape is unverified until a human clicks one example.
import { describe, expect, it } from "vitest";
import {
  BBB_SEARCH_BASE,
  MAX_NAME_CHARS,
  bbbSearchUrl,
  cleanPrinted,
  isPlaceholderName,
  printedContractorOf,
} from "../../../travis/permits/bbb-search-url.js";

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("bbbSearchUrl", () => {
  it("builds the proposed search shape from the name and the city", () => {
    expect(bbbSearchUrl("Done Right Roofing", "Austin")).toBe(
      "https://www.bbb.org/search?find_country=USA&find_text=Done%20Right%20Roofing&find_loc=Austin%2C%20TX&find_type=Category",
    );
  });

  it("encodes ampersands, plus signs, quotes and slashes so they cannot split the query", () => {
    const url = bbbSearchUrl("A&B Roofing + Sons, Inc. (O'Neil) No. 1/2", "Round Rock") as string;
    expect(url).toContain("A%26B%20Roofing%20%2B%20Sons");
    const p = params(url);
    expect(p.get("find_text")).toBe("A&B Roofing + Sons, Inc. (O'Neil) No. 1/2");
    expect(p.get("find_loc")).toBe("Round Rock, TX");
    expect([...p.keys()]).toEqual(["find_country", "find_text", "find_loc", "find_type"]);
    expect(url).not.toContain("'");
    expect(url).not.toContain("(");
    expect(url).not.toContain(" ");
  });

  it("encodes unicode as UTF-8 and round-trips it", () => {
    const url = bbbSearchUrl("Cañón Techos Ñandú", "Austin") as string;
    expect(url).toContain("Ca%C3%B1%C3%B3n");
    expect(params(url).get("find_text")).toBe("Cañón Techos Ñandú");
  });

  it("drops clerk markers from the search text only, keeping the printed name as printed", () => {
    expect(
      params(bbbSearchUrl("Sam Stewart Custom Homes, Inc***DO NOT USE***", "Austin") as string).get(
        "find_text",
      ),
    ).toBe("Sam Stewart Custom Homes, Inc");
    expect(
      params(
        bbbSearchUrl("Valdez Remodeling & Weatherization Inc.**MAIN**", "Austin") as string,
      ).get("find_text"),
    ).toBe("Valdez Remodeling & Weatherization Inc.");
    expect(bbbSearchUrl("***DO NOT USE***", "Austin")).toBeNull();
    expect(
      printedContractorOf({ permit_number: "x", contractor_company_name: "Acme Roofing**MAIN**" })
        .contractor_name_as_printed,
    ).toBe("Acme Roofing**MAIN**");
  });

  it("trims and collapses whitespace", () => {
    const url = bbbSearchUrl("  Argosy \t Roofing  \n LLC ", " Pflugerville ") as string;
    expect(params(url).get("find_text")).toBe("Argosy Roofing LLC");
    expect(params(url).get("find_loc")).toBe("Pflugerville, TX");
  });

  it("falls back to Austin when the permit prints no contractor city", () => {
    expect(params(bbbSearchUrl("Acme Roofing", null) as string).get("find_loc")).toBe("Austin, TX");
    expect(params(bbbSearchUrl("Acme Roofing", "   ") as string).get("find_loc")).toBe(
      "Austin, TX",
    );
  });

  it("cuts a very long name at a word boundary and keeps the URL bounded", () => {
    const long = Array.from({ length: 80 }, (_, i) => `Word${i}`).join(" ");
    const url = bbbSearchUrl(long, "Austin") as string;
    const text = params(url).get("find_text") as string;
    expect(Array.from(text).length).toBeLessThanOrEqual(MAX_NAME_CHARS);
    expect(long.startsWith(text)).toBe(true);
    expect(text.endsWith(" ")).toBe(false);
    expect(url.length).toBeLessThan(MAX_NAME_CHARS * 4 + 200);
    // one unbroken string longer than the cap is cut by code points, never mid surrogate pair
    const emoji = "a😀".repeat(MAX_NAME_CHARS);
    const cut = params(bbbSearchUrl(emoji, "Austin") as string).get("find_text") as string;
    expect(Array.from(cut)).toHaveLength(MAX_NAME_CHARS);
  });

  it("returns null (no link) for an empty or placeholder name", () => {
    for (const name of [
      null,
      undefined,
      "",
      "   ",
      "N/A",
      "n/a",
      "NA",
      "OWNER",
      "Owner",
      "SELF",
      "self.",
      "HOMEOWNER",
      "Owner/Builder",
      "NONE",
      "-",
      "...",
      "***",
    ]) {
      expect(bbbSearchUrl(name, "Austin")).toBeNull();
    }
  });

  it("keeps names that merely contain a placeholder word", () => {
    expect(bbbSearchUrl("Self Reliance Roofing", "Austin")).not.toBeNull();
    expect(bbbSearchUrl("Owner's Choice Roofing", "Austin")).not.toBeNull();
    expect(bbbSearchUrl("NA Roofing", "Austin")).not.toBeNull();
  });

  it("starts at the unverified BBB search page", () => {
    expect((bbbSearchUrl("Acme", "Austin") as string).startsWith(`${BBB_SEARCH_BASE}?`)).toBe(true);
  });
});

describe("cleanPrinted / isPlaceholderName", () => {
  it("cleans and classifies", () => {
    expect(cleanPrinted("  a   b ")).toBe("a b");
    expect(cleanPrinted("   ")).toBeNull();
    expect(cleanPrinted(null)).toBeNull();
    expect(isPlaceholderName("N/A")).toBe(true);
    expect(isPlaceholderName("Acme Roofing")).toBe(false);
  });
});

describe("printedContractorOf", () => {
  it("returns the name as printed (trimmed), city, raw status, expiry date and a blocked BBB link", () => {
    const out = printedContractorOf({
      permit_number: "2019-000001 BP",
      contractor_company_name: "  Done Right Roofing ",
      contractor_city: "Round Rock",
      contractor_full_name: "Pat Person",
      contractor_phone: "5125550100",
      contractor_address1: "1 Main St",
      status_current: "Expired",
      expiresdate: "2020-03-04T00:00:00.000",
    });
    expect(out).toEqual({
      contractor_name_as_printed: "Done Right Roofing",
      contractor_city: "Round Rock",
      permit_status_raw: "Expired",
      permit_expiry_date: "2020-03-04",
      bbb_url: expect.stringContaining("find_text=Done%20Right%20Roofing"),
      bbb_status: "blocked",
      bbb_status_reason: "bbb_blocked",
    });
    // no phone, person name or street address is carried
    expect(JSON.stringify(out)).not.toMatch(/5125550100|Pat Person|Main St/);
  });

  it("gives no name, no link and not_checked when the company name is empty or a placeholder", () => {
    for (const name of [undefined, null, "", "N/A", "OWNER"]) {
      const out = printedContractorOf({
        permit_number: "x",
        contractor_company_name: name,
        contractor_city: "Austin",
        contractor_full_name: "Only A Person",
        status_current: "Final",
      });
      expect(out.contractor_name_as_printed).toBeNull();
      expect(out.contractor_city).toBeNull();
      expect(out.bbb_url).toBeNull();
      expect(out.bbb_status).toBe("not_checked");
      expect(out.bbb_status_reason).toBe("contractor_unresolved");
      expect(out.permit_status_raw).toBe("Final");
    }
  });

  it("keeps the expiry date null unless the source prints a date", () => {
    expect(
      printedContractorOf({ permit_number: "x", expiresdate: "garbage" }).permit_expiry_date,
    ).toBeNull();
    expect(printedContractorOf({ permit_number: "x" }).permit_expiry_date).toBeNull();
    expect(
      printedContractorOf({ permit_number: "x", expiresdate: "2021-07-01" }).permit_expiry_date,
    ).toBe("2021-07-01");
  });
});
