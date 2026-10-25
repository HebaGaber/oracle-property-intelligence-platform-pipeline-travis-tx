// Legal · Data sources (`/legal/data`; A-13 T038, AC-11, FR-011, D-8): the seven sources, each
// with a link to its official terms or licence page and the date and HTTP status it was checked,
// then the four access rules. Static text from content/legal.ts: no data request, no legal
// advice. A react-router lazy route module exporting `Component`.
import type { ReactElement } from "react";
import {
  ACCESS_RULES,
  ACCESS_RULES_HEADING,
  LEGAL_NOT_ADVICE,
  LEGAL_SOURCES,
} from "../content/legal";
import styles from "./LegalData.module.css";

export function Component(): ReactElement {
  return (
    <section aria-label="Legal · Data sources" data-route="legal-data" className={styles.page}>
      <h2 className={styles.title}>Legal · Data sources</h2>
      <p className={styles.body}>
        CountyLens publishes records collected from the seven public sources below.{" "}
        {LEGAL_NOT_ADVICE}
      </p>
      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>Sources</h3>
        <ul className={styles.list} aria-label="Data sources">
          {LEGAL_SOURCES.map((source) => (
            <li key={source.id} className={styles.item} data-source={source.id}>
              <strong>{source.name}</strong>
              <p className={styles.body}>{source.fact}</p>
              <a
                className={styles.link}
                href={source.termsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {source.termsLabel}
              </a>
              <p className={styles.small}>
                Page requested {source.checkedOn} · HTTP {source.checkedStatus}
              </p>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>{ACCESS_RULES_HEADING}</h3>
        <ul className={styles.rules} aria-label={ACCESS_RULES_HEADING}>
          {ACCESS_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
