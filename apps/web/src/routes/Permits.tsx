// A-03 T007 stub of the Permits list (`/permits`). T056 (G-C4) fills it per plan § "Atlas
// element map" → Permits list: the state machine loading → ready | empty | error, the engine
// line, cards below 600 px and the data table from 600 px. A react-router lazy route module:
// it exports `Component` and nothing else. No data, fixture or placeholder value lives here.
import type { ReactElement } from "react";

export function Component(): ReactElement {
  return <section aria-label="Permits" data-route="permits" />;
}
