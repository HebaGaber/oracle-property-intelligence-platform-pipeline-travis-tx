// A-03 T007 stub (interface fixed for T055/T056): Atlas § 9 Empty, reduced for A-03 (plan
// § "Atlas element map" → Extensions): headline-small title and one body-medium sentence; no
// illustration and no action (A-13 restores the full pattern). The Permits list shows it only
// when `coverage.permits_emitted.count` = 0 and 0 rows (TC-029). Render-only.
import type { ReactElement, ReactNode } from "react";

export interface EmptyStateProps {
  /** headline-small, verbatim from the fixed texts (e.g. PERMITS_TEXTS.empty). */
  readonly title: string;
  /** The one body-medium sentence (it may carry a CID element with `data-cid`). */
  readonly children: ReactNode;
}

export function EmptyState(_props: EmptyStateProps): ReactElement {
  throw new Error("not implemented");
}
