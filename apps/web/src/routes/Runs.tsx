// A-03 T007 stub of the Runs page (`/runs`). T042 (G-C3) fills it per plan § "Atlas element
// map" → Runs page: the run card, provenance line, publication-state pill, sources, coverage
// rows, data groups and the "Server check" line. A react-router lazy route module: it exports
// `Component` and nothing else. No data, fixture or placeholder value lives here.
import type { ReactElement } from "react";

export function Component(): ReactElement {
  return <section aria-label="Runs" data-route="runs" />;
}
