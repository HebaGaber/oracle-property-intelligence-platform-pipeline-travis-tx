// Hub (`/`; A-13 T035, US7, AC-9, FR-009, FR-020; research R6, R9): the CountyLens card (Open →
// Explore, What can I ask? → Help · MCP), the Roofing CRM card ("Coming soon · Not deployed yet"
// with a disabled button until `crmUrl` in /site-links.json is https), the run chip from
// runs/index.json only, and Watch demo / PR links only when their https URLs are set. The chip
// row and both cards reserve their height, so nothing shifts when the index arrives. The Hub
// reads two small JSON files and loads no heavy engine module. A
// react-router lazy route module exporting `Component`.
import { ROUTES } from "@countylens/shared/routes";
import { PAGE_TEXTS } from "@countylens/shared/texts";
import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { StatusPill } from "../components/StatusPill";
import { loadSiteLinks, type SiteLinks } from "../data/site-links";
import { HubIndexError, latestChip, loadHubRuns } from "../data/hub-index";
import styles from "./Hub.module.css";

type ChipState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly text: string }
  | { readonly kind: "error"; readonly reason: string };

export function Component(): ReactElement {
  const [chip, setChip] = useState<ChipState>({ kind: "loading" });
  const [links, setLinks] = useState<SiteLinks>({});

  useEffect(() => {
    const controller = new AbortController();
    loadHubRuns(controller.signal).then(
      (runs) => {
        const { n, finishedAt } = latestChip(runs);
        if (!controller.signal.aborted)
          setChip({ kind: "ready", text: PAGE_TEXTS.hubChip(n, finishedAt) });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const reason =
          error instanceof HubIndexError ? error.message : "the run index could not be read";
        setChip({ kind: "error", reason });
      },
    );
    loadSiteLinks({ signal: controller.signal }).then((loaded) => {
      if (!controller.signal.aborted) setLinks(loaded);
    });
    return () => controller.abort();
  }, []);

  return (
    <section aria-label="Hub" data-route="hub" data-state={chip.kind} className={styles.page}>
      <h2 className={styles.title}>Old roofs and long-open permits, from files you can verify</h2>
      <p className={styles.lead}>
        CountyLens shows Travis County, Texas property and roofing-permit records, each with its
        source and the published run it came from.
      </p>

      <div className={styles.chipRow}>
        {chip.kind === "loading" ? (
          <span className={styles.chipSkeleton} data-chip-skeleton="" aria-hidden="true" />
        ) : null}
        {chip.kind === "ready" ? (
          <StatusPill status="info" icon="history" text={chip.text} />
        ) : null}
        {chip.kind === "error" ? (
          <span role="alert" className={styles.cardBody}>
            Run index unavailable · {chip.reason}{" "}
            <a className={styles.link} href="/runs/index.json">
              /runs/index.json
            </a>
          </span>
        ) : null}
      </div>

      <div className={styles.cards}>
        <article className={styles.card} aria-labelledby="hub-countylens">
          <div>
            <h3 id="hub-countylens" className={styles.cardTitle}>
              CountyLens
            </h3>
            <p className={styles.cardBody}>
              Search properties near a place by roof age, open roofing permits and owner tenure.
            </p>
          </div>
          <div className={styles.actions}>
            <Link to={ROUTES.explore} className={styles.filled}>
              Open
            </Link>
            <Link to={ROUTES.helpMcp} className={styles.outlined}>
              What can I ask?
            </Link>
          </div>
        </article>

        <article className={styles.card} aria-labelledby="hub-crm">
          <div>
            <h3 id="hub-crm" className={styles.cardTitle}>
              Roofing CRM
            </h3>
            <p className={styles.cardBody}>
              {links.crmUrl === undefined
                ? PAGE_TEXTS.comingSoonNotDeployed
                : "Work the leads you found with CountyLens."}
            </p>
          </div>
          <div className={styles.actions}>
            {links.crmUrl === undefined ? (
              <button type="button" className={styles.filled} disabled aria-disabled="true">
                Open CRM
              </button>
            ) : (
              <a
                className={styles.filled}
                href={links.crmUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open CRM
              </a>
            )}
          </div>
        </article>
      </div>

      <nav className={styles.links} aria-label="More about CountyLens">
        {links.demoVideoUrl === undefined ? null : (
          <a
            className={styles.link}
            href={links.demoVideoUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Watch demo
          </a>
        )}
        {links.prUrl === undefined ? null : (
          <a className={styles.link} href={links.prUrl} target="_blank" rel="noopener noreferrer">
            PR
          </a>
        )}
        <Link className={styles.link} to={ROUTES.legalData}>
          Data sources
        </Link>
        <Link className={styles.link} to={ROUTES.legalPrivacy}>
          Privacy
        </Link>
        <Link className={styles.link} to={ROUTES.legalTerms}>
          Terms
        </Link>
      </nav>
    </section>
  );
}
