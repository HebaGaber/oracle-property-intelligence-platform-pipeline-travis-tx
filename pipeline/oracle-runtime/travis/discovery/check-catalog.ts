// T026: the A-01 checker, rules 1-5 and 8 (contracts/catalog.md). Rules 6-7 arrive in US2
// (T033). The kit validator ignores these A-01 keys, so this checker enforces them.
//
// Usage: check-catalog [path]   (default pipeline/docs/travis-sources.yaml)
// Prints one line per failure, `FAIL rule <n>: <subject> <detail>`, and exits 1 on any
// failure. It reads the YAML as plain data (not through the strict Zod schema) so a
// damaged catalog still yields numbered failures instead of one parse error.
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { redact } from "../lib/log.js";
import { DECISIONS, SOURCE_KEYS } from "./catalog.schema.js";
import { MAX_PAGE_SIZE, MIN_PAGES, exceedsDecisionThreshold } from "./measure.js";
import { DEFAULT_CATALOG_PATH } from "./write-catalog.js";

export { DEFAULT_CATALOG_PATH };

type Obj = Record<string, unknown>;

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const PROJECTION_TOLERANCE_H = 0.1;
const GAP_TOLERANCE_PCT = 0.01;

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function text(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

type Fail = (rule: number, subject: string, detail: string) => void;

/** Rule 2 on one Measurement. */
function checkMeasurement(m: Obj, path: string, fail: Fail): void {
  if (!text(m.source_url)) fail(2, path, "missing source_url");
  if (!(typeof m.captured_at === "string" && UTC_ISO.test(m.captured_at))) {
    fail(2, path, "missing or non-UTC captured_at");
  }
  if (m.value === null) {
    if (!text(m.missing_reason)) fail(2, path, "value null without missing_reason");
  } else if (!num(m.value)) {
    fail(2, path, "value is neither a number nor null");
  }
}

/** Walks the catalog; every object with an own `value` key is a Measurement (FR-007a). */
function walkMeasurements(node: unknown, path: string, fail: Fail): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      const label = isObj(item) && text(item.key) ? item.key : String(i);
      walkMeasurements(item, `${path}[${label}]`, fail);
    });
    return;
  }
  if (!isObj(node)) return;
  if (Object.hasOwn(node, "value")) {
    checkMeasurement(node, path, fail);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    walkMeasurements(v, path === "" ? k : `${path}.${k}`, fail);
  }
}

