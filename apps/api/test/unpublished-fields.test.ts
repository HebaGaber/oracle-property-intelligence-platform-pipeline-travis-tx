// ERR-78: contract v1.1 publishes contractor_name_as_printed, so the agent must never tell a user
// the contractor's name is not published (it is, on 4,139 of 15,025 Run 3 permits).
import { VIEWS } from "@countylens/contract";
import { describe, expect, it } from "vitest";
import { UNPUBLISHED_FIELDS } from "../src/agent/citations.js";

describe("unpublished fields (ERR-78)", () => {
  it("the contractor's printed name is not declarable as unpublished", () => {
    expect(Object.keys(UNPUBLISHED_FIELDS)).not.toContain("contractor.name_as_printed");
  });
  it("and the contract really carries it on v_roofing_permit", () => {
    expect(JSON.stringify(VIEWS)).toContain("contractor_name_as_printed");
  });
});

describe("system prompt (ERR-78)", () => {
  it("never tells the model that contractor names are unavailable", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/agent/ask.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Contractor names and BBB ratings are likewise/);
    expect(src).toMatch(/contractor_name_as_printed on each permit row/);
  });
});
