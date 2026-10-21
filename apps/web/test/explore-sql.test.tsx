// A-13 T028 (AC-6, FR-006, FR-006a, FR-017; TC-004, TC-038, TC-039, TC-040, TC-043): the SQL
// panel (`?mode=sql`). Only this mode opens the in-browser engine (ExploreSql.engine.ts, the one
// route-side importer of engine/duckdb-wasm besides the A-03 Permits loader); the first load shows
// a progress bar; the engine line reads "DuckDB-WASM in your browser · read-only"; a write is
// refused with "Read-only: only SELECT, WITH, DESCRIBE and SHOW run here" without reaching the
// engine; an engine error shows "{first line} · Try: {fix}" and no stack trace. The session is
// mocked here; the source scan checks that nothing else imports the engine.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { QueryClient, QueryClientProvider, skipToken } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOnlyRefusal, sqlErrorLine } from "../src/routes/ExploreSql.engine";

const session = vi.hoisted(() => ({
  open: vi.fn(),
  query: vi.fn<(sql: string) => Promise<Record<string, unknown>[]>>(),
}));

vi.mock("../src/routes/ExploreSql.engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/routes/ExploreSql.engine")>();
  return { ...real, openSqlSession: session.open };
});

vi.mock("@countylens/api-client/react", () => ({
  useTRPC: () => ({
    explore: {
      search: {
        queryOptions: (input: unknown) => ({
          queryKey: ["explore", "search", input],
          queryFn: input === skipToken ? skipToken : async () => new Promise(() => undefined),
        }),
      },
    },
  }),
}));

