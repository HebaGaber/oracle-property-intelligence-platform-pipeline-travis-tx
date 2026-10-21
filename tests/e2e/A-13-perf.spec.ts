// A-13 performance cases (T033; testplans/A-13-test-cases.md § 8): TC-040 (first DuckDB-WASM load
// ≤ 8 s with a progress bar), TC-041 (20 timed runs per Filters search, p95 < 3 s, input change →
// updated header, engine = server per FR-006a) and TC-082 (initial JS ≤ 300 KB gzipped excluding
// DuckDB). Both TC-040 and TC-041 "Wait for A-11": today they run on the single published run and
// are recorded as provisional. The SQL `count(*)` run has no timing target (FR-006a); TC-004 records
// its elapsed time only. Timings are written to docs/evidence/A-13-TC-{nnn}-timings.json and
// attached to the report. Nearest-rank percentiles (lib/perf.ts).
import type { Page } from "@playwright/test";
import { ROUTES } from "@countylens/shared";
import {
  EXPLORE_SEARCH,
  checkpoint,
  evidenceJson,
  expect,
  isDuckdbWasm,
  nextSearch,
  noteBranch,
  ready,
  setControl,
  test,
} from "./lib/a13-fixtures.js";
import { SEL, exploreUrl, scenario, trpcData } from "./lib/a13-ui.js";
import { LIMITS, TIMED_RUNS, summarize } from "./lib/perf.js";

const EXPLORE = ROUTES.explore;
const COLD_LOADS = 5;
/** NFR-002: initial JS ≤ 300 KB gzipped (transferred). */
const JS_BUDGET_BYTES = 307_200;

