// Display helpers of the pages (A-03 T042, G-C3). Timestamps are shown as the manifest's own
// UTC ISO strings with a "UTC" suffix (TC-010 step 4);
// counts are printed as plain digits so tests can compare them with the manifest's numbers.

/** The ISO instant in UTC: the manifest value itself when it already ends in `Z`. */
export function utcTimestamp(iso: string): string {
  if (iso.endsWith("Z")) return iso;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toISOString();
}

/** A manifest count as digits (no grouping), shown with `tabular-nums`. */
export function formatCount(count: number): string {
  return String(count);
}
