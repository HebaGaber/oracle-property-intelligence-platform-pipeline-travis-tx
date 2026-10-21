// A-13 scan cases (T043; testplans/A-13-test-cases.md § 8): TC-073 (no-sample-data scan over every route),
// TC-074 (no "not wired" toast and no ProtoBar on any control) and TC-083 (WCAG 2.2 AA on every route).
// The route set is read from apps/web/src/routes/route-list.ts at run time (lib/a13-routes.ts), so a route
// added to the app is scanned without editing this file. The allowed CID set is every CID of every manifest
// reachable from runs/index.json (lib/a13.ts buildCidAllowlist); the denylist is
// fixtures/prototype-placeholders.json plus every CID-shaped token in design/prototype/**.
import type { Page } from "@playwright/test";
import { ROUTES } from "@countylens/shared";
import {
  buildCidAllowlist,
  cidTokens,
  denylistHits,
  disallowedCidTokens,
  fetchAllManifests,
  loadPlaceholderDenylist,
  prototypeCidTokens,
} from "./lib/a13.js";
import { checkpoint, ensureFiltersOpen, expect, test } from "./lib/a13-fixtures.js";
import { writeEvidenceSection } from "./lib/a13-evidence.js";
import { AXE_VERSION, openMore, openSettled, runAxe, tabThrough } from "./lib/a13-pages.js";
import { routeTargets, type RouteTarget } from "./lib/a13-routes.js";
import { SEL, exploreUrl, scenario } from "./lib/a13-ui.js";

const EXPLORE = ROUTES.explore;
const WIDE = { at: "30.2672,-97.7431", r: 25, roof: 0, view: "list" } as const;

/** The routes of TC-086 plus the pages the scan must also open drawers and another county on. */
function scanTargets(manifestCid: string): RouteTarget[] {
  return [
    ...routeTargets(manifestCid),
    { key: "explore-wide", path: exploreUrl(EXPLORE, WIDE) },
    { key: "other-county", path: "/tx/harris/explore" },
  ];
}

/** Text, `data-cid`, `href`, `title`, `aria-label` and `data-value` of the whole page as one string. */
async function pageStrings(page: Page): Promise<string> {
  return page.evaluate(() => {
    const attrs = ["data-cid", "href", "title", "aria-label", "data-value"];
    const values = Array.from(document.querySelectorAll(attrs.map((a) => `[${a}]`).join(",")))
      .flatMap((el) => attrs.map((a) => el.getAttribute(a) ?? ""))
      .filter((v) => v !== "");
    return `${document.body.innerText}\n${values.join("\n")}`;
  });
}

/** Opens every tab, the More sheet, the filter sheet (390) and the first property drawer. */
async function openEverything(page: Page, width: number): Promise<string[]> {
  const seen: string[] = [await pageStrings(page)];
  for (const tab of await page.getByRole("tab").all()) {
    if (await tab.isEnabled()) {
      await tab.click();
      seen.push(await pageStrings(page));
    }
  }
  if (width < 840) {
    await ensureFiltersOpen(page);
    seen.push(await pageStrings(page));
  }
  const row = page.locator(SEL.resultRow).first();
  if ((await row.count()) > 0) {
    await row.click();
    if (await page.getByRole("dialog").first().isVisible()) seen.push(await pageStrings(page));
    await page.keyboard.press("Escape");
  }
  await openMore(page);
  seen.push(await pageStrings(page));
  return seen;
}

