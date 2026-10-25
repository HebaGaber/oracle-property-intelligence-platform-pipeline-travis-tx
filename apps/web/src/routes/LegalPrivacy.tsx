// Legal · Privacy (`/legal/privacy`; A-13 T038, AC-11): static text, no data request. States
// facts about what the hosted app does; it is not legal advice. A lazy route module.
import type { ReactElement } from "react";
import { Link } from "react-router";
import { ROUTES } from "@countylens/shared/routes";
import { LEGAL_NOT_ADVICE } from "../content/legal";
import styles from "./LegalData.module.css";

export function Component(): ReactElement {
  return (
    <section aria-label="Legal · Privacy" data-route="legal-privacy" className={styles.page}>
      <h2 className={styles.title}>Legal · Privacy</h2>
      <p className={styles.body}>{LEGAL_NOT_ADVICE}</p>
      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>What CountyLens asks of you</h3>
        <p className={styles.body}>
          CountyLens has no accounts and no sign-in for visitors, and it asks for no personal
          details. Searching needs no name, email address or login.
        </p>
      </div>
      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>Where your browser connects</h3>
        <p className={styles.body}>
          To show published records your browser reads files from this site, from the CID copy of
          the published data, and from the public IPFS gateways named on the Data pages. Like any
          web host, those services can see your IP address and the files you request.
        </p>
      </div>
      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>What the records contain</h3>
        <p className={styles.body}>
          The records are collected from public sources. Each source and its terms are listed on the
          data sources page.
        </p>
        <Link className={styles.link} to={ROUTES.legalData}>
          Data sources
        </Link>
      </div>
    </section>
  );
}
