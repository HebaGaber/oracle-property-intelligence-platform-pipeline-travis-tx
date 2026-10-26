// An Explore result (A-13 T025/T027/T031; AC-4, AC-5, AC-7, AC-8, FR-004, FR-005, FR-007,
// FR-008, FR-022; ERR-20). `PropertyFields` is the description list shared by the result card
// and the Property drawer: one `[data-field]` cell per field holding only its value or its
// missing reason in words (contracts/ui-routes.md), never blank. `MissingSummary` groups the
// row's `missing` entries by reason and names their fields (ERR-20: "{fields}: {reason}"); a
// no-carrier entry reads "not published · no lexicon carrier". `RowProvenance` is the § 8 line
// (source, collected, table CID, run). `ResultRow` is the clickable Atlas card; Enter/Space or its
// Details button open the drawer. Every value comes from the explore.search row. Render-only.
import { MISSING_REASONS, type MissingReason as Reason } from "@countylens/contract";
import type { ExploreRow, MissingEntry } from "@countylens/query-core";
import { EXPLORE_TEXTS, missingLabel } from "@countylens/shared";
import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from "react";
import { CidDisplay } from "./CidDisplay";
import { ContractorBadge } from "./ContractorBadge";
import { MissingReason } from "./MissingReason";
import { PermitChip } from "./PermitChip";
import { Provenance } from "./Provenance";
import { StatusPill } from "./StatusPill";
import styles from "./ResultRow.module.css";

/** Shown in the permit cell of a property with no roofing permit in the run. */
export const NO_PERMIT_TEXT = "no roofing permit on this property in the current run";
/** Shown where a provenance value is absent from the row. */
const NOT_IN_ROW = "not in the published row";

const NO_CARRIER = "no_lexicon_carrier";

/** A gap pill: the reason in words, with the entry's field and reason as data. */
function Gap({
  text,
  short,
  reason,
  field,
}: {
  readonly text: string;
  /** The compact visible label; `text` stays the pill's text and tooltip. */
  readonly short?: string | undefined;
  readonly reason?: string | undefined;
  readonly field?: string | undefined;
}): ReactElement {
  const data: Record<string, string> = {};
  if (reason !== undefined) data["reason"] = reason;
  if (field !== undefined) data["field"] = field;
  return <StatusPill status="unavailable" text={text} data={data} short={short} />;
}

const isReason = (reason: string): reason is Reason =>
  (MISSING_REASONS as readonly string[]).includes(reason);

function missingFor(row: ExploreRow, field: string): MissingEntry | undefined {
  return row.missing.find((m) => m.field === field);
}

const ROOF_SHORT = "Roof age unknown";
const TENURE_SHORT = "Tenure unknown";
const BBB_SHORT = {
  not_checked: "BBB not checked",
  blocked: "BBB blocked",
  not_found: "No BBB profile",
} as const;

/** A roof gap for `field`: its own missing entry's label when the row has one, else roofUnknown. */
function gapFor(row: ExploreRow, field: string): ReactElement {
  const entry = missingFor(row, field);
  if (entry !== undefined && isReason(entry.reason) && entry.reason !== NO_CARRIER) {
    return <MissingReason field={entry.field} reason={entry.reason} short={ROOF_SHORT} />;
  }
  return (
    <Gap
      text={EXPLORE_TEXTS.roofUnknown}
      short={ROOF_SHORT}
      reason={entry?.reason}
      field={entry?.field}
    />
  );
}

export function bbbText(status: string | null, reason: string | null): string | null {
  switch (status) {
    case null:
      return null;
    case "not_checked":
      return EXPLORE_TEXTS.bbbNotChecked(reason ?? "");
    case "blocked":
      return EXPLORE_TEXTS.bbbBlocked;
    case "not_found":
      return EXPLORE_TEXTS.bbbNotFound;
    default:
      return `BBB ${status}`;
  }
}

function Cell({
  label,
  field,
  children,
}: {
  readonly label: string;
  readonly field: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={styles.cell}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value} data-field={field}>
        {children}
      </dd>
    </div>
  );
}

const unknownRoof = (basis: string | null): boolean => basis === null || basis === "unknown";

