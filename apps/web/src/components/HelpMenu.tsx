// Header help menu (A-16 T050; Shell1440 board): the "?" icon button opens an Atlas § 7 menu with
// What can I ask? (Explore's first-visit card), Field glossary (the Data catalog's field tables),
// MCP and API docs and Data use and licences. The board's "Keyboard shortcuts" row is left out:
// the app defines no shortcuts. Escape, a pick or a click outside closes it; focus returns to "?".
import { ROUTES } from "@countylens/shared/routes";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { Link } from "react-router";
import { Icon } from "./Icon";
import styles from "./HelpMenu.module.css";

export const HELP_LABEL = "Help";

/** `?welcome=1` opens Explore's "What can I ask?" card even after it was dismissed. */
export const WELCOME_PATH = `${ROUTES.explore}?welcome=1`;

export const HELP_ITEMS: readonly {
  readonly label: string;
  readonly icon: string;
  readonly to: string;
}[] = [
  { label: "What can I ask?", icon: "lightbulb", to: WELCOME_PATH },
  { label: "Field glossary", icon: "menu_book", to: ROUTES.dataCatalog },
  { label: "MCP and API docs", icon: "integration_instructions", to: ROUTES.helpMcp },
  { label: "Data use and licences", icon: "license", to: ROUTES.legalData },
];

export function HelpMenu(): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("a")?.focus();
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("a") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  };
  return (
    <div className={styles.wrap}>
      <button
        ref={button}
        type="button"
        className={styles.icon}
        aria-label={HELP_LABEL}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="help" />
      </button>
      {open ? (
        <ul
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label={HELP_LABEL}
          className={styles.menu}
          onKeyDown={onKeyDown}
        >
          {HELP_ITEMS.map((item) => (
            <li key={item.label} role="none">
              <Link
                role="menuitem"
                to={item.to}
                className={styles.item}
                onClick={() => close(false)}
              >
                <Icon name={item.icon} />
                <span data-help-label="">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
