// Hub (`/`; A-13 T035, US7, AC-9, FR-009, FR-020; research R6, R9): the CountyLens card (Open →
// Explore, What can I ask? → Help · MCP), the Roofing CRM card ("Coming soon · Not deployed yet"
// with a disabled button until `crmUrl` in /site-links.json is https), the run chip from
// runs/index.json only, and Watch demo / PR links only when their https URLs are set. The chip
// row and both cards reserve their height, so nothing shifts when the index arrives. The Hub
// reads two small JSON files and loads no heavy engine module. A-16 T050 (Hub1440/768/390
// boards): "Open property data tools" hero with the run chip and the demo/PR buttons, each app card
// with its subtitle, status pill and three-item check list, the "Shared by both apps" tiles and the
// counties line. A react-router lazy route module exporting `Component`.
import { ROUTES } from "@countylens/shared/routes";
import { PAGE_TEXTS, RUNS_TEXTS } from "@countylens/shared/texts";
import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { Icon } from "../components/Icon";
import { StatusPill } from "../components/StatusPill";
import { loadSiteLinks, type SiteLinks } from "../data/site-links";
import { HubIndexError, latestChip, loadHubRuns } from "../data/hub-index";
import styles from "./Hub.module.css";

/** Hub1440 board: what each app does (no numbers: the chip is the Hub's only number). */
const COUNTYLENS_CHECKS = [
  "List with lat/lon and a source link per row",
  "Runs, coverage and verifiable CIDs",
  "MCP tools for Claude and other clients",
] as const;
const CRM_CHECKS = [
  "Explore with Map view, Filters and AI",
  "Search box with the same three modes",
  "Lead tools (visits, notes): coming soon",
] as const;
const SHARED_TILES = [
  {
    to: ROUTES.runs,
    icon: "history",
    title: "Runs and CIDs",
    text: "Every published run and its manifest CID",
  },
  {
    to: ROUTES.coverage,
    icon: "donut_small",
    title: "Coverage",
    text: "Loaded vs each source’s total",
  },
  {
    to: ROUTES.helpMcp,
    icon: "integration_instructions",
    title: "MCP and API",
    text: "Tools, schema, try a call",
  },
  {
    to: ROUTES.legalData,
    icon: "license",
    title: "Data use and licences",
    text: "Sources and how to cite",
  },
] as const;

function Checks({ items }: { readonly items: readonly string[] }): ReactElement {
  return (
    <ul className={styles.checks}>
      {items.map((item) => (
        <li key={item}>
          <Icon name="check" size="small" />
          {item}
        </li>
      ))}
    </ul>
  );
}

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
      <h2 className={styles.title}>Open property data tools</h2>
      <p className={styles.lead}>
        Two apps built on the same published runs. Every number traces back to a public source and a
        content ID you can check yourself.
      </p>

      <div className={styles.chipRow} role="status">
        {chip.kind === "loading" ? (
          <>
            <span className={styles.chipSkeleton} data-chip-skeleton="" aria-hidden="true" />
            <span className={styles.visuallyHidden}>Loading latest run</span>
          </>
        ) : null}
        {chip.kind === "ready" ? (
          <StatusPill status="info" icon="history" text={chip.text} />
        ) : null}
        {chip.kind === "error" ? (
          <span role="alert" className={styles.errorChip}>
            <StatusPill status="error" text={RUNS_TEXTS.indexUnavailable(chip.reason)} />{" "}
            <a className={styles.link} href="/runs/index.json">
              /runs/index.json
            </a>
          </span>
        ) : null}
      </div>

      {links.demoVideoUrl === undefined && links.prUrl === undefined ? null : (
        <div className={styles.heroActions}>
          {links.demoVideoUrl === undefined ? null : (
            <a
              className={styles.filled}
              href={links.demoVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Watch demo
            </a>
          )}
          {links.prUrl === undefined ? null : (
            <a
              className={styles.outlined}
              href={links.prUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              PR
            </a>
          )}
        </div>
      )}

      <div className={styles.cards}>
        <article className={styles.card} aria-labelledby="hub-countylens">
          <div>
            <h3 id="hub-countylens" className={styles.cardTitle}>
              CountyLens
            </h3>
            <p className={styles.cardSub}>Property data explorer</p>
            <StatusPill status="verified" icon="cloud_done" text="Live · Travis County" />
            <p className={styles.cardBody}>
              Find properties by area, roof age, permits and owner location. Ask in plain English or
              SQL, and check where each value came from.
            </p>
            <Checks items={COUNTYLENS_CHECKS} />
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
            <p className={styles.cardSub}>Leads and follow-up</p>
            <p className={styles.cardBody}>
              {links.crmUrl === undefined
                ? PAGE_TEXTS.comingSoonNotDeployed
                : "Work the leads you found with CountyLens."}
            </p>
            <Checks items={CRM_CHECKS} />
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

      <section className={styles.shared} aria-labelledby="hub-shared">
        <h3 id="hub-shared" className={styles.sharedTitle}>
          Shared by both apps
        </h3>
        <div className={styles.tiles}>
          {SHARED_TILES.map((tile) => (
            <Link key={tile.to} to={tile.to} className={styles.tile}>
              <Icon name={tile.icon} />
              <span className={styles.tileText}>
                <span className={styles.tileTitle}>{tile.title}</span>
                <span className={styles.tileBody}>{tile.text}</span>
              </span>
              <Icon name="chevron_right" />
            </Link>
          ))}
        </div>
      </section>

      <p className={styles.counties}>
        Counties: Travis County, TX live · other counties coming soon
      </p>

      <nav className={styles.links} aria-label="More about CountyLens">
        <Link className={styles.link} to={ROUTES.legalTerms}>
          Terms
        </Link>
        <Link className={styles.link} to={ROUTES.legalPrivacy}>
          Privacy
        </Link>
        <Link className={styles.link} to={ROUTES.legalData}>
          Data licences
        </Link>
      </nav>
    </section>
  );
}
