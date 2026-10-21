// The Property drawer (A-13 T025, `sel=`; AC-4, AC-5, FR-004b, FR-005, FR-007, FR-022; TC-030,
// TC-032, TC-034): a non-modal dialog beside the results (a full-width sheet at 390) with the
// property's CID, every field of the row (ResultRow's PropertyFields: value or reason in words,
// the permit chip, the contractor's resolution badge, the BBB line), the grouped missing data
// (ERR-20) and the § 8 provenance line. Close returns focus to the page and drops `sel`. It shows
// only the explore.search row; it fetches nothing and holds no licence line (AD-06).
import type { ExploreRow } from "@countylens/query-core";
import { useEffect, useId, useRef, type ReactElement } from "react";
import { CidDisplay } from "../components/CidDisplay";
import { MissingSummary, PropertyFields, RowProvenance } from "../components/ResultRow";
import styles from "./Explore.module.css";

export interface PropertyDrawerProps {
  readonly row: ExploreRow;
  readonly onClose: () => void;
}

export function PropertyDrawer({ row, onClose }: PropertyDrawerProps): ReactElement {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [row.property_cid]);
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
        <h3 id={titleId} className={styles.drawerTitle}>
          Property <CidDisplay cid={row.property_cid} />
        </h3>
        <button type="button" className={styles.tab} onClick={onClose}>
          Close
        </button>
      </header>
      <PropertyFields row={row} />
      <MissingSummary row={row} />
      <RowProvenance row={row} />
    </aside>
  );
}
