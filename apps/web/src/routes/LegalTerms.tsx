// Legal · Terms (`/legal/terms`; A-13 T038, AC-11): static text, no data request. Facts about
// how the published data may be read; it is not legal advice. A lazy route module.
import type { ReactElement } from "react";
import { Link } from "react-router";
import { ROUTES } from "@countylens/shared/routes";
import { LEGAL_NOT_ADVICE } from "../content/legal";
import styles from "./LegalData.module.css";

export function Component(): ReactElement {
  return (
    <section aria-label="Legal · Terms" data-route="legal-terms" className={styles.page}>
      <h2 className={styles.title}>Legal · Terms</h2>
      <p className={styles.body}>{LEGAL_NOT_ADVICE}</p>
      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>The data as published</h3>
        <p className={styles.body}>
          The records are shown as published, with the source, collection time and run behind each
          one. A missing value says why it is missing. Derived values, such as roof age, state their
          basis next to the value.
        </p>
      </div>
      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>Sources keep their own terms</h3>
        <p className={styles.body}>
          Each source publisher sets its own terms for its data. They are linked on the data sources
          page, and they apply to your use of the records.
        </p>
        <Link className={styles.link} to={ROUTES.legalData}>
          Data sources
        </Link>
      </div>
      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>No warranty</h3>
        <p className={styles.body}>
          CountyLens is provided as is, without warranty. Check a record against its source before
          relying on it.
        </p>
      </div>
    </section>
  );
}