function Providers({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function renderExplore(search: string): Promise<void> {
  const { Component } = await import("../src/routes/Explore");
  render(
    <Providers>
      <MemoryRouter initialEntries={[`/tx/travis/explore${search}`]}>
        <Routes>
          <Route path="/tx/travis/explore" element={<Component />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  );
}

let release: () => void = () => undefined;

/** Resolves the session once the panel has asked for it (the panel chunk loads lazily). */
async function openNow(): Promise<void> {
  await waitFor(() => expect(session.open).toHaveBeenCalled());
  release();
}

beforeEach(() => {
  session.open.mockReset();
  session.query.mockReset();
  session.open.mockImplementation(
    (report: (stage: string) => void) =>
      new Promise((resolve) => {
        report("Starting the query engine");
        release = () =>
          resolve({
            runId: "travis-test-sql",
            manifestCid: "bafkreitest",
            fallbackLabel: null,
            query: session.query,
            close: async () => undefined,
          });
      }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response("{}")),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SQL panel loading (FR-006, TC-040, TC-043)", () => {
  it("opens the browser engine only in ?mode=sql", async () => {
    await renderExplore("?place=pflugerville&r=5");
    await screen.findByRole("tab", { name: "SQL" });
    expect(session.open).not.toHaveBeenCalled();
    cleanup();
    await renderExplore("?mode=sql");
    await waitFor(() => expect(session.open).toHaveBeenCalledTimes(1));
  });

  it("shows a progress bar on first load, then the editor and the browser engine line", async () => {
    await renderExplore("?mode=sql");
    expect(await screen.findByRole("progressbar")).toBeDefined();
    await openNow();
    const editor = await screen.findByRole("textbox", { name: "SQL" });
    expect(editor).toBeDefined();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.querySelector("[data-engine-line]")?.textContent).toContain(
      EXPLORE_TEXTS.engineBrowser,
    );
    await waitFor(() =>
      expect(
        document.querySelector('section[data-route="explore"]')?.getAttribute("data-state"),
      ).toBe("ready"),
    );
  });

  it("runs a SELECT and shows the result grid", async () => {
    session.query.mockResolvedValue([{ count_star: 14 }]);
    await renderExplore("?mode=sql");
    await openNow();
    const editor = await screen.findByRole("textbox", { name: "SQL" });
    fireEvent.change(editor, { target: { value: "SELECT count(*) FROM v_property" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const grid = await screen.findByRole("table", { name: "Query result" });
    expect(grid.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(grid.querySelector("tbody td")?.textContent).toBe("14");
    expect(session.query).toHaveBeenCalledWith("SELECT count(*) FROM v_property");
  });
});

describe("SQL panel bounds the result (A-13 review finding 4)", () => {
  it("shows the first 500 rows and says so when the engine returned more", async () => {
    session.query.mockResolvedValue(Array.from({ length: 501 }, (_, i) => ({ n: i })));
    await renderExplore("?mode=sql");
    await openNow();
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    const grid = await screen.findByRole("table", { name: "Query result" });
    expect(grid.querySelectorAll("tbody tr")).toHaveLength(500);
    expect(document.body.textContent).toContain("showing the first 500 rows");
    expect(document.body.textContent).not.toMatch(/501 rows/);
  });

  it("states the true count when the result was not cut", async () => {
    session.query.mockResolvedValue([{ n: 1 }, { n: 2 }]);
    await renderExplore("?mode=sql");
    await openNow();
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await screen.findByRole("table", { name: "Query result" });
    expect(document.body.textContent).toMatch(/2 rows · \d+ ms in this browser/);
    expect(document.body.textContent).not.toContain("showing the first");
  });
});

describe("SQL panel read-only and errors (FR-006, FR-017, TC-038, TC-039)", () => {
  it.each([
    "DELETE FROM v_property",
    "INSERT INTO t VALUES (1)",
    "CREATE TABLE t AS SELECT 1",
    "SELECT 1; DROP TABLE v_property",
    "WITH x AS (SELECT 1) DELETE FROM v_property",
    "COPY v_property TO 'x.csv'",
  ])("refuses %s without running it", async (sql) => {
    await renderExplore("?mode=sql");
    await openNow();
    const editor = await screen.findByRole("textbox", { name: "SQL" });
    fireEvent.change(editor, { target: { value: sql } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(
      (await screen.findByText(EXPLORE_TEXTS.sqlReadOnly)).closest("[data-sql-error]"),
    ).not.toBeNull();
    expect(session.query).not.toHaveBeenCalled();
    expect((editor as HTMLTextAreaElement).value).toBe(sql);
  });

  it("shows one error line with a fix and no stack trace", async () => {
    session.query.mockRejectedValue(
      new Error(
        'Catalog Error: Table with name v_propety does not exist!\nDid you mean "v_property"?\n    at Object.query (duckdb.js:1:1)',
      ),
    );
    await renderExplore("?mode=sql");
    await openNow();
    const editor = await screen.findByRole("textbox", { name: "SQL" });
    fireEvent.change(editor, { target: { value: "SELECT count(*) FROM v_propety" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(document.querySelector("[data-sql-error]")).not.toBeNull());
    const text = document.querySelector("[data-sql-error]")?.textContent ?? "";
    expect(text).not.toContain("\n");
    expect(text).toMatch(
      /^Catalog Error: Table with name v_propety does not exist! · Try: .*v_property/,
    );
    expect(document.body.textContent).not.toContain("duckdb.js:1:1");
  });

  it("maps the read-only check and error lines without the engine", () => {
    expect(readOnlyRefusal("  -- a comment\n select 1")).toBeNull();
    expect(readOnlyRefusal("WITH a AS (SELECT 1) SELECT * FROM a")).toBeNull();
    expect(readOnlyRefusal("DESCRIBE v_property")).toBeNull();
    expect(readOnlyRefusal("SHOW TABLES")).toBeNull();
    expect(readOnlyRefusal("SELECT 'delete me' AS x")).toBeNull();
    expect(readOnlyRefusal("UPDATE v_property SET x = 1")).toBe(EXPLORE_TEXTS.sqlReadOnly);
    expect(sqlErrorLine(new Error('Parser Error: syntax error at or near "SELEC"'))).toMatch(
      /^Parser Error: syntax error at or near "SELEC" · Try: .*SELECT/,
    );
  });
});

describe("Only the SQL panel and the A-03 Permits loader import the engine (R2)", () => {
  it("finds engine/duckdb-wasm imported only by ExploreSql.engine.ts and engine/load-permits.ts", () => {
    const root = join(__dirname, "..", "src");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(root);
    const importers = files
      .filter((f) => !f.endsWith(join("engine", "duckdb-wasm.ts")))
      .filter((f) =>
        /import\(\s*["'][./]*(engine\/)?duckdb-wasm["']\s*\)|from\s+["'][./]*(engine\/)?duckdb-wasm["']/.test(
          readFileSync(f, "utf8"),
        ),
      )
      .map((f) => f.slice(root.length + 1).replaceAll("\\", "/"))
      .sort();
    expect(importers).toEqual(["engine/load-permits.ts", "routes/ExploreSql.engine.ts"]);
    const explore = readFileSync(join(root, "routes", "Explore.tsx"), "utf8");
    expect(explore).not.toMatch(/from\s+["']\.\/ExploreSql["']/);
  });
});
