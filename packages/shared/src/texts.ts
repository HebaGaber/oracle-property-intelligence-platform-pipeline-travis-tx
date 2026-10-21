// A-13 fixed texts (contracts/ui-routes.md, both tables; FR-025, stable for A-14 and A-16). Every
// fixed string of the explorer and its pages lives here; pages and tests import these, never
// retype them. Templates are functions over plain values; nothing here holds a data value.
// This module imports nothing (no contract, no zod), so the shell and the Hub can use it through
// `@countylens/shared/texts` without pulling the contract schemas into the initial bundle.

/** `YYYY-MM-DD HH:mm UTC` of an ISO 8601 instant (the Hub chip and the run labels). */
export function utcMinute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Not an instant: ${iso}`);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** `{first 4}…{last 4}` of a digest or CID. */
export function shortHash(value: string): string {
  return value.length <= 8 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Runs, Compare and the run index. */
export const RUNS_TEXTS = Object.freeze({
  nextSync: "Next sync: none · scheduler off by default",
  oldManifestResolves: "old manifest still resolves on Pinata and Filebase",
  /** Compare with one run, and the delta column of a first run. */
  firstRun: "first run · nothing to compare against",
  /** Every entry of runs/index.json is a completed run (the index is written after finish). */
  completedRun: "Listed in the run index: a completed run",
  indexUnavailable: (reason: string): string => `Run index unavailable · ${reason}`,
  manifestUnavailable: (cid: string, reason: string): string =>
    `Manifest unavailable · ${cid} · ${reason}`,
});

export interface SizeAndDigest {
  readonly size: number;
  readonly sha256: string;
}

/** Data · Verify lanes (research R3). */
export const VERIFY_TEXTS = Object.freeze({
  rateLimited: "rate-limited, retrying",
  noReadableResponse: "no readable response (rate-limited or blocked), retrying",
  viaCar: "Verify via CAR",
  verified: "Verified · size and SHA-256 match the manifest",
  mismatch: (got: SizeAndDigest, expected: SizeAndDigest): string =>
    `Mismatch · size ${got.size} vs ${expected.size} · SHA-256 ${shortHash(got.sha256)} vs ${shortHash(expected.sha256)}`,
  /** A lane that ended without bytes to compare (no ✓). */
  notVerified: (detail: string): string => `Not verified · ${detail}`,
  /** The Warning pill when a gateway other than the copy served the bytes. */
  fallback: (host: string): string => `fallback · ${host}`,
});

/** Explore · Filters, the result rows, permits, owners and the SQL panel. */
export const EXPLORE_TEXTS = Object.freeze({
  header: (n: number, r: number, place: string, years: number): string =>
    `${n} within ${r} mi of ${place} · roof ≥ ${years} yrs`,
  stalledExpired: (x: number): string => `Stalled ${x} yrs · source says Expired`,
  openSourceSays: (x: number, statusRaw: string): string =>
    `Open ${x} yrs · source says ${statusRaw}`,
  stalledNoCarrier: (x: number): string =>
    `Stalled ${x} yrs · source status not published · no lexicon carrier`,
  openNoCarrier: (x: number): string =>
    `Open ${x} yrs · source status not published · no lexicon carrier`,
  asPrinted: "as printed on permit",
  noCarrier: "not published · no lexicon carrier",
  noOpenPermits: "no open roofing permits in this radius on the current run",
  tenureUnknownCount: (n: number): string => `tenure unknown: ${n}`,
  engineBrowser: "DuckDB-WASM in your browser · read-only",
  engineServer: "DuckDB on the server · same views",
  sqlReadOnly: "Read-only: only SELECT, WITH, DESCRIBE and SHOW run here",
  sqlError: (firstLine: string, fix: string): string => `${firstLine} · Try: ${fix}`,
  zeroResults: (r: number, k: number): string =>
    `No properties within ${r} mi · ${k} close matches just outside`,
  milesOutside: (miles: number): string => `+${miles} mi`,
  roofUnknown: "roof age unknown · no permit, new-construction or built-year record",
  bbbNotChecked: (reason: string): string => `BBB not checked · ${reason}`,
  bbbBlocked: "BBB blocked · 403 challenge, not harvested",
  bbbNotFound: "BBB: no profile found",
  tenureUnknown: "tenure unknown · no dated sale on record",
  ownerAreaUnknown: "owner area unknown · mailing address not in the published export",
});

/** Coverage denominators (research R10, PO D-4). */
export const COVERAGE_TEXTS = Object.freeze({
  /** A record kind with no key in the run manifest's coverage section (TC-017). */
  kindAbsent: "not in this run's coverage section",
  denominatorMissing: "denominator not in this run's manifest",
  denominatorMissingFor: (source: string): string =>
    `denominator not in this run's manifest · A-01 source ${source}`,
});

/** Hub, Catalog, Coming soon, county selector and Help · MCP. */
export const PAGE_TEXTS = Object.freeze({
  comingSoonNotDeployed: "Coming soon · Not deployed yet",
  comingSoon: "Coming soon",
  travisOnly: "CountyLens has data for Travis County, TX only",
  catalogUnavailable: (reason: string): string => `Catalog unavailable · ${reason}`,
  tableExportMissing: "table export not in this run's manifest",
  /** "Run {n} · {finishedAt as YYYY-MM-DD HH:mm UTC}"; n is the 1-based index position. */
  hubChip: (n: number, finishedAt: string): string => `Run ${n} · ${utcMinute(finishedAt)}`,
  mcpNotAvailable: "Not available yet · the agent and MCP server arrive with story A-14",
});
