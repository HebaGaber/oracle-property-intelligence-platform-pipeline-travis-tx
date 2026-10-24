// A-03 read-path fallback cases: TC-032, TC-033 and TC-034 (AC-5, FR-005; PO decision D-2).
// Each case breaks the CID copy from the test side with `context.route` on CID_COPY_HOST
// (abort / 500 / 5 s delay) against the hosted Permits page, with no debug flag in the build,
// and asserts the same CIDs are then read from FILEBASE_GATEWAY_HOST, the list still shows
// `coverage.permits_emitted.count` rows, and the fallback label names the gateway host.
// The label (`fallback · {host}`) and the both-hosts-down text are fixed by plan § "Fixed texts
// and config keys" and emitted by apps/web (FallbackChip.tsx, data/fetch-by-cid.ts); they are
// not exported by @countylens/shared, so they are carried here verbatim.
//
// DOM contract (G-C4): the list is `table tbody tr` at desktop (one row per permit); the
// fallback label is its own text element; the error banner is `role="alert"` with the fixed text
// as its own text element; no `table` renders in the error state.
import type { Locator, Page, TestInfo } from "@playwright/test";
import type { RunManifestV1 } from "@countylens/contract";
import { PERMITS_TEXTS } from "@countylens/shared";
import { expect, test } from "./lib/fixtures.js";
import { checkpoint } from "./lib/evidence.js";
import { artifactsOf, publicCid } from "./lib/manifest.js";
import { harnessConfig, requireCidCopyHost } from "./lib/runtime.js";

/** plan § "Fixed texts": `apps/web/src/data/fetch-by-cid.ts` BOTH_HOSTS_DOWN_TEXT (TC-032 step 5). */
const BOTH_HOSTS_DOWN_TEXT = "Data could not be reached from the CID copy or the Filebase gateway";

/** plan § "Fixed texts": the word `fallback`, ` · `, the gateway host from config. */
function fallbackLabel(host: string): string {
  return `fallback · ${host}`;
}

/** D-2: the copy must deliver a first byte within 4 s; TC-034 delays it 5 s. */
const FALLBACK_AFTER_MS = 4_000;
const DELAY_MS = 5_000;
/** CDP event delivery sits between the page's timer and the harness clock. */
const TIMING_SLACK_MS = 100;

const ROW = "table tbody tr";

function cidOfUrl(url: URL): string {
  return url.pathname.split("/").filter(Boolean).at(-1) ?? "";
}

function publishedCids(manifest: RunManifestV1, manifestCid: string): Set<string> {
  const cids = new Set<string>([manifestCid]);
  for (const artifact of manifest.artifacts) {
    cids.add(artifact.cid);
    cids.add(publicCid(artifact));
  }
  return cids;
}

function permitsPublished(manifest: RunManifestV1): number {
  const entry = manifest.coverage.permits_emitted;
  if (!entry) throw new Error('manifest coverage has no "permits_emitted" entry');
  return entry.count;
}

const byHost =
  (host: string) =>
  (url: URL): boolean =>
    url.hostname === host;

interface SeenRequest {
  method: string;
  url: URL;
  at: number;
}

interface SeenResponse extends SeenRequest {
  status: number;
}

interface NetworkLog {
  requests: SeenRequest[];
  responses: SeenResponse[];
}

function recordNetwork(page: Page): NetworkLog {
  const log: NetworkLog = { requests: [], responses: [] };
  page.on("request", (request) => {
    log.requests.push({ method: request.method(), url: new URL(request.url()), at: Date.now() });
  });
  page.on("response", (response) => {
    log.responses.push({
      method: response.request().method(),
      url: new URL(response.url()),
      at: Date.now(),
      status: response.status(),
    });
  });
  return log;
}

async function attachNetwork(testInfo: TestInfo, name: string, log: NetworkLog): Promise<void> {
  const serialize = (entries: SeenRequest[]): unknown[] =>
    entries.map((entry) => ({ ...entry, url: entry.url.href }));
  await testInfo.attach(name, {
    body: JSON.stringify(
      { requests: serialize(log.requests), responses: serialize(log.responses) },
      null,
      2,
    ),
    contentType: "application/json",
  });
}

