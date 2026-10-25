// T019 (A-14, agent-design.md § 5 "Citation mapping"; data-model.md § "agent.ask contract" >
// `Match`): the per-request citation registry. Every row any tool returns this turn is
// registered once, keyed by the row's own record cid (v_property's `cid` for a property row,
// v_roofing_permit's `cid` — same value as its `permit_cid` — for a permit row; see
// packages/query-core/views.sql: both views alias their own record cid to a flat `cid` column),
// with a stable 1-based index `n` assigned in first-seen order. `matches()` builds `Match[]`
// only from each row's own provenance fields, copied verbatim — never from model text.
// `postCheck(answer)` strips any `[n]` outside `1..matches().length` and any unregistered
// CID-shaped token (`bafy…`/`bafk…`, 59 chars) from a candidate answer, counting each removal so
// ask.ts can log `ungrounded_citation`/`out_of_range_citation` metrics (agent-design.md § 4,
// gate G-grounded).
//
// Algorithm matches packages/query-core/test/agent-citations.test.ts's
// `referenceCitationRegistry()` exactly (register/matches/postCheck semantics): that file is the
// executable spec this module is built against, not imported from (it lives in query-core
// because it predates this file, T018a).
import type { Row } from "@countylens/query-core";

const CID_SHAPED = /\b(bafy[0-9a-z]{55}|bafk[0-9a-z]{55})\b/gi;
const CITATION_TOKEN = /\[(\d+)\]/g;

/** data-model.md's `Match`: every field copied verbatim from the row's own provenance, plus
 *  whichever row-type fields that row carries. `missing` defaults to `[]` when the row has none. */
export interface Match {
  n: number;
  property_cid?: string;
  permit_cid?: string;
  permit_number?: string;
  source_url: string | null;
  captured_at: string;
  table: string;
  table_cid: string;
  run_id: string;
  manifest_cid: string;
  as_of: string;
  roof_age_years?: number;
  roof_age_basis?: string;
  roof_age_confidence?: string;
  open_days?: number;
  status_class?: string;
  contractor_resolution?: string;
  bbb_status?: string;
  bbb_status_reason?: string;
  missing: { field: string; reason: string }[];
}

/** A tool-result row, as returned by a packages/query-core tool function: must carry its own
 *  record `cid` (the registry key) plus whatever provenance/row fields that view exposes. */
export type CitationRow = Row & { cid: string };

export interface PostCheckResult {
  /** `answer` with every out-of-range `[n]` and unregistered CID-shaped token removed. */
  cleaned: string;
  /** Count of `[n]` tokens outside `1..matches().length` that were stripped. */
  outOfRangeCitations: number;
  /** Count of CID-shaped tokens not in the registry that were stripped. */
  ungroundedCids: number;
}

export interface CitationRegistry {
  /** Registers a row by its own `cid`, first-seen order. Re-registering the same `cid` is a
   *  no-op that returns its existing index (the first-registered row's fields are kept). */
  register(row: CitationRow): number;
  /** Every registered row as a `Match`, in `n` order (1-based; `matches()[i]` has `n === i+1`). */
  matches(): Match[];
  /** True when a row with this `cid` is already registered. */
  has(cid: string): boolean;
  /** Number of distinct rows registered so far. */
  size(): number;
  postCheck(answer: string): PostCheckResult;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toMatch(n: number, row: CitationRow): Match {
  const missing = Array.isArray(row.missing) ? (row.missing as Match["missing"]) : [];
  const propertyCid = optionalString(row.property_cid);
  const permitCid = optionalString(row.permit_cid);
  const permitNumber = optionalString(row.permit_number);
  const roofAgeYears = optionalNumber(row.roof_age_years);
  const roofAgeBasis = optionalString(row.roof_age_basis);
  const roofAgeConfidence = optionalString(row.roof_age_confidence);
  const openDays = optionalNumber(row.open_days);
  const statusClass = optionalString(row.status_class);
  const contractorResolution = optionalString(row.contractor_resolution);
  const bbbStatus = optionalString(row.bbb_status);
  const bbbStatusReason = optionalString(row.bbb_status_reason);
  return {
    n,
    ...(propertyCid !== undefined ? { property_cid: propertyCid } : {}),
    ...(permitCid !== undefined ? { permit_cid: permitCid } : {}),
    ...(permitNumber !== undefined ? { permit_number: permitNumber } : {}),
    source_url: optionalString(row.source_url) ?? null,
    captured_at: optionalString(row.captured_at) ?? "",
    table: optionalString(row.table) ?? "",
    table_cid: optionalString(row.table_cid) ?? "",
    run_id: optionalString(row.run_id) ?? "",
    manifest_cid: optionalString(row.manifest_cid) ?? "",
    as_of: optionalString(row.as_of) ?? "",
    ...(roofAgeYears !== undefined ? { roof_age_years: roofAgeYears } : {}),
    ...(roofAgeBasis !== undefined ? { roof_age_basis: roofAgeBasis } : {}),
    ...(roofAgeConfidence !== undefined ? { roof_age_confidence: roofAgeConfidence } : {}),
    ...(openDays !== undefined ? { open_days: openDays } : {}),
    ...(statusClass !== undefined ? { status_class: statusClass } : {}),
    ...(contractorResolution !== undefined ? { contractor_resolution: contractorResolution } : {}),
    ...(bbbStatus !== undefined ? { bbb_status: bbbStatus } : {}),
    ...(bbbStatusReason !== undefined ? { bbb_status_reason: bbbStatusReason } : {}),
    missing,
  };
}

/** Builds a fresh, empty registry (one per `agent.ask` request — never shared across requests). */
export function createCitationRegistry(): CitationRegistry {
  const order: string[] = [];
  const rows = new Map<string, CitationRow>();

  return {
    register(row) {
      if (!rows.has(row.cid)) {
        rows.set(row.cid, row);
        order.push(row.cid);
      }
      return order.indexOf(row.cid) + 1;
    },

    has(cid) {
      return rows.has(cid);
    },

    size() {
      return order.length;
    },

    matches() {
      return order.map((cid, i) => {
        const row = rows.get(cid);
        if (row === undefined)
          throw new Error(`citation registry: ${cid} missing from its own order`);
        return toMatch(i + 1, row);
      });
    },

    postCheck(answer) {
      const maxN = order.length;
      const registeredCids = new Set(order);
      let outOfRangeCitations = 0;
      let ungroundedCids = 0;

      let cleaned = answer.replace(CITATION_TOKEN, (full, nStr: string) => {
        const n = Number(nStr);
        if (n < 1 || n > maxN) {
          outOfRangeCitations += 1;
          return "";
        }
        return full;
      });

      cleaned = cleaned.replace(CID_SHAPED, (full) => {
        if (!registeredCids.has(full)) {
          ungroundedCids += 1;
          return "";
        }
        return full;
      });

      return { cleaned, outOfRangeCitations, ungroundedCids };
    },
  };
}
