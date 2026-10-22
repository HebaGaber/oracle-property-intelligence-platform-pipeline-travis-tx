// A-07 T021 (Track A, NFR-001): the 25-row contractor sampler. Must fail before T022
// (travis/identity/sampler.ts) lands -- T022 is Wave 3, out of scope for this builder pass,
// so this test is expected to stay red (module not found) until then.
//
// Fixes the contract: a recorded random seed (so the sample is reproducible) and a guarantee
// that every non-empty ledger state is represented in the sample when the source ledger has
// enough rows of each state.
import { describe, expect, it } from "vitest";
import { sampleContractorLedger } from "../../../../travis/identity/sampler.js";
import type { LedgerRow } from "../../../../travis/identity/resolver.js";

const DIGEST = "d".repeat(64);
const EFFECTIVE_ON = "2026-10-22T00:00:00.000Z";

function row(state: LedgerRow["state"], permitKey: string): LedgerRow {
  return {
    permitKey,
    rawContractorName: state === "unresolved" ? null : "Sample Co.",
    state,
    reasonCode: state === "unresolved" ? "contractor_not_printed" : null,
    matchedRecordIds: state === "unresolved" ? [] : ["32000000009"],
    matchRule: "normalize-name-v1",
    resolverVersion: "1.0.0",
    registrySnapshotDigest: DIGEST,
    effectiveOn: EFFECTIVE_ON,
  };
}

function ledgerWithEveryState(perState = 10): LedgerRow[] {
  const states: LedgerRow["state"][] = ["resolved", "candidate", "ambiguous", "conflicting", "unresolved"];
  const rows: LedgerRow[] = [];
  for (const state of states) {
    for (let i = 0; i < perState; i += 1) rows.push(row(state, `${state}-${i}`));
  }
  return rows;
}

describe("sampleContractorLedger (NFR-001)", () => {
  it("samples exactly 25 rows and records the random seed used", () => {
    const result = sampleContractorLedger(ledgerWithEveryState(), { seed: 42 });
    expect(result.sample.length).toBe(25);
    expect(result.seed).toBe(42);
  });

  it("every non-empty ledger state is represented in the sample", () => {
    const result = sampleContractorLedger(ledgerWithEveryState(), { seed: 7 });
    const statesInSample = new Set(result.sample.map((r: LedgerRow) => r.state));
    expect(statesInSample).toEqual(new Set(["resolved", "candidate", "ambiguous", "conflicting", "unresolved"]));
  });

  it("is reproducible: the same seed over the same ledger gives the same sample", () => {
    const ledger = ledgerWithEveryState();
    const first = sampleContractorLedger(ledger, { seed: 99 });
    const second = sampleContractorLedger(ledger, { seed: 99 });
    expect(first.sample.map((r: LedgerRow) => r.permitKey)).toEqual(second.sample.map((r: LedgerRow) => r.permitKey));
  });

  it("an empty state (e.g. 0 resolved, this run's expected outcome) is simply absent, not an error", () => {
    const ledger = ledgerWithEveryState().filter((r: LedgerRow) => r.state !== "resolved");
    const result = sampleContractorLedger(ledger, { seed: 1 });
    expect(result.sample.every((r: LedgerRow) => r.state !== "resolved")).toBe(true);
    expect(result.sample.length).toBe(Math.min(25, ledger.length));
  });
});
