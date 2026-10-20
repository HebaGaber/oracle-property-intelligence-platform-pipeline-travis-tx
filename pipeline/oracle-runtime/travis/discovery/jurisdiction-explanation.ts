// PO decision 2026-10-20: no records request, Public Information Act request or API
// application is filed in this project. Every permit row that is not `supported` therefore
// carries `blocked_explanation`: one evaluator-readable text, built only from the row's own
// recorded fields, that says (a) why no permit history is captured, (b) what was tried and
// (c) what would unblock it, and that the request is not filed. Pure, no I/O; the class and
// status rules (status-map.ts) are untouched.
import type { Jurisdiction } from "./catalog.schema.js";

export const PO_DECISION = "PO decision 2026-10-20";
export const NOT_FILED = `not filed (${PO_DECISION})`;

/** The blocked-row note wording before the PO decision, and its replacement. */
export const LEGACY_BLOCKED_NOTE =
  "classified records request until the records request is answered";
export const BLOCKED_NOTE = `classified records request; the records request is ${NOT_FILED}`;
/** Earlier wordings migrated to BLOCKED_NOTE (the first draft of this decision included). */
const LEGACY_BLOCKED_NOTES = [
  LEGACY_BLOCKED_NOTE,
  `classified records request (the records request is ${NOT_FILED})`,
];

/** The Austin dataset that captures Austin-issued permits located in other jurisdictions. */
const AUSTIN_DATASET = "Austin dataset 3syk-w9eu";

export interface ExplainOptions {
  /** The challenge marker recorded with the stop (receipt or evidence file), if any. */
  challengeSignal?: string | null;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** A plain-language name for a recorded challenge marker (never the raw quoted marker). */
export function describeChallenge(signal: string | null | undefined): string | null {
  if (!signal) return null;
  if (/cloudflare|cf-mitigated/i.test(signal)) return "a Cloudflare challenge";
  if (/access denied/i.test(signal)) return "an Access Denied page";
  return "a bot challenge";
}

function failureText(be: NonNullable<Jurisdiction["blocked_evidence"]>, short = false): string {
  if (be.timeout_ms !== undefined) return `no answer within ${be.timeout_ms} ms`;
  if (be.http_status === undefined) return "network error, no HTTP response";
  if (be.http_status === 406 && !short) {
    return "HTTP 406, a content-negotiation refusal of the requested text/html, not a block";
  }
  return `HTTP ${be.http_status}`;
}

function whySentence(row: Jurisdiction, opts: ExplainOptions): string {
  const be = row.blocked_evidence;
  if (row.status === "blocked" && be) {
    const at = day(be.captured_at);
    if (be.outcome === "blocked") {
      if (be.timeout_ms !== undefined) {
        return `No permit history was captured: the official page did not answer within ${be.timeout_ms} ms on ${at}, and it is not requested again (no retry, no identity change)`;
      }
      const challenge = describeChallenge(opts.challengeSignal);
      return `No permit history was captured: the official site refused automated access with HTTP ${be.http_status ?? "none"}${challenge ? ` (${challenge})` : ""} on ${at}, and it is not requested again (no retry, no identity change, no challenge solved)`;
    }
    return `No permit history was captured: the official evidence page could not be read on ${at} (${failureText(be)}), so the permit system is known only from research`;
  }
  switch (row.status) {
    case "manual-only":
      return `No permit history can be captured: permits are filed in an account-based application portal that shows no public permit history${row.vendor ? ` (portal: ${row.vendor})` : ""}`;
    case "custodian-only":
      return "No permit history can be captured: permit files are kept on paper or in the office and no online permit system was found";
    case "delegated":
      return `No permit history of its own: permits here are issued by ${row.issued_by ?? "another body"}`;
    case "unavailable":
      return "No permit history can be captured: no permit records were found for this jurisdiction";
    default:
      return `No permit history is captured: the row is ${row.status}`;
  }
}

function austinClause(row: Jurisdiction): string {
  const here = row.austin_issued_located_here?.value;
  if (row.key === "austin" || typeof here !== "number" || here <= 0) return "";
  const owner = row.jurisdiction.endsWith("s") ? `${row.jurisdiction}'` : `${row.jurisdiction}'s`;
  const permits =
    here === 1
      ? "1 Austin-issued permit located here is"
      : `${here} Austin-issued permits located here are`;
  return `; ${owner} own permits are not captured, but ${permits} captured through ${AUSTIN_DATASET}`;
}

function triedSentence(row: Jurisdiction): string {
  const be = row.blocked_evidence;
  if (be) {
    return `Tried: one identified request to ${be.url} on ${day(be.captured_at)} (${failureText(be, true)}); evidence ${be.evidence_path}`;
  }
  const answer =
    row.evidence_http_status === undefined
      ? "with no recorded HTTP status"
      : `answered HTTP ${row.evidence_http_status}`;
  return `Tried: one identified request to the official page ${row.evidence_url} on ${day(row.evidence_captured_at)} ${answer}`;
}

function unblockSentence(row: Jurisdiction): string {
  const rr = row.records_request;
  if (rr) {
    const via = rr.request_portal_url ?? rr.request_email ?? "no recorded channel";
    return `To unblock: a records request to ${rr.recipient_office} via ${via}; ${NOT_FILED}`;
  }
  if (row.status === "delegated") {
    return `To unblock: nothing in this jurisdiction; the issuing body's records cover it (no request ${NOT_FILED})`;
  }
  return `To unblock: no lawful request route is recorded; no request is ${NOT_FILED}`;
}

/** The explanation for a non-supported row, or null for a supported row. */
export function explainJurisdiction(row: Jurisdiction, opts: ExplainOptions = {}): string | null {
  if (row.status === "supported") return null;
  return `${whySentence(row, opts)}${austinClause(row)}. ${triedSentence(row)}. ${unblockSentence(row)}.`;
}

/** The row with `blocked_explanation` set (non-supported) or removed (supported). */
export function withExplanation(row: Jurisdiction, opts: ExplainOptions = {}): Jurisdiction {
  const { blocked_explanation: _old, ...rest } = row;
  const text = explainJurisdiction(rest, opts);
  const out: Jurisdiction = { ...rest };
  if (text !== null) {
    // keep the explanation just before notes so the row reads in order
    const { notes, ...head } = out;
    return notes === undefined
      ? { ...head, blocked_explanation: text }
      : { ...head, blocked_explanation: text, notes };
  }
  return out;
}

/** Replaces the pre-decision blocked-row note wording; idempotent. */
export function migrateBlockedNote(notes: string | undefined): string | undefined {
  if (notes === undefined) return undefined;
  return LEGACY_BLOCKED_NOTES.reduce((text, old) => text.split(old).join(BLOCKED_NOTE), notes);
}
