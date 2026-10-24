// A-03 Permits list cases: TC-020…TC-026, TC-028 and TC-030 (FR-003, FR-004, FR-005, FR-008,
// FR-011, FR-012, FR-013; plan § "Atlas element map" → Permits list; G6 matrix § 7). Labels come
// from @countylens/shared, the status-class enum and the closed reason list from
// @countylens/contract, every count and CID from the manifest the `run` fixture fetched; nothing
// is hard-coded. Two texts the plan places in apps/web, not in @countylens/shared, are carried
// here verbatim from plan § "Fixed texts and config keys": the engine line and the
// `fallback · {host}` label prefix.
//
// DOM contract these cases read (G-C4 builds it; aligned with apps/web/test/{permits-state,
// provenance,missing-reason}.test.ts; these hooks are the only ones the tests use):
// - `section[data-route="permits"]` is the page. Loading: `role="progressbar"` with
//   `aria-label="Loading permits"` and a non-empty `aria-valuetext`; skeletons live in a
//   `role="status" aria-busy="true"` container that holds no `table` and no `td`.
// - The engine line text is its own text element (its `memory` icon is `aria-hidden="true"`).
// - At ≥ 600 px the list is a `<table>` whose column headers read, in order: Permit number,
//   Improvement status, Status class, Issue date, Contractor, Missing data, Provenance; one
//   `tbody tr` per permit, each with `data-missing` = the JSON of the row's `missing` list
//   (`[{"field","reason"}, …]`) and one `td` per column. Cards below 600 px (`article` with an
//   `h3` permit number) carry the same `data-missing`; these cases run at desktop.
// - `Issue date` is the plain text `YYYY-MM-DD`; `Status class` is `open` / `stalled` /
//   `closed`, else a missing-reason pill; `Improvement status` is the value or a pill.
// - The `Contractor` cell holds the resolution pill `[data-status="verified"|"unavailable"]` whose
//   text is `resolved` / `unresolved`, then the reason label(s) as missing-reason pills
//   (`contractor_company_cid`, `contractor_name_raw`); nothing else.
// - A missing-reason pill is `[data-field="{field}"][data-reason="{reason}"]` (one per entry of
//   the row's `missing` list, in the displayed cell or in `Missing data`) whose label
//   `missingLabel(field, reason)` is visible text (not only a title); its icon is `aria-hidden`.
// - The `Provenance` cell holds `a[href="{source_url}"]`, `<time datetime="{captured_at}">`,
//   `[data-cid="{table_cid}"][title="{table_cid}"]` with the middle-truncated text, and the
//   text `run {run_id}`.
// Full-county adaptation 2026-10-24 (A-11 Run 2, PO approved: "Yes, adapt them"): the page lists
// all ~15,000 permits across decades, so (a) nothing pins the pilot's issue month, (b) every row
// is checked once, in one in-page pass, for the cheap invariants (`auditAllRows`), and (c) the
// full per-row assertions run on a deterministic sample (`snapshotRows`: the first
// SAMPLE_HEAD rows, every SAMPLE_STRIDE-th row and the NAMED_PERMITS). Row counts stay exact.
// - TC-030 reads `NO_TCAD_PERMIT_NUMBERS` (comma-separated, from the run's capture receipt; the
//   receipt is internal, so the operator exports it) and checks it against the manifest count.
import type { Locator, Page, TestInfo } from "@playwright/test";
import { MISSING_REASONS, Missing, VIEWS, type RunManifestV1 } from "@countylens/contract";
import {
  CONTRACTOR_NOT_PRINTED_LABEL,
  MISSING_REASON_LABELS,
  PERMITS_TEXTS,
  PROGRESS_LABELS,
  isContractorField,
  missingLabel,
} from "@countylens/shared";
import { z } from "zod";
import { expect, test } from "./lib/fixtures.js";
import { checkpoint } from "./lib/evidence.js";
import { artifactsOf, publicCid } from "./lib/manifest.js";
import { harnessConfig, requireCidCopyHost, runtimeUrl, type PublishedRun } from "./lib/runtime.js";

/** plan § "Fixed texts": `apps/web/src/components/EngineLine.tsx` ENGINE_LINE_TEXT (TC-023). */
const ENGINE_LINE_TEXT = "DuckDB-WASM in your browser · read-only";

/** plan § "Fixed texts": the word `fallback`, ` · `, the gateway host (`apps/web/src/components/FallbackChip.tsx`). */
const FALLBACK_LABEL = /^fallback · /;

/**
 * Deterministic row sample for the full per-row assertions (full-county adaptation): the first
 * SAMPLE_HEAD rows, every SAMPLE_STRIDE-th row (a prime, so it does not align with page or
 * ordering boundaries) and the named permits. Every row still gets the cheap invariants.
 */
const SAMPLE_HEAD = 200;
const SAMPLE_STRIDE = 97;
/** A permit from a different decade than the pilot's, fixed in the Run 2 data (A-11). */
const NAMED_PERMITS = ["2003-012717 BP"];

/** The column headers, in order (apps/web/test/permits-state.test.ts "renders the Atlas data table"). */
const HEADERS = [
  "Permit number",
  "Improvement status",
  "Status class",
  "Issue date",
  "Contractor",
  "Missing data",
  "Provenance",
] as const;

/** Cell index by column. */
const COL = {
  permit_number: 0,
  improvement_status: 1,
  status_class: 2,
  issue_date: 3,
  contractor: 4,
  missing_data: 5,
  provenance: 6,
} as const;

const ROW = "table tbody tr";

const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

const NO_TCAD_ENV = "NO_TCAD_PERMIT_NUMBERS";

/** Cell texts that would mean a blank or a raw value (TC-022 step 5). */
const BLANK_TEXTS = new Set(["", "null", "undefined", "NaN", "—", "-", "N/A", "n/a"]);

const MissingList = z.array(Missing);

