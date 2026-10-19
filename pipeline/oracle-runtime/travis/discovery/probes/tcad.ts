// T022: the TCAD probe (research R8, FR-003, FR-003a).
//
// 1. Capture the public-information page once and find the 2026 Certified Special Export,
//    the Export Layouts and the supplemental exports from their link text.
// 2. Download the Export Layouts (field definitions) once.
// 3. Download the 2026 Certified Special Export once to pipeline/data/raw/tcad/ (gitignored)
//    with a 10-minute inactivity limit and a 2-hour total limit; either limit is a timeout
//    and the source is recorded as blocked with `timeout_ms` (FR-003, FR-006).
// 4. Stream the export with stream-json (bounded memory; the file may be multi-GB): count
//    accounts, list fields, print the property key exactly as it appears, and note whether
//    deed or sale dates are present. A ZIP download is read entry by entry, never unpacked.
// Supplemental exports are listed only, never downloaded.
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pipeline, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { z } from "zod";
import type { CaptureReceipt } from "../../lib/source-client.js";
import { isZip, listZipEntries, openZipEntry } from "../../lib/zip-entry.js";
import type { Measurement } from "../catalog.schema.js";
import { downloadRate, type DownloadRate } from "../measure.js";
import {
  missingReason,
  notAskedMeasurement,
  nullMeasurement,
  stopsSource,
  type ProbeDeps,
} from "./common.js";
import { ChallengeFreePage } from "./evidence.js";

export const TCAD_PUBLIC_INFO_URL = "https://traviscad.org/publicinformation";
export const TCAD_RAW_DIR = fileURLToPath(new URL("../../../../data/raw/tcad", import.meta.url));
export const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
export const TOTAL_LIMIT_MS = 2 * 60 * 60 * 1000;
export const ROLL_YEAR = 2026;

const COUNT_METHOD = "streaming count";

export interface TcadLinks {
  certified_special_export: string | null;
  export_layouts: string | null;
  supplemental: Array<{ label: string; url: string }>;
  certification_date: string | null;
}

export interface ExportScan {
  /** "" for a top-level array, otherwise the top-level key holding the record array. */
  record_path: string;
  /** The JSON entry read inside a ZIP download, or null for a plain JSON file. */
  zip_entry: string | null;
  count: number;
  fields: string[];
  identifier_name: string | null;
  identifier_proven: boolean;
  identifier_format: string | null;
  deed_or_sale_dates_present: boolean;
}

export interface TcadProbe {
  status: "available" | "blocked";
  receipts: CaptureReceipt[];
  blocked_receipt: CaptureReceipt | null;
  url: string;
  links: TcadLinks | null;
  layouts_receipt: CaptureReceipt | null;
  layouts_path: string | null;
  export_url: string | null;
  export_receipt: CaptureReceipt | null;
  export_path: string | null;
  download_rate: DownloadRate | null;
  scan: ExportScan | null;
  assessed_parcel_count: Measurement;
  roll_year: number;
  certification_date: string | null;
}

export interface TcadProbeDeps extends ProbeDeps {
  rawDir?: string;
  landingUrl?: string;
  limits?: { inactivityMs: number; totalMs: number };
  /** Explicit JSON record path, once confirmed from the Export Layouts (T048). */
  recordPath?: string;
}

// ---------- landing page ----------

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function normalizeDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return raw;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (us)
    return `${us[3]}-${(us[1] as string).padStart(2, "0")}-${(us[2] as string).padStart(2, "0")}`;
  const long = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(raw);
  if (long) {
    const month = MONTHS.indexOf((long[1] as string).toLowerCase());
    if (month < 0) return null;
    return `${long[3]}-${String(month + 1).padStart(2, "0")}-${(long[2] as string).padStart(2, "0")}`;
  }
  return null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Finds the export links by their visible text (the page layout is not a contract). */
export function findTcadLinks(html: string, baseUrl: string): TcadLinks {
  const anchors: Array<{ text: string; url: string }> = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    try {
      anchors.push({ text: stripTags(m[3] as string), url: new URL(m[2] as string, baseUrl).href });
    } catch {
      // an unparsable href is not a download link
    }
  }
  const year = String(ROLL_YEAR);
  const special = anchors.filter(
    (a) => /special\s+export/i.test(a.text) && !/supplement/i.test(a.text),
  );
  const certified =
    special.find(
      (a) => /certified/i.test(a.text) && (a.text.includes(year) || a.url.includes(year)),
    ) ??
    special.find((a) => /certified/i.test(a.text) && !/\b20\d\d\b/.test(a.text)) ??
    null;
  const layouts = anchors.find((a) => /export\s+layouts?/i.test(a.text)) ?? null;
  const supplemental = anchors
    .filter((a) => /supplement/i.test(a.text))
    .map((a) => ({ label: a.text, url: a.url }));

  let certificationDate: string | null = null;
  const dateRe =
    /certif\w*[^.<]{0,60}?\b([A-Z][a-z]+\s+\d{1,2},\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i;
  const dm = dateRe.exec(stripTags(html));
  if (dm) certificationDate = normalizeDate(dm[1] as string);

  return {
    certified_special_export: certified ? certified.url : null,
    export_layouts: layouts ? layouts.url : null,
    supplemental,
    certification_date: certificationDate,
  };
}

