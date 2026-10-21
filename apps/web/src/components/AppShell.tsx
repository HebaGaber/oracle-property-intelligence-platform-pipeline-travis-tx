// The shell of every page (A-03 T007; A-13 T015; plan § "Atlas element map" → Shell).
// Atlas § 7: top app bar (64 px, `surface`, title-large, elevation 2 on scroll) whose only
// control is the title, a link to the Hub (`/`); bottom navigation below 600 px and navigation
// rail from 600 px, each with the same pill indicator and the destinations Explore, Runs,
// Coverage and Data, plus More. More opens a sheet (bottom sheet at 390, side sheet from 600)
// listing the other pages and every Coming soon item (content/coming-soon.ts) with the
// "Coming soon" label. Escape or choosing a link closes it and focus returns to More.
// Layout and colours come only from tokens.css through AppShell.module.css.
// DOM order is banner, navigation, main (ERR-13: Tab reaches the rail before the page content);
// the grid areas place the bottom navigation below main on compact widths, so nothing moves.
import { ROUTES, comingSoonPath } from "@countylens/shared/routes";
import { PAGE_TEXTS } from "@countylens/shared/texts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type UIEvent,
} from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { COMING_SOON_ITEMS } from "../content/coming-soon";
import { MORE_PAGES } from "../routes/route-list";
import { CountySelect } from "./CountySelect";
import styles from "./AppShell.module.css";

export const APP_TITLE = "CountyLens";
export const MORE_LABEL = "More";

export interface Destination {
  readonly to: string;
  readonly label: string;
  /** Material Symbols Rounded glyph name (Atlas § 6). */
  readonly icon: string;
}

export const DESTINATIONS: readonly Destination[] = [
  { to: ROUTES.explore, label: "Explore", icon: "travel_explore" },
  { to: ROUTES.runs, label: "Runs", icon: "history" },
  { to: ROUTES.coverage, label: "Coverage", icon: "fact_check" },
  { to: ROUTES.dataManifest, label: "Data", icon: "database" },
];

function Glyph({ name }: { readonly name: string }): ReactElement {
  return (
    <span className="material-symbols-rounded" aria-hidden="true">
      {name}
    </span>
  );
}

function MoreSheet({ onClose }: { readonly onClose: () => void }): ReactElement {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.focus();
  }, []);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      // Focus trap: Tab and Shift+Tab cycle inside the sheet.
      const items = Array.from(sheet.current?.querySelectorAll<HTMLElement>("a[href]") ?? []);
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === sheet.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );
  return (
    <div
      ref={sheet}
      id="more-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={MORE_LABEL}
      tabIndex={-1}
      className={styles.sheet}
      onKeyDown={onKeyDown}
    >
      <h2 className={styles.sheetTitle}>Pages</h2>
      <ul className={styles.sheetList}>
        {MORE_PAGES.map((page) => (
          <li key={page.path}>
            <Link to={page.path} className={styles.sheetItem} onClick={onClose}>
              {page.title}
            </Link>
          </li>
        ))}
      </ul>
      <h2 className={styles.sheetTitle}>Planned</h2>
      <ul className={styles.sheetList}>
        {COMING_SOON_ITEMS.map((item) => (
          <li key={item.id}>
            {item.linked ? (
              <Link to={comingSoonPath(item.id)} className={styles.sheetItem} onClick={onClose}>
                <span>{item.title}</span>
                <span className={styles.soon}>{PAGE_TEXTS.comingSoon}</span>
              </Link>
            ) : (
              <span className={styles.sheetItem}>
                <span>{item.title}</span>
                <span className={styles.soon}>{PAGE_TEXTS.comingSoon}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AppShell(): ReactElement {
  // The main region is the scroll container (the bottom navigation stays in view on compact
  // widths without a non-token padding), so the bar's elevation follows its scroll offset.
  const [scrolled, setScrolled] = useState(false);
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    setScrolled(event.currentTarget.scrollTop > 0);
  }, []);
  // The location slot (county selector) sits at the top of the page region under `/tx/…`; the
  // app bar keeps the title as its only control.
  const inCounty = useLocation().pathname.startsWith("/tx/");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  // Return focus to More after the background is no longer inert (an inert element cannot take
  // focus), so this runs after the render that closes the sheet.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !moreOpen) moreButton.current?.focus();
    wasOpen.current = moreOpen;
  }, [moreOpen]);

  return (
    <div className={styles.shell}>
      <header
        inert={moreOpen}
        className={scrolled ? `${styles.bar} ${styles.barScrolled}` : styles.bar}
      >
        <h1 className={styles.title}>
          <Link to={ROUTES.hub} className={styles.titleLink}>
            {APP_TITLE}
          </Link>
        </h1>
      </header>
      <nav className={styles.nav} aria-label="Primary" inert={moreOpen}>
        {DESTINATIONS.map((destination) => (
          <NavLink
            key={destination.to}
            to={destination.to}
            className={({ isActive }) =>
              isActive ? `${styles.item} ${styles.itemActive}` : styles.item
            }
          >
            <span className={styles.pill}>
              <Glyph name={destination.icon} />
            </span>
            <span className={styles.label}>{destination.label}</span>
          </NavLink>
        ))}
        <button
          ref={moreButton}
          type="button"
          className={styles.more}
          aria-expanded={moreOpen}
          aria-controls="more-sheet"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className={styles.pill}>
            <Glyph name="more_horiz" />
          </span>
          <span className={styles.label}>{MORE_LABEL}</span>
        </button>
      </nav>
      {moreOpen ? (
        <>
          <div className={styles.scrim} data-more-scrim="" onClick={closeMore} aria-hidden="true" />
          <MoreSheet onClose={closeMore} />
        </>
      ) : null}
      <main className={styles.main} onScroll={onScroll} inert={moreOpen}>
        {inCounty ? <CountySelect /> : null}
        <Outlet />
      </main>
    </div>
  );
}