test.describe("A-13 scan", { tag: "@a13-scan" }, () => {
  test(scenario("073"), async ({ browser, oracle }) => {
    test.setTimeout(30 * 60_000);
    // 1. The allowed CID set: every CID of every manifest of runs/index.json.
    const allow = buildCidAllowlist(await fetchAllManifests(oracle.index));
    const denylist = loadPlaceholderDenylist();
    const prototypeCids = prototypeCidTokens();
    const rows: string[] = [];
    const failures: string[] = [];
    // 2. Open each route at 1440 and 390; open every drawer, sheet and tab.
    for (const target of scanTargets(oracle.manifestCid)) {
      for (const width of [1440, 390] as const) {
        const context = await browser.newContext({
          viewport: { width, height: width === 1440 ? 900 : 844 },
          colorScheme: "light",
        });
        try {
          const page = await context.newPage();
          await openSettled(page, target.path);
          const texts = await openEverything(page, width);
          // 3. Scan text and attributes.
          const all = texts.join("\n");
          const phrases = denylistHits(all, denylist, { runCount: oracle.runs.length });
          const protoCids = cidTokens(all).filter((t) => prototypeCids.includes(t));
          const foreign = disallowedCidTokens(all, allow);
          let selectors = 0;
          for (const selector of denylist.selectors)
            selectors += await page.locator(selector).count();
          const label = `${target.key} @ ${width}`;
          rows.push(
            `| ${label} | ${phrases.length} | ${protoCids.length} | ${foreign.length} | ${selectors} |`,
          );
          if (phrases.length + protoCids.length + foreign.length + selectors > 0) {
            failures.push(
              `${label}: phrases=${JSON.stringify(phrases)} prototype CIDs=${JSON.stringify(protoCids)} CIDs not in any manifest=${JSON.stringify(foreign)} selectors=${selectors}`,
            );
          }
          if (width === 1440) await checkpoint(page, "073", target.key);
        } finally {
          await context.close();
        }
      }
    }
    const saved = writeEvidenceSection(
      "A-13-TC-073",
      [
        `## TC-073 no-sample-data scan (${oracle.runs.length} run(s), ${allow.size} allowed CIDs, ${prototypeCids.length} prototype CIDs denied)`,
        "",
        "| route @ width | denylist phrases | prototype CIDs | CIDs not in a manifest | ProtoBar selectors |",
        "| --- | --- | --- | --- | --- |",
        ...rows,
        "",
        failures.length === 0
          ? "Result: 0 hits."
          : `Result: FAIL\n\n${failures.map((f) => `- ${f}`).join("\n")}`,
      ].join("\n"),
    );
    test.info().annotations.push({ type: "evidence", description: saved });
    expect(failures, "no sample data on any route").toEqual([]);
  });

  test(scenario("074"), async ({ page, oracle }) => {
    test.setTimeout(45 * 60_000);
    const MAX_CLICKS = 40;
    const ENABLED = [
      'main button:not([disabled]):not([aria-disabled="true"])',
      'main a[href^="/"]:not([aria-disabled="true"])',
      'nav button:not([disabled]):not([aria-disabled="true"])',
      'nav a[href^="/"]',
    ].join(", ");
    const SKIP = /delete|remove|clear all|sign out|log out/i;
    const bad: string[] = [];
    page.on("dialog", (d) => void d.dismiss());
    // 1. Open each route.
    for (const target of routeTargets(oracle.manifestCid)) {
      await openSettled(page, target.path);
      const count = Math.min(await page.locator(ENABLED).count(), MAX_CLICKS);
      // 2. Click every enabled in-site button and link; 3. watch for toasts.
      for (let i = 0; i < count; i += 1) {
        const control = page.locator(ENABLED).nth(i);
        if (!(await control.isVisible())) continue;
        const name = (
          (await control.getAttribute("aria-label")) ??
          (await control.innerText()) ??
          ""
        ).trim();
        if (SKIP.test(name) || (await control.getAttribute("target")) === "_blank") continue;
        await control.click({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(250);
        const live = (
          await page
            .locator('[role="status"], [role="alert"], [aria-live], [data-toast]')
            .allInnerTexts()
        ).join("\n");
        const body = await page.locator("body").innerText();
        if (/not wired|prototype/i.test(`${live}\n${body}`))
          bad.push(`${target.path}: "${name}" → not wired / prototype text`);
        if ((await page.locator("[data-protobar]").count()) > 0 || /ProtoBar/i.test(body)) {
          bad.push(`${target.path}: "${name}" → ProtoBar`);
        }
        await page.keyboard.press("Escape");
        const here = `${new URL(page.url()).pathname}${new URL(page.url()).search}`;
        if (here !== target.path) await openSettled(page, target.path);
      }
      await checkpoint(page, "074", target.key);
    }
    expect(bad, "no toast, ProtoBar or prototype text after any click").toEqual([]);
  });

  test(scenario("083"), async ({ browser, oracle }) => {
    test.setTimeout(30 * 60_000);
    const lines: string[] = [];
    const problems: string[] = [];
    for (const target of routeTargets(oracle.manifestCid)) {
      // 1. Open the route in a private window; run axe-core (wcag2a, wcag2aa, wcag21aa, wcag22aa).
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: "light",
      });
      try {
        const page = await context.newPage();
        await openSettled(page, target.path);
        const violations = await runAxe(page);
        const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        // 2. Tab through the page: a visible focus indicator, in document order.
        const stops = await tabThrough(page);
        const hidden = stops.filter((s) => !s.visible).map((s) => s.label);
        const outOfOrder = stops.some((s, i) => i > 0 && s.index < (stops[i - 1]?.index ?? 0));
        const positive = stops.some((s) => s.positiveTabindex);
        lines.push(
          `| ${target.key} | ${violations.length} | ${serious.length} | ${stops.length} | ${hidden.length} | ${outOfOrder || positive ? "no" : "yes"} |`,
        );
        if (serious.length > 0) {
          problems.push(
            `${target.path}: ${serious.map((v) => `${v.id} (${v.impact}, ${v.nodes}) ${v.targets.join(" | ")}`).join("; ")}`,
          );
        }
        if (stops.length === 0) problems.push(`${target.path}: nothing focusable`);
        if (hidden.length > 0)
          problems.push(`${target.path}: no visible focus on ${hidden.join(", ")}`);
        if (outOfOrder || positive)
          problems.push(`${target.path}: focus order is not document order`);
        await checkpoint(page, "083", target.key);
      } finally {
        await context.close();
      }
    }
    writeEvidenceSection(
      "A-13-TC-083",
      [
        `## TC-083 WCAG 2.2 AA (axe-core ${AXE_VERSION}, tags wcag2a wcag2aa wcag21aa wcag22aa)`,
        "",
        "| route | violations | serious or critical | tab stops | stops without focus ring | document order |",
        "| --- | --- | --- | --- | --- | --- |",
        ...lines,
      ].join("\n"),
    );
    expect(problems, "0 serious or critical violations; focus visible on every control").toEqual(
      [],
    );
  });
});
