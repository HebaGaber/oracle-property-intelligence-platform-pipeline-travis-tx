// A-13 T030 (FR-023; TC-042): Help · MCP (`/help/mcp`). It lists the six fixed tools of AD-21
// (no SQL tool) and "Try a tool" answers "Not available yet · the agent and MCP server arrive with
// story A-14", never a sample response.
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

  it("answers Try a tool with the A-14 text and no sample response", async () => {
    await renderHelp();
    expect(screen.queryByText(PAGE_TEXTS.mcpNotAvailable)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /try/i })[0] as HTMLElement);
    expect(screen.getByText(PAGE_TEXTS.mcpNotAvailable)).toBeDefined();
    expect(document.querySelector("pre, code[data-sample]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/bafy|bafk|"rows"/);
  });
});
