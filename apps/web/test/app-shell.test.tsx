// A-03 T006 (G-A2): the app shell of apps/web (plan § "Atlas element map" → Shell; FR-002).
// Written before src/App.tsx exists: the red run fails with "Cannot find module '../src/App'".
// A-13 T008 updates it: every route of route-list.ts is a lazy child that renders a heading,
// `/` renders the Hub (no redirect), the bar title links to `/`, the destinations are Explore,
// Runs, Coverage, Data and More (a sheet with the Coming soon items); `/permits` stays.
// Three fixed assertions from tasks.md: /runs and /permits are lazy routes, / redirects to /runs,
// and nothing in apps/web/src uses an inline style literal (Atlas tokens through CSS Modules only).
// The shell checks after them pin the A-03 bar (title only) and the two destinations.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PAGE_TEXTS, ROUTES } from "@countylens/shared";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../src/App";
import { DESTINATIONS } from "../src/components/AppShell";
import { COMING_SOON_ITEMS } from "../src/content/coming-soon";
import { ROUTE_LIST } from "../src/routes/route-list";

/** Every TSX source of the app, read as text (Vite raw import; no node: API in a jsdom test). */
const SOURCES = import.meta.glob<string>("../src/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const INLINE_STYLE_LITERAL = /style=\{\{/;

function shellChildren(): RouteObject[] {
  const shell = routes[0];
  expect(shell, "the shell route").toBeDefined();
  expect(shell?.path).toBe("/");
  return shell?.children ?? [];
}

function childRoute(path: string): RouteObject {
  const route = shellChildren().find((r) => r.path === path);
  expect(route, `route ${path}`).toBeDefined();
  return route as RouteObject;
}

async function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.initialized).toBe(true));
  await waitFor(() => expect(router.state.navigation.state).toBe("idle"));
  // React Router 7 applies router state inside a React transition: an idle router does not mean
  // React has committed the shell yet. On a slow runner the waitFor interval fired before the
  // commit and the queries below saw an empty container (CI 2026-10-21, ubuntu: `<body><div />`).
  // Wait for the committed shell itself.
  await screen.findByRole("navigation", { name: "Primary" }, { timeout: 5_000 });
  return { router, ...view };
}

afterEach(() => {
  document.body.innerHTML = "";
});

/** A concrete URL for a route pattern (`:cid`, `:item`, `:county` filled with plain values). */
function concrete(path: string): string {
  return path
    .replace(":cid", "bafkreiroutecheck")
    .replace(":item", COMING_SOON_ITEMS[0]?.id ?? "")
    .replace(":county", "williamson")
    .replace("/*", "/explore");
}

/** The kept A-03 page files (G2 extends Runs later). */
const A03_PAGES: readonly string[] = ["/runs", "/permits"];

describe("app shell routes (A-13 T015: every route of contracts/ui-routes.md, lazy)", () => {
  it("every route-list entry is a lazy child of the shell: a lazy loader, no eager element or Component", () => {
    const children = shellChildren();
    for (const entry of ROUTE_LIST) {
      const route =
        entry.path === "/"
          ? children.find((r) => r.index === true)
          : children.find((r) => `/${r.path ?? ""}` === entry.path);
      expect(route, `route ${entry.path}`).toBeDefined();
      expect(typeof route?.lazy, `${entry.path}.lazy`).toBe("function");
      expect(route?.element, `${entry.path}.element`).toBeUndefined();
      expect(route?.Component, `${entry.path}.Component`).toBeUndefined();
    }
    expect(children).toHaveLength(ROUTE_LIST.length);
  });

  it("covers every route of the contract (ROUTES in packages/shared), /permits kept", () => {
    const paths = ROUTE_LIST.map((r) => r.path);
    for (const path of Object.values(ROUTES)) expect(paths, path).toContain(path);
    expect(paths).toContain("/permits");
    expect(childRoute("permits")).toBeDefined();
  });

  it("/ renders the Hub (no redirect to /runs)", async () => {
    const { router } = await renderAt("/");
    expect(router.state.location.pathname).toBe("/");
    const main = await screen.findByRole("main");
    expect(await within(main).findByRole("heading", { level: 2 })).toBeTruthy();
  });

  it("every route in route-list.ts renders a heading inside main", async () => {
    for (const entry of ROUTE_LIST) {
      const { unmount } = await renderAt(concrete(entry.path));
      const main = screen.getByRole("main");
      if (A03_PAGES.includes(entry.path)) {
        // The kept A-03 pages (Runs, Permits; not A-13 files) render their h2 only once their
        // data has loaded; without the VITE_* hosts they show the error banner inside their
        // labelled section, so the check is that labelled region.
        expect(
          await within(main).findByRole("region", { name: entry.title }, { timeout: 5_000 }),
        ).toBeTruthy();
      } else {
        const heading = await within(main).findByRole("heading", { level: 2 }, { timeout: 5_000 });
        expect(heading.textContent?.trim().length, entry.path).toBeGreaterThan(0);
      }
      unmount();
      document.body.innerHTML = "";
    }
  }, 60_000);
});

