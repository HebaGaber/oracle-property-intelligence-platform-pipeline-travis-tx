// SYNTHETIC TEST INPUT (test-only). A fake Socrata `3syk-w9eu` endpoint for the A-04 permit
// tests: keyset pages by `:id`, `count(*)` with an optional `:updated_at` bound and the hourly
// `:updated_at` histogram. Every row here is invented; no owner or contractor data.
import type { FetchLike } from "../../../../travis/lib/source-client.js";

export type Row = Record<string, string>;

export const BASE = "https://data.austintexas.gov/resource/3syk-w9eu.json";

const pad = (n: number, w: number): string => String(n).padStart(w, "0");

/** A synthetic Austin row; `i` fixes its `:id` order. */
export function synthRow(i: number, over: Partial<Row> = {}): Row {
  return {
    ":id": `row-${pad(i, 6)}`,
    ":created_at": "2026-01-01T00:00:00.000Z",
    ":updated_at": "2026-10-01T00:00:00.000Z",
    ":@computed_region_abcd_1234": "7",
    permit_number: `2026-${pad(i, 6)} BP`,
    permittype: "BP",
    work_class: "Remodel",
    description: "SYNTHETIC TEST INPUT",
    status_current: "Active",
    issue_date: "2026-09-01T00:00:00.000",
    expiresdate: "2027-03-01T00:00:00.000",
    tcad_id: "0100000001",
    original_address1: `${i} SYNTHETIC ST`,
    original_city: "AUSTIN",
    original_state: "TX",
    original_zip: "78701",
    jurisdiction: "AUSTIN FULL PURPOSE",
    issued_in_last_30_days: "No",
    day_issued: "MONDAY",
    ...over,
  };
}

export interface Call {
  url: URL;
  t: number;
  headers: Record<string, string>;
}

export interface FakeSocrataOptions {
  rows: () => readonly Row[];
  /** Status to answer instead of the body, by call; null = answer normally. */
  fault?: (url: URL, call: number) => number | null;
  /** Throw (a killed process) instead of answering. */
  crash?: (url: URL, call: number) => boolean;
  clock: () => number;
}

const CLAUSE = /^(:id|:updated_at) (>|<=) '([^']+)'$/;

function filterRows(rows: readonly Row[], where: string | null): Row[] {
  if (where === null || where === "") return [...rows];
  const clauses = where.split(" AND ").map((c) => {
    const m = CLAUSE.exec(c.trim());
    if (!m) throw new Error(`fake-socrata: unsupported clause ${c}`);
    return { field: m[1] as string, op: m[2] as string, value: m[3] as string };
  });
  return rows.filter((r) =>
    clauses.every((c) => {
      const v = r[c.field] ?? "";
      return c.op === ">" ? v > c.value : v <= c.value;
    }),
  );
}

export function fakeSocrata(options: FakeSocrataOptions): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (raw, init) => {
    const url = new URL(raw);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url, t: options.clock(), headers });
    const n = calls.length;
    if (options.crash?.(url, n)) throw new Error("synthetic crash: process killed");
    const status = options.fault?.(url, n) ?? null;
    if (status !== null) {
      return new Response(status === 403 ? "<html>Forbidden</html>" : "{}", {
        status,
        headers: { "content-type": status === 403 ? "text/html" : "application/json" },
      });
    }
    const p = url.searchParams;
    const select = p.get("$select") ?? "";
    const sorted = [...options.rows()].sort((a, b) =>
      (a[":id"] ?? "") < (b[":id"] ?? "") ? -1 : 1,
    );
    const matched = filterRows(sorted, p.get("$where"));
    let body: unknown;
    if (select === "count(*) AS n") {
      body = [{ n: String(matched.length) }];
    } else if (select.startsWith("date_trunc_ymdh(:updated_at) AS h")) {
      const by = new Map<string, number>();
      for (const r of matched) {
        const h = `${(r[":updated_at"] ?? "").slice(0, 13)}:00:00.000`;
        by.set(h, (by.get(h) ?? 0) + 1);
      }
      body = [...by.entries()].sort().map(([h, c]) => ({ h, n: String(c) }));
    } else {
      const limit = Number(p.get("$limit") ?? "1000");
      body = matched.slice(0, limit);
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

/** A fake clock + sleep: sleeping advances the clock (no real waiting). */
export function fakeTime(startIso = "2026-10-22T03:00:00.000Z") {
  const start = Date.parse(startIso);
  let t = 0;
  const sleeps: number[] = [];
  return {
    clock: () => t,
    now: () => new Date(start + t),
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += Math.max(0, ms);
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}

/** A seeded RNG (mulberry32) so jitter is reproducible. */
export function seededRandom(seed: number): { random: () => number; drawn: number[] } {
  let a = seed >>> 0;
  const drawn: number[] = [];
  return {
    drawn,
    random: () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      const r = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      drawn.push(r);
      return r;
    },
  };
}
