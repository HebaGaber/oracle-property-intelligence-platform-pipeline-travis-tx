// The Property drawer (A-13 T025, `sel=`; AC-4, AC-5, FR-004b, FR-005, FR-007, FR-022; TC-030,
// TC-032, TC-034; A-16 T050 per the Property1440/768/390 boards): a non-modal dialog beside the
// results (a full-width sheet at 390). Board order: title (the address, or "Property" + CID while
// the export carries no address, with that reason), the chip row (roof age · confidence, the
// permit chip, out-of-area owner), the Street View box (Coming soon: no imagery source), the
// actions (Show in the list, Ask about this property → the AI tab with the question filled in),
// the Roof section with its evidence chain (basis → source → captured → table CID), then every
// field of the row (PropertyFields), the grouped missing data (ERR-20) and the § 8 provenance
// line. Close returns focus to the page and drops `sel`. It shows only the explore.search row;
// it fetches nothing and holds no licence line (AD-06).
import type { ExploreRow } from "@countylens/query-core";
import { EXPLORE_TEXTS } from "@countylens/shared";
import { useEffect, useId, useRef, type ReactElement } from "react";
import { Link } from "react-router";
import { ComingSoonEntries } from "../components/ComingSoonEntry";
import { CidDisplay } from "../components/CidDisplay";
import { Icon } from "../components/Icon";
import { PermitChip } from "../components/PermitChip";
import { MissingSummary, PropertyFields, RowProvenance } from "../components/ResultRow";
import { StatusPill } from "../components/StatusPill";
import { askPath } from "../components/WelcomeCard";
import styles from "./Explore.module.css";

export interface PropertyDrawerProps {
  readonly row: ExploreRow;
  readonly onClose: () => void;
}

/** Property390NoImagery board: the Street View box text (no imagery source in this release). */
export const STREET_VIEW_TEXT = "No street photo yet. The property data below is unaffected.";

/** The question "Ask about this property" puts in the AI box (never sent until Ask). */
export const askAboutProperty = (cid: string): string =>
  `Tell me about property ${cid}: roof age and its basis, roofing permits, owner tenure, with sources.`;

const host = (url: string | null): string | null => {
  if (url === null) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

export function PropertyDrawer({ row, onClose }: PropertyDrawerProps): ReactElement {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [row.property_cid]);
  const p = row.provenance;
  const showInList = (): void => {
    const target = document.querySelector<HTMLElement>(
      `[data-result-row][data-property-cid="${CSS.escape(row.property_cid)}"]`,
    );
    target?.scrollIntoView({ block: "center" });
    target?.focus();
  };
  const outOfArea = row.owner_area_class !== null && /out/i.test(row.owner_area_class);
  const sourceHost = host(p.source_url);
  return (
    <aside
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={styles.drawer}
      data-property-cid={row.property_cid}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <header className={styles.drawerHead}>
        <div className={styles.drawerTitleBlock}>
          <h3 id={titleId} className={styles.drawerTitle}>
            {row.address ?? "Property"} <CidDisplay cid={row.property_cid} />
          </h3>
          {row.address === null ? (
            <p className={styles.engine} data-address-reason="">
              Address: {EXPLORE_TEXTS.noCarrier}
            </p>
          ) : null}
        </div>
        <button type="button" className={styles.tab} onClick={onClose}>
          Close
        </button>
      </header>

      <div className={styles.chipRow} data-drawer-chips="">
        {row.roof_age_years === null ? (
          <StatusPill status="unavailable" text={EXPLORE_TEXTS.roofUnknown} />
        ) : (
          <StatusPill
            status="info"
            icon="roofing"
            text={`Roof ${row.roof_age_years} yrs${
              row.roof_age_confidence === null ? "" : ` · ${row.roof_age_confidence}`
            }`}
          />
        )}
        {row.permit === null ? null : <PermitChip permit={row.permit} />}
        {outOfArea ? <StatusPill status="warning" icon="flight" text="Out-of-area owner" /> : null}
      </div>

      <div className={styles.streetView} data-street-view="">
        <Icon name="no_photography" />
        <div>
          <p className={styles.streetTitle}>Street View: coming soon</p>
          <p className={styles.engine}>{STREET_VIEW_TEXT}</p>
        </div>
      </div>

      <div className={styles.drawerActions}>
        <button type="button" className={styles.outlinedButton} onClick={showInList}>
          <Icon name="view_list" size="medium" />
          Show in the list
        </button>
        <Link to={askPath(askAboutProperty(row.property_cid))} className={styles.tonalButton}>
          <Icon name="smart_toy" size="medium" />
          Ask about this property
        </Link>
      </div>

      <section className={styles.drawerSection} aria-label="Roof">
        <h4 className={styles.sectionTitle}>Roof</h4>
        <p className={styles.engine}>Evidence chain</p>
        <ol className={styles.chain} data-evidence-chain="">
          <li>
            {row.roof_age_basis === null || row.roof_age_basis === "unknown"
              ? EXPLORE_TEXTS.roofUnknown
              : row.roof_age_basis}
          </li>
          <li>
            <Icon name="arrow_forward" size="small" />
            {sourceHost ?? "source not in the published row"}
          </li>
          <li>
            <Icon name="arrow_forward" size="small" />
            {p.captured_at === null
              ? "capture date not in the row"
              : `Captured ${p.captured_at.slice(0, 10)}`}
          </li>
          <li>
            <Icon name="arrow_forward" size="small" />
            {p.table_cid === null ? "table CID not in the row" : <CidDisplay cid={p.table_cid} />}
          </li>
        </ol>
      </section>

      <section className={styles.drawerSection} aria-label="All fields">
        <h4 className={styles.sectionTitle}>Fields</h4>
        <PropertyFields row={row} />
        <MissingSummary row={row} />
        <RowProvenance row={row} />
      </section>
      <ComingSoonEntries ids={["street-view", "similar-properties"]} />
    </aside>
  );
}
