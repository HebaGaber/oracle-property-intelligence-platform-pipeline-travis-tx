// A-03 T007 stub (interface fixed for T042/T055/T056): Atlas § 9 Error: an error-container
// banner with the `error` icon, what failed, and "Retry"; the app bar and navigation keep
// working. `message` is one of the fixed texts (plan § "Fixed texts and config keys"): both
// hosts down, run index unreadable / empty, count mismatch, engine failure. Render-only.
import type { ReactElement } from "react";

export interface ErrorBannerProps {
  /** What failed, verbatim from the fixed texts. */
  readonly message: string;
  /** "Retry" re-runs the load; when absent the banner shows no action. */
  readonly onRetry?: () => void;
}

export function ErrorBanner(_props: ErrorBannerProps): ReactElement {
  throw new Error("not implemented");
}
