// Legal · Terms (A-13 T015 stub, contracts/ui-routes.md): a react-router lazy route module exporting
// `Component`. Heading only until G3 (T038) builds the page; it holds no data and no placeholder value.
import type { ReactElement } from "react";

export function Component(): ReactElement {
  return (
    <section aria-label="Legal · Terms" data-route="legal-terms">
      <h2>Legal · Terms</h2>
    </section>
  );
}
