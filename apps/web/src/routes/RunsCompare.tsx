// Runs · Compare (A-13 T015 stub, contracts/ui-routes.md): a react-router lazy route module exporting
// `Component`. Heading only until G2 (T020) builds the page; it holds no data and no placeholder value.
import type { ReactElement } from "react";

export function Component(): ReactElement {
  return (
    <section aria-label="Runs · Compare" data-route="runs-compare">
      <h2>Runs · Compare</h2>
    </section>
  );
}
