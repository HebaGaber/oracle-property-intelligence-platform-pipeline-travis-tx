// A-03 T033 / T060 (G-C3): the Runs page (`/runs`), spec FR-002, FR-005(b), FR-009; plan
// § "Atlas element map" → Runs page; TC-010…014, TC-031. The page reads `/runs/index.json`
// (same origin), the manifest by CID through fetchByCid, and shows the run ID, UTC start and
// finish, the sources in manifest order, the coverage rows with their derivation helper text,
// the data groups with their tables CIDs, the manifest CID (`data-cid`, truncated text, copy
// button), the publication-state pill and the "Server check" line as secondary text. Every
// count comes from the manifest, never from the API. Texts come from @countylens/shared.
//
// The Atlas components (G-C4, T055) are mocked with minimal renderers: this file tests the
// page's content and state, not the components' form. Fetches are vi.fn; no network.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import {
  COVERAGE_LABELS,
  DERIVATION_LABELS,
  PROGRESS_LABELS,
  PUBLICATION_STATE_TEXT,
  RUN_INDEX_TEXTS,
  SOURCE_LABELS,
} from "@countylens/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BOTH_HOSTS_DOWN_TEXT } from "../src/data/fetch-by-cid";

const COPY_HOST = "copy.example.test";
const GATEWAY_HOST = "ipfs.filebase.io";

// ---------------------------------------------------------------------------------------------
// Component mocks (G-C4 owns the real ones; props per the T007 stubs and plan § Atlas map).
// ---------------------------------------------------------------------------------------------

const api = vi.hoisted(() => ({
  summary: vi.fn<
    (input: { manifestCid: string }) => Promise<{
      manifestCid: string;
      verified: true;
      tablesBound: number;
      roofingPermitRows: number;
      queryDurationMs: number;
    }>
  >(),
}));

vi.mock("../src/components/StatusPill", () => ({
  StatusPill: (props: { status: string; text: string; icon?: string }): ReactElement => (
    <span data-testid="status-pill" data-status={props.status} data-icon={props.icon ?? ""}>
      {props.text}
    </span>
  ),
}));

vi.mock("../src/components/ErrorBanner", () => ({
  ErrorBanner: (props: { message: string; onRetry?: () => void }): ReactElement => (
    <div role="alert">
      <span>{props.message}</span>
      {props.onRetry === undefined ? null : (
        <button type="button" onClick={props.onRetry}>
          Retry
        </button>
      )}
    </div>
  ),
}));

vi.mock("../src/components/Skeleton", () => ({
  Skeleton: (props: { variant: string; count?: number }): ReactElement => (
    <div role="status" aria-busy="true" data-variant={props.variant} data-count={props.count} />
  ),
}));

vi.mock("../src/components/LinearProgress", () => ({
  LinearProgress: (props: { label: string; stageText: string }): ReactElement => (
    <div role="progressbar" aria-label={props.label} aria-valuetext={props.stageText} />
  ),
}));

vi.mock("../src/components/FallbackChip", async () => {
  const { fallbackLabel } = await import("../src/data/fetch-by-cid");
  return {
    FallbackChip: (props: {
      source: { kind: "copy" | "fallback"; host: string };
    }): ReactElement | null => {
      const label = fallbackLabel(props.source);
      return label === null ? null : <span data-testid="fallback-chip">{label}</span>;
    },
  };
});

vi.mock("@countylens/api-client/react", () => ({
  useTRPC: () => ({
    runs: {
      summary: {
        queryOptions: (input: { manifestCid: string }) => ({
          queryKey: ["runs", "summary", input],
          queryFn: () => api.summary(input),
        }),
      },
    },
  }),
}));

// ---------------------------------------------------------------------------------------------
// Fixture: a schema-valid manifest built in the test (every CID is a real raw-leaves CIDv1 of
// test bytes; nothing here is shown as real data). Index → latest run → manifest.
// ---------------------------------------------------------------------------------------------

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
const SHA = "0".repeat(64);

