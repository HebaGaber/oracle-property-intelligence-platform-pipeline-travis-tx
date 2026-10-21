// Unit tests of the pure parts of lib/a13-vitals.ts and lib/a13-pages.ts (no browser, no network).
import { describe, expect, it } from "vitest";
import { upsertSection } from "./a13-evidence.js";
import { clsOf } from "./a13-vitals.js";

describe("clsOf", () => {
  it("is 0 without shifts and sums one session window", () => {
    expect(clsOf([])).toBe(0);
    expect(
      clsOf([
        { t: 100, value: 0.02 },
        { t: 600, value: 0.03 },
      ]),
    ).toBeCloseTo(0.05);
  });

  it("starts a new window after a 1 s gap and keeps the worst", () => {
    expect(
      clsOf([
        { t: 100, value: 0.04 },
        { t: 2_000, value: 0.03 },
        { t: 2_500, value: 0.02 },
      ]),
    ).toBeCloseTo(0.05);
  });
});

describe("upsertSection", () => {
  it("appends a new section and replaces an existing one in place", () => {
    const a = upsertSection("# T\n", "A-13-TC-073", "first");
    expect(a).toContain("<!-- A-13-TC-073:start -->\nfirst\n<!-- A-13-TC-073:end -->");
    const b = upsertSection(a, "A-13-TC-058", "other");
    const c = upsertSection(b, "A-13-TC-073", "second");
    expect(c).toContain("second");
    expect(c).not.toContain("first");
    expect(c).toContain("other");
  });
});
