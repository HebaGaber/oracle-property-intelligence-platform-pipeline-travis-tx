// A-13 T036 (G3): Data · Catalog (`/data/catalog`), US8, AC-10, FR-010, FR-019, FR-024; TC-053,
// TC-054. One row per table of the latest manifest's artifacts; columns and row counts come from
// the Parquet footers (mocked here at the readParquetFooter seam: hyparquet's own reads are
// covered by data-modules tests); nothing is cached or sampled.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { PAGE_TEXTS, ROUTES } from "@countylens/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const COPY_HOST = "copy.example.test";
const SHA = "0".repeat(64);
const encode = (t: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(t);

const footer = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../src/data/parquet-meta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/data/parquet-meta")>();
  // readTableMeta mirrors the real one (columns from part 1, rows summed over the parts, one
  // after another) on top of the mocked footer reader; its Range guard and caps are covered by
  // data-caps.test.ts.
  const readTableMeta: typeof actual.readTableMeta = async (parts, urlOf, options) => {
    const [first, ...rest] = parts;
    if (first === undefined) throw new Error("the table has no part in the manifest");
    const head = await footer.read(urlOf(first), first.size, options);
    let rows: number = head.rows;
    for (const part of rest) rows += (await footer.read(urlOf(part), part.size, options)).rows;
    return { columns: head.columns, rows };
  };
  return { ...actual, readParquetFooter: footer.read, readTableMeta };
});

interface Fixture {
  manifest: RunManifestV1;
  bytes: Uint8Array<ArrayBuffer>;
  cid: string;
  parts: { name: string; cid: string }[];
}
let fx: Fixture;

async function build(withExport: boolean): Promise<Fixture> {
  const names = [
    "tables/county/property/part-00000.parquet",
    "tables/county/property/part-00001.parquet",
    "tables/property_improvement/property_improvement/part-00000.parquet",
  ];
  const parts = await Promise.all(
    names.map(async (name) => ({ name, cid: await rawCid(encode(name)) })),
  );
  const manifest: RunManifestV1 = {
    schema: RUN_MANIFEST_SCHEMA,
    runId: "test-run",
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-21T08:00:00.000Z",
    finishedAt: "2026-10-21T08:12:34.000Z",
    previousManifestCid: null,
    sources: [
      {
        name: "tcad-2026-certified-json",
        url: "https://example.test/source",
        watermark: null,
        captured_at: "2026-10-21T08:05:00.000Z",
        records: 1,
        added: 1,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts: [
      {
        name: "tables/county",
        cid: await rawCid(encode("dir")),
        codec: "dag-pb",
        size: 5,
        sha256: SHA,
        kind: "directory",
        carCid: await rawCid(encode("dir-car")),
      },
      ...parts.map((p, i) => ({
        name: p.name,
        cid: p.cid,
        codec: "raw" as const,
        size: 100 + i,
        sha256: SHA,
        kind: "table" as const,
      })),
      ...(withExport
        ? [
            {
              name: "tables-export.json",
              cid: await rawCid(encode("export")),
              codec: "raw" as const,
              size: 9,
              sha256: SHA,
              kind: "table" as const,
            },
          ]
        : []),
    ],
    profiles: [],
    coverage: {
      parcels_emitted: { count: 7, derivation: "published_rows" },
      permits_captured: { count: 99, derivation: "capture_receipt" },
    },
    limitations: [],
  };
  const bytes = encode(JSON.stringify(manifest));
  return { manifest, bytes, cid: await rawCid(bytes), parts };
}

beforeAll(async () => {
  fx = await build(false);
});

function install(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/runs/index.json") {
        return new Response(
          JSON.stringify({
            schema: RUNS_INDEX_SCHEMA,
            runs: [{ runId: "test-run", manifestCid: fx.cid, finishedAt: fx.manifest.finishedAt }],
          }),
        );
      }
      if (new URL(url).host === COPY_HOST && url.includes(fx.cid)) return new Response(fx.bytes);
      return new Response("x", { status: 503 });
    }),
  );
}

async function renderCatalog(): Promise<HTMLElement> {
  const { Component } = await import("../src/routes/DataCatalog");
  render(
    <MemoryRouter initialEntries={["/data/catalog"]}>
      <Component />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: "Data · Catalog" });
}