interface Fixture {
  manifest: RunManifestV1;
  manifestBytes: Uint8Array<ArrayBuffer>;
  manifestCid: string;
  countyTablesCid: string;
  improvementTablesCid: string;
  indexJson: string;
}

async function buildFixture(noTcadCount: number): Promise<Fixture> {
  const cid = (seed: string): Promise<string> => rawCid(encode(seed));
  const countyTablesCid = await cid("tables/county");
  const improvementTablesCid = await cid("tables/property_improvement");
  const manifest: RunManifestV1 = {
    schema: RUN_MANIFEST_SCHEMA,
    runId: "travis-2026-09-test",
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-21T08:00:00.000Z",
    finishedAt: "2026-10-21T08:12:34.000Z",
    previousManifestCid: null,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: "2026-09-30",
        captured_at: "2026-10-21T08:01:00.000Z",
        records: 42,
        added: 42,
        changed: 0,
        removed: 0,
        limitations: ["Comptroller baseline not loaded (A-07)"],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/publicinformation",
        watermark: null,
        captured_at: "2026-10-21T08:05:00.000Z",
        records: 1234,
        added: 1234,
        changed: 0,
        removed: 0,
        limitations: ["Confidential owner records redacted (Texas Tax Code §25.025): 0"],
      },
    ],
    artifacts: [
      {
        name: "car/travis-county.car",
        cid: await cid("car/county"),
        codec: "car",
        size: 10,
        sha256: SHA,
        kind: "car",
        carCid: await cid("car/county/file"),
      },
      {
        name: "tables/county",
        cid: countyTablesCid,
        codec: "dag-pb",
        size: 10,
        sha256: SHA,
        kind: "directory",
        carCid: await cid("tables/county/file"),
      },
      {
        name: "tables/county/property/part-00000.parquet",
        cid: await cid("county/property/part-00000"),
        codec: "raw",
        size: 10,
        sha256: SHA,
        kind: "table",
      },
      {
        name: "tables/property_improvement",
        cid: improvementTablesCid,
        codec: "dag-pb",
        size: 10,
        sha256: SHA,
        kind: "directory",
        carCid: await cid("tables/property_improvement/file"),
      },
      {
        name: "tables/property_improvement/property_improvement/part-00000.parquet",
        cid: await cid("property_improvement/part-00000"),
        codec: "raw",
        size: 10,
        sha256: SHA,
        kind: "table",
      },
    ],
    profiles: [],
    coverage: {
      permits_captured: { count: 42, derivation: "capture_receipt" },
      permits_emitted: { count: 37, derivation: "published_rows" },
      permits_no_tcad_geoid: { count: noTcadCount, derivation: "aggregate_match" },
    },
    limitations: [],
  };
  const manifestBytes = encode(JSON.stringify(manifest));
  const manifestCid = await rawCid(manifestBytes);
  const indexJson = JSON.stringify({
    schema: RUNS_INDEX_SCHEMA,
    runs: [{ runId: manifest.runId, manifestCid, finishedAt: manifest.finishedAt }],
  });
  return { manifest, manifestBytes, manifestCid, countyTablesCid, improvementTablesCid, indexJson };
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

