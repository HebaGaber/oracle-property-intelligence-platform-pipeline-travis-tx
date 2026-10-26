// RunSelect (PO 2026-10-26: a run list with only run + date is a dropdown, the same on every
// page): runs newest first as "Run N · Mon D, YYYY", the latest marked, the chosen run selected,
// an optional "all runs" choice reported as null, and a labelled native select.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunSelect } from "../src/components/RunSelect";
import { runDate, runOptionLabel } from "../src/data/runs-index";

// Out of order on purpose: numbering follows finishedAt, not array order.
const RUNS = [
  { runId: "run-c", manifestCid: "bafkc", finishedAt: "2026-10-25T12:44:21Z" },
  { runId: "run-a", manifestCid: "bafka", finishedAt: "2026-10-21T10:40:04.543Z" },
  { runId: "run-b", manifestCid: "bafkb", finishedAt: "2026-10-24T18:20:49Z" },
];

afterEach(cleanup);

const select = (name = "Run"): HTMLSelectElement => screen.getByRole("combobox", { name });

describe("runOptionLabel", () => {
  it("reads Run N · Mon D, YYYY in UTC", () => {
    expect(runOptionLabel(4, "2026-10-25T23:59:59Z")).toBe("Run 4 · Oct 25, 2026");
    expect(runDate("not a date")).toBe("not a date");
  });
});

describe("RunSelect", () => {
  it("lists runs newest first, numbered by finish time, the latest marked", () => {
    render(<RunSelect runs={RUNS} value="run-b" onChange={() => undefined} label="Run" />);
    const options = [...select().options];
    expect(options.map((o) => o.textContent)).toEqual([
      "Run 3 · Oct 25, 2026 · latest",
      "Run 2 · Oct 24, 2026",
      "Run 1 · Oct 21, 2026",
    ]);
    expect(options.map((o) => o.getAttribute("data-run-id"))).toEqual(["run-c", "run-b", "run-a"]);
    expect(select().value).toBe("run-b");
  });

  it("reports the chosen run ID", () => {
    const onChange = vi.fn();
    render(<RunSelect runs={RUNS} value="run-c" onChange={onChange} label="Run" />);
    fireEvent.change(select(), { target: { value: "run-a" } });
    expect(onChange).toHaveBeenCalledWith("run-a");
  });

  it("selects the latest when the value is unknown and there is no all-runs choice", () => {
    render(<RunSelect runs={RUNS} value="missing" onChange={() => undefined} label="Run" />);
    expect(select().value).toBe("run-c");
  });

  it("offers an all-runs choice first, reported as null", () => {
    const onChange = vi.fn();
    render(
      <RunSelect
        runs={RUNS}
        value={null}
        onChange={onChange}
        label="Run"
        hideLabel
        allLabel="All runs"
      />,
    );
    expect(select().options[0]?.textContent).toBe("All runs");
    expect(select().value).toBe("");
    fireEvent.change(select(), { target: { value: "run-b" } });
    fireEvent.change(select(), { target: { value: "" } });
    expect(onChange.mock.calls).toEqual([["run-b"], [null]]);
  });

  it("names the field by its label, visible or for assistive tech only", () => {
    render(
      <RunSelect runs={RUNS} value={null} onChange={() => undefined} label="Older run" hideLabel />,
    );
    expect(select("Older run")).toBeDefined();
    expect(
      document.querySelector('[data-icon="arrow_drop_down"]')?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});
