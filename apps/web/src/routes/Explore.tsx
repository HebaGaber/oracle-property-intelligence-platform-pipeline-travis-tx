// Explore (A-13 T015 stub, contracts/ui-routes.md): a react-router lazy route module exporting
// `Component`. Heading only until G2 (T025) builds the page; it holds no data and no placeholder value.
import type { ReactElement } from "react";

export function Component(): ReactElement {
  return (
    <section aria-label="Explore" data-route="explore">
      <h2>Explore</h2>
    </section>
  );
}
