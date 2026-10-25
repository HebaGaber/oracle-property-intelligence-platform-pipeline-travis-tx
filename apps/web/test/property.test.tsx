// A-13 T025 (AC-4, AC-5, FR-004b, FR-005, FR-007, FR-022; TC-030, TC-032, TC-034): the Property
// drawer. `sel=` opens it on that property (a deep link survives a reload); it is a dialog with
// the property CID, every field with its value or reason, the contractor's resolution badge, the
// BBB line, the no-carrier fields reading "not published · no lexicon carrier" (every
// `data-reason="no_lexicon_carrier"` element included) and the provenance line; no licence line.
// Close removes `sel`. The drawer is rendered directly with a row built in the test.
import { rawCid, type ExploreRow } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { PropertyDrawer } from "../src/routes/PropertyDrawer";

const encode = (t: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(t);
let row: ExploreRow;

beforeAll(async () => {
  const cid = await rawCid(encode("drawer property"));
  const table = await rawCid(encode("drawer table"));
  row = {
    property_cid: cid,
    address: null,
    dist_mi: 0.8,
    bearing: "N",
    lat: 30.3,
    lon: -97.7,
    roof_age_years: 22,
    roof_age_basis: "permit_anchor",
    roof_age_confidence: "high",
    permit: {
      cid: "permit",
      number: "2018-111111 BP",
      status_raw: null,
      status_class: "stalled",
      open_years: 7.2,
      open_days: 2630,
      table_cid: table,
    },
    contractor: { name_as_printed: null, resolution: "unresolved", company_cid: null },
    bbb_status: "not_checked",
    bbb_status_reason: "not run for this county",
    tenure_years: null,
    tenure_basis: null,
    owner_area_class: "unknown",
    provenance: {
      cid,
      source_url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
      captured_at: "2026-10-21T08:01:00.000Z",
      table: "property_improvement/property_improvement",
      table_cid: table,
      run_id: "travis-test-drawer",
      manifest_cid: table,
      as_of: "2026-10-21",
    },
    missing: [
      { field: "address", reason: "not_in_export" },
      { field: "permit.status_raw", reason: "no_lexicon_carrier" },
      { field: "contractor.name_as_printed", reason: "no_lexicon_carrier" },
      { field: "tenure_years", reason: "no_dated_sale" },
    ],
  };
});

afterEach(() => cleanup());

describe("Property drawer (FR-004b, FR-005, TC-030, TC-032, TC-034)", () => {
  it("is a dialog for the property with every field, the badge, the BBB line and provenance", () => {
    render(
      <MemoryRouter>
        <PropertyDrawer row={row} onClose={() => undefined} />
      </MemoryRouter>,
    );
    const drawer = screen.getByRole("dialog");
    expect(drawer.getAttribute("data-property-cid")).toBe(row.property_cid);
    const field = (f: string): string | null | undefined =>
      drawer.querySelector(`[data-field="${f}"]`)?.textContent;
    expect(field("address")).toBe(EXPLORE_TEXTS.noCarrier);
    expect(field("status_raw")).toBe(EXPLORE_TEXTS.noCarrier);
    expect(field("contractor_name")).toBe(EXPLORE_TEXTS.noCarrier);
    expect(field("bbb")).toBe(EXPLORE_TEXTS.bbbNotChecked("not run for this county"));
    expect(field("tenure_years")).toBe(EXPLORE_TEXTS.tenureUnknown);
    expect(field("owner_area_class")).toBe(EXPLORE_TEXTS.ownerAreaUnknown);
    expect(field("distance")).toBe("0.8 mi N");
    expect(drawer.querySelector("[data-permit-chip]")?.textContent).toBe(
      EXPLORE_TEXTS.stalledNoCarrier(7.2),
    );
    expect(
      drawer
        .querySelector("[data-contractor-resolution]")
        ?.getAttribute("data-contractor-resolution"),
    ).toBe("unresolved");
    const carriers = drawer.querySelectorAll('[data-reason="no_lexicon_carrier"]');
    expect(carriers.length).toBeGreaterThan(0);
    for (const el of carriers) expect(el.textContent).toBe(EXPLORE_TEXTS.noCarrier);
    const provenance = drawer.querySelector("[data-provenance]");
    expect(provenance?.textContent).toContain("travis-test-drawer");
    expect(provenance?.querySelector("[data-cid]")?.getAttribute("data-cid")).toBe(
      row.provenance.table_cid,
    );
    expect(drawer.textContent).not.toMatch(/licen[cs]e/i);
  });

  it("closes through its Close button", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <PropertyDrawer row={row} onClose={onClose} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
