// A-03 T006 (G-A2): the app shell of apps/web (plan § "Atlas element map" → Shell; FR-002).
// Written before src/App.tsx exists: the red run fails with "Cannot find module '../src/App'".
// Three fixed assertions from tasks.md: /runs and /permits are lazy routes, / redirects to /runs,
// and nothing in apps/web/src uses an inline style literal (Atlas tokens through CSS Modules only).
// The shell checks after them pin the A-03 bar (title only) and the two destinations.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../src/App";

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

describe("app shell routes (T007: lazy routes, / → /runs)", () => {
  it("loads /runs and /permits lazily: a lazy loader, no eager element or Component", () => {
    for (const path of ["runs", "permits"]) {
      const route = childRoute(path);
      expect(typeof route.lazy, `${path}.lazy`).toBe("function");
      expect(route.element, `${path}.element`).toBeUndefined();
      expect(route.Component, `${path}.Component`).toBeUndefined();
    }
  });

  it("declares only the two destinations plus the index redirect", () => {
    const paths = shellChildren()
      .map((r) => (r.index ? "(index)" : (r.path ?? "")))
      .sort();
    expect(paths).toEqual(["(index)", "permits", "runs"]);
  });

  it("redirects / to /runs", async () => {
    const { router } = await renderAt("/");
    expect(router.state.location.pathname).toBe("/runs");
    expect(await screen.findByRole("main")).toBeTruthy();
  });
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

describe("shell chrome (plan § Atlas element map → Shell)", () => {
  it("shows a top app bar with only the title CountyLens", async () => {
    await renderAt("/runs");
    const bar = screen.getByRole("banner");
    expect(bar.textContent?.trim()).toBe("CountyLens");
    expect(within(bar).queryAllByRole("button")).toHaveLength(0);
    expect(within(bar).queryAllByRole("link")).toHaveLength(0);
  });

  it("offers exactly two navigation destinations, Runs and Permits, and marks the current one", async () => {
    await renderAt("/permits");
    const nav = screen.getByRole("navigation");
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      expect.stringContaining("Runs"),
      expect.stringContaining("Permits"),
    ]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/runs", "/permits"]);
    expect(links[1]?.getAttribute("aria-current")).toBe("page");
    expect(links[0]?.getAttribute("aria-current")).toBeNull();
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

  it("finds the app's buttons (Copy CID, Retry, the two Permits pager buttons)", () => {
    expect(buttons.map((b) => b.cls).sort()).toEqual([
      "copy",
      "pagerButton",
      "pagerButton",
      "retry",
    ]);
  });

  for (const name of ["copy", "retry", "pagerButton"]) {
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
