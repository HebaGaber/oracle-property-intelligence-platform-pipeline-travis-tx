// A-13 T030 (FR-023; TC-042): Help · MCP (`/help/mcp`). It lists the six fixed tools of AD-21
// (no SQL tool) and "Try a tool" answers "Not available yet · the agent and MCP server arrive with
// story A-14", never a sample response.
import { EXPLORE_BOUNDS, PERMIT_FILTERS, EXPLORE_SORTS } from "@countylens/query-core";
import { PAGE_TEXTS } from "@countylens/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

async function renderHelp(): Promise<void> {
  const { Component } = await import("../src/routes/HelpMcp");
  render(
    <MemoryRouter initialEntries={["/help/mcp"]}>
      <Component />
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

const TOOLS = [
  "search_properties",
  "list_permits",
  "get_property",
  "get_coverage",
  "list_runs",
  "get_schema",
];

describe("Help · MCP (FR-023, TC-042)", () => {
  it("lists the six AD-21 tools and no SQL tool", async () => {
    await renderHelp();
    const list = screen.getByRole("list", { name: "MCP tools" });
    const names = [...list.querySelectorAll("[data-tool]")].map((el) =>
      el.getAttribute("data-tool"),
    );
    expect(names).toEqual(TOOLS);
    expect(list.textContent?.toLowerCase()).not.toMatch(/\bsql\b|query_sql|run_sql/);
    const section = document.querySelector('section[data-route="help-mcp"]');
    expect(section?.getAttribute("data-state")).toBe("ready");
  });

  it("shows search_properties' input from the query-core bounds, never hand-typed copies", async () => {
    await renderHelp();
    const tool = document.querySelector('[data-tool="search_properties"]') as HTMLElement;
    // TC-042: the real schema is marked [data-schema] inside its [data-tool].
    expect(tool.querySelector("[data-schema]"), "search_properties schema").not.toBeNull();
    expect(tool.querySelector("[data-schema-pending]")).toBeNull();
    const params = new Map(
      [...tool.querySelectorAll("[data-param]")].map((el) => [
        el.getAttribute("data-param"),
        el.textContent ?? "",
      ]),
    );
    expect(params.get("radius_mi")).toContain(`${EXPLORE_BOUNDS.radiusMi[0]}`);
    expect(params.get("radius_mi")).toContain(`${EXPLORE_BOUNDS.radiusMi[1]}`);
    expect(params.get("roof")).toContain(`${EXPLORE_BOUNDS.roof[1]}`);
    expect(params.get("openYrs")).toContain(`${EXPLORE_BOUNDS.openYrs[1]}`);
    expect(params.get("tenure")).toContain(`${EXPLORE_BOUNDS.tenure[1]}`);
    for (const value of [...PERMIT_FILTERS, ...EXPLORE_SORTS]) {
      expect(tool.textContent).toContain(value);
    }
    // The five tools whose Zod schemas are not in query-core say so instead of inventing one.
    for (const name of [
      "list_permits",
      "get_property",
      "get_coverage",
      "list_runs",
      "get_schema",
    ]) {
      const li = document.querySelector(`[data-tool="${name}"]`) as HTMLElement;
      expect(li.querySelector("[data-param]"), name).toBeNull();
      expect(li.querySelector("[data-schema-pending]"), name).not.toBeNull();
    }
  });

  it("gives Claude Desktop, Claude Code and MCP Inspector snippets with the bearer header", async () => {
    await renderHelp();
    for (const client of ["claude-desktop", "claude-code", "mcp-inspector"]) {
      const snippet = document.querySelector(`[data-snippet="${client}"]`);
      expect(snippet, client).not.toBeNull();
      expect(snippet?.textContent).toContain("Authorization: Bearer <token>");
    }
    expect(
      screen.getByText("Bearer token required, shared privately with reviewers"),
    ).toBeDefined();
    expect(document.body.textContent).not.toMatch(/Bearer (?!<token>)[A-Za-z0-9]{12,}/);
  });

  it("has one Try a tool control, no per-tool buttons, answering with the A-14 text", async () => {
    await renderHelp();
    expect(screen.queryByText(PAGE_TEXTS.mcpNotAvailable)).toBeNull();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("Try a tool");
    expect(screen.queryByRole("button", { name: /Try (search|list|get)_/ })).toBeNull();
    fireEvent.click(buttons[0] as HTMLElement);
    expect(screen.getByText(PAGE_TEXTS.mcpNotAvailable)).toBeDefined();
    expect(document.querySelector("[data-sample]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/bafy|bafk|"rows"/);
  });
});