export function checkCatalog(raw: unknown): string[] {
  const lines: string[] = [];
  const fail: Fail = (rule, subject, detail) => {
    lines.push(`FAIL rule ${rule}: ${subject} ${detail}`);
  };
  const cat: Obj = isObj(raw) ? raw : {};
  const sources = Array.isArray(cat.sources) ? cat.sources.filter(isObj) : [];
  const byKey = new Map<string, Obj>();
  for (const s of sources) if (text(s.key) && !byKey.has(s.key)) byKey.set(s.key, s);

  // Rule 1: all 9 source keys present.
  for (const key of SOURCE_KEYS) if (!byKey.has(key)) fail(1, "sources", `missing ${key}`);

  // Rule 2: every Measurement has source_url and captured_at; every null has a reason.
  if (Array.isArray(cat.sources)) walkMeasurements(cat.sources, "sources", fail);
  if (isObj(cat.parcel)) walkMeasurements(cat.parcel, "parcel", fail);
  if (isObj(cat.permits)) walkMeasurements(cat.permits, "permits", fail);

  // Rule 3: every source has a decision (one of three words) and a reason.
  for (const s of sources) {
    const key = text(s.key) ? s.key : "(unnamed source)";
    const hours = num(s.projected_full_capture_hours) ? s.projected_full_capture_hours : null;
    if (!text(s.decision)) {
      if (exceedsDecisionThreshold(hours)) {
        fail(3, key, `projected ${fmt(hours as number)} h has no decision`);
      } else {
        fail(3, key, "has no decision");
      }
    } else if (!(DECISIONS as readonly string[]).includes(s.decision)) {
      fail(3, key, `decision "${s.decision}" is not one of ${DECISIONS.join(" | ")}`);
    }
    if (!text(s.decision_reason)) fail(3, key, "has no decision_reason");
  }

  // Rule 4: Comptroller has both counts; the denominator is the Travis-coded count.
  const comptroller = byKey.get("tx_comptroller");
  if (!comptroller) {
    fail(4, "tx_comptroller", "row missing");
  } else {
    const travis = comptroller.travis_coded_rows;
    const statewide = comptroller.statewide_rows;
    if (!isObj(travis)) fail(4, "tx_comptroller", "missing travis_coded_rows");
    if (!isObj(statewide)) fail(4, "tx_comptroller", "missing statewide_rows");
    if (isObj(travis)) {
      const denominator = isObj(comptroller.denominator)
        ? comptroller.denominator.value
        : undefined;
      if (denominator !== travis.value) {
        fail(4, "tx_comptroller", "denominator does not equal travis_coded_rows");
      }
      if (
        isObj(statewide) &&
        num(statewide.value) &&
        num(travis.value) &&
        statewide.value < travis.value
      ) {
        fail(4, "tx_comptroller", "statewide_rows is smaller than travis_coded_rows");
      }
    }
  }

  // Rule 5: Austin has count, null tcad_id count, throughput, projection and decision.
  const austin = byKey.get("austin_permits");
  if (!austin) {
    fail(5, "austin_permits", "row missing");
  } else {
    const subject = "austin_permits";
    const denominator = isObj(austin.denominator) ? austin.denominator.value : undefined;
    if (!num(denominator)) fail(5, subject, "count (denominator.value) missing");
    const nulls = austin.tcad_id_null_count;
    if (!isObj(nulls) || !num(nulls.value)) fail(5, subject, "tcad_id_null_count missing");
    const t = austin.throughput;
    let median: number | null = null;
    if (!isObj(t)) {
      fail(5, subject, "throughput missing");
    } else {
      if (!(num(t.pages_read) && t.pages_read >= MIN_PAGES)) {
        fail(5, subject, `throughput.pages_read ${String(t.pages_read)} is below ${MIN_PAGES}`);
      }
      if (!(num(t.page_size) && t.page_size > 0 && t.page_size <= MAX_PAGE_SIZE)) {
        fail(
          5,
          subject,
          `throughput.page_size ${String(t.page_size)} is not within 1..${MAX_PAGE_SIZE}`,
        );
      }
      if (num(t.rows_per_minute_median) && t.rows_per_minute_median > 0) {
        median = t.rows_per_minute_median;
      } else {
        fail(5, subject, "throughput.rows_per_minute_median is not positive");
      }
    }
    const projected = austin.projected_full_capture_hours;
    if (!num(projected)) {
      fail(5, subject, "projected_full_capture_hours missing");
    } else if (num(denominator) && median !== null) {
      const expected = denominator / median / 60;
      if (Math.abs(projected - expected) > PROJECTION_TOLERANCE_H) {
        fail(
          5,
          subject,
          `projected_full_capture_hours ${projected} != denominator / median / 60 (${fmt(expected)})`,
        );
      }
    }
    if (!text(austin.decision)) fail(5, subject, "decision missing");
  }

  // Rule 8: GIS is counted (gap computed against the roll), or unknown with a reason.
  const parcel = cat.parcel;
  if (!isObj(parcel)) {
    fail(8, "parcel", "block missing");
  } else {
    const gis = parcel.gis_feature_count;
    const roll = parcel.assessed_parcel_count;
    const gap = parcel.gap_pct;
    const needUnknown = (why: string): void => {
      if (gap !== "unknown")
        fail(8, "parcel", `gap_pct ${String(gap)} must be unknown when ${why}`);
      else if (!text(parcel.gap_reason)) fail(8, "parcel", "gap_pct unknown without gap_reason");
    };
    if (num(gis)) {
      if (num(roll) && roll > 0) {
        const expected = (Math.abs(roll - gis) / roll) * 100;
        if (!num(gap) || Math.abs(gap - expected) > GAP_TOLERANCE_PCT) {
          fail(
            8,
            "parcel",
            `gap_pct ${String(gap)} != |roll - GIS| / roll * 100 (${expected.toFixed(3)})`,
          );
        }
      } else {
        needUnknown("the roll count is missing");
      }
    } else if (gis === null) {
      needUnknown("GIS is not counted");
    } else {
      fail(8, "parcel", "gis_feature_count missing");
    }
  }

  return lines;
}

export function resolveCatalogPath(arg: string | undefined, cwd: string): string {
  if (arg === undefined || arg.trim() === "") return DEFAULT_CATALOG_PATH;
  return isAbsolute(arg) ? arg : resolve(cwd, arg);
}

export function main(
  argv: readonly string[],
  out: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
): number {
  const path = resolveCatalogPath(argv[0], process.env.INIT_CWD ?? process.cwd());
  const shown = redact(path);
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8"), { schema: "core" });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    out(`FAIL rule 0: catalog ${shown} unreadable: ${redact(message ?? "")}`);
    return 1;
  }
  const lines = checkCatalog(raw);
  for (const line of lines) out(line);
  if (lines.length === 0) out(`PASS check-catalog rules 1-5, 8: ${shown}`);
  return lines.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
