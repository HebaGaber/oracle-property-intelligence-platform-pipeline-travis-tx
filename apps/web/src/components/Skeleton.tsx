// A-03 T007 stub (interface fixed for T042/T055/T056): Atlas § 9 Loading skeletons. The rows
// (table) or cards live in a `role="status" aria-busy="true"` container, carry no data cells
// and are never a `<table>`; the data table / cards mount only in `ready` (FR-008, TC-024).
// The page-level linear progress bar is a separate component (LinearProgress, T055).
import type { ReactElement } from "react";

export const DEFAULT_SKELETON_COUNT = 5;

export interface SkeletonProps {
  /** `rows` for the ≥ 600 px table layout, `cards` for compact widths and the Runs card. */
  readonly variant: "rows" | "cards";
  /** Number of placeholders; defaults to DEFAULT_SKELETON_COUNT. */
  readonly count?: number;
}

export function Skeleton(_props: SkeletonProps): ReactElement {
  throw new Error("not implemented");
}
