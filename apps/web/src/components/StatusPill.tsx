// A-03 T007 stub (interface fixed for T042/T055, G-C3/G-C4): Atlas § 7 Badge / status pill,
// 24 px, corner-full, label-medium, icon plus text, colours from § 2.4. Used for the
// publication state (Info / pending, `schedule`), the fallback chip (Warning / partial,
// `warning`), and the contractor cell (Verified `check_circle` / Not available
// `do_not_disturb_on`). Render-only: it decides nothing (agent-design metagross § 8).
import type { ReactElement } from "react";

/** Atlas § 2.4 semantic statuses. */
export type StatusKind = "verified" | "warning" | "error" | "info" | "unavailable";

/** The § 2.4 default glyph per status; `icon` overrides it (e.g. `schedule` for pending). */
export const STATUS_ICONS: Readonly<Record<StatusKind, string>> = {
  verified: "check_circle",
  warning: "warning",
  error: "error",
  info: "info",
  unavailable: "do_not_disturb_on",
};

export interface StatusPillProps {
  readonly status: StatusKind;
  /** Visible text, verbatim from the fixed texts or the row value. */
  readonly text: string;
  /** Material Symbols Rounded glyph name; defaults to STATUS_ICONS[status]. */
  readonly icon?: string;
}

export function StatusPill(_props: StatusPillProps): ReactElement {
  throw new Error("not implemented");
}
