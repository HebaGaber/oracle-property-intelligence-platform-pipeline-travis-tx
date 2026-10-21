// A-04 T023 (AC-4, FR-004): ownership tenure from the latest dated `sales[].saleDt`.
// `as_of` is the run's finishedAt date (RunContext.asOf), never now() inside the derivation.
// No dated sale → tenure_basis unknown, tenure_years / is_long_tenure null and reason
// no_dated_sale: such an owner is never counted as a long-tenure owner (disagreement #5).
export const LONG_TENURE_YEARS = 10;
const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;

export interface TenureFields {
  last_ownership_transfer_date: string | null;
  tenure_years: number | null;
  tenure_basis: "sale_date" | "unknown";
  tenure_missing_reason: "no_dated_sale" | null;
  is_long_tenure: boolean | null;
}

/** The YYYY-MM-DD of a printed sale date ("2015-07-07 00:00:00"), or null. */
export function saleDateOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso ? null : iso;
}

export function tenureOf(sales: ReadonlyArray<{ saleDt?: unknown }>, asOf: string): TenureFields {
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(asOfMs)) throw new Error(`tenure: as_of ${asOf} is not a date`);
  const dates = sales
    .map((s) => saleDateOf(s.saleDt))
    .filter((d): d is string => d !== null && Date.parse(`${d}T00:00:00Z`) <= asOfMs)
    .sort();
  const latest = dates[dates.length - 1];
  if (latest === undefined) {
    return {
      last_ownership_transfer_date: null,
      tenure_years: null,
      tenure_basis: "unknown",
      tenure_missing_reason: "no_dated_sale",
      is_long_tenure: null,
    };
  }
  const years = (asOfMs - Date.parse(`${latest}T00:00:00Z`)) / DAY_MS / YEAR_DAYS;
  const tenure = Math.round(years * 100) / 100;
  return {
    last_ownership_transfer_date: latest,
    tenure_years: tenure,
    tenure_basis: "sale_date",
    tenure_missing_reason: null,
    is_long_tenure: tenure > LONG_TENURE_YEARS,
  };
}
