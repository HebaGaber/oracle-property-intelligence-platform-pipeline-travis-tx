// A-13 T022 (AC-3, AC-7, FR-003, FR-003a–c, FR-016; TC-006, TC-018, TC-020, TC-021, TC-022,
// TC-023): Data · Verify (`/data/verify/:cid`) and its VerifyLane. Two lanes, Pinata then
// Filebase, each with its exact URL; ✓ only when the bytes' size and SHA-256 (and raw CID) equal
// the manifest; a mismatch shows both values; a readable 429 reads "rate-limited, retrying", an
// unreadable answer "no readable response (rate-limited or blocked), retrying"; a directory reads
// "Verify via CAR" and fetches nothing; no request ever goes to the CID copy for the artifact.
// Fixtures are built in the test (real digests of test bytes); fetches are vi.fn, no network.
import { RUN_MANIFEST_SCHEMA, RUNS_INDEX_SCHEMA, type RunManifestV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { VERIFY_TEXTS } from "@countylens/shared";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VerifyLane } from "../src/components/VerifyLane";

const COPY_HOST = "copy.example.test";
const FILEBASE_HOST = "ipfs.filebase.io";
const PINATA_HOST = "gateway.pinata.test";
const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let fileBytes: Uint8Array<ArrayBuffer>;
let fileCid: string;
let dirCid: string;
let manifestBytes: Uint8Array<ArrayBuffer>;
let manifestCid: string;
let manifest: RunManifestV1;

beforeAll(async () => {
  fileBytes = encode("published parquet bytes (test)");
  fileCid = await rawCid(fileBytes);
  dirCid = await rawCid(encode("dir"));
  manifest = {
    schema: RUN_MANIFEST_SCHEMA,
    runId: "travis-test-verify",
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
        captured_at: "2026-10-01T08:01:00.000Z",
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
        cid: dirCid,
        codec: "dag-json",
        size: 3,
        sha256: "b".repeat(64),
        kind: "directory",
        carCid: dirCid,
      },
      {
        name: "tables/county/property/part-00000.parquet",
        cid: fileCid,
        codec: "raw",
        size: fileBytes.length,
        sha256: await sha256(fileBytes),
        kind: "table",
      },
    ],
    profiles: [],
    coverage: {},
    limitations: [],
  };
  manifestBytes = encode(JSON.stringify(manifest));
  manifestCid = await rawCid(manifestBytes);
});

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

type Gateway = (url: URL) => Response | Promise<Response>;

function install(opts: { pinata?: Gateway; filebase?: Gateway; copyDown?: boolean } = {}) {
  const serve: Gateway = (url) =>
    url.pathname.endsWith(manifestCid)
      ? new Response(manifestBytes)
      : url.pathname.endsWith(fileCid)
        ? new Response(fileBytes)
        : new Response(null, { status: 404 });
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = urlOf(input);
    if (url === "/runs/index.json") {
      return new Response(
        JSON.stringify({
          schema: RUNS_INDEX_SCHEMA,
          runs: [{ runId: manifest.runId, manifestCid, finishedAt: manifest.finishedAt }],
        }),
      );
    }
    const parsed = new URL(url);
    if (parsed.host === COPY_HOST) {
      return opts.copyDown === true ? new Response(null, { status: 503 }) : serve(parsed);
    }
    if (parsed.host === PINATA_HOST) return (opts.pinata ?? serve)(parsed);
    if (parsed.host === FILEBASE_HOST) {
      return parsed.pathname.endsWith(manifestCid)
        ? serve(parsed)
        : (opts.filebase ?? serve)(parsed);
    }
    throw new TypeError(`unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderVerify(cid: string): Promise<void> {
  const { Component } = await import("../src/routes/DataVerify");
  render(
    <MemoryRouter initialEntries={[`/data/verify/${cid}`]}>
      <Routes>
        <Route path="/data/verify/:cid" element={<Component />} />
      </Routes>
    </MemoryRouter>,
  );
}

const lane = (gateway: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-lane="${gateway}"]`);
  expect(el, `lane ${gateway}`).not.toBeNull();
  return el as HTMLElement;
};

