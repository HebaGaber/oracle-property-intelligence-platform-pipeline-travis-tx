// T005 (A-13, AC-4, FR-004): `resolvePlace` over travis-places@1.0.0 gives the Explore search box
// its label, "{name_lsad} · Census {year} Gazetteer · {lat}, {lon}" (U+2212 for a negative
// coordinate), plus the point and the source stamp. Anything outside Travis is out_of_scope with
// no point. Written before src/places.ts exists: the red run fails with "Cannot find module".
import { describe, expect, it } from "vitest";
import { placeLabel, resolvePlace } from "../src/places.js";

describe("resolvePlace (travis-places@1.0.0)", () => {
  it('"Pflugerville" → "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116"', () => {
    const r = resolvePlace("Pflugerville");
    if (r.status !== "found") throw new Error(JSON.stringify(r));
    expect(r.label).toBe("Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116");
    expect(r).toMatchObject({
      id: "4857176",
      name: "Pflugerville city",
      kind: "place",
      point: { lat: 30.447765, lon: -97.602116 },
    });
    expect(r.source.url).toContain("2024_Gaz_place_national.zip");
    expect(r.gazetteer.version).toBe("travis-places@1.0.0");
  });

  it("is case- and LSAD-insensitive, and resolves a ZCTA by its code", () => {
    expect(resolvePlace("pflugerville city")).toEqual(resolvePlace("Pflugerville"));
    const z = resolvePlace("78753");
    if (z.status !== "found") throw new Error(JSON.stringify(z));
    expect(z.kind).toBe("zcta");
    expect(z.id).toBe("78753");
    expect(z.label).toMatch(/^ZCTA5 78753 · Census 2024 Gazetteer · 30\.\d+, −97\.\d+$/);
  });

  it("resolves a place by its gazetteer id (the `place` URL parameter)", () => {
    expect(resolvePlace("4857176")).toEqual(resolvePlace("Pflugerville"));
  });

  it.each(["Georgetown", "", "99999"])("returns out_of_scope with no point for %j", (q) => {
    expect(resolvePlace(q)).toEqual({ status: "out_of_scope", query: q });
  });

  it("formats a label from any name and point", () => {
    expect(placeLabel("X", { lat: 30.1, lon: -97.5 }, "2024")).toBe(
      "X · Census 2024 Gazetteer · 30.1, −97.5",
    );
  });
});