/** Where the export lands: pipeline/data/raw/tcad/<file name from the URL>. */
export function tcadExportPath(url: string, rawDir: string = TCAD_RAW_DIR): string {
  const name = basename(new URL(url).pathname).replace(/[^A-Za-z0-9._-]/g, "_");
  return join(rawDir, name.length > 0 && name !== "." ? name : "tcad-certified-special-export");
}

// ---------- streaming scan ----------

type Token = { name: string; value?: unknown };

function openExport(path: string): { stream: Readable; zip_entry: string | null } {
  if (!isZip(path)) return { stream: createReadStream(path), zip_entry: null };
  const jsonEntries = listZipEntries(path)
    .filter((e) => /\.json$/i.test(e.name))
    .sort((a, b) => b.uncompressedSize - a.uncompressedSize);
  const entry = jsonEntries[0];
  if (!entry) throw new Error("tcad: the ZIP export has no .json entry");
  return { stream: openZipEntry(path, entry), zip_entry: entry.name };
}

/** Reads only the first tokens to find where the record array sits. */
async function detectRecordPath(path: string): Promise<string> {
  const { stream } = openExport(path);
  const tokens = stream.pipe(parser.asStream({ streamValues: false }));
  let depth = 0;
  let key: string | null = null;
  try {
    for await (const raw of tokens) {
      const token = raw as Token;
      if (depth === 0) {
        if (token.name === "startArray") return "";
        if (token.name !== "startObject") break;
        depth = 1;
        continue;
      }
      if (depth === 1 && token.name === "keyValue") {
        key = String(token.value);
        continue;
      }
      if (depth === 1 && token.name === "startArray" && key !== null) return key;
      if (token.name === "startObject" || token.name === "startArray") depth += 1;
      else if (token.name === "endObject" || token.name === "endArray") depth -= 1;
      if (depth === 0) break;
    }
  } finally {
    stream.destroy();
    tokens.destroy();
  }
  throw new Error("tcad: no record array found at the top level of the export");
}

const RecordSchema = z.record(z.string(), z.unknown());
const PROP_ID = /^prop[_ ]?id$/i;
const GEO_ID = /^geo[_ ]?id$/i;
const DEED_OR_SALE_DATE = /(deed|sale).*(date|dt)|(date|dt).*(deed|sale)/i;
const MAX_FIELD_DEPTH = 3;

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

class IdTracker {
  readonly seen = new Set<string>();
  present = 0;
  allDigits = true;
  minLen = Number.POSITIVE_INFINITY;
  maxLen = 0;
  add(v: unknown): void {
    if (!nonEmpty(v)) return;
    const s = String(v);
    this.present += 1;
    this.seen.add(s);
    if (!/^\d+$/.test(s)) this.allDigits = false;
    this.minLen = Math.min(this.minLen, s.length);
    this.maxLen = Math.max(this.maxLen, s.length);
  }
  format(): string {
    const kind = this.allDigits ? "integer" : "string";
    const unit = this.allDigits ? "digits" : "characters";
    return this.minLen === this.maxLen
      ? `${kind}, ${this.minLen} ${unit}`
      : `${kind}, ${this.minLen}-${this.maxLen} ${unit}`;
  }
}

export async function scanExport(
  path: string,
  opts: { recordPath?: string } = {},
): Promise<ExportScan> {
  const recordPath = opts.recordPath ?? (await detectRecordPath(path));
  const { stream, zip_entry } = openExport(path);
  const records = streamArray.asStream();
  const stages: NodeJS.ReadWriteStream[] = [parser.asStream()];
  if (recordPath !== "") stages.push(pick.asStream({ filter: recordPath }));
  pipeline([stream, ...stages, records], (error) => {
    if (error) records.destroy(error);
  });

  const fields = new Set<string>();
  const ids = new Map<string, IdTracker>();
  let deedOrSale = false;
  let count = 0;

  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (depth > MAX_FIELD_DEPTH || value === null || typeof value !== "object") return;
    const entries = Array.isArray(value)
      ? value.flatMap((item) =>
          item !== null && typeof item === "object" && !Array.isArray(item)
            ? Object.entries(item)
            : [],
        )
      : Object.entries(value);
    const base = Array.isArray(value) ? `${prefix}[]` : prefix;
    for (const [k, v] of entries) {
      const name = base === "" ? k : `${base}.${k}`;
      fields.add(name);
      if (!deedOrSale && DEED_OR_SALE_DATE.test(k) && nonEmpty(v) && typeof v !== "object")
        deedOrSale = true;
      walk(v, name, depth + 1);
    }
  };

  for await (const item of records) {
    const record = RecordSchema.parse((item as { value: unknown }).value);
    count += 1;
    for (const [k, v] of Object.entries(record)) {
      if (PROP_ID.test(k) || GEO_ID.test(k)) {
        let t = ids.get(k);
        if (!t) {
          t = new IdTracker();
          ids.set(k, t);
        }
        t.add(v);
      }
    }
    walk(record, "", 1);
  }

  const names = [...ids.keys()];
  const identifier =
    names.find((n) => PROP_ID.test(n)) ?? names.find((n) => GEO_ID.test(n)) ?? null;
  const tracker = identifier ? (ids.get(identifier) as IdTracker) : null;
  return {
    record_path: recordPath,
    zip_entry,
    count,
    fields: [...fields].sort(),
    identifier_name: identifier,
    identifier_proven:
      tracker !== null && count > 0 && tracker.present === count && tracker.seen.size === count,
    identifier_format: tracker && tracker.present > 0 ? tracker.format() : null,
    deed_or_sale_dates_present: deedOrSale,
  };
}

