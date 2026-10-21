// A-13 T019 (AC-2, FR-002, FR-007, FR-022; TC-003, TC-016, TC-017): Coverage
// (`/tx/travis/coverage`). One card per record kind; every count is a manifest `coverage` key
// (`data-coverage-key`) with its derivation label, note, collection time, source table and
// provenance; a kind the section lacks says so in words; each source's denominator reads
// "denominator not in this run's manifest · A-01 source {name}" until the manifest carries a
// `source_total:{source}` key. Fixture built in the test; fetches are vi.fn, no network.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { COVERAGE_TEXTS, DERIVATION_LABELS } from "@countylens/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COVERAGE_KIND_MISSING } from "../src/routes/Coverage.kinds";

const COPY_HOST = "copy.example.test";
const FILEBASE_HOST = "ipfs.filebase.io";
const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

async function buildRun(extraCoverage: RunManifestV1["coverage"] = {}) {
  const cid = (seed: string): Promise<string> => rawCid(encode(seed));
  const permitsPart = await cid("permits part");
  const propertyPart = await cid("property part");
  const manifest: RunManifestV1 = {
    schema: RUN_MANIFEST_SCHEMA,
    runId: "travis-test-coverage",
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-21T08:00:00.000Z",
    finishedAt: "2026-10-21T08:10:00.000Z",
    previousManifestCid: null,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: null,
        captured_at: "2026-10-21T08:01:00.000Z",
        records: 5,
        added: 5,
        changed: 0,
        removed: 0,
        limitations: [],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation",
        watermark: null,
        captured_at: "2026-10-21T08:02:00.000Z",
        records: 3,
        added: 3,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts: [
      {
        name: "tables/property_improvement/property_improvement/part-00000.parquet",
        cid: permitsPart,
        codec: "raw",
        size: 10,
        sha256: "0".repeat(64),
        kind: "table",
      },
      {
        name: "tables/county/property/part-00000.parquet",
        cid: propertyPart,
        codec: "raw",
        size: 10,
        sha256: "0".repeat(64),
        kind: "table",
      },
    ],
    profiles: [],
    coverage: {
      permits_emitted: { count: 5, derivation: "published_rows" },
      permits_captured: { count: 7, derivation: "capture_receipt", note: "test note" },
      parcels_published: { count: 3, derivation: "published_rows" },
      contractor_unresolved: { count: 5, derivation: "aggregate_match" },
      some_future_key: { count: 2, derivation: "aggregate_match" },
      ...extraCoverage,
    },
    limitations: [],
  };
  const bytes = encode(JSON.stringify(manifest));
  const manifestCid = await rawCid(bytes);
  const index = JSON.stringify({
    schema: RUNS_INDEX_SCHEMA,
    runs: [{ runId: manifest.runId, manifestCid, finishedAt: manifest.finishedAt }],
  });
  return { manifest, bytes, manifestCid, index, permitsPart, propertyPart };
}

type Built = Awaited<ReturnType<typeof buildRun>>;

function install(built: Built): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/runs/index.json") return new Response(built.index);
      if (new URL(url).host === COPY_HOST) return new Response(built.bytes);
      throw new TypeError(`unexpected request ${url}`);
    }),
  );
}

async function renderCoverage(): Promise<void> {
  const { Component } = await import("../src/routes/Coverage");
  render(
    <MemoryRouter initialEntries={["/tx/travis/coverage"]}>
      <Component />
    </MemoryRouter>,
  );
}

const kind = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-kind="${id}"]`);
  expect(el, `kind ${id}`).not.toBeNull();
  return el as HTMLElement;
};

beforeEach(() => {
  vi.stubEnv("VITE_CID_COPY_HOST", COPY_HOST);
  vi.stubEnv("VITE_FILEBASE_GATEWAY_HOST", FILEBASE_HOST);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Coverage counts come only from the manifest (FR-002, TC-016)", () => {
  it("shows every coverage key once with its count and derivation label, unknown keys included", async () => {
    const built = await buildRun();
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    const keys = [...document.querySelectorAll<HTMLElement>("[data-coverage-key]")];
    expect(keys.map((k) => k.dataset["coverageKey"]).sort()).toEqual(
      Object.keys(built.manifest.coverage).sort(),
    );
    for (const el of keys) {
      const c = built.manifest.coverage[el.dataset["coverageKey"] ?? ""];
      expect(within(el).getByText(String(c?.count))).toBeDefined();
      expect(
        within(el).getByText(DERIVATION_LABELS[c?.derivation ?? "published_rows"]),
      ).toBeDefined();
    }
    expect(screen.getByText("test note")).toBeDefined();
  });

  it("names the kind's source table with its CID and the collection time, with provenance", async () => {
    const built = await buildRun();
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    const permit = kind("permit");
    const table = permit.querySelector("[data-table]");
    expect(table?.getAttribute("data-table")).toBe("property_improvement/property_improvement");
    expect(table?.querySelector(`[data-cid="${built.permitsPart}"]`)).not.toBeNull();
    expect(permit.textContent).toContain("2026-10-21 08:01:00 UTC");
    expect(permit.querySelector(`[data-cid="${built.manifestCid}"]`)).not.toBeNull();
    expect(permit.textContent).toContain(built.manifest.runId);
    expect(kind("property").querySelector(`[data-cid="${built.propertyPart}"]`)).not.toBeNull();
  });
});

describe("Coverage gaps say why (FR-002, FR-007, TC-017)", () => {
  it("shows `not in this run's coverage section` for a record kind with no key", async () => {
    const built = await buildRun();
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    for (const id of ["bbb", "business", "places", "coordinates"]) {
      expect(kind(id).textContent).toContain(COVERAGE_KIND_MISSING);
      expect(kind(id).querySelector("[data-coverage-key]")).toBeNull();
    }
  });

  it("shows `denominator not in this run's manifest · A-01 source {name}` per source without a total", async () => {
    const built = await buildRun();
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    const region = screen.getByRole("region", { name: /denominators/i });
    for (const source of built.manifest.sources) {
      expect(
        within(region).getByText(COVERAGE_TEXTS.denominatorMissingFor(source.name)),
      ).toBeDefined();
    }
  });

  it("shows a `source_total:{source}` denominator from the manifest when present", async () => {
    const built = await buildRun({
      "source_total:austin-3syk-w9eu": { count: 4321, derivation: "capture_receipt" },
    });
    install(built);
    await renderCoverage();
    await screen.findAllByRole("article");

    const region = screen.getByRole("region", { name: /denominators/i });
    const row = region.querySelector<HTMLElement>('[data-denominator="austin-3syk-w9eu"]');
    expect(row?.textContent).toContain("4321");
    expect(row?.textContent).not.toContain(COVERAGE_TEXTS.denominatorMissing);
    expect(
      within(region).getByText(COVERAGE_TEXTS.denominatorMissingFor("tcad-2026-certified-json")),
    ).toBeDefined();
    expect(
      document.querySelector('[data-coverage-key="source_total:austin-3syk-w9eu"]'),
    ).toBeNull();
  });
});

describe("Coverage errors (FR-021, TC-013)", () => {
  it("says `Manifest unavailable · {cid} · {reason}` when no host serves the manifest", async () => {
    const built = await buildRun();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "/runs/index.json") return new Response(built.index);
        return new Response(null, { status: 503 });
      }),
    );
    await renderCoverage();
    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("[data-error-text]")?.textContent).toMatch(
      new RegExp(`^Manifest unavailable · ${built.manifestCid} · .+`),
    );
    expect(document.querySelector("[data-coverage-key]")).toBeNull();
  });
});
