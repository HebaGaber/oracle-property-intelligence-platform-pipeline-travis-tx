// A-11: client-side paging of the Permits list. All rows stay in memory (the count check in
// resolvePermitsState is unchanged); only PERMITS_PAGE_SIZE rows are in the DOM at a time, so a
// full-county run (about 15,000 rows) does not freeze the browser. Rows below are in-test inputs.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PERMITS_PAGE_SIZE, PERMITS_TEXTS } from "@countylens/shared";
import type { PermitListRow } from "../src/engine/permit-list";
import {
  PermitsPage,
  TABLE_MEDIA_QUERY,
  resolvePermitsState,
  type PermitsLoaded,
} from "../src/routes/Permits.page";

const cid = (tag: string): string => `bafkrei${tag}`.padEnd(59, "a");

function row(n: number): PermitListRow {
  const id = String(n).padStart(6, "0");
  return {
    permit_number: `TEST-${id}`,
    improvement_status: "Permitted",
    status_class: "open",
    issue_date: "2026-09-01",
    contractor_resolution: "unresolved",
    cid: cid(`permit${id}`),
    source_url: `https://source.test/TEST-${id}`,
    captured_at: "2026-10-20T14:02:05Z",
    table: "property_improvement/property_improvement",
    table_cid: cid("table"),
    run_id: "test-run",
    manifest_cid: cid("manifest"),
    as_of: "2026-10-01T00:00:00Z",
    missing: [],
  };
}

const loadedOf = (count: number): PermitsLoaded => ({
  runId: "test-run",
  manifestCid: cid("manifest"),
  permitsEmitted: count,
  rows: Array.from({ length: count }, (_, i) => row(i + 1)),
  fallbackLabel: null,
});

function stubViewport(wide: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: query === TABLE_MEDIA_QUERY ? wide : false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  });
}

async function renderReady(count: number, wide = true) {
  stubViewport(wide);
  render(createElement(PermitsPage, { load: () => Promise.resolve(loadedOf(count)) }));
  await waitFor(() => expect(screen.getByTestId("permits-range")).toBeTruthy());
}

const range = () => screen.getByTestId("permits-range");
const prev = () => screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement;
const next = () => screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement;
const bodyRows = () => document.querySelectorAll("table tbody tr").length;

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("Permits paging (table)", () => {
  it("uses a page size of 200", () => {
    expect(PERMITS_PAGE_SIZE).toBe(200);
  });

  it("shows 1-200 of N with 200 rows and Previous disabled on the first page", async () => {
    await renderReady(450);
    expect(range().textContent).toBe("Showing 1–200 of 450");
    expect(range().textContent).toBe(PERMITS_TEXTS.showing(1, 200, 450));
    expect(range().getAttribute("data-first")).toBe("1");
    expect(range().getAttribute("data-last")).toBe("200");
    expect(range().getAttribute("data-total")).toBe("450");
    expect(bodyRows()).toBe(200);
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);
    expect(screen.getAllByRole("navigation", { name: "Permits pages" })).toHaveLength(1);
  });

  it("Next moves to 201-400, then to the partial last page, where Next is disabled", async () => {
    await renderReady(450);
    fireEvent.click(next());
    expect(range().textContent).toBe("Showing 201–400 of 450");
    expect(bodyRows()).toBe(200);
    expect(prev().disabled).toBe(false);
    fireEvent.click(next());
    expect(range().textContent).toBe("Showing 401–450 of 450");
    expect(range().getAttribute("data-last")).toBe("450");
    expect(bodyRows()).toBe(50);
    expect(next().disabled).toBe(true);
    expect(prev().disabled).toBe(false);
    const first = document.querySelector("table tbody tr td");
    expect(first?.textContent).toContain("TEST-000401");
    fireEvent.click(prev());
    expect(range().textContent).toBe("Showing 201–400 of 450");
    // Three pages of 200 rows render in jsdom: about 5 s on a slow CI runner, so give it room.
  }, 30_000);

  it("with 200 or fewer rows the pager shows and both buttons are disabled", async () => {
    await renderReady(37);
    expect(range().textContent).toBe("Showing 1–37 of 37");
    expect(bodyRows()).toBe(37);
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(true);
  });

  it("formats large totals with thousands separators but plain data attributes", async () => {
    await renderReady(1500);
    expect(range().textContent).toBe("Showing 1–200 of 1,500");
    expect(range().getAttribute("data-total")).toBe("1500");
  });
});

describe("Permits paging (cards)", () => {
  it("renders one page of cards below 600 px", async () => {
    await renderReady(250, false);
    const list = screen.getByRole("list", { name: "Permits" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(200);
    expect(document.querySelector("table")).toBeNull();
    fireEvent.click(next());
    expect(range().textContent).toBe("Showing 201–250 of 250");
    expect(within(list).getAllByRole("listitem")).toHaveLength(50);
    expect(next().disabled).toBe(true);
  });
});

describe("resolvePermitsState keeps the exact count check", () => {
  it("is ready for a matching count and an error for a mismatch, whatever the page size", () => {
    const data = loadedOf(450);
    expect(resolvePermitsState(data)).toEqual({ kind: "ready", data });
    expect(resolvePermitsState({ ...data, permitsEmitted: 449 })).toEqual({
      kind: "error",
      message: PERMITS_TEXTS.countMismatch(450, 449),
    });
  });
});
