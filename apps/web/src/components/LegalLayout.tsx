// The legal pages' layout (A-16 T050; LegalData/LegalPrivacy/LegalTerms 1440/768/390 boards): an
// "On this page" table of contents (a side column from 1024 px, above the text below it) with a
// "Related" list of the other legal pages, the not-legal-advice banner, then one titled section
// per entry with an anchor the contents link to. Static text only. Render-only.
import { ROUTES } from "@countylens/shared/routes";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "./Icon";
import styles from "./LegalLayout.module.css";

export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
}

const RELATED = [
  { to: ROUTES.legalTerms, label: "Terms of use" },
  { to: ROUTES.legalPrivacy, label: "Privacy" },
  { to: ROUTES.legalData, label: "Data use and licences" },
] as const;

export function LegalLayout({
  current,
  banner,
  intro,
  sections,
}: {
  readonly current: string;
  readonly banner: string;
  readonly intro?: ReactNode;
  readonly sections: readonly LegalSection[];
}): ReactElement {
  return (
    <div className={styles.layout}>
      <nav className={styles.toc} aria-label="On this page">
        <p className={styles.tocTitle}>On this page</p>
        <ul className={styles.tocList}>
          {sections.map((s) => (
            <li key={s.id}>
              <a className={styles.tocLink} href={`#${s.id}`}>
                {s.title}
              </a>
            </li>
          ))}
        </ul>
        <p className={styles.tocTitle}>Related</p>
        <ul className={styles.tocList}>
          {RELATED.filter((r) => r.to !== current).map((r) => (
            <li key={r.to}>
              <Link className={styles.tocLink} to={r.to}>
                {r.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.text}>
        <p className={styles.banner} data-legal-banner="">
          <Icon name="info" size="medium" />
          <span>{banner}</span>
        </p>
        {intro}
        {sections.map((s) => (
          <section key={s.id} id={s.id} className={styles.section} aria-labelledby={`${s.id}-h`}>
            <h3 id={`${s.id}-h`} className={styles.sectionTitle}>
              {s.title}
            </h3>
            {s.body}
          </section>
        ))}
      </div>
    </div>
  );
}