function statusClassValues(): readonly string[] {
  const column = VIEWS.v_roofing_permit.find((candidate) => candidate.name === "status_class");
  if (!column?.enum) throw new Error("contract: v_roofing_permit.status_class has no enum");
  return column.enum;
}

/** The all-rows audit's inputs, all from the manifest the `run` fixture fetched. */
function auditParamsOf(run: PublishedRun): AuditParams {
  const [austin] = run.manifest.sources;
  if (!austin) throw new Error("manifest has no sources[0]");
  return {
    // as_of is the manifest's finishedAt (columns.ts: "manifest finishedAt (= as_of)").
    asOfDate: run.manifest.finishedAt.slice(0, 10),
    statusClasses: statusClassValues(),
    needsReviewLabel: MISSING_REASON_LABELS.needs_review,
    sourceHost: new URL(austin.url).hostname,
    capturedAtMs: Date.parse(austin.captured_at),
    tableCids: artifactsOf(run.manifest, "table").map((artifact) => artifact.cid),
    runId: run.runId,
    columns: HEADERS.length,
    provenanceColumn: COL.provenance,
    contractorColumn: COL.contractor,
    blankTexts: [...BLANK_TEXTS],
    rawCodes: [...MISSING_REASONS],
  };
}

function truncateCid(cid: string): string {
  return `${cid.slice(0, 4)}…${cid.slice(-4)}`;
}

/** The last path segment of a read-path URL: `/{cid}` on the copy, `/ipfs/{cid}` on a gateway. */
function cidOfUrl(url: URL): string {
  return url.pathname.split("/").filter(Boolean).at(-1) ?? "";
}

/** Every CID whose bytes are public for the run: the manifest and each artifact's public CID. */
function publishedCids(manifest: RunManifestV1, manifestCid: string): Set<string> {
  const cids = new Set<string>([manifestCid]);
  for (const artifact of manifest.artifacts) {
    cids.add(artifact.cid);
    cids.add(publicCid(artifact));
  }
  return cids;
}

function coverageCount(manifest: RunManifestV1, key: string): number {
  const entry = manifest.coverage[key];
  if (!entry) throw new Error(`manifest coverage has no "${key}" entry`);
  return entry.count;
}