test.describe("A-13 perf", { tag: "@a13-perf" }, () => {
  test.describe.configure({ mode: "serial" });

  test(scenario("040"), async ({ browser, oracle }) => {
    test.setTimeout(300_000);
    noteBranch(oracle, "provisional until A-11");
    const timings: number[] = [];
    for (let i = 1; i <= COLD_LOADS; i += 1) {
      // 1. A fresh private window (no cache) each time.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(() => {
        const w = window as unknown as { __a13ProgressSeen?: boolean };
        const look = (): void => {
          const bar = document.querySelector('[role="progressbar"]');
          if (bar !== null && (bar.getAttribute("aria-label") ?? bar.getAttribute("aria-labelledby") ?? "") !== "") {
            w.__a13ProgressSeen = true;
          }
        };
        new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true });
      });
      await page.goto(exploreUrl(EXPLORE, { mode: "sql" }));
      // 2. Navigation start → engine ready (the SQL editor is editable and no progress bar remains).
      await expect(page.getByRole("textbox", { name: "SQL" })).toBeEditable({ timeout: 60_000 });
      await expect(page.locator(SEL.progress)).toHaveCount(0, { timeout: 60_000 });
      const ms = await page.evaluate(() => performance.now());
      timings.push(Math.round(ms));
      expect(
        await page.evaluate(() => (window as unknown as { __a13ProgressSeen?: boolean }).__a13ProgressSeen === true),
        `load ${i}: a named progress bar was visible`,
      ).toBe(true);
      if (i === 1) await checkpoint(page, "040", "ready");
      await context.close();
    }
    await evidenceJson("A-13-TC-040-timings.json", {
      case: "A-13-TC-040",
      provisional: oracle.branch === "today",
      runId: oracle.M.runId,
      limitMs: LIMITS.firstLoadMs,
      timingsMs: timings,
    });
    for (const [i, ms] of timings.entries()) {
      expect(ms, `cold load ${i + 1}`).toBeLessThanOrEqual(LIMITS.firstLoadMs);
    }
  });

  /** One timed search: input change → header names the new radius; returns ms and queryDurationMs. */
  async function timedRadius(page: Page, r: number): Promise<{ ms: number; queryDurationMs: number | null }> {
    const radius = page.getByLabel("Radius", { exact: true });
    const header = page.locator(SEL.header);
    const t0 = Date.now();
    const [response] = await Promise.all([
      page.waitForResponse((res) => EXPLORE_SEARCH.test(res.url()) && res.request().method() !== "OPTIONS"),
      setControl(radius, String(r)),
    ]);
    await expect(header).toContainText(new RegExp(`^\\d[\\d,]* within ${r} mi of `), { timeout: 15_000 });
    const ms = Date.now() - t0;
    const data = trpcData(await response.json()) as { queryDurationMs?: number };
    return { ms, queryDurationMs: data.queryDurationMs ?? null };
  }

  async function series(page: Page, url: string): Promise<{ ms: number[]; query: (number | null)[] }> {
    // 1. Open; wait for the first header.
    await nextSearch(page, () => page.goto(url));
    await ready(page, "explore");
    await expect(page.locator(SEL.header)).toBeVisible();
    // 2. One untimed warm-up, then 20 timed runs toggling 5 → 3 → 5.
    await timedRadius(page, 3);
    const ms: number[] = [];
    const query: (number | null)[] = [];
    for (let i = 0; i < TIMED_RUNS; i += 1) {
      const run = await timedRadius(page, i % 2 === 0 ? 5 : 3);
      ms.push(run.ms);
      query.push(run.queryDurationMs);
    }
    return { ms, query };
  }

  test(scenario("041"), async ({ page, oracle }) => {
    test.setTimeout(300_000);
    noteBranch(oracle, "provisional until A-11");
    const radiusRoof = await series(page, exploreUrl(EXPLORE, { place: "pflugerville", r: 5, roof: 15 }));
    await checkpoint(page, "041", "radius-roof");
    // 3. The open-permit search.
    const openPermit = await series(
      page,
      exploreUrl(EXPLORE, { place: "pflugerville", r: 5, permit: "open_stalled", openYrs: 5, sort: "open_desc" }),
    );
    await checkpoint(page, "041", "open-permit");
    // 4. p50 and p95 per search.
    const a = summarize(radiusRoof.ms);
    const b = summarize(openPermit.ms);
    await evidenceJson("A-13-TC-041-timings.json", {
      case: "A-13-TC-041",
      provisional: oracle.branch === "today",
      runId: oracle.M.runId,
      limitP95Ms: LIMITS.queryP95Ms,
      radiusRoof: { ...a, queryDurationMs: radiusRoof.query },
      openPermit: { ...b, queryDurationMs: openPermit.query },
    });
    expect(a.p95Ms, "radius + roof p95").toBeLessThan(LIMITS.queryP95Ms);
    expect(b.p95Ms, "open-permit p95").toBeLessThan(LIMITS.queryP95Ms);
  });

  test(scenario("082"), async ({ browser }) => {
    const totals: Record<string, number> = {};
    for (const path of [ROUTES.hub, EXPLORE]) {
      // 1. A private window; record scripts until load.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(path, { waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      // 2. Sum transferred JS bytes, excluding DuckDB-WASM files and workers.
      const entries = await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map((e) => e as PerformanceResourceTiming)
          .map((e) => ({ name: e.name, type: e.initiatorType, bytes: e.encodedBodySize })),
      );
      const js = entries.filter(
        (e) => (/\.m?js(\?|$)/.test(new URL(e.name).pathname) || e.type === "script") && !isDuckdbWasm(new URL(e.name)),
      );
      totals[path] = js.reduce((t, e) => t + e.bytes, 0);
      await checkpoint(page, "082", path === ROUTES.hub ? "hub" : "explore");
      await context.close();
    }
    test.info().annotations.push({ type: "js-bytes", description: JSON.stringify(totals) });
    for (const [path, bytes] of Object.entries(totals)) {
      expect(bytes, `initial JS on ${path}`).toBeLessThanOrEqual(JS_BUDGET_BYTES);
    }
  });
});