interface Hosts {
  index: () => Response;
  copy: () => Response;
  gateway?: () => Response;
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function installFetch(hosts: Hosts): FetchMock {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    if (url === "/runs/index.json") return hosts.index();
    const parsed = new URL(url);
    if (parsed.host === COPY_HOST) return hosts.copy();
    if (parsed.host === GATEWAY_HOST && hosts.gateway !== undefined) return hosts.gateway();
    throw new TypeError(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (text: string, status = 200): Response =>
  new Response(text, { status, headers: { "content-type": "application/json" } });

function Providers({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderRuns(): Promise<void> {
  const { Component } = await import("../src/routes/Runs");
  render(
    <Providers>
      <Component />
    </Providers>,
  );
}

async function findCard(): Promise<HTMLElement> {
  return screen.findByRole("article");
}

function listNamed(name: string): HTMLElement {
  return screen.getByRole("list", { name });
}

function coverageRow(key: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-coverage="${key}"]`);
  expect(row, `coverage row ${key}`).not.toBeNull();
  return row as HTMLElement;
}

let fixture: Fixture;
const clipboard = { writeText: vi.fn<(text: string) => Promise<void>>(async () => undefined) };

beforeAll(async () => {
  fixture = await buildFixture(0);
});

beforeEach(() => {
  vi.stubEnv("VITE_CID_COPY_HOST", COPY_HOST);
  vi.stubEnv("VITE_FILEBASE_GATEWAY_HOST", GATEWAY_HOST);
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  clipboard.writeText.mockClear();
  api.summary.mockReset();
  api.summary.mockResolvedValue({
    manifestCid: fixture.manifestCid,
    verified: true,
    tablesBound: 2,
    roofingPermitRows: 37,
    queryDurationMs: 12,
  });
  installFetch({
    index: () => json(fixture.indexJson),
    copy: () => new Response(fixture.manifestBytes),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Runs page: loading state (plan § States)", () => {
  it("shows the linear progress named `Loading run` with a stage text and a card skeleton, never an empty card", async () => {
    installFetch({
      index: () => new Promise<Response>(() => undefined) as never,
      copy: () => new Response(null),
    });
    await renderRuns();

    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-label")).toBe(PROGRESS_LABELS.runs);
    expect(bar.getAttribute("aria-valuetext") ?? "").not.toBe("");
    const skeleton = screen.getByRole("status");
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("Runs page: the run card (TC-010)", () => {
  it("shows the run ID and the UTC start and finish from the manifest", async () => {
    await renderRuns();
    const card = await findCard();

    expect(within(card).getByRole("heading", { level: 2 }).textContent).toBe(
      fixture.manifest.runId,
    );
    expect(card.textContent).toContain(`Started ${fixture.manifest.startedAt} UTC`);
    expect(card.textContent).toContain(`Finished ${fixture.manifest.finishedAt} UTC`);
  });

  it("shows the manifest CID in data-cid with a middle-truncated text and a copy button that copies the full CID", async () => {
    await renderRuns();
    const card = await findCard();
    const cid = fixture.manifestCid;

    const element = card.querySelector<HTMLElement>(`[data-cid="${cid}"]`);
    expect(element, "manifest CID element").not.toBeNull();
    expect(element?.textContent).toBe(`${cid.slice(0, 4)}…${cid.slice(-4)}`);
    expect(element?.getAttribute("title")).toBe(cid);

    const copy = within(element as HTMLElement).getByRole("button", { name: /copy/i });
    fireEvent.click(copy);
    expect(clipboard.writeText).toHaveBeenCalledWith(cid);
  });

  it("names the index origin and the manifest in the provenance line", async () => {
    await renderRuns();
    const card = await findCard();

    expect(card.textContent).toContain("Index: this site (/runs/index.json)");
    expect(card.textContent).toContain("Manifest:");
  });

  it("shows the publication state as an Info / pending pill with the fixed text and never says published to Atlas", async () => {
    await renderRuns();
    const card = await findCard();

    const pill = within(card)
      .getAllByTestId("status-pill")
      .find((p) => p.textContent === PUBLICATION_STATE_TEXT);
    expect(pill, "publication-state pill").toBeDefined();
    expect(pill?.getAttribute("data-status")).toBe("info");
    expect(pill?.getAttribute("data-icon")).toBe("schedule");
    expect(pill?.textContent).toBe("Public by CID · Atlas registration pending");
    expect(document.body.textContent).not.toContain("published to Atlas");
  });

  it("offers no run controls: the only buttons are CID copy buttons", async () => {
    await renderRuns();
    const card = await findCard();

    const buttons = within(card).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute("aria-label") ?? "").toMatch(/^Copy /);
    }
  });

  it("shows no fallback chip when the copy served the manifest", async () => {
    await renderRuns();
    await findCard();
    expect(screen.queryByTestId("fallback-chip")).toBeNull();
  });
});

describe("Runs page: sources in manifest order (TC-011)", () => {
  it("lists every source with its label, id, records, capture time and link, Austin first", async () => {
    await renderRuns();
    await findCard();

    const items = within(listNamed("Sources")).getAllByRole("listitem");
    expect(items).toHaveLength(fixture.manifest.sources.length);

    const [austin, tcad] = items;
    expect(austin, "Austin item").toBeDefined();
    expect(tcad, "TCAD item").toBeDefined();
    const [source0, source1] = fixture.manifest.sources;
    expect(source0).toBeDefined();
    expect(source1).toBeDefined();
    if (
      austin === undefined ||
      tcad === undefined ||
      source0 === undefined ||
      source1 === undefined
    ) {
      return;
    }

    expect(within(austin).getByText(SOURCE_LABELS["austin-3syk-w9eu"])).toBeDefined();
    expect(austin.textContent).toContain(`${source0.records} records`);
    expect(austin.textContent).toContain(`collected ${source0.captured_at} UTC`);
    expect(within(austin).getByRole("link").getAttribute("href")).toBe(source0.url);

    expect(within(tcad).getByText(SOURCE_LABELS["tcad-2026-certified-json"])).toBeDefined();
    expect(tcad.textContent).toContain("tcad-2026-certified-json");
    expect(tcad.textContent).toContain(`${source1.records} records`);
    expect(within(tcad).getByRole("link").getAttribute("href")).toBe(source1.url);
  });

  it("shows each source's added, changed and removed counts and its watermark (A-11 Run 3)", async () => {
    await renderRuns();
    await findCard();
    const austin = within(listNamed("Sources")).getAllByRole("listitem")[0];
    const delta = austin?.querySelector('[data-source-delta="austin-3syk-w9eu"]');
    expect(delta?.textContent).toContain("42 added · 0 changed · 0 removed");
    expect(delta?.textContent).toContain("2026-09-30");
    const tcad = within(listNamed("Sources")).getAllByRole("listitem")[1];
    expect(tcad?.querySelector("[data-source-delta]")?.textContent).toContain("watermark none");
  });
});

describe("Runs page: coverage rows (TC-012, TC-031, T060)", () => {
  it("shows `Permits published` = coverage.permits_emitted.count with its derivation helper text", async () => {
    await renderRuns();
    await findCard();

    const row = coverageRow("permits_emitted");
    expect(within(row).getByText(COVERAGE_LABELS.permits_emitted)).toBeDefined();
    expect(within(row).getByText("37")).toBeDefined();
    expect(within(row).getByText(DERIVATION_LABELS.published_rows)).toBeDefined();
    expect(row.textContent).toContain("Counted from published rows");
  });

  it("shows `No TCAD id on source record` with a true 0 shown as `0` and the aggregate_match helper text", async () => {
    await renderRuns();
    await findCard();

    const row = coverageRow("permits_no_tcad_geoid");
    expect(within(row).getByText(COVERAGE_LABELS.permits_no_tcad_geoid)).toBeDefined();
    expect(within(row).getByText("0")).toBeDefined();
    expect(within(row).getByText(DERIVATION_LABELS.aggregate_match)).toBeDefined();
    expect(row.textContent).toContain(
      "From the run's internal match (not recomputable from public data)",
    );
  });

  it("shows the manifest's no-TCAD count when it is not zero", async () => {
    const other = await buildFixture(1);
    installFetch({
      index: () => json(other.indexJson),
      copy: () => new Response(other.manifestBytes),
    });
    await renderRuns();
    await findCard();

    expect(within(coverageRow("permits_no_tcad_geoid")).getByText("1")).toBeDefined();
  });

  it("takes every count from the manifest, never from the API (FR-009)", async () => {
    api.summary.mockResolvedValue({
      manifestCid: fixture.manifestCid,
      verified: true,
      tablesBound: 2,
      roofingPermitRows: 99,
      queryDurationMs: 7,
    });
    await renderRuns();
    await findCard();

    expect(within(coverageRow("permits_emitted")).getByText("37")).toBeDefined();
    expect(within(coverageRow("permits_emitted")).queryByText("99")).toBeNull();
    await screen.findByText("Server check: 99 rows · 7 ms · from the API (runs.summary)");
  });
});

describe("Runs page: data groups with their tables CIDs (TC-013)", () => {
  it("lists county and property_improvement with the directory artifact CID in data-cid, and no other group", async () => {
    await renderRuns();
    await findCard();

    const items = within(listNamed("Data groups")).getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("data-group"))).toEqual([
      "county",
      "property_improvement",
    ]);
    expect(items[0]?.querySelector(`[data-cid="${fixture.countyTablesCid}"]`)).not.toBeNull();
    expect(items[1]?.querySelector(`[data-cid="${fixture.improvementTablesCid}"]`)).not.toBeNull();
    expect(items[0]?.textContent).toContain("county");
    expect(items[1]?.textContent).toContain("property_improvement");
  });
});

describe("Runs page: the Server check line (contracts/api.md runs.summary)", () => {
  it("renders the API's rows and duration as secondary text with its own provenance, not a heading", async () => {
    await renderRuns();
    await findCard();

    const line = await screen.findByText(
      "Server check: 37 rows · 12 ms · from the API (runs.summary)",
    );
    expect(line.closest("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(api.summary).toHaveBeenCalledWith({ manifestCid: fixture.manifestCid });
  });

  it("says `Server check: unavailable` when the API fails, without a page error", async () => {
    api.summary.mockRejectedValue(new Error("502"));
    await renderRuns();
    await findCard();

    await screen.findByText("Server check: unavailable");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Runs page: fallback and error states (TC-032…034 on this page, FR-005(c))", () => {
  it("labels a manifest read through the Filebase gateway `fallback · {host}`", async () => {
    installFetch({
      index: () => json(fixture.indexJson),
      copy: () => new Response(null, { status: 500 }),
      gateway: () => new Response(fixture.manifestBytes),
    });
    await renderRuns();
    await findCard();

    expect(screen.getByTestId("fallback-chip").textContent).toBe(`fallback · ${GATEWAY_HOST}`);
  });

  it("shows exactly the both-hosts-down text when the copy and the gateway fail", async () => {
    installFetch({
      index: () => json(fixture.indexJson),
      copy: () => {
        throw new TypeError("Failed to fetch");
      },
      gateway: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await renderRuns();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(BOTH_HOSTS_DOWN_TEXT);
    expect(alert.textContent).toContain(
      "Data could not be reached from the CID copy or the Filebase gateway",
    );
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("Runs page: run index unreadable or empty (TC-014)", () => {
  it.each([
    ["missing (404)", () => json("", 404)],
    ["not JSON", () => json("{not json")],
    ["schema mismatch", () => json('{"foo":1}')],
  ])(
    "shows `Run index could not be read from this site` when the index is %s",
    async (_name, index) => {
      const fetchMock = installFetch({ index, copy: () => new Response(fixture.manifestBytes) });
      await renderRuns();

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(RUN_INDEX_TEXTS.unreadable);
      expect(alert.textContent).toContain("Run index could not be read from this site");
      expect(screen.queryByRole("article")).toBeNull();
      expect(screen.queryByRole("progressbar")).toBeNull();
      expect(fetchMock.mock.calls.map(([input]) => urlOf(input))).toEqual(["/runs/index.json"]);
    },
  );

  it("shows `No runs published yet` for an index with zero runs", async () => {
    installFetch({
      index: () => json(JSON.stringify({ schema: RUNS_INDEX_SCHEMA, runs: [] })),
      copy: () => new Response(fixture.manifestBytes),
    });
    await renderRuns();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(RUN_INDEX_TEXTS.empty);
    expect(alert.textContent).toContain("No runs published yet");
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("re-runs the load on Retry", async () => {
    let attempts = 0;
    installFetch({
      index: () => {
        attempts += 1;
        return attempts === 1 ? json("", 404) : json(fixture.indexJson);
      },
      copy: () => new Response(fixture.manifestBytes),
    });
    await renderRuns();

    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await findCard();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(attempts).toBe(2);
  });
});