/** TC-030 test data: the permit numbers the capture receipt lists as not emitted (no tcad_id). */
function noTcadPermitNumbers(expectedCount: number): string[] {
  const raw = process.env[NO_TCAD_ENV];
  if (raw === undefined) {
    if (expectedCount === 0) return [];
    throw new Error(
      `${NO_TCAD_ENV} is not set; export the ${expectedCount} permit number(s) without tcad_id from the run's capture receipt, comma-separated`,
    );
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

// ---------------------------------------------------------------------------------------
// Network and DOM recording.
// ---------------------------------------------------------------------------------------

interface SeenRequest {
  method: string;
  url: URL;
  at: number;
  requestHeaders: Record<string, string>;
}

interface SeenResponse extends SeenRequest {
  status: number;
  headers: Record<string, string>;
}

interface NetworkLog {
  requests: SeenRequest[];
  responses: SeenResponse[];
}

/** Records every request and response the page (and its workers) issues from now on. */
function recordNetwork(page: Page): NetworkLog {
  const log: NetworkLog = { requests: [], responses: [] };
  page.on("request", (request) => {
    log.requests.push({
      method: request.method(),
      url: new URL(request.url()),
      at: Date.now(),
      requestHeaders: request.headers(),
    });
  });
  page.on("response", (response) => {
    log.responses.push({
      method: response.request().method(),
      url: new URL(response.url()),
      at: Date.now(),
      requestHeaders: response.request().headers(),
      status: response.status(),
      headers: response.headers(),
    });
  });
  return log;
}

async function attachNetwork(testInfo: TestInfo, log: NetworkLog): Promise<void> {
  const serialize = (entries: SeenRequest[]): unknown[] =>
    entries.map((entry) => ({ ...entry, url: entry.url.href }));
  await testInfo.attach("network.json", {
    body: JSON.stringify(
      { requests: serialize(log.requests), responses: serialize(log.responses) },
      null,
      2,
    ),
    contentType: "application/json",
  });
}

interface DomState {
  t: number;
  tables: number;
  tableRows: number;
  progress: boolean;
  busyTables: number;
  busyCells: number;
  emptyText: boolean;
}

/** A MutationObserver that snapshots the loading-related DOM state on every change (TC-024). */
async function installStateRecorder(page: Page): Promise<void> {
  await page.addInitScript((emptyText: string) => {
    const states: DomState[] = [];
    const snapshot = (): void => {
      states.push({
        t: performance.now(),
        tables: document.querySelectorAll("table").length,
        tableRows: document.querySelectorAll("table tbody tr").length,
        progress: document.querySelector('[role="progressbar"]') !== null,
        busyTables: document.querySelectorAll('[role="status"][aria-busy="true"] table').length,
        busyCells: document.querySelectorAll('[role="status"][aria-busy="true"] td').length,
        emptyText: document.body?.textContent?.includes(emptyText) ?? false,
      });
    };
    const start = (): void => {
      snapshot();
      new MutationObserver(snapshot).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
    (window as unknown as { __a03States: DomState[] }).__a03States = states;
  }, PERMITS_TEXTS.empty);
}

function readStates(page: Page): Promise<DomState[]> {
  return page.evaluate(() => (window as unknown as { __a03States?: DomState[] }).__a03States ?? []);
}

/**
 * Waits until the list rendered rows, or fails naming the error banner or the empty state the
 * page showed instead. Returns the rows locator.
 */
async function waitForPermitRows(page: Page, timeoutMs = 120_000): Promise<Locator> {
  const rows = page.locator(ROW);
  const alert = page.getByRole("alert");
  const empty = page.getByText(PERMITS_TEXTS.empty, { exact: true });
  await expect
    .poll(
      async () => {
        if ((await rows.count()) > 0) return "rows";
        if ((await alert.count()) > 0) return "alert";
        if ((await empty.count()) > 0) return "empty";
        return "pending";
      },
      { timeout: timeoutMs, message: "the Permits list, an error banner or the empty state" },
    )
    .not.toBe("pending");
  if ((await alert.count()) > 0) {
    throw new Error(`the Permits page shows an error banner: ${await alert.first().innerText()}`);
  }
  if ((await empty.count()) > 0) {
    throw new Error(`the Permits page shows the empty state: ${PERMITS_TEXTS.empty}`);
  }
  return rows;
}

interface PillSnapshot {
  reason: string | null;
  status: string | null;
  text: string;
  leaves: string[];
  visible: boolean;
}

interface RowSnapshot {
  /** Position of the row in the full list (the sample keeps the original index). */
  index: number;
  missingAttr: string | null;
  /** Visible text per `td`, in column order. */
  cells: string[];
  /** Per `td`, its own-text elements: every label or value that is its own element. */
  leaves: string[][];
  /** data-field → the missing-reason pill (`[data-reason]`). */
  pills: Record<string, PillSnapshot>;
  /** `[data-status]` elements of the Contractor cell (the resolution pill has no data-reason). */
  contractorPills: PillSnapshot[];
  provenance: {
    links: string[];
    datetimes: string[];
    cids: { cid: string; title: string | null; text: string }[];
  };
}

/**
 * One structured read of the sampled rows (SAMPLE_HEAD, SAMPLE_STRIDE, NAMED_PERMITS): visible
 * texts (outside `aria-hidden`), hooks and attributes.
 */
function readRows(
  page: Page,
  contractorColumn: number,
  provenanceColumn: number,
): Promise<RowSnapshot[]> {
  return page.locator(ROW).evaluateAll(
    (rows, columns) => {
      const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();
      const picked = rows.flatMap((row, index) =>
        index < columns.head ||
        index % columns.stride === 0 ||
        columns.named.includes(normalize(row.querySelector("td")?.textContent ?? ""))
          ? [{ row, index }]
          : [],
      );
      const visible = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
        if (!(node instanceof Element) || node.getAttribute("aria-hidden") === "true") return "";
        return Array.from(node.childNodes).map(visible).join("");
      };
      const leavesOf = (root: Element): string[] => {
        const out: string[] = [];
        const walk = (element: Element): void => {
          if (element.getAttribute("aria-hidden") === "true") return;
          const own = normalize(
            Array.from(element.childNodes)
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent ?? "")
              .join(""),
          );
          if (own !== "") out.push(own);
          Array.from(element.children).forEach(walk);
        };
        walk(root);
        return out;
      };
      const pill = (element: Element): PillSnapshot => ({
        reason: element.getAttribute("data-reason"),
        status: element.getAttribute("data-status"),
        text: normalize(visible(element)),
        leaves: leavesOf(element),
        visible: element.getClientRects().length > 0,
      });
      return picked.map(({ row, index }) => {
        const tds = Array.from(row.querySelectorAll("td"));
        const pills: Record<string, PillSnapshot> = {};
        for (const element of Array.from(row.querySelectorAll("[data-reason]"))) {
          pills[element.getAttribute("data-field") ?? ""] = pill(element);
        }
        const contractor = tds[columns.contractor];
        const provenance = tds[columns.provenance];
        return {
          index,
          missingAttr: row.getAttribute("data-missing"),
          cells: tds.map((td) => normalize(visible(td))),
          leaves: tds.map(leavesOf),
          pills,
          contractorPills: contractor
            ? Array.from(contractor.querySelectorAll("[data-status]")).map(pill)
            : [],
          provenance: {
            links: provenance
              ? Array.from(provenance.querySelectorAll("a[href]")).map(
                  (anchor) => (anchor as HTMLAnchorElement).href,
                )
              : [],
            datetimes: provenance
              ? Array.from(provenance.querySelectorAll("time[datetime]")).map(
                  (time) => time.getAttribute("datetime") ?? "",
                )
              : [],
            cids: provenance
              ? Array.from(provenance.querySelectorAll("[data-cid]")).map((cid) => ({
                  cid: cid.getAttribute("data-cid") ?? "",
                  title: cid.getAttribute("title"),
                  text: normalize(visible(cid)),
                }))
              : [],
          },
        };
      });
    },
    {
      contractor: contractorColumn,
      provenance: provenanceColumn,
      head: SAMPLE_HEAD,
      stride: SAMPLE_STRIDE,
      named: NAMED_PERMITS,
    },
  );
}

/** The deterministic sample of rows that get the full per-row assertions. */
function snapshotRows(page: Page): Promise<RowSnapshot[]> {
  return readRows(page, COL.contractor, COL.provenance);
}

function parseMissing(row: RowSnapshot): z.infer<typeof MissingList> {
  expect(row.missingAttr, `row ${row.index}: carries data-missing`).not.toBeNull();
  return MissingList.parse(JSON.parse(row.missingAttr ?? "[]"));
}

/** Asserts the named permits are in the sample, so the sample always covers them. */
function expectNamedPermitsSampled(snapshots: RowSnapshot[]): void {
  const sampled = snapshots.map((row) => row.cells[COL.permit_number] ?? "");
  for (const permit of NAMED_PERMITS) {
    expect(sampled, `named permit ${permit} is in the row sample`).toContain(permit);
  }
}

interface AuditParams {
  asOfDate: string;
  statusClasses: readonly string[];
  needsReviewLabel: string;
  sourceHost: string;
  capturedAtMs: number;
  tableCids: string[];
  runId: string;
  columns: number;
  provenanceColumn: number;
  contractorColumn: number;
  blankTexts: string[];
  rawCodes: string[];
}

interface RowAudit {
  rows: number;
  /** Violations per invariant (each entry names the row index), capped per invariant. */
  violations: Record<
    "dates" | "columns" | "statusClass" | "provenance" | "blankCells" | "missing" | "contractor",
    string[]
  >;
}

/**
 * The cheap invariants of every row, checked once for ALL rows in one in-page pass (a per-row
 * Playwright round trip does not scale to ~15,000 rows). Each invariant lists the offending
 * rows (first 20), so a failure still names the row. Full-county adaptation 2026-10-24.
 */
function auditAllRows(page: Page, params: AuditParams): Promise<RowAudit> {
  return page.locator(ROW).evaluateAll((rows, p) => {
    const CAP = 20;
    const violations: RowAudit["violations"] = {
      dates: [],
      columns: [],
      statusClass: [],
      provenance: [],
      blankCells: [],
      missing: [],
      contractor: [],
    };
    const flag = (key: keyof RowAudit["violations"], index: number, why: string): void => {
      if (violations[key].length < CAP) violations[key].push(`row ${index}: ${why}`);
    };
    const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();
    const visible = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof Element) || node.getAttribute("aria-hidden") === "true") return "";
      return Array.from(node.childNodes).map(visible).join("");
    };
    const truncate = (cid: string): string => `${cid.slice(0, 4)}…${cid.slice(-4)}`;
    const tableCids = new Set(p.tableCids);
    const statusClasses = new Set(p.statusClasses);
    const blank = new Set(p.blankTexts);
    const raw = new Set(p.rawCodes);

    rows.forEach((row, index) => {
      const tds = Array.from(row.querySelectorAll("td"));
      const cells = tds.map((td) => normalize(visible(td)));
      if (tds.length !== p.columns) flag("columns", index, `${tds.length} cells`);

      // Issue date: a real calendar date in YYYY-MM-DD that is not after the run's as_of.
      const issue = cells[3] ?? "";
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(issue) ? new Date(`${issue}T00:00:00Z`) : null;
      if (
        !parsed ||
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== issue
      ) {
        flag("dates", index, `issue_date "${issue}" is not a valid YYYY-MM-DD date`);
      } else if (issue > p.asOfDate) {
        flag("dates", index, `issue_date ${issue} is after as_of ${p.asOfDate}`);
      }

      // Status class: open / stalled / closed, or the needs_review label.
      const statusClass = cells[2] ?? "";
      if (!statusClasses.has(statusClass) && !statusClass.includes(p.needsReviewLabel)) {
        flag("statusClass", index, `status class "${statusClass}"`);
      }

      // Provenance: one source link on the source host, one capture time, one manifest table CID.
      const prov = tds[p.provenanceColumn];
      if (!prov) {
        flag("provenance", index, "no provenance cell");
      } else {
        const links = Array.from(prov.querySelectorAll("a[href]")).filter(
          (a) => new URL((a as HTMLAnchorElement).href).hostname === p.sourceHost,
        );
        const times = Array.from(prov.querySelectorAll("time[datetime]"));
        const cids = Array.from(prov.querySelectorAll("[data-cid]"));
        if (links.length !== 1) flag("provenance", index, `${links.length} source links`);
        if (times.length !== 1) flag("provenance", index, `${times.length} capture times`);
        else if (Date.parse(times[0]?.getAttribute("datetime") ?? "") !== p.capturedAtMs) {
          flag("provenance", index, "capture time differs from sources[0].captured_at");
        }
        if (cids.length !== 1) flag("provenance", index, `${cids.length} table CIDs`);
        else {
          const cid = cids[0]?.getAttribute("data-cid") ?? "";
          if (!tableCids.has(cid)) flag("provenance", index, `CID ${cid} is not a manifest table`);
          if (cids[0]?.getAttribute("title") !== cid) flag("provenance", index, "CID title");
          if (normalize(visible(cids[0] as Element)) !== truncate(cid)) {
            flag("provenance", index, "CID text is not the truncated CID");
          }
        }
        if (!(cells[p.provenanceColumn] ?? "").includes(`run ${p.runId}`)) {
          flag("provenance", index, `no "run ${p.runId}"`);
        }
      }

      // No blank, null-ish, dash-only or raw-code cell.
      cells.forEach((text, column) => {
        if (blank.has(text)) flag("blankCells", index, `column ${column} is "${text}"`);
        if (raw.has(text)) flag("blankCells", index, `column ${column} shows raw code "${text}"`);
      });

      // Every missing entry renders its pill (data-field + data-reason).
      let missing: { field: string; reason: string }[] = [];
      try {
        missing = JSON.parse(row.getAttribute("data-missing") ?? "null") as typeof missing;
        if (!Array.isArray(missing)) throw new Error("not a list");
      } catch {
        flag("missing", index, "data-missing is absent or not a JSON list");
        missing = [];
      }
      for (const { field, reason } of missing) {
        const pill = row.querySelector(
          `[data-field="${CSS.escape(field)}"][data-reason="${CSS.escape(reason)}"]`,
        );
        if (!pill) flag("missing", index, `no pill for ${field} (${reason})`);
        else if (pill.getClientRects().length === 0) flag("missing", index, `${field} hidden`);
        else if (normalize(visible(pill)) === "") flag("missing", index, `${field} label blank`);
      }

      // Exactly one resolution pill, reading resolved or unresolved.
      const contractor = tds[p.contractorColumn];
      const resolution = contractor
        ? Array.from(contractor.querySelectorAll("[data-status]")).filter(
            (el) => !el.hasAttribute("data-reason"),
          )
        : [];
      const state = resolution.length === 1 ? normalize(visible(resolution[0] as Element)) : "";
      if (state !== "resolved" && state !== "unresolved") {
        flag("contractor", index, `${resolution.length} resolution pill(s), text "${state}"`);
      } else if (
        state === "unresolved" &&
        !missing.some(
          (m) => m.field === "contractor_company_cid" && m.reason === "contractor_unresolved",
        )
      ) {
        flag("contractor", index, "unresolved without contractor_unresolved in missing");
      }
    });
    return { rows: rows.length, violations };
  }, params);
}