beforeEach(() => {
  vi.stubEnv("VITE_CID_COPY_HOST", COPY_HOST);
  vi.stubEnv("VITE_FILEBASE_GATEWAY_HOST", "ipfs.filebase.io");
  footer.read.mockReset();
  footer.read.mockImplementation(async (url: string) =>
    url.includes(fx.parts[2]?.cid ?? "")
      ? { columns: [{ name: "improvement_type", type: "STRING" }], rows: 4 }
      : {
          columns: [
            { name: "parcel_identifier", type: "STRING" },
            { name: "year_built", type: "INT_32" },
          ],
          rows: 10,
        },
  );
  install();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Catalog: one row per table (TC-053)", () => {
  it("lists each table of the manifest once, with CIDs linking to Verify, size and sums", async () => {
    const page = await renderCatalog();
    const rows = await vi.waitFor(() => {
      const found = page.querySelectorAll<HTMLElement>("[data-table]");
      expect(found.length).toBe(2);
      expect(page.getAttribute("data-state")).toBe("ready");
      return found;
    });
    const property = [...rows].find((r) => r.getAttribute("data-table") === "county.property");
    expect(property).toBeDefined();
    const p = property as HTMLElement;
    // Two parts of 100 and 101 bytes; footers say 10 rows each.
    expect(within(p).getByText(/rows in the published file/).textContent).toContain("20");
    expect(within(p).getByText("parcel_identifier")).toBeTruthy();
    expect(within(p).getByText("year_built")).toBeTruthy();
    const hrefs = [...p.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const part of fx.parts.slice(0, 2)) expect(hrefs).toContain(`/data/verify/${part.cid}`);
    expect(p.textContent).toContain("201");
  });

  it("shows published_rows beside it where a coverage key maps to the table", async () => {
    const page = await renderCatalog();
    await vi.waitFor(() =>
      expect(page.getAttribute("data-state"), page.textContent ?? "").toBe("ready"),
    );
    const p = page.querySelector<HTMLElement>('[data-table="county.property"]') as HTMLElement;
    expect(p.textContent).toContain("published_rows");
    expect(p.querySelector('[data-coverage-key="parcels_emitted"]')?.textContent).toContain("7");
    const other = page.querySelector<HTMLElement>(
      '[data-table="property_improvement.property_improvement"]',
    ) as HTMLElement;
    expect(other.textContent).not.toContain("published_rows");
  });

  it("says the table export is not in this run's manifest while there is no tables-export.json", async () => {
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    expect(screen.getByText(PAGE_TEXTS.tableExportMissing)).toBeTruthy();
  });

  it("does not say it when the manifest lists tables-export.json", async () => {
    fx = await build(true);
    install();
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    expect(screen.queryByText(PAGE_TEXTS.tableExportMissing)).toBeNull();
    fx = await build(false);
  });

  it("reads each footer from the CID copy host, never from a gateway fallback list", async () => {
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    const urls = footer.read.mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBe(3);
    for (const url of urls) expect(new URL(url).host).toBe(COPY_HOST);
  });

  it("shows the progress bar while reading", async () => {
    footer.read.mockImplementation(() => new Promise(() => undefined));
    const page = await renderCatalog();
    expect(await screen.findByRole("progressbar")).toBeTruthy();
    expect(page.getAttribute("data-state")).toBe("loading");
  });
});

describe("Catalog: unavailable (TC-054)", () => {
  it("every footer unreadable → Catalog unavailable · {reason} with a manifest link, no rows", async () => {
    footer.read.mockRejectedValue(new Error("copy.example.test answered 503"));
    const page = await renderCatalog();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      PAGE_TEXTS.catalogUnavailable("copy.example.test answered 503"),
    );
    expect(
      within(alert)
        .getByRole("link", { name: /manifest/i })
        .getAttribute("href"),
    ).toBe(ROUTES.dataManifest);
    expect(page.getAttribute("data-state")).toBe("error");
    expect(page.querySelectorAll("[data-table]")).toHaveLength(0);
  });

  it("an unreadable run index → Catalog unavailable with a non-empty reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x", { status: 404 })),
    );
    const page = await renderCatalog();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/^Catalog unavailable · .+/);
    expect(page.querySelectorAll("[data-table]")).toHaveLength(0);
  });

  it("one table's footer failing keeps the others and says why on its row", async () => {
    footer.read.mockImplementation(async (url: string) => {
      if (url.includes(fx.parts[2]?.cid ?? "")) throw new Error("range read failed");
      return { columns: [{ name: "parcel_identifier", type: "STRING" }], rows: 10 };
    });
    const page = await renderCatalog();
    await vi.waitFor(() => expect(page.getAttribute("data-state")).toBe("ready"));
    const bad = page.querySelector<HTMLElement>(
      '[data-table="property_improvement.property_improvement"]',
    ) as HTMLElement;
    expect(bad.textContent).toContain("range read failed");
    expect(page.querySelectorAll("[data-table]")).toHaveLength(2);
  });
});