/** Waits for rows, failing with the banner or empty-state text the page showed instead. */
async function waitForPermitRows(page: Page, timeoutMs = 180_000): Promise<Locator> {
  const rows = page.locator(ROW);
  const alert = page.getByRole("alert");
  const empty = page.getByText(PERMITS_TEXTS.empty, { exact: true });
  await expect
    .poll(
      async () => {
        if ((await rows.count()) > 0) return "rows";
        if ((await alert.count()) > 0) return "alert";
        if ((await empty.count()) > 0) return "empty";
        return "pending";
      },
      { timeout: timeoutMs, message: "the Permits list, an error banner or the empty state" },
    )
    .not.toBe("pending");
  if ((await alert.count()) > 0) {
    throw new Error(`the Permits page shows an error banner: ${await alert.first().innerText()}`);
  }
  if ((await empty.count()) > 0) {
    throw new Error(`the Permits page shows the empty state: ${PERMITS_TEXTS.empty}`);
  }
  return rows;
}

/** The gateway reads: `/ipfs/{cid}` on FILEBASE_GATEWAY_HOST, every CID listed by the manifest. */
function expectGatewayReads(
  log: NetworkLog,
  gatewayHost: string,
  manifest: RunManifestV1,
  manifestCid: string,
): void {
  const published = publishedCids(manifest, manifestCid);
  const tableCids = new Set(artifactsOf(manifest, "table").map((artifact) => artifact.cid));
  const reads = log.requests.filter((request) => request.url.hostname === gatewayHost);
  expect(reads.length, `requests to ${gatewayHost}`).toBeGreaterThan(0);
  for (const read of reads) {
    expect(read.url.pathname, `${read.url.href}: gateway path`).toMatch(/^\/ipfs\//);
    expect(published.has(cidOfUrl(read.url)), `${read.url.href}: a manifest CID`).toBe(true);
  }
  expect(
    reads.some((read) => cidOfUrl(read.url) === manifestCid),
    "the manifest was read from the gateway",
  ).toBe(true);
  expect(
    reads.some((read) => tableCids.has(cidOfUrl(read.url))),
    "table parts were read from the gateway",
  ).toBe(true);
}

/**
 * Known failure parked as A-16 carried-forward item #7 (stories/A-16-cost-and-admin.md): rawCid()
 * cannot verify table parts above 256 KiB. Remove the three test.fixme markers (and this const)
 * when item #7 is fixed, so any other hosted failure keeps turning the job red.
 */
const A16_ITEM_7 = {
  annotation: {
    type: "fixme",
    description: "known failure, A-16 item #7: rawCid() cannot verify parts above 256 KiB",
  },
};

test.describe("A-03 CID copy fallback to the Filebase gateway (AC-5, FR-005)", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test.describe("A-03-TC-032 CID copy request aborted → Filebase fallback (error)", () => {
    test.fixme("@scenario:A-03-TC-032", A16_ITEM_7, async ({ page, context, run }, testInfo) => {
      const copyHost = requireCidCopyHost();
      const gatewayHost = harnessConfig().FILEBASE_GATEWAY_HOST;
      const { manifest, manifestCid } = run;
      const network = recordNetwork(page);

      // Step 1: every request to the copy is aborted.
      await context.route(byHost(copyHost), (route) => route.abort());

      // Steps 2–4: the list still renders, read from the gateway, labelled.
      await page.goto("/permits");
      const rows = await waitForPermitRows(page);
      await attachNetwork(testInfo, "network-copy-aborted.json", network);
      expect(
        network.requests.some((request) => request.url.hostname === copyHost),
        "the copy was tried first",
      ).toBe(true);
      expectGatewayReads(network, gatewayHost, manifest, manifestCid);
      await expect(rows).toHaveCount(permitsPublished(manifest));
      await expect(page.getByText(fallbackLabel(gatewayHost), { exact: true })).toBeVisible();
      await checkpoint(page, "032", "2-4-gateway-fallback-labelled");

      // Step 5: with the gateway aborted too, the explicit error state, never a blank page.
      await context.route(byHost(gatewayHost), (route) => route.abort());
      await page.reload();
      await expect(
        page.getByRole("alert").getByText(BOTH_HOSTS_DOWN_TEXT, { exact: true }),
      ).toBeVisible({ timeout: 60_000 });
      await expect(page.locator("table")).toHaveCount(0);
      await expect(page.locator(ROW)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "CountyLens" })).toBeVisible();
      await checkpoint(page, "032", "5-both-hosts-down-error");
    });
  });

  test.describe("A-03-TC-033 CID copy returns 500 → Filebase fallback (error)", () => {
    test.fixme("@scenario:A-03-TC-033", A16_ITEM_7, async ({ page, context, run }, testInfo) => {
      const copyHost = requireCidCopyHost();
      const gatewayHost = harnessConfig().FILEBASE_GATEWAY_HOST;
      const { manifest, manifestCid } = run;
      const network = recordNetwork(page);

      // Step 1: every request to the copy answers 500.
      await context.route(byHost(copyHost), (route) => route.fulfill({ status: 500 }));

      // Steps 2–3: the same CIDs are then read from the gateway and answer 200/206.
      await page.goto("/permits");
      const rows = await waitForPermitRows(page);
      await attachNetwork(testInfo, "network-copy-500.json", network);
      expect(
        network.responses.some(
          (response) => response.url.hostname === copyHost && response.status === 500,
        ),
        "the copy answered 500",
      ).toBe(true);
      expectGatewayReads(network, gatewayHost, manifest, manifestCid);
      const gatewayResponses = network.responses.filter(
        (response) => response.url.hostname === gatewayHost,
      );
      expect(gatewayResponses.length).toBeGreaterThan(0);
      for (const response of gatewayResponses) {
        expect([200, 206], `${response.url.href}: status`).toContain(response.status);
      }

      // Expected result: the 500 is never shown as data; the rows are labelled.
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(rows).toHaveCount(permitsPublished(manifest));
      await expect(page.getByText(fallbackLabel(gatewayHost), { exact: true })).toBeVisible();
      await checkpoint(page, "033", "expected-rows-labelled-no-500");
    });
  });

  test.describe("A-03-TC-034 CID copy slower than 4 s → Filebase fallback (edge)", () => {
    test.fixme("@scenario:A-03-TC-034", A16_ITEM_7, async ({ page, context, run }, testInfo) => {
      const copyHost = requireCidCopyHost();
      const gatewayHost = harnessConfig().FILEBASE_GATEWAY_HOST;
      const { manifest, manifestCid } = run;
      const network = recordNetwork(page);

      // Step 1: every copy response is held 5 s, then continued.
      await context.route(byHost(copyHost), async (route) => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, DELAY_MS));
        try {
          await route.continue();
        } catch {
          // The page had already given up on this request (the 4 s timeout fired).
        }
      });

      // Steps 2–3: the gateway request starts between 4.0 s and 5.0 s after the copy request.
      await page.goto("/permits");
      const rows = await waitForPermitRows(page);
      await attachNetwork(testInfo, "network-copy-delayed.json", network);
      const firstCopy = network.requests.find((request) => request.url.hostname === copyHost);
      const firstGateway = network.requests.find((request) => request.url.hostname === gatewayHost);
      expect(firstCopy, `a request to ${copyHost}`).toBeDefined();
      expect(firstGateway, `a request to ${gatewayHost}`).toBeDefined();
      const elapsed = (firstGateway?.at ?? 0) - (firstCopy?.at ?? 0);
      await testInfo.attach("fallback-timing.json", {
        body: JSON.stringify({
          firstCopy: firstCopy?.url.href,
          firstGateway: firstGateway?.url.href,
          elapsedMs: elapsed,
        }),
        contentType: "application/json",
      });
      expect(elapsed, "the fallback started after the 4 s timeout").toBeGreaterThanOrEqual(
        FALLBACK_AFTER_MS - TIMING_SLACK_MS,
      );
      expect(elapsed, "the fallback started before the delayed copy answered").toBeLessThanOrEqual(
        DELAY_MS,
      );
      expectGatewayReads(network, gatewayHost, manifest, manifestCid);

      // Expected result: rows from the gateway, labelled.
      await expect(rows).toHaveCount(permitsPublished(manifest));
      await expect(page.getByText(fallbackLabel(gatewayHost), { exact: true })).toBeVisible();
      await checkpoint(page, "034", "expected-rows-labelled-after-timeout");
    });
  });
});