/** Every field a result row shows, in board order (the table, the card and the drawer). */
export type RowField =
  | "address"
  | "roof_age_years"
  | "roof_age_basis"
  | "roof_age_confidence"
  | "distance"
  | "lat_lon"
  | "permit"
  | "status_raw"
  | "contractor_name"
  | "contractor_resolution"
  | "bbb"
  | "tenure_years"
  | "tenure_basis"
  | "owner_area_class";

/** The field's label, as the card and drawer show it. */
export const FIELD_LABELS: Readonly<Record<RowField, string>> = {
  address: "Address",
  roof_age_years: "Roof age",
  roof_age_basis: "Basis",
  roof_age_confidence: "Confidence",
  distance: "Distance",
  lat_lon: "Lat, lon",
  permit: "Roofing permit",
  status_raw: "Status as printed",
  contractor_name: "Contractor as printed",
  contractor_resolution: "Contractor match",
  bbb: "BBB",
  tenure_years: "Tenure",
  tenure_basis: "Tenure basis",
  owner_area_class: "Owner area",
};

/** Whether the row has the field at all (permit, contractor and BBB cells exist only with data). */
export function hasField(row: ExploreRow, field: RowField): boolean {
  if (field === "status_raw") return row.permit !== null;
  if (field === "contractor_name" || field === "contractor_resolution")
    return row.contractor !== null;
  if (field === "bbb") return bbbText(row.bbb_status, row.bbb_status_reason) !== null;
  return true;
}

/** One field's value, or its missing reason in words (never blank). */
export function FieldValue({
  row,
  field,
}: {
  readonly row: ExploreRow;
  readonly field: RowField;
}): ReactElement | null {
  switch (field) {
    case "address":
      return (
        row.address ?? (
          <Gap
            text={EXPLORE_TEXTS.noCarrier}
            short="No address"
            reason={missingFor(row, "address")?.reason}
            field="address"
          />
        )
      );
    case "roof_age_years":
      return row.roof_age_years === null ? (
        gapFor(row, "roof_age_years")
      ) : (
        <>{`${row.roof_age_years} yrs`}</>
      );
    case "roof_age_basis":
      return unknownRoof(row.roof_age_basis) ? (
        gapFor(row, "roof_age_basis")
      ) : (
        <>{row.roof_age_basis}</>
      );
    case "roof_age_confidence":
      return row.roof_age_confidence === null ? (
        gapFor(row, "roof_age_confidence")
      ) : (
        <>{row.roof_age_confidence}</>
      );
    case "distance":
      return <>{`${row.dist_mi} mi ${row.bearing}`}</>;
    case "lat_lon":
      return <>{`${row.lat}, ${row.lon}`}</>;
    case "permit":
      return row.permit === null ? (
        <span>{NO_PERMIT_TEXT}</span>
      ) : (
        <PermitChip permit={row.permit} />
      );
    case "status_raw":
      return row.permit === null ? null : (
        <Gap
          text={EXPLORE_TEXTS.noCarrier}
          short="Status not published"
          reason={NO_CARRIER}
          field="permit.status_raw"
        />
      );
    case "contractor_name":
      return row.contractor === null ? null : (
        <Gap
          text={EXPLORE_TEXTS.noCarrier}
          short="Name not published"
          reason={NO_CARRIER}
          field="contractor.name_as_printed"
        />
      );
    case "contractor_resolution":
      return row.contractor === null ? null : (
        <ContractorBadge resolution={row.contractor.resolution} />
      );
    case "bbb": {
      const bbb = bbbText(row.bbb_status, row.bbb_status_reason);
      if (bbb === null) return null;
      return row.bbb_status === "not_checked" ||
        row.bbb_status === "blocked" ||
        row.bbb_status === "not_found" ? (
        <Gap
          text={bbb}
          short={BBB_SHORT[row.bbb_status]}
          reason={`bbb_${row.bbb_status}`}
          field="bbb_status"
        />
      ) : (
        <>{bbb}</>
      );
    }
    case "tenure_years":
      return row.tenure_years === null ? (
        <Gap
          text={EXPLORE_TEXTS.tenureUnknown}
          short={TENURE_SHORT}
          reason={missingFor(row, "tenure_years")?.reason}
        />
      ) : (
        <>{`${row.tenure_years} yrs`}</>
      );
    case "tenure_basis":
      return row.tenure_basis === null ? (
        <Gap text={EXPLORE_TEXTS.tenureUnknown} short={TENURE_SHORT} />
      ) : (
        <>{row.tenure_basis}</>
      );
    case "owner_area_class":
      return row.owner_area_class === null || row.owner_area_class === "unknown" ? (
        <Gap text={EXPLORE_TEXTS.ownerAreaUnknown} short="Owner area unknown" />
      ) : (
        <>{row.owner_area_class}</>
      );
  }
}