// ---------- the probe ----------

export async function probeTcad(deps: TcadProbeDeps): Promise<TcadProbe> {
  const landingUrl = deps.landingUrl ?? TCAD_PUBLIC_INFO_URL;
  const rawDir = deps.rawDir ?? TCAD_RAW_DIR;
  const limits = deps.limits ?? { inactivityMs: INACTIVITY_LIMIT_MS, totalMs: TOTAL_LIMIT_MS };
  const receipts: CaptureReceipt[] = [];
  const base: TcadProbe = {
    status: "available",
    receipts,
    blocked_receipt: null,
    url: landingUrl,
    links: null,
    layouts_receipt: null,
    layouts_path: null,
    export_url: null,
    export_receipt: null,
    export_path: null,
    download_rate: null,
    scan: null,
    assessed_parcel_count: nullMeasurement(landingUrl, deps.now().toISOString(), "not measured"),
    roll_year: ROLL_YEAR,
    certification_date: null,
  };
  const stop = (
    receipt: CaptureReceipt,
    url: string,
    partial: Partial<TcadProbe> = {},
  ): TcadProbe => ({
    ...base,
    ...partial,
    status: "blocked",
    blocked_receipt: receipt,
    assessed_parcel_count: nullMeasurement(
      url,
      receipt.captured_at,
      `TCAD ${missingReason(receipt)}`,
      COUNT_METHOD,
    ),
  });

  // 1. landing page
  const landing = await deps.client.capture({
    url: landingUrl,
    schema: ChallengeFreePage,
    bodyKind: "text",
    accept: "text/html",
  });
  receipts.push(landing.receipt);
  if (stopsSource(landing.receipt) || landing.data === null)
    return stop(landing.receipt, landingUrl);
  const links = findTcadLinks(landing.data, landingUrl);
  base.links = links;
  base.certification_date = links.certification_date;
  if (links.certified_special_export === null) {
    return {
      ...base,
      assessed_parcel_count: nullMeasurement(
        landingUrl,
        landing.receipt.captured_at,
        `${ROLL_YEAR} Certified Special Export link not found on the public-information page`,
        COUNT_METHOD,
      ),
    };
  }
  const exportUrl = links.certified_special_export;
  base.export_url = exportUrl;

  // 2. export layouts (field definitions), once
  if (links.export_layouts !== null) {
    const layouts = await deps.client.capture({ url: links.export_layouts, accept: "*/*" });
    receipts.push(layouts.receipt);
    base.layouts_receipt = layouts.receipt;
    if (stopsSource(layouts.receipt)) {
      return {
        ...stop(layouts.receipt, links.export_layouts),
        assessed_parcel_count: notAskedMeasurement(exportUrl, layouts.receipt, COUNT_METHOD),
      };
    }
    mkdirSync(rawDir, { recursive: true });
    const layoutsPath = tcadExportPath(links.export_layouts, rawDir);
    writeFileSync(layoutsPath, layouts.body);
    base.layouts_path = layoutsPath;
  }

  // 3. the one download
  const dl = await deps.client.download({
    url: exportUrl,
    destPath: tcadExportPath(exportUrl, rawDir),
    inactivityMs: limits.inactivityMs,
    totalMs: limits.totalMs,
  });
  receipts.push(dl.receipt);
  base.export_receipt = dl.receipt;
  if (stopsSource(dl.receipt) || dl.path === null) return stop(dl.receipt, exportUrl);
  base.export_path = dl.path;
  base.download_rate = downloadRate({
    bytes: dl.receipt.bytes,
    seconds: Math.max(dl.seconds, 0.001),
    source_url: exportUrl,
    captured_at: dl.receipt.captured_at,
  });

  // 4. streaming scan
  try {
    const scan = await scanExport(
      dl.path,
      deps.recordPath === undefined ? {} : { recordPath: deps.recordPath },
    );
    return {
      ...base,
      scan,
      assessed_parcel_count: {
        value: scan.count,
        source_url: exportUrl,
        captured_at: dl.receipt.captured_at,
        method: COUNT_METHOD,
        ...(scan.record_path === "" ? {} : { query: `record path: ${scan.record_path}` }),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      assessed_parcel_count: nullMeasurement(
        exportUrl,
        dl.receipt.captured_at,
        `export downloaded but not countable: ${message}`,
        COUNT_METHOD,
      ),
    };
  }
}
