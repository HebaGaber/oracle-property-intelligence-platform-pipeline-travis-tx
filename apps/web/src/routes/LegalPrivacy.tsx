// Legal · Privacy (A-13 T015 stub, contracts/ui-routes.md): a react-router lazy route module exporting
// `Component`. Heading only until G3 (T038) builds the page; it holds no data and no placeholder value.
import type { ReactElement } from "react";

export function Component(): ReactElement {
  return (
    <section aria-label="Legal · Privacy" data-route="legal-privacy">
      <h2>Legal · Privacy</h2>
    </section>
  );
}