const CARD_FIELDS: readonly RowField[] = [
  "address",
  "roof_age_years",
  "roof_age_basis",
  "roof_age_confidence",
  "distance",
  "lat_lon",
  "permit",
  "status_raw",
  "contractor_name",
  "contractor_resolution",
  "bbb",
  "tenure_years",
  "tenure_basis",
  "owner_area_class",
];

export function PropertyFields({ row }: { readonly row: ExploreRow }): ReactElement {
  return (
    <dl className={styles.fields}>
      {CARD_FIELDS.filter((f) => hasField(row, f)).map((field) => (
        <Cell key={field} label={FIELD_LABELS[field]} field={field}>
          <FieldValue row={row} field={field} />
        </Cell>
      ))}
    </dl>
  );
}

/** ERR-20: the row's missing entries grouped by reason, each group naming its fields. */
export function MissingSummary({ row }: { readonly row: ExploreRow }): ReactElement | null {
  if (row.missing.length === 0) return null;
  const groups = new Map<string, string[]>();
  for (const m of row.missing) groups.set(m.reason, [...(groups.get(m.reason) ?? []), m.field]);
  return (
    <ul className={styles.missing} aria-label="Missing data">
      {[...groups].map(([reason, fields]) => {
        const label =
          reason === NO_CARRIER
            ? EXPLORE_TEXTS.noCarrier
            : isReason(reason)
              ? missingLabel(fields[0] ?? "", reason)
              : reason.replaceAll("_", " ");
        return (
          <li
            key={reason}
            className={styles.missingGroup}
            data-missing-group={reason}
            aria-label={`${fields.join(", ")}: ${label}`}
          >
            <code className={styles.fieldNames}>{fields.join(", ")}</code>
            {reason === NO_CARRIER || !isReason(reason) ? (
              <Gap
                text={label}
                short={reason === NO_CARRIER ? "Not published" : undefined}
                reason={reason}
              />
            ) : (
              <MissingReason field={fields[0] ?? ""} reason={reason} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RowProvenance({ row }: { readonly row: ExploreRow }): ReactElement {
  const p = row.provenance;
  return (
    <div data-provenance="">
      {p.table_cid !== null && p.captured_at !== null && p.run_id !== null ? (
        <Provenance
          sourceUrl={p.source_url}
          capturedAt={p.captured_at}
          tableCid={p.table_cid}
          runId={p.run_id}
        />
      ) : (
        <Provenance>
          Source: {p.source_url ?? <Gap text={NOT_IN_ROW} short="Not in row" />} · table{" "}
          {p.table_cid === null ? (
            <Gap text={NOT_IN_ROW} short="Not in row" />
          ) : (
            <CidDisplay cid={p.table_cid} />
          )}{" "}
          · run {p.run_id ?? <Gap text={NOT_IN_ROW} short="Not in row" />}
        </Provenance>
      )}
    </div>
  );
}

export interface ResultRowProps {
  readonly row: ExploreRow;
  readonly onSelect?: (propertyCid: string) => void;
  readonly selected?: boolean;
  /** False for a close match: it is outside the radius, so not a `[data-result-row]`. */
  readonly inRadius?: boolean;
}

export function ResultRow({
  row,
  onSelect,
  selected = false,
  inRadius = true,
}: ResultRowProps): ReactElement {
  const select = (): void => onSelect?.(row.property_cid);
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
  const titleId = `row-${row.property_cid}`;
  return (
    <article
      className={`${styles.row} ${selected ? styles.selected : ""}`}
      data-result-row={inRadius ? "" : undefined}
      data-property-cid={row.property_cid}
      aria-labelledby={titleId}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <header className={styles.head}>
        <h4 id={titleId} className={styles.title}>
          Property <CidDisplay cid={row.property_cid} />
        </h4>
        {onSelect === undefined ? null : (
          <button type="button" className={styles.details} onClick={select}>
            Details
          </button>
        )}
      </header>
      <PropertyFields row={row} />
      <MissingSummary row={row} />
      <RowProvenance row={row} />
    </article>
  );
}