// ---------------------------------------------------------------------------------------
// Cases.
// ---------------------------------------------------------------------------------------

test.describe("A-03 Permits list (FR-003, FR-005, FR-008, FR-011)", () => {
  test.describe.configure({ timeout: 5 * 60_000 });

  test.describe("A-03-TC-020 Permits list via DuckDB-WASM (happy path, demo D-1/D-4)", () => {
    test("@scenario:A-03-TC-020", async ({ page, run }, testInfo) => {
      const copyHost = requireCidCopyHost();
      const { manifest, manifestCid } = run;
      const published = publishedCids(manifest, manifestCid);
      const tableCids = new Set(artifactsOf(manifest, "table").map((artifact) => artifact.cid));
      const network = recordNetwork(page);
      await installStateRecorder(page);

      // Step 1: progress bar, then the table; public, no sign-in.
      await page.goto("/permits");
      await expect(page.locator('[data-route="permits"]')).toBeVisible();
      const rows = await waitForPermitRows(page);
      await attachNetwork(testInfo, network);
      const states = await readStates(page);
      expect(
        states.some((state) => state.progress),
        "a progress bar showed before the table",
      ).toBe(true);
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await expect(page.getByText(/sign in/i)).toHaveCount(0);
      await checkpoint(page, "020", "1-table-public");

      // Step 2: Parquet reads go to the CID copy, addressed by CIDs the manifest lists.
      const copyRequests = network.requests.filter((request) => request.url.hostname === copyHost);
      expect(copyRequests.length, `requests to ${copyHost}`).toBeGreaterThan(0);
      expect(
        copyRequests.map((request) => cidOfUrl(request.url)).filter((cid) => !published.has(cid)),
        "every copy request names a CID the manifest lists",
      ).toEqual([]);
      expect(
        copyRequests.some((request) => tableCids.has(cidOfUrl(request.url))),
        "at least one table part was read from the copy",
      ).toBe(true);

      // Step 3: one row per published permit.
      const count = coverageCount(manifest, "permits_emitted");
      await expect(rows).toHaveCount(count);
      await checkpoint(page, "020", "3-one-row-per-permit");

      // Step 4 (full-county adaptation 2026-10-24): every row's issue_date is a valid
      // YYYY-MM-DD date not after the run's as_of (manifest finishedAt). One in-page pass.
      const audit = await auditAllRows(page, auditParamsOf(run));
      expect(audit.rows, "the audit saw every row").toBe(count);
      expect(audit.violations.dates, "issue_date is a valid date not after as_of").toEqual([]);

      // Expected result: read from the copy, so no fallback label.
      await expect(page.getByText(FALLBACK_LABEL)).toHaveCount(0);
      await checkpoint(page, "020", "expected-no-fallback-label");
    });
  });

  test.describe("A-03-TC-021 Contract columns and provenance per row", () => {
    test("@scenario:A-03-TC-021", async ({ page, run }) => {
      const { manifest, runId } = run;
      const tableCids = new Set(artifactsOf(manifest, "table").map((artifact) => artifact.cid));
      const [austin] = manifest.sources;
      if (!austin) throw new Error("manifest has no sources[0]");
      const sourceHost = new URL(austin.url).hostname;
      const statusClasses = statusClassValues();

      await page.goto("/permits");
      const rows = await waitForPermitRows(page);

      // Step 2: the headers, in order.
      const headers = await page
        .getByRole("table")
        .getByRole("columnheader")
        .evaluateAll((cells) =>
          cells.map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()),
        );
      expect(headers, "column headers").toEqual([...HEADERS]);
      await checkpoint(page, "021", "2-headers");

      // Steps 3–4 (full-county adaptation 2026-10-24): the cheap invariants of every row in one
      // in-page pass, then the full per-row assertions on the deterministic sample.
      expect(await rows.count()).toBe(coverageCount(manifest, "permits_emitted"));
      const audit = await auditAllRows(page, auditParamsOf(run));
      expect(audit.violations.columns, "one cell per column on every row").toEqual([]);
      expect(audit.violations.statusClass, "status class on every row").toEqual([]);
      expect(audit.violations.provenance, "four provenance fields on every row").toEqual([]);

      const snapshots = await snapshotRows(page);
      expectNamedPermitsSampled(snapshots);
      for (const row of snapshots) {
        const index = row.index;
        expect(row.cells.length, `row ${index}: one cell per column`).toBe(HEADERS.length);
        const statusClass = row.cells[COL.status_class] ?? "";
        expect(
          statusClasses.includes(statusClass) ||
            (row.leaves[COL.status_class] ?? []).includes(MISSING_REASON_LABELS.needs_review),
          `row ${index}: status class "${statusClass}" is ${statusClasses.join(" / ")} or the needs_review label`,
        ).toBe(true);

        const { links, datetimes, cids } = row.provenance;
        const sourceLinks = links.filter((href) => new URL(href).hostname === sourceHost);
        expect(sourceLinks.length, `row ${index}: source URL link on ${sourceHost}`).toBe(1);
        expect(datetimes.length, `row ${index}: one capture time`).toBe(1);
        expect(
          Date.parse(datetimes[0] ?? ""),
          `row ${index}: capture time equals sources[0].captured_at`,
        ).toBe(Date.parse(austin.captured_at));
        expect(cids.length, `row ${index}: one table CID`).toBe(1);
        const [tableCid] = cids;
        expect(
          tableCids.has(tableCid?.cid ?? ""),
          `row ${index}: table CID is a manifest table`,
        ).toBe(true);
        expect(tableCid?.title, `row ${index}: table CID title`).toBe(tableCid?.cid);
        expect(tableCid?.text, `row ${index}: table CID truncated text`).toBe(
          truncateCid(tableCid?.cid ?? ""),
        );
        expect(row.cells[COL.provenance], `row ${index}: run ID`).toContain(`run ${runId}`);
      }
      await checkpoint(page, "021", "3-4-status-and-provenance");
    });
  });

  test.describe("A-03-TC-022 Every missing reason shows its approved label (missing data)", () => {
    test("@scenario:A-03-TC-022", async ({ page, run }, testInfo) => {
      await page.goto("/permits");
      await waitForPermitRows(page);

      // Full-county adaptation 2026-10-24: every row gets the cheap invariants in one in-page
      // pass (a pill with the right reason and a visible, non-blank label for each missing
      // entry; no blank or raw-code cell); the exact-label assertions run on the sample.
      const audit = await auditAllRows(page, auditParamsOf(run));
      expect(audit.rows).toBe(coverageCount(run.manifest, "permits_emitted"));
      expect(audit.violations.missing, "every missing entry renders its pill").toEqual([]);
      expect(audit.violations.blankCells, "no blank, null-ish or raw-code cell").toEqual([]);

      const snapshots = await snapshotRows(page);
      expect(snapshots.length).toBeGreaterThan(0);
      expectNamedPermitsSampled(snapshots);
      await testInfo.attach("rows.json", {
        body: JSON.stringify(snapshots, null, 2),
        contentType: "application/json",
      });

      for (const row of snapshots) {
        const index = row.index;
        const missing = parseMissing(row);

        // Steps 2–3: each {field, reason} renders exactly its approved label as visible text.
        for (const { field, reason } of missing) {
          const label = missingLabel(field, reason);
          if (reason === "source_missing") {
            expect(label).toBe(
              isContractorField(field)
                ? CONTRACTOR_NOT_PRINTED_LABEL
                : MISSING_REASON_LABELS.source_missing,
            );
          }
          const pill = row.pills[field];
          expect(
            pill,
            `row ${index}: ${field} (${reason}) renders a missing-reason pill`,
          ).toBeDefined();
          expect(pill?.reason, `row ${index}: ${field} pill names its reason`).toBe(reason);
          expect(pill?.visible, `row ${index}: ${field} label is visible`).toBe(true);
          expect(pill?.leaves, `row ${index}: ${field} shows "${label}"`).toContain(label);
        }

        // Step 4: the two uncarried fields on every row; a stalled row's improvement_status.
        for (const field of ["status_raw", "expiry_date"]) {
          expect(
            row.pills[field]?.leaves,
            `row ${index}: ${field} shows the no_lexicon_carrier label`,
          ).toContain(MISSING_REASON_LABELS.no_lexicon_carrier);
        }
        if (row.cells[COL.status_class] === "stalled") {
          expect(
            row.pills.improvement_status?.leaves,
            `row ${index}: stalled row shows the enum_lacks_value label`,
          ).toContain(MISSING_REASON_LABELS.enum_lacks_value);
        }

        // Step 5: no blank, null-ish, dash-only or raw-code cell.
        for (const [column, text] of row.cells.entries()) {
          const name = HEADERS[column] ?? `column ${column}`;
          expect(BLANK_TEXTS.has(text), `row ${index}: ${name} is "${text}"`).toBe(false);
          expect(
            (MISSING_REASONS as readonly string[]).includes(text),
            `row ${index}: ${name} shows the raw code "${text}"`,
          ).toBe(false);
        }
        for (const [field, pill] of Object.entries(row.pills)) {
          expect(pill.text, `row ${index}: ${field} label is not blank`).not.toBe("");
          expect(
            (MISSING_REASONS as readonly string[]).includes(pill.text),
            `row ${index}: ${field} shows a raw code`,
          ).toBe(false);
        }
      }
      await checkpoint(page, "022", "2-5-missing-reason-labels");
    });
  });

  test.describe("A-03-TC-023 Engine line exact; no database server", () => {
    test("@scenario:A-03-TC-023", async ({ page, run }, testInfo) => {
      const copyHost = requireCidCopyHost();
      const { manifest, manifestCid } = run;
      const published = publishedCids(manifest, manifestCid);
      const origin = new URL(runtimeUrl());
      const gatewayHost = harnessConfig().FILEBASE_GATEWAY_HOST;
      const network = recordNetwork(page);

      await page.goto("/permits");
      await waitForPermitRows(page);
      await attachNetwork(testInfo, network);

      // Step 2: the engine line, verbatim, as its own text element.
      await expect(page.getByText(ENGINE_LINE_TEXT, { exact: true })).toBeVisible();
      await page.getByText(ENGINE_LINE_TEXT, { exact: true }).scrollIntoViewIfNeeded();
      await checkpoint(page, "023", "2-engine-line");

      // Step 3: no API call, no database host; data requests are GETs by CID only.
      const http = network.requests.filter((request) =>
        ["http:", "https:"].includes(request.url.protocol),
      );
      expect(
        http
          .filter(
            (request) =>
              request.url.host === origin.host && request.url.pathname.startsWith("/api/"),
          )
          .map((request) => request.url.href),
        "no request to the CountyLens API",
      ).toEqual([]);
      const allowedHosts = new Set([origin.host, ...FONT_HOSTS, copyHost, gatewayHost]);
      expect(
        http
          .filter((request) => !allowedHosts.has(request.url.host))
          .map((request) => request.url.href),
        "no request to any other host",
      ).toEqual([]);
      const dataRequests = http.filter(
        (request) => request.url.hostname === copyHost || request.url.hostname === gatewayHost,
      );
      expect(dataRequests.length, "data was read by CID").toBeGreaterThan(0);
      for (const request of dataRequests) {
        expect(["GET", "HEAD"], `${request.url.href}: read-only method`).toContain(request.method);
        expect(published.has(cidOfUrl(request.url)), `${request.url.href}: a manifest CID`).toBe(
          true,
        );
      }
      await checkpoint(page, "023", "3-no-database-server");
    });
  });

  test.describe("A-03-TC-024 Loading state shows a progress bar, no empty-table flash (edge)", () => {
    test("@scenario:A-03-TC-024", async ({ page, context, run }, testInfo) => {
      const copyHost = requireCidCopyHost();
      const count = coverageCount(run.manifest, "permits_emitted");
      await installStateRecorder(page);

      // Step 1: every CID-copy response is delayed 2 s (under the 4 s fallback threshold).
      await context.route(
        (url) => url.hostname === copyHost,
        async (route) => {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
          try {
            await route.continue();
          } catch {
            // The page gave up on this request; nothing to continue.
          }
        },
      );

      // Steps 2–3: the progress bar, with its accessible name and stage text, before any table.
      await page.goto("/permits");
      const progress = page.getByRole("progressbar", { name: PROGRESS_LABELS.permits });
      await expect(progress).toBeVisible();
      await expect(progress).toHaveAttribute("aria-valuetext", /\S/);
      await expect(page.locator("table"), "no table while loading").toHaveCount(0);
      const busy = page.locator('[role="status"][aria-busy="true"]');
      if ((await busy.count()) > 0) {
        expect(await busy.first().evaluate((element) => element.tagName)).not.toBe("TABLE");
        await expect(busy.locator("table, td"), "skeletons carry no data cells").toHaveCount(0);
      }
      await checkpoint(page, "024", "2-3-progress-bar");

      // Step 4: every DOM state until rows appeared.
      const rows = await waitForPermitRows(page);
      await expect(rows).toHaveCount(count);
      const states = await readStates(page);
      await testInfo.attach("dom-states.json", {
        body: JSON.stringify(states, null, 2),
        contentType: "application/json",
      });
      expect(
        states.some((state) => state.progress),
        "the progress bar was observed",
      ).toBe(true);
      expect(
        states.filter((state) => state.tables > 0 && state.tableRows === 0),
        "never a zero-row table",
      ).toEqual([]);
      expect(
        states.filter((state) => state.busyTables > 0),
        "skeletons are never a <table>",
      ).toEqual([]);
      expect(
        states.filter((state) => state.busyCells > 0),
        "skeletons carry no data cells",
      ).toEqual([]);
      expect(
        states.filter((state) => state.emptyText),
        "the empty state never showed",
      ).toEqual([]);
      await expect(page.getByText(FALLBACK_LABEL), "2 s < 4 s: no fallback").toHaveCount(0);
      await checkpoint(page, "024", "4-rows-after-loading");
    });
  });

  test.describe("A-03-TC-025 Contractor via contractor_resolution with its label", () => {
    test("@scenario:A-03-TC-025", async ({ page, run }) => {
      await page.goto("/permits");
      await waitForPermitRows(page);

      // Full-county adaptation 2026-10-24: every row has exactly one resolved / unresolved pill
      // (and unresolved lists contractor_unresolved) in one in-page pass; the label-by-label
      // assertions run on the sample.
      const audit = await auditAllRows(page, auditParamsOf(run));
      expect(audit.rows).toBe(coverageCount(run.manifest, "permits_emitted"));
      expect(audit.violations.contractor, "a resolution pill on every row").toEqual([]);

      const snapshots = await snapshotRows(page);
      expect(snapshots.length).toBeGreaterThan(0);
      expectNamedPermitsSampled(snapshots);

      for (const row of snapshots) {
        const index = row.index;
        const missing = parseMissing(row);
        const leaves = row.leaves[COL.contractor] ?? [];

        // Step 2: the resolution pill (`data-status`, no `data-reason`) reads resolved / unresolved.
        const resolution = row.contractorPills.filter((candidate) => candidate.reason === null);
        expect(resolution.length, `row ${index}: one resolution pill`).toBe(1);
        const [pill] = resolution;
        const state = pill?.text;
        expect(
          ["resolved", "unresolved"],
          `row ${index}: contractor cell shows resolved or unresolved`,
        ).toContain(state);
        expect(pill?.status, `row ${index}: the pill's § 2.4 status`).toBe(
          state === "resolved" ? "verified" : "unavailable",
        );

        // Step 3: an unresolved row shows the approved label beside the pill.
        if (state === "unresolved") {
          expect(leaves, `row ${index}: contractor_unresolved label`).toContain(
            MISSING_REASON_LABELS.contractor_unresolved,
          );
          expect(
            missing.some(
              (entry) =>
                entry.field === "contractor_company_cid" &&
                entry.reason === "contractor_unresolved",
            ),
            `row ${index}: missing lists contractor_company_cid as contractor_unresolved`,
          ).toBe(true);
        }

        // Step 4: nothing else in the cell: no raw contractor name shown as if resolved.
        const allowed = new Set([
          state,
          MISSING_REASON_LABELS.contractor_unresolved,
          CONTRACTOR_NOT_PRINTED_LABEL,
          MISSING_REASON_LABELS.no_lexicon_carrier,
        ]);
        expect(
          leaves.filter((leaf) => !allowed.has(leaf)),
          `row ${index}: contractor cell shows only the state and its labels`,
        ).toEqual([]);
        if (row.pills.contractor_name_raw) {
          expect(
            row.pills.contractor_name_raw.leaves,
            `row ${index}: contractor_name_raw has no place in the published model`,
          ).toContain(MISSING_REASON_LABELS.no_lexicon_carrier);
        }

        // Step 5: source_missing on a contractor field → "Contractor not printed on permit".
        for (const entry of missing) {
          if (entry.reason === "source_missing" && isContractorField(entry.field)) {
            expect(
              row.pills[entry.field]?.leaves,
              `row ${index}: ${entry.field} not printed on the permit`,
            ).toContain(CONTRACTOR_NOT_PRINTED_LABEL);
          }
        }
      }
      await checkpoint(page, "025", "2-5-contractor-resolution");
    });
  });

  test.describe("A-03-TC-026 Table parts read with HTTP 206 range requests", () => {
    test("@scenario:A-03-TC-026", async ({ page, run }, testInfo) => {
      const copyHost = requireCidCopyHost();
      const tableCids = new Set(artifactsOf(run.manifest, "table").map((artifact) => artifact.cid));
      const network = recordNetwork(page);

      await page.goto("/permits");
      await waitForPermitRows(page);
      await attachNetwork(testInfo, network);

      const parts = network.responses.filter(
        (response) => response.url.hostname === copyHost && tableCids.has(cidOfUrl(response.url)),
      );
      expect(parts.length, `table-part responses from ${copyHost}`).toBeGreaterThan(0);
      const reads = parts.filter((response) => response.method === "GET");
      expect(reads.length, "table parts are read with GET").toBeGreaterThan(0);
      for (const read of reads) {
        const label = `${read.method} ${read.url.href}`;
        expect(read.requestHeaders.range, `${label}: Range header`).toMatch(/^bytes=/);
        expect(read.status, `${label}: 206 Partial Content`).toBe(206);
        expect(read.headers["content-range"], `${label}: Content-Range header`).toMatch(/^bytes /);
      }
      expect(
        reads.filter((read) => read.status === 200).map((read) => read.url.href),
        "no whole-file 200 for a table part",
      ).toEqual([]);
      await checkpoint(page, "026", "rows-from-range-reads");
    });
  });

  test.describe("A-03-TC-028 DuckDB-WASM binary transferred compressed", () => {
    // Plan R2 fallback (2026-10-21): Amplify rejects a Content-Encoding custom header, so the
    // build ships duckdb-eh-<hash>.wasm.gz only and the engine gunzips it in the browser.
    test("@scenario:A-03-TC-028", async ({ page }, testInfo) => {
      const MAX_TRANSFER_BYTES = 12 * 1024 * 1024;
      const network = recordNetwork(page);
      const transfers: { url: string; status: number | null; bodyBytes: number }[] = [];
      const pending: Promise<void>[] = [];
      page.on("requestfinished", (request) => {
        if (!new URL(request.url()).pathname.endsWith(".wasm.gz")) return;
        pending.push(
          (async () => {
            const sizes = await request.sizes();
            const response = await request.response();
            transfers.push({
              url: request.url(),
              status: response?.status() ?? null,
              bodyBytes: sizes.responseBodySize,
            });
          })(),
        );
      });
      await page.goto("/permits");
      await waitForPermitRows(page);
      await Promise.all(pending);
      await attachNetwork(testInfo, network);
      await testInfo.attach("wasm-transfer.json", {
        body: JSON.stringify(transfers, null, 2),
        contentType: "application/json",
      });

      const raw = network.requests.filter((request) => request.url.pathname.endsWith(".wasm"));
      expect(
        raw.map((request) => request.url.href),
        "the uncompressed .wasm is never requested",
      ).toEqual([]);
      expect(transfers.length, "the DuckDB-WASM .wasm.gz was fetched").toBeGreaterThan(0);
      for (const transfer of transfers) {
        const name = new URL(transfer.url).pathname.split("/").at(-1) ?? transfer.url;
        expect([200, 304], `${name}: status`).toContain(transfer.status);
        expect(
          transfer.bodyBytes,
          `${name}: transfer ${transfer.bodyBytes} B < ${MAX_TRANSFER_BYTES} B`,
        ).toBeLessThan(MAX_TRANSFER_BYTES);
      }
      await checkpoint(page, "028", "rows-after-compressed-wasm");
    });
  });

  test.describe("A-03-TC-030 No-tcad_id permit is not published (missing data)", () => {
    test("@scenario:A-03-TC-030", async ({ page, run }, testInfo) => {
      const expected = coverageCount(run.manifest, "permits_no_tcad_geoid");
      const numbers = noTcadPermitNumbers(expected);
      // Full-county adaptation 2026-10-24 (A-11 Run 2, PO approved): the pilot exported every
      // unlinked permit (1); at full scale there are hundreds of thousands (Run 2: 275,764), so
      // the env var carries a sample of them, never more than the manifest counts.
      if (expected > 0) {
        expect(numbers.length, `${NO_TCAD_ENV} lists at least one unlinked permit`).toBeGreaterThan(
          0,
        );
      }
      expect(
        numbers.length,
        `${NO_TCAD_ENV} lists no more permits than permits_no_tcad_geoid (${expected})`,
      ).toBeLessThanOrEqual(expected);
      await testInfo.attach("no-tcad-permit-numbers.txt", {
        body: numbers.join("\n"),
        contentType: "text/plain",
      });

      await page.goto("/permits");
      await waitForPermitRows(page);
      // Full-county adaptation 2026-10-24: the permit-number column of all rows and a text scan
      // of the whole page, both read in the page (no per-row round trip, no 15,000-row innerText).
      const listed = await page
        .locator(ROW)
        .evaluateAll((rows) =>
          rows.map((row) =>
            (row.querySelector("td")?.textContent ?? "").replace(/\s+/g, " ").trim(),
          ),
        );
      expect(listed.length, "the whole list is read").toBe(
        coverageCount(run.manifest, "permits_emitted"),
      );
      const onPage = await page.evaluate(
        (candidates) =>
          candidates.map((candidate) => (document.body.textContent ?? "").includes(candidate)),
        numbers,
      );
      const listedSet = new Set(listed);
      for (const [position, number] of numbers.entries()) {
        expect(listedSet.has(number), `permit ${number} is not listed`).toBe(false);
        expect(onPage[position], `permit ${number} appears nowhere on the page`).toBe(false);
      }
      await checkpoint(page, "030", "no-tcad-permits-absent");
    });
  });
});
