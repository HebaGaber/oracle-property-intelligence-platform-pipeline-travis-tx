// A-03 T006 (G-A2): the app shell of apps/web (plan § "Atlas element map" → Shell; FR-002).
// Written before src/App.tsx exists: the red run fails with "Cannot find module '../src/App'".
// Three fixed assertions from tasks.md: /runs and /permits are lazy routes, / redirects to /runs,
// and nothing in apps/web/src uses an inline style literal (Atlas tokens through CSS Modules only).
// The shell checks after them pin the A-03 bar (title only) and the two destinations.
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
