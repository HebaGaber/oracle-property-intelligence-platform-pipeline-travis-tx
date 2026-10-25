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
  PARKED_GAPS,
  parkGap,
} from "./lib/a13-fixtures.js";
import { SEL, exploreUrl, scenario, trpcData } from "./lib/a13-ui.js";
import {
  PER_RUN_TIMEOUT_MS,
  radiusHeaderPattern,
  runFailureMessage,
  searchRadii,
  seriesBudgetMs,
} from "./lib/a13-perf-runs.js";
import { LIMITS, QUERY_SAMPLE_RUNS, summarize } from "./lib/perf.js";

const EXPLORE = ROUTES.explore;
const COLD_LOADS = 5;
/** The radius in the URL the TC-041 series open at (that search is cached by the page). */
const URL_RADIUS = 5;
/** The untimed warm-up radius: outside the timed list (3..8 mi except 5), so no run repeats it. */
const WARM_UP_RADIUS = 2.75;
/** NFR-002: initial JS ≤ 300 KB gzipped (transferred). */
const JS_BUDGET_BYTES = 307_200;

test.describe("A-13 perf", { tag: "@a13-perf" }, () => {
  test.describe.configure({ mode: "serial" });

  test(scenario("040"), async ({ browser, oracle }) => {
    parkGap(PARKED_GAPS.sqlFirstQuery);
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
          if (
            bar !== null &&
            (bar.getAttribute("aria-label") ?? bar.getAttribute("aria-labelledby") ?? "") !== ""
          ) {
            w.__a13ProgressSeen = true;
          }
        };
        new MutationObserver(look).observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      });
      await page.goto(exploreUrl(EXPLORE, { mode: "sql" }));
      // 2. Navigation start → engine ready (the SQL editor is editable and no progress bar remains).
      await expect(page.getByRole("textbox", { name: "SQL" })).toBeEditable({ timeout: 60_000 });
      await expect(page.locator(SEL.progress)).toHaveCount(0, { timeout: 60_000 });
      const ms = await page.evaluate(() => performance.now());
      timings.push(Math.round(ms));
      expect(
        await page.evaluate(
          () => (window as unknown as { __a13ProgressSeen?: boolean }).__a13ProgressSeen === true,
        ),
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

  /**
   * One timed search: input change -> header names the new radius, bounded by PER_RUN_TIMEOUT_MS. The
   * radius is one the page has not searched yet (see a13-perf-runs.ts), so each run is a real
   * explore.search; the header text of the new radius is the "updated header".
   */
  async function timedRadius(
    page: Page,
    r: number,
    label: string,
    run: number,
  ): Promise<{ ms: number; queryDurationMs: number | null }> {
    const radius = page.getByLabel("Radius", { exact: true });
    const header = page.locator(SEL.header);
    const response = page
      .waitForResponse(
        (res) => EXPLORE_SEARCH.test(res.url()) && res.request().method() !== "OPTIONS",
        { timeout: PER_RUN_TIMEOUT_MS },
      )
      .catch(() => null);
    const t0 = Date.now();
    try {
      await setControl(radius, String(r));
      await expect(header).toContainText(radiusHeaderPattern(r), { timeout: PER_RUN_TIMEOUT_MS });
    } catch (error) {
      const cause = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
      throw new Error(runFailureMessage(label, run, QUERY_SAMPLE_RUNS, r, cause), { cause: error });
    }
    const ms = Date.now() - t0;
    const answered = await response;
    let queryDurationMs: number | null = null;
    if (answered !== null) {
      const data = trpcData(await answered.json().catch(() => null)) as {
        queryDurationMs?: number;
      } | null;
      queryDurationMs = data?.queryDurationMs ?? null;
    }
    return { ms, queryDurationMs };
  }

  async function series(
    page: Page,
    url: string,
    label: string,
    timings: { ms: number[]; radii: number[]; query: (number | null)[] },
  ): Promise<void> {
    // 1. Open once; wait for the first header (the URL radius is already cached by the page).
    await nextSearch(page, () => page.goto(url));
    await ready(page, "explore");
    await expect(page.locator(SEL.header)).toBeVisible();
    // 2. One untimed warm-up at a radius outside the timed list, then 20 timed runs, each at a new radius.
    await timedRadius(page, WARM_UP_RADIUS, label, 0);
    for (const [i, r] of searchRadii(QUERY_SAMPLE_RUNS, URL_RADIUS).entries()) {
      const run = await timedRadius(page, r, label, i + 1);
      timings.ms.push(run.ms);
      timings.radii.push(r);
      timings.query.push(run.queryDurationMs);
    }
  }

  test(scenario("041"), async ({ page, oracle }) => {
    parkGap(PARKED_GAPS.exploreSearch);
    // Two series of 1 warm-up + 20 runs, each run capped at PER_RUN_TIMEOUT_MS: the budget is the cap
    // times the run count (the 300 s default is a few runs short of that worst case); typical use ~2 min.
    test.setTimeout(seriesBudgetMs(2, QUERY_SAMPLE_RUNS));
    noteBranch(oracle, "provisional until A-11");
    const radiusRoof = {
      ms: [] as number[],
      radii: [] as number[],
      query: [] as (number | null)[],
    };
    const openPermit = {
      ms: [] as number[],
      radii: [] as number[],
      query: [] as (number | null)[],
    };
    let failure: string | null = null;
    try {
      await series(
        page,
        exploreUrl(EXPLORE, { place: "pflugerville", r: URL_RADIUS, roof: 15 }),
        "radius + roof",
        radiusRoof,
      );
      await checkpoint(page, "041", "radius-roof");
      // 3. The open-permit search.
      await series(
        page,
        exploreUrl(EXPLORE, {
          place: "pflugerville",
          r: URL_RADIUS,
          permit: "open_stalled",
          openYrs: 5,
          sort: "open_desc",
        }),
        "open-permit",
        openPermit,
      );
      await checkpoint(page, "041", "open-permit");
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      // 4. All timings, also of a failed run (the failure names the run and radius).
      const part = (t: typeof radiusRoof): object =>
        t.ms.length === 0
          ? { n: 0, timingsMs: [], radiiMi: [], queryDurationMs: [] }
          : { ...summarize(t.ms), radiiMi: t.radii, queryDurationMs: t.query };
      await evidenceJson("A-13-TC-041-timings.json", {
        case: "A-13-TC-041",
        provisional: oracle.branch === "today",
        runId: oracle.M.runId,
        limitP95Ms: LIMITS.queryP95Ms,
        perRunTimeoutMs: PER_RUN_TIMEOUT_MS,
        failure,
        radiusRoof: part(radiusRoof),
        openPermit: part(openPermit),
      });
    }
    // 5. p50 and p95 per search.
    expect(radiusRoof.ms, "radius + roof runs").toHaveLength(QUERY_SAMPLE_RUNS);
    expect(openPermit.ms, "open-permit runs").toHaveLength(QUERY_SAMPLE_RUNS);
    expect(summarize(radiusRoof.ms).p95Ms, "radius + roof p95").toBeLessThan(LIMITS.queryP95Ms);
    expect(summarize(openPermit.ms).p95Ms, "open-permit p95").toBeLessThan(LIMITS.queryP95Ms);
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
        (e) =>
          (/\.m?js(\?|$)/.test(new URL(e.name).pathname) || e.type === "script") &&
          !isDuckdbWasm(new URL(e.name)),
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
