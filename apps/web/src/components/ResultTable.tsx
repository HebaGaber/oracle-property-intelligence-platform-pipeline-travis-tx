// Explore results as the board's compact data table (Explore1440 board; PO 2026-10-26 "fix the
// table list styling"): one `tr[data-result-row]` per property (`data-property-cid`), one line of
// values per row: #, the address and owner (or why there is no address, and the short CID), roof age, its basis
// in short words, confidence, the roofing permit, distance, lat/lon, the compact provenance and a
// Details button. Values come from the same FieldValue the card and the drawer use, so a missing
// value shows its short pill with the reason. Row click opens the Property drawer. Shown from
// 1240 px (Explore picks it); the cards (ResultRow) below. Render-only.
import type { ExploreRow } from "@countylens/query-core";
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import { truncateCid } from "./CidDisplay";
import { Icon } from "./Icon";
import { CompactProvenance, FieldValue, plainWords } from "./ResultRow";
import styles from "./ResultTable.module.css";

/** The roof-age basis in the board's short words ("year built 1934"); null when unknown. */
export function shortBasis(row: ExploreRow): string | null {
  const basis = row.roof_age_basis;
  if (basis === null || basis === "unknown") return null;
  const words = basis === "built_year" ? "year built" : plainWords(basis);
  return basis !== "permit" && typeof row.year_built === "number"
    ? `${words} ${String(row.year_built)}`
    : words;
}

/** The board's roof marker: older roofs read warmer (≥ 25 yrs, ≥ 15 yrs, younger). */
function roofTone(years: number | null): string {
  if (years === null) return "";
  if (years >= 25) return styles.roofOld ?? "";
  if (years >= 15) return styles.roofAged ?? "";
  return styles.roofYoung ?? "";
}

function confidenceClass(value: string | null): string {
  if (value === "high") return styles.confHigh ?? "";
  if (value === "medium") return styles.confMedium ?? "";
  return styles.confLow ?? "";
}

export interface ResultTableProps {
  readonly rows: readonly ExploreRow[];
  /** 1-based number of the first row (the pager's offset). */
  readonly first: number;
  readonly onSelect: (propertyCid: string) => void;
  readonly selected: string | null;
  /** The run every row comes from, named once under the table. */
  readonly runId?: string;
}

export function ResultTable({
  rows,
  first,
  onSelect,
  selected,
  runId,
}: ResultTableProps): ReactElement {
  return (
    <div className={styles.box}>
      <table className={styles.table} aria-label="Results">
        {runId === undefined ? null : (
          <caption className={styles.caption} data-table-run={runId}>
            Every row is from run {runId}; each row names its source, collection date and table.
          </caption>
        )}
        <thead>
          <tr>
            <th scope="col" className={styles.num}>
              #
            </th>
            <th scope="col">Address</th>
            <th scope="col" className={styles.right}>
              Roof
            </th>
            <th scope="col">Basis</th>
            <th scope="col">Conf.</th>
            <th scope="col">Permit</th>
            <th scope="col" className={styles.right}>
              Mi
            </th>
            <th scope="col" className={styles.optional}>
              Lat, lon
            </th>
            <th scope="col" className={styles.optional}>
              Source
            </th>
            <th scope="col">
              <span className={styles.srOnly}>Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <Row
              key={row.property_cid}
              row={row}
              n={first + i}
              onSelect={onSelect}
              selected={selected === row.property_cid}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  row,
  n,
  onSelect,
  selected,
}: {
  readonly row: ExploreRow;
  readonly n: number;
  readonly onSelect: (cid: string) => void;
  readonly selected: boolean;
}): ReactElement {
  const select = (): void => onSelect(row.property_cid);
  const onClick = (event: MouseEvent<HTMLElement>): void => {
    if ((event.target as Element).closest("a, button") !== null) return;
    select();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  };
  const basis = shortBasis(row);
  return (
    <tr
      className={selected ? styles.selected : undefined}
      data-result-row=""
      data-property-cid={row.property_cid}
      tabIndex={0}
      aria-selected={selected}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <td className={styles.num}>{n}</td>
      <td>
        {/* Explore1440 board: the address, then the owner (the CID when there is no address). */}
        <span className={styles.stack}>
          <span data-field="address" className={styles.address}>
            <FieldValue row={row} field="address" />
          </span>
          <span className={styles.sub}>
            {typeof row.owner_name === "string" ? (
              row.owner_name
            ) : (
              <code className={styles.mono} title={row.property_cid}>
                {truncateCid(row.property_cid)}
              </code>
            )}
          </span>
        </span>
      </td>
      <td className={styles.right}>
        <span className={styles.roof}>
          <span className={`${styles.marker} ${roofTone(row.roof_age_years)}`} aria-hidden="true" />
          <span data-field="roof_age_years">
            <FieldValue row={row} field="roof_age_years" />
          </span>
        </span>
      </td>
      <td
        data-field="roof_age_basis"
        className={styles.basis}
        title={row.roof_age_basis ?? undefined}
      >
        {basis ?? <FieldValue row={row} field="roof_age_basis" />}
      </td>
      <td>
        {row.roof_age_confidence === null ? (
          <span data-field="roof_age_confidence">
            <FieldValue row={row} field="roof_age_confidence" />
          </span>
        ) : (
          <span
            className={`${styles.conf} ${confidenceClass(row.roof_age_confidence)}`}
            data-field="roof_age_confidence"
          >
            {row.roof_age_confidence}
          </span>
        )}
      </td>
      <td data-field="permit" className={styles.permit}>
        {row.permit === null ? (
          <span className={styles.sub}>No roofing permit</span>
        ) : (
          <FieldValue row={row} field="permit" />
        )}
      </td>
      <td data-field="distance" className={`${styles.right} ${styles.nowrap}`}>
        <FieldValue row={row} field="distance" />
      </td>
      <td data-field="lat_lon" className={`${styles.mono} ${styles.nowrap} ${styles.optional}`}>
        <FieldValue row={row} field="lat_lon" />
      </td>
      <td className={`${styles.source} ${styles.optional}`}>
        <CompactProvenance row={row} />
      </td>
      <td>
        <button
          type="button"
          className={styles.iconButton}
          onClick={select}
          aria-label={`Details, property ${row.property_cid}`}
          title="Open the property"
        >
          <Icon name="info" />
        </button>
      </td>
    </tr>
  );
}
