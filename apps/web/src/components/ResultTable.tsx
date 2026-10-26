// Explore results as the board's dense data table (A-16 T050; Explore1440 board; PO notes
// 2026-10-26: compact rows): one `tr[data-result-row]` per property (`data-property-cid`), each
// value in its `[data-field]` cell (the same FieldValue the card and drawer use, so a missing
// value shows its short pill with the reason as text and tooltip), the compact provenance
// (host · date, table CID, run) in the Source column and a Details icon button. The board's
// columns show by default; Owner area and Contractor are optional ("More fields" toggles; not
// named "Columns", or TC-033 ticks every checkbox on the page, filters included): their
// cells stay in the row, hidden, so every field is still in the DOM. Row click selects the
// property (opens the drawer). Shown from 1240 px; the compact cards (ResultRow) below.
import type { ExploreRow } from "@countylens/query-core";
import { useState, type MouseEvent, type ReactElement } from "react";
import { truncateCid } from "./CidDisplay";
import { Icon } from "./Icon";
import { CompactProvenance, FieldValue, hasField, type RowField } from "./ResultRow";
import styles from "./ResultTable.module.css";

/** Shown in the Contractor column of a row with no contractor and no BBB status. */
export const NO_CONTRACTOR_TEXT = "no contractor on record in this run";

type Optional = "owner" | "contractor";

const COLUMNS: readonly {
  readonly label: string;
  readonly fields: readonly RowField[];
  readonly optional?: Optional;
}[] = [
  { label: "Address", fields: ["address"] },
  { label: "Roof", fields: ["roof_age_years", "roof_age_basis"] },
  { label: "Conf.", fields: ["roof_age_confidence"] },
  { label: "Permit", fields: ["permit"] },
  { label: "Mi · lat, lon", fields: ["distance", "lat_lon"] },
  // Task B B-03: tenure (years since the last dated sale or deed) shows by default.
  { label: "Owned", fields: ["tenure_years", "tenure_basis"] },
  { label: "Owner area", fields: ["owner_area_class"], optional: "owner" },
  {
    label: "Contractor",
    fields: ["contractor_name", "contractor_resolution", "bbb"],
    optional: "contractor",
  },
];

const OPTIONAL_LABELS: Readonly<Record<Optional, string>> = {
  owner: "Owner area",
  contractor: "Contractor",
};

export interface ResultTableProps {
  readonly rows: readonly ExploreRow[];
  /** 1-based number of the first row (the pager's offset). */
  readonly first: number;
  readonly onSelect: (propertyCid: string) => void;
  readonly selected: string | null;
}

export function ResultTable({ rows, first, onSelect, selected }: ResultTableProps): ReactElement {
  const [shown, setShown] = useState<Readonly<Record<Optional, boolean>>>({
    owner: false,
    contractor: false,
  });
  const [menu, setMenu] = useState(false);
  return (
    <div className={styles.box}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.columns}
          aria-expanded={menu}
          aria-controls="result-columns"
          onClick={() => setMenu((m) => !m)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMenu(false);
          }}
        >
          <Icon name="view_list" size="medium" />
          More fields
        </button>
        {menu ? (
          <div
            id="result-columns"
            role="group"
            aria-label="Optional fields"
            className={styles.menu}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMenu(false);
            }}
          >
            {(["owner", "contractor"] as const).map((key) => (
              <label key={key} className={styles.check}>
                <input
                  type="checkbox"
                  checked={shown[key]}
                  onChange={() => setShown((s) => ({ ...s, [key]: !s[key] }))}
                />
                {OPTIONAL_LABELS[key]}
              </label>
            ))}
          </div>
        ) : null}
      </div>
      <div className={styles.scroll}>
        <table className={styles.table} aria-label="Results">
          <thead>
            <tr>
              <th scope="col">#</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.label}
                  scope="col"
                  hidden={c.optional !== undefined && !shown[c.optional]}
                >
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
                shown={shown}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  row,
  n,
  onSelect,
  selected,
  shown,
}: {
  readonly row: ExploreRow;
  readonly n: number;
  readonly onSelect: (cid: string) => void;
  readonly selected: boolean;
  readonly shown: Readonly<Record<Optional, boolean>>;
}): ReactElement {
  const select = (): void => onSelect(row.property_cid);
  const onClick = (event: MouseEvent<HTMLElement>): void => {
    if ((event.target as Element).closest("a, button") !== null) return;
    select();
  };
  return (
    <tr
      className={selected ? `${styles.row} ${styles.selected}` : styles.row}
      data-result-row=""
      data-property-cid={row.property_cid}
      onClick={onClick}
    >
      <td className={styles.num}>{n}</td>
      {COLUMNS.map((c) => {
        const present = c.fields.filter((f) => hasField(row, f));
        return (
          <td key={c.label} hidden={c.optional !== undefined && !shown[c.optional]}>
            <span className={styles.stack}>
              {present.length === 0 ? (
                <span className={styles.muted}>{NO_CONTRACTOR_TEXT}</span>
              ) : (
                present.map((field, j) => (
                  <span
                    key={field}
                    data-field={field}
                    className={j === 0 ? styles.value : `${styles.value} ${styles.muted}`}
                  >
                    <FieldValue row={row} field={field} />
                  </span>
                ))
              )}
              {c.label === "Address" ? (
                <code className={styles.cid} title={row.property_cid}>
                  {truncateCid(row.property_cid)}
                </code>
              ) : null}
            </span>
          </td>
        );
      })}
      <td className={styles.source}>
        <CompactProvenance row={row} />
      </td>
      <td>
        <button
          type="button"
          className={styles.details}
          onClick={select}
          aria-label={`Details, property ${row.property_cid}`}
        >
          <Icon name="info" />
        </button>
      </td>
    </tr>
  );
}
