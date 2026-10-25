// A-11 Run 3 (PO decisions 2026-10-25, FU-A-01): the contractor name AS PRINTED on an Austin permit
// and a plain BBB SEARCH link built from it. Neither is an identity claim:
//   - the printed name is evidence, "as printed, unverified"; it is never a `company` record, and
//     contractor_resolution stays 'unresolved' (Oracle rule: do not persist a contractor copied
//     from the permit);
//   - the link is a string we build. This module never requests bbb.org (A-01 receipts: HTTP 403
//     Cloudflare challenge). The BBB rating therefore stays missing, with bbb_status = 'blocked'
//     and bbb_status_reason = 'bbb_blocked'.
//
// URL SHAPE IS UNVERIFIED. The search URL below is BBB's public search page as we understand it;
// no automated request was made to check it. A human must click one example in a browser before
// any link ships. If BBB's shape differs, only BBB_SEARCH_BASE and `bbbSearchUrl` change.
//
// Pure functions, no I/O.

/** Unverified BBB public search page (see the header). */
export const BBB_SEARCH_BASE = "https://www.bbb.org/search";

/** Longest printed name that goes into a link; longer names are cut at a word boundary. */
export const MAX_NAME_CHARS = 120;

/** City used in the link when the permit prints no contractor city (the permit authority's city). */
export const DEFAULT_BBB_CITY = "Austin";

/** Printed values that mean "no contractor" (compared after upper-casing and trimming punctuation). */
const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
  "N/A",
  "NA",
  "N A",
  "NONE",
  "NULL",
  "NO",
  "NIL",
  "UNKNOWN",
  "TBD",
  "TO BE DETERMINED",
  "OWNER",
  "SELF",
  "HOMEOWNER",
  "HOME OWNER",
  "OWNER BUILDER",
  "OWNER/BUILDER",
  "OWNER BUILT",
  "THE OWNER",
  "SAME",
  "SAME AS ABOVE",
  "-",
]);

/** Trim and collapse inner whitespace; null for missing input. */
export function cleanPrinted(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = value.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** True when the printed text is empty or a placeholder such as N/A, OWNER or SELF. */
export function isPlaceholderName(value: string | null | undefined): boolean {
  const s = cleanPrinted(value);
  if (s === null) return true;
  const key = s.toUpperCase().replace(/^[\s.\-_*]+|[\s.\-_*]+$/g, "");
  if (key === "") return true;
  if (PLACEHOLDER_NAMES.has(key)) return true;
  // Punctuation only, for example "...".
  return !/[\p{L}\p{N}]/u.test(key);
}

/** Percent-encode one query value: RFC 3986 unreserved characters stay, everything else is escaped. */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Austin clerks append markers such as "**MAIN**" or "***DO NOT USE***" to a printed name. They are
 * not part of the business name, so the SEARCH text drops them; the published printed name keeps
 * them verbatim ("as printed").
 */
function searchText(name: string): string {
  return (cleanPrinted(name.replace(/\*+[^*]*\*+/g, " ").replace(/\*/g, " ")) ?? "").trim();
}

/** Cut a name to MAX_NAME_CHARS code points, at a word boundary when one is near. */
function limitName(name: string): string {
  const points = Array.from(name);
  if (points.length <= MAX_NAME_CHARS) return name;
  const head = points.slice(0, MAX_NAME_CHARS).join("");
  const space = head.lastIndexOf(" ");
  return (space > MAX_NAME_CHARS / 2 ? head.slice(0, space) : head).trim();
}

/**
 * The BBB search link for a printed contractor name and city, or null when the name is empty or a
 * placeholder. City falls back to DEFAULT_BBB_CITY; the state is always TX (Austin permits).
 * UNVERIFIED shape: a human must click one example before it ships.
 */
export function bbbSearchUrl(
  name: string | null | undefined,
  city: string | null | undefined,
): string | null {
  if (isPlaceholderName(name)) return null;
  const text = searchText(name as string);
  if (isPlaceholderName(text)) return null;
  const printed = limitName(text);
  const place = cleanPrinted(city) ?? DEFAULT_BBB_CITY;
  return (
    `${BBB_SEARCH_BASE}?find_country=USA` +
    `&find_text=${encodeValue(printed)}` +
    `&find_loc=${encodeValue(`${place}, TX`)}` +
    `&find_type=Category`
  );
}

/** The permit fields this module reads (Austin 3syk-w9eu, as stored in permit_source_rows.payload). */
export type PrintedContractorSource = Readonly<Record<string, string | null | undefined>>;

/** The BBB part of a row: v1.1 columns bbb_url, bbb_status, bbb_status_reason. */
export interface BbbSearchFields {
  bbb_url: string | null;
  bbb_status: "blocked" | "not_checked";
  /** 'bbb_blocked' when a link exists, 'contractor_unresolved' when there is no printed name. */
  bbb_status_reason: "bbb_blocked" | "contractor_unresolved";
}

/**
 * What the permit prints about its contractor, as printed and unverified. No phone, no person
 * name (a private individual), no street address: only the company name, city, the source's own
 * status word and expiry date.
 */
export interface PrintedContractor extends BbbSearchFields {
  contractor_name_as_printed: string | null;
  contractor_city: string | null;
  /** Austin `status_current` verbatim (trimmed), for example "Expired". */
  permit_status_raw: string | null;
  /** Austin `expiresdate`, the date part (YYYY-MM-DD). */
  permit_expiry_date: string | null;
}

function datePart(value: string | null | undefined): string | null {
  const s = cleanPrinted(value);
  if (s === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(s);
  return m ? (m[1] as string) : null;
}

/** Reads one stored Austin permit payload; never throws, never invents a value. */
export function printedContractorOf(row: PrintedContractorSource): PrintedContractor {
  const raw = row.contractor_company_name;
  const name = isPlaceholderName(raw) ? null : cleanPrinted(raw);
  const city = name === null ? null : cleanPrinted(row.contractor_city);
  const url = bbbSearchUrl(name, city);
  return {
    contractor_name_as_printed: name,
    contractor_city: city,
    permit_status_raw: cleanPrinted(row.status_current),
    permit_expiry_date: datePart(row.expiresdate),
    bbb_url: url,
    bbb_status: url === null ? "not_checked" : "blocked",
    bbb_status_reason: url === null ? "contractor_unresolved" : "bbb_blocked",
  };
}