beforeEach(() => {
  vi.stubEnv("VITE_CID_COPY_HOST", COPY_HOST);
  vi.stubEnv("VITE_FILEBASE_GATEWAY_HOST", FILEBASE_HOST);
  vi.stubEnv("VITE_PINATA_GATEWAY_HOST", PINATA_HOST);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Data · Verify page (AC-3, FR-003, TC-006, TC-022)", () => {
  it("shows two ✓ lanes with the exact Pinata and Filebase URLs and the compared values", async () => {
    const fetchMock = install();
    await renderVerify(fileCid);

    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
    await waitFor(() => expect(lane("filebase").getAttribute("data-state")).toBe("verified"));
    expect(lane("pinata").textContent).toContain(`https://${PINATA_HOST}/ipfs/${fileCid}`);
    expect(lane("filebase").textContent).toContain(`https://${FILEBASE_HOST}/ipfs/${fileCid}`);
    for (const g of ["pinata", "filebase"]) {
      expect(lane(g).textContent).toContain(VERIFY_TEXTS.verified);
      expect(lane(g).textContent).toContain("✓");
      expect(lane(g).textContent).toContain(manifest.artifacts[1]?.sha256 ?? "x");
      expect(lane(g).textContent).toContain(String(fileBytes.length));
    }
    const fileRequests = fetchMock.mock.calls
      .map(([input]) => new URL(urlOf(input), "https://app.test"))
      .filter((u) => u.pathname.endsWith(fileCid));
    expect(new Set(fileRequests.map((u) => u.host))).toEqual(new Set([PINATA_HOST, FILEBASE_HOST]));
    for (const [, init] of fetchMock.mock.calls.filter(([i]) => urlOf(i).endsWith(fileCid))) {
      expect(init?.credentials).toBe("omit");
      expect(init?.headers).toBeUndefined();
    }
  });

  it("shows a mismatch with both values and no ✓ when a gateway serves other bytes (TC-021)", async () => {
    install({ filebase: () => new Response(encode("tampered")) });
    await renderVerify(fileCid);

    await waitFor(() => expect(lane("filebase").getAttribute("data-state")).toBe("mismatch"));
    expect(lane("filebase").textContent).toMatch(
      /^.*Mismatch · size \d+ vs \d+ · SHA-256 .+….+ vs .+….+/,
    );
    expect(lane("filebase").textContent).not.toContain("✓");
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
  });

  it("reads `Verify via CAR` for a directory and fetches nothing for it (FR-003c, TC-018)", async () => {
    const fetchMock = install();
    await renderVerify(dirCid);
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("via_car"));
    expect(lane("filebase").textContent).toContain(VERIFY_TEXTS.viaCar);
    expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith(dirCid))).toBe(false);
  });

  it("shows the fallback chip when Filebase served the manifest, and still verifies on both gateways (FR-016, TC-023)", async () => {
    install({ copyDown: true });
    await renderVerify(fileCid);
    expect((await screen.findAllByText(`fallback · ${FILEBASE_HOST}`)).length).toBeGreaterThan(0);
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
    await waitFor(() => expect(lane("filebase").getAttribute("data-state")).toBe("verified"));
  });

  it("verifies a run manifest itself by its CID", async () => {
    install();
    await renderVerify(manifestCid);
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
  });

  it("says the CID is not in this run's manifest when it is unknown", async () => {
    install();
    const unknown = await rawCid(encode("unknown"));
    await renderVerify(unknown);
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(document.querySelector("[data-lane]")).toBeNull();
  });
});

describe("VerifyLane retries (AC-7, FR-003b, TC-020)", () => {
  const target = (): {
    cid: string;
    size: number;
    sha256: string;
    kind: "table";
    codec: string;
  } => ({
    cid: fileCid,
    size: fileBytes.length,
    sha256: manifest.artifacts[1]?.sha256 ?? "",
    kind: "table",
    codec: "raw",
  });

  it("shows `rate-limited, retrying` on a readable 429, never ✓, then ✓ after a matching answer", async () => {
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls += 1;
      return calls < 3 ? new Response(null, { status: 429 }) : new Response(fileBytes);
    });
    let release: () => void = () => undefined;
    const sleep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <VerifyLane
        gateway="pinata"
        url={`https://${PINATA_HOST}/ipfs/${fileCid}`}
        target={target()}
        fetch={fetchImpl}
        sleep={sleep}
      />,
    );
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("retrying"));
    expect(within(lane("pinata")).getByText(VERIFY_TEXTS.rateLimited)).toBeDefined();
    expect(lane("pinata").textContent).not.toContain("✓");
    await act(async () => release());
    await waitFor(() => expect(sleep).toHaveBeenCalledTimes(2));
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([2000, 4000]);
    await act(async () => release());
    await waitFor(() => expect(lane("pinata").getAttribute("data-state")).toBe("verified"));
    expect(lane("pinata").textContent).toContain("✓");
  });

  it("shows `no readable response (rate-limited or blocked), retrying` on a network error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    render(
      <VerifyLane
        gateway="filebase"
        url={`https://${FILEBASE_HOST}/ipfs/${fileCid}`}
        target={target()}
        fetch={fetchImpl}
        sleep={() => new Promise<void>(() => undefined)}
      />,
    );
    await waitFor(() => expect(lane("filebase").getAttribute("data-state")).toBe("retrying"));
    expect(within(lane("filebase")).getByText(VERIFY_TEXTS.noReadableResponse)).toBeDefined();
    expect(lane("filebase").textContent).not.toContain("✓");
  });
});