describe("no inline style literal (Atlas § 13 rule 4; ESLint no-restricted-syntax)", () => {
  it("has no `style={{…}}` in any apps/web/src TSX file", () => {
    const files = Object.keys(SOURCES);
    expect(files.length, "TSX sources under apps/web/src").toBeGreaterThan(0);
    for (const [file, text] of Object.entries(SOURCES)) {
      expect(text, file).not.toMatch(INLINE_STYLE_LITERAL);
    }
  });

  it("renders /runs and /permits without a style attribute on any element", async () => {
    for (const path of ["/runs", "/permits"]) {
      const { container, unmount } = await renderAt(path);
      expect(container.querySelectorAll("[style]"), path).toHaveLength(0);
      unmount();
    }
  });
});

describe("shell chrome (plan § Atlas element map → Shell; A-13 T015)", () => {
  it("shows a top app bar whose only control is the title CountyLens, linking to /", async () => {
    await renderAt("/runs");
    const bar = screen.getByRole("banner");
    expect(bar.textContent?.trim()).toBe("CountyLens");
    expect(within(bar).getByRole("heading", { level: 1, name: "CountyLens" })).toBeTruthy();
    expect(within(bar).queryAllByRole("button")).toHaveLength(0);
    const links = within(bar).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/"]);
    expect(links[0]?.textContent?.trim()).toBe("CountyLens");
  });

  it("offers the destinations Explore, Runs, Coverage, Data and More, and marks the current one", async () => {
    await renderAt("/runs");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      expect.stringContaining("Explore"),
      expect.stringContaining("Runs"),
      expect.stringContaining("Coverage"),
      expect.stringContaining("Data"),
    ]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/tx/travis/explore",
      "/runs",
      "/tx/travis/coverage",
      "/data/manifest",
    ]);
    expect(links[1]?.getAttribute("aria-current")).toBe("page");
    expect(links[0]?.getAttribute("aria-current")).toBeNull();
    const more = within(nav).getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(within(nav).queryByRole("link", { name: "Permits" })).toBeNull();
    expect(DESTINATIONS.map((d) => d.label)).toEqual(["Explore", "Runs", "Coverage", "Data"]);
  });

  it("More opens a sheet listing every Coming soon item and the other pages; Escape closes it", async () => {
    await renderAt("/runs");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    fireEvent.click(within(nav).getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(within(nav).getByRole("button", { name: "More" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    const hrefs = within(sheet)
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    for (const item of COMING_SOON_ITEMS) {
      if (item.linked) expect(hrefs).toContain(`/soon/${item.id}`);
      else expect(hrefs).not.toContain(`/soon/${item.id}`); // AI-user sign-in: listed, not linked
    }
    expect(within(sheet).getByText("AI-user sign-in")).toBeTruthy();
    for (const path of ["/data/catalog", "/runs/log", "/help/mcp", "/legal/data"])
      expect(hrefs).toContain(path);
    expect(within(sheet).getAllByText(PAGE_TEXTS.comingSoon).length).toBe(COMING_SOON_ITEMS.length);
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
  });

  it("the Coming soon list is the D-7 list: id, title and one sentence, no numbers or CIDs", () => {
    expect(COMING_SOON_ITEMS.map((i) => i.title)).toEqual([
      "Builder mode",
      "Other counties and states",
      "Street View",
      "AI-user sign-in",
      "Saved searches",
      "Similar properties",
      "SQL checks",
      "Pipeline diagram and Gantt",
      "Area matrix",
      "Timeline scrubber",
      "Gateway race",
    ]);
    for (const item of COMING_SOON_ITEMS) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.sentence).toMatch(/^[^.]+\.$/); // one sentence
      expect(`${item.title} ${item.sentence}`).not.toMatch(/\d|baf[a-z2-7]{6,}/);
    }
  });
});

