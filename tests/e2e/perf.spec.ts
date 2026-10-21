// A-03 browser read-path timings on the hosted Permits page (T061; AC-4, FR-004, NFR-001).
//
// - TC-NF-01: five cold first loads (a fresh browser context each, so nothing is cached), each
//   timed from navigation start to the first rendered permit row, with the `Loading permits`
//   progress bar seen in between; every load ≤ 8,000 ms.
// - TC-NF-02: once DuckDB-WASM is ready, one untimed warm-up and then 20 timed runs each of the
//   COUNT and the listing query through the page's query hook (`window.__countylensPermitsQuery`,
//   lib/perf.ts), timed with `performance.now()` in the page; each p95 < 3,000 ms.
// Timings are attached as JSON for docs/evidence/A-03.md and docs/decisions/0001-read-path.md.
import { expect, test } from "./lib/fixtures.js";
import {
  LIMITS,
  PERMITS_QUERY_HOOK,
  SELECTORS,
  TIMED_RUNS,
  permitsEmitted as permitsEmittedOf,
  summarize,
  type PermitsQueryHook,
} from "./lib/perf.js";
import { runtimeUrl } from "./lib/runtime.js";

const COLD_LOADS = 5;

interface FirstLoadProbe {
  progressAt: number | null;
  firstRowAt: number | null;
}

declare global {
  interface Window {
    __nf01?: FirstLoadProbe;
  }
}

test.describe("A-03-TC-NF-01 browser first load ≤ 8 s with a progress bar", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test("@scenario:A-03-TC-NF-01", async ({ browser, run }, testInfo) => {
    const permitsEmitted = permitsEmittedOf(run.manifest);
    expect(permitsEmitted, "the run publishes permits (rows to time)").toBeGreaterThan(0);

    const loads: (FirstLoadProbe & { load: number })[] = [];
    for (let load = 1; load <= COLD_LOADS; load += 1) {
      const context = await browser.newContext({ colorScheme: "light" });
      try {
        // Times are milliseconds since navigation start (performance.timeOrigin of the document).
        await context.addInitScript(
          ({ progress, row }) => {
            const probe: FirstLoadProbe = { progressAt: null, firstRowAt: null };
            window.__nf01 = probe;
            const check = (): void => {
              if (probe.progressAt === null && document.querySelector(progress)) {
                probe.progressAt = performance.now();
              }
              if (probe.firstRowAt === null && document.querySelector(row)) {
                probe.firstRowAt = performance.now();
                observer.disconnect();
              }
            };
            const observer = new MutationObserver(check);
            observer.observe(document, { childList: true, subtree: true, attributes: true });
          },
          { progress: SELECTORS.permitsProgress, row: SELECTORS.permitRow },
        );
        const page = await context.newPage();
        await page.goto(`${runtimeUrl()}/permits`, { waitUntil: "commit" });
        await page
          .locator(SELECTORS.permitRow)
          .first()
          .waitFor({ state: "visible", timeout: 60_000 });
        const probe = await page.evaluate(() => window.__nf01 ?? null);
        expect(probe, `load ${load}: the first-load probe ran`).not.toBeNull();
        loads.push({
          load,
          progressAt: probe?.progressAt ?? null,
          firstRowAt: probe?.firstRowAt ?? null,
        });
      } finally {
        await context.close();
      }
    }

    const timings = loads.map((l) => Math.round(l.firstRowAt ?? Number.POSITIVE_INFINITY));
    await testInfo.attach("tc-nf-01-first-loads.json", {
      body: JSON.stringify({ url: `${runtimeUrl()}/permits`, loads, timingsMs: timings }, null, 2),
      contentType: "application/json",
    });
    for (const l of loads) {
      expect
        .soft(l.progressAt, `load ${l.load}: progress bar "Loading permits" shown`)
        .not.toBeNull();
      expect.soft(l.firstRowAt, `load ${l.load}: a permit row rendered`).not.toBeNull();
      if (l.progressAt !== null && l.firstRowAt !== null) {
        expect
          .soft(l.progressAt, `load ${l.load}: progress bar before the first row`)
          .toBeLessThan(l.firstRowAt);
      }
      expect
        .soft(
          Math.round(l.firstRowAt ?? Number.POSITIVE_INFINITY),
          `load ${l.load}: first load ≤ ${LIMITS.firstLoadMs} ms`,
        )
        .toBeLessThanOrEqual(LIMITS.firstLoadMs);
    }
    expect(loads).toHaveLength(COLD_LOADS);
  });
});

test.describe("A-03-TC-NF-02 COUNT and listing p95 < 3 s in the browser (20 runs)", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test("@scenario:A-03-TC-NF-02", async ({ page, run }, testInfo) => {
    const permitsEmitted = permitsEmittedOf(run.manifest);
    await page.goto(`${runtimeUrl()}/permits`, { waitUntil: "domcontentloaded" });
    await page.locator(SELECTORS.permitsReady).waitFor({ state: "visible", timeout: 60_000 });

    const hookType = await page.evaluate(
      (name) => typeof Reflect.get(window, name),
      PERMITS_QUERY_HOOK,
    );
    expect(
      hookType,
      `the Permits page exposes its query hook window.${PERMITS_QUERY_HOOK} = { count(), list() } once DuckDB is ready (TC-NF-02 step 2)`,
    ).toBe("object");

    const measured = await page.evaluate(
      async ({ name, runs }) => {
        const hook = Reflect.get(window, name) as PermitsQueryHook;
        const time = async (
          fn: () => Promise<number>,
        ): Promise<{ ms: number[]; value: number; warmupMs: number }> => {
          const w0 = performance.now();
          await fn();
          const warmupMs = performance.now() - w0;
          const ms: number[] = [];
          let value = 0;
          for (let i = 0; i < runs; i += 1) {
            const t0 = performance.now();
            value = await fn();
            ms.push(performance.now() - t0);
          }
          return { ms, value, warmupMs };
        };
        const count = await time(() => hook.count());
        const list = await time(() => hook.list());
        return { count, list };
      },
      { name: PERMITS_QUERY_HOOK, runs: TIMED_RUNS },
    );

    const count = summarize(measured.count.ms.map((v) => Math.round(v * 10) / 10));
    const list = summarize(measured.list.ms.map((v) => Math.round(v * 10) / 10));
    await testInfo.attach("tc-nf-02-timings.json", {
      body: JSON.stringify(
        {
          url: `${runtimeUrl()}/permits`,
          manifestCid: run.manifestCid,
          warmupMs: { count: measured.count.warmupMs, list: measured.list.warmupMs },
          count,
          list,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    expect(count.n).toBe(TIMED_RUNS);
    expect(list.n).toBe(TIMED_RUNS);
    expect
      .soft(measured.count.value, "COUNT equals the manifest's permits_emitted")
      .toBe(permitsEmitted);
    expect
      .soft(measured.list.value, "the listing returns every published row")
      .toBe(permitsEmitted);
    expect.soft(count.p95Ms, `COUNT p95 < ${LIMITS.queryP95Ms} ms`).toBeLessThan(LIMITS.queryP95Ms);
    expect(list.p95Ms, `listing p95 < ${LIMITS.queryP95Ms} ms`).toBeLessThan(LIMITS.queryP95Ms);
  });
});
