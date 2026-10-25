// Explore results as the board's dense data table (A-16 T050; Explore1440/768 boards): one
// `tr[data-result-row]` per property (`data-property-cid`), each value in its `[data-field]` cell
// (the same FieldValue the card and drawer use, so a missing value shows its reason), the row
// provenance line in the Source column and a Details button. Row click, Enter or Space selects
// the property (opens the drawer). Shown from 840 px; the cards (ResultRow) below. Render-only.
import type { ExploreRow } from "@countylens/query-core";
import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import { CidDisplay } from "./CidDisplay";
import { FieldValue, RowProvenance, hasField, type RowField } from "./ResultRow";
import styles from "./ResultTable.module.css";

/** Shown in the Contractor column of a row with no contractor and no BBB status. */
export const NO_CONTRACTOR_TEXT = "no contractor on record in this run";

const COLUMNS: readonly { readonly label: string; readonly fields: readonly RowField[] }[] = [
  { label: "Address", fields: ["address"] },
  { label: "Roof", fields: ["roof_age_years", "roof_age_basis"] },
  { label: "Conf.", fields: ["roof_age_confidence"] },
  { label: "Permit", fields: ["permit", "status_raw"] },
  { label: "Mi", fields: ["distance"] },
  { label: "Lat, lon", fields: ["lat_lon"] },
  { label: "Owner", fields: ["tenure_years", "tenure_basis", "owner_area_class"] },
  { label: "Contractor", fields: ["contractor_name", "contractor_resolution", "bbb"] },
];

export interface ResultTableProps {
  readonly rows: readonly ExploreRow[];
  /** 1-based number of the first row (the pager's offset). */
  readonly first: number;
  readonly onSelect: (propertyCid: string) => void;
  readonly selected: string | null;
}

export function ResultTable({ rows, first, onSelect, selected }: ResultTableProps): ReactElement {
  return (
    <div className={styles.scroll}>
      <table className={styles.table} aria-label="Results">
        <thead>
          <tr>
            <th scope="col">#</th>
            {COLUMNS.map((c) => (
              <th key={c.label} scope="col">
                {c.label}
              </th>
            ))}
            <th scope="col">Source</th>
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
  return (
    <tr
      className={selected ? `${styles.row} ${styles.selected}` : styles.row}
      data-result-row=""
      data-property-cid={row.property_cid}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <td className={styles.num}>{n}</td>
      {COLUMNS.map((c) => {
        const present = c.fields.filter((f) => hasField(row, f));
        return (
          <td key={c.label}>
            <span className={styles.stack}>
              {present.length === 0 ? (
                <span className={styles.muted}>{NO_CONTRACTOR_TEXT}</span>
              ) : (
                present.map((field) => (
                  <span key={field} data-field={field} className={styles.value}>
                    <FieldValue row={row} field={field} />
                  </span>
                ))
              )}
              {c.label === "Address" ? <CidDisplay cid={row.property_cid} /> : null}
            </span>
          </td>
        );
      })}
      <td className={styles.source}>
        <RowProvenance row={row} />
      </td>
      <td>
        <button
          type="button"
          className={styles.details}
          onClick={select}
          aria-label={`Details, property ${row.property_cid}`}
        >
          Details
        </button>
      </td>
    </tr>
  );
}