/** A CSS Module of the app, read as text by its glob-style path (`../src/…`); Vitest stubs CSS imports. */
function cssModule(path: string): string | undefined {
  const file = fileURLToPath(new URL(path, import.meta.url));
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/** The declarations of the first `.{name} {…}` rule of a CSS Module (a plain class selector). */
function ruleBody(css: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\n)\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
}

describe("ERR-12: every <button> sets its font from the tokens (a UA button font is Arial 13.33px)", () => {
  // `button` does not inherit the page font: without a font declaration it computes the user
  // agent's (smeargle 2026-10-21: Copy CID = Arial / 13.33px). stylelint cannot see a missing
  // declaration, so each button's CSS Module class must declare `font: inherit` or a token
  // font-family plus font-size.
  const buttons = Object.entries(SOURCES).flatMap(([file, source]) => {
    const module = /import styles from "\.\/([\w.]+\.module\.css)"/.exec(source)?.[1];
    return [...source.matchAll(/<button\b[^>]*className=\{styles\.(\w+)\}/g)].map((m) => ({
      file,
      cls: m[1] ?? "",
      css: module === undefined ? undefined : cssModule(file.replace(/[^/]+$/, module)),
    }));
  });

  it("finds the app's buttons (Copy CID, Retry, the shell's More)", () => {
    expect(buttons.map((b) => b.cls)).toEqual(expect.arrayContaining(["copy", "retry", "more"]));
  });

  for (const name of [...new Set(buttons.map((b) => b.cls))]) {
    it(`.${name}: declares font: inherit, or a token font-family and font-size`, () => {
      const button = buttons.find((b) => b.cls === name);
      expect(button?.css, `${name}: CSS Module found`).toBeDefined();
      const body = ruleBody(button?.css ?? "", name) ?? "";
      const inherits = /(^|;|\s)font:\s*inherit\s*;/.test(body);
      const tokens = /font-family:\s*var\(--md-/.test(body) && /font-size:\s*var\(--md-/.test(body);
      expect(inherits || tokens, `.${name} {${body}}`).toBe(true);
    });
  }
});

describe("ERR-13: landmark order: banner, navigation, then main (keyboard reaches the rail first)", () => {
  it("renders the navigation before main in DOM order; the grid areas place them visually", async () => {
    await renderAt("/runs");
    const bar = screen.getByRole("banner");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const main = screen.getByRole("main");
    const precedes = (a: Element, b: Element): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(precedes(bar, nav), "banner before navigation").toBe(true);
    expect(precedes(nav, main), "navigation before main").toBe(true);
  });

  it("keeps the layout in grid-template-areas (DOM order does not move anything visually)", () => {
    const css = cssModule("../src/components/AppShell.module.css") ?? "";
    expect(ruleBody(css, "nav")).toMatch(/grid-area:\s*nav/);
    expect(ruleBody(css, "main")).toMatch(/grid-area:\s*main/);
    expect(css).toMatch(/"nav main"/);
    expect(css).toMatch(/"bar"\s*"main"\s*"nav"/);
  });
});
