// The shell of both pages (A-03 T007; plan § "Atlas element map" → Shell).
// Atlas § 7: top app bar (64 px, `surface`, title-large, elevation 2 on scroll; nothing else in
// the bar in A-03), bottom navigation below 600 px and navigation rail from 600 px, each with
// the same pill indicator and the two destinations Runs and Permits (no locked "Coming soon"
// items until A-13). Layout and colours come only from tokens.css through AppShell.module.css.
// DOM order is banner, navigation, main (ERR-13: Tab reaches the rail before the page content);
// the grid areas place the bottom navigation below main on compact widths, so nothing moves.
import { useCallback, useState, type ReactElement, type UIEvent } from "react";
import { NavLink, Outlet } from "react-router";
import styles from "./AppShell.module.css";

export const APP_TITLE = "CountyLens";

export interface Destination {
  readonly to: "/runs" | "/permits";
  readonly label: string;
  /** Material Symbols Rounded glyph name (Atlas § 6). */
  readonly icon: string;
}

export const DESTINATIONS: readonly Destination[] = [
  { to: "/runs", label: "Runs", icon: "history" },
  { to: "/permits", label: "Permits", icon: "receipt_long" },
];

export function AppShell(): ReactElement {
  // The main region is the scroll container (the bottom navigation stays in view on compact
  // widths without a non-token padding), so the bar's elevation follows its scroll offset.
  const [scrolled, setScrolled] = useState(false);
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    setScrolled(event.currentTarget.scrollTop > 0);
  }, []);

  return (
    <div className={styles.shell}>
      <header className={scrolled ? `${styles.bar} ${styles.barScrolled}` : styles.bar}>
        <h1 className={styles.title}>{APP_TITLE}</h1>
      </header>
      <nav className={styles.nav} aria-label="Primary">
        {DESTINATIONS.map((destination) => (
          <NavLink
            key={destination.to}
            to={destination.to}
            className={({ isActive }) =>
              isActive ? `${styles.item} ${styles.itemActive}` : styles.item
            }
          >
            <span className={styles.pill}>
              <span className="material-symbols-rounded" aria-hidden="true">
                {destination.icon}
              </span>
            </span>
            <span className={styles.label}>{destination.label}</span>
          </NavLink>
        ))}
      </nav>
      <main className={styles.main} onScroll={onScroll}>
        <Outlet />
      </main>
    </div>
  );
}
