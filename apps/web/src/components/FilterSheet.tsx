// Explore · Filters controls (A-13 T025/T031; AC-4, AC-5, AC-8, FR-004, FR-004a, FR-008,
// FR-018). Every control reads and writes the URL (the caller's `onPatch`): the place combobox
// (gazetteer suggestions as `role=option`), Radius, Roof age, Open or stalled, Open ≥, Sort,
// Tenure and Out-of-area owner, each with an exact accessible name, plus the `ooa78753` preset
// (ZCTA 78753, tenure > 10, out-of-area). Tenure and out-of-area each carry a one-line definition.
// Below 840 px the controls collapse into a sheet behind a "Filters" button (aria-expanded); from
// 840 px they sit beside the results. Atlas outlined text fields, 48 px targets. Render-only.
import { EXPLORE_BOUNDS } from "@countylens/query-core/explore";
import type { ResolvedPlace } from "@countylens/query-core/places";
import { useEffect, useId, useState, type KeyboardEvent, type ReactElement } from "react";
import styles from "./FilterSheet.module.css";

/** One-line filter definitions (FR-008, TC-036). */
export const FILTER_DEFINITIONS = Object.freeze({
  tenure:
    "Tenure: years since the latest dated sale on record; properties without one are left out and counted.",
  ooa: "Out-of-area owner: the owner's mailing ZIP is outside the Travis County area (owner_area_class).",
});

export const SORT_OPTIONS = Object.freeze([
  { value: "nearest", label: "Nearest" },
  { value: "open_desc", label: "Open longest" },
  { value: "roof_desc", label: "Oldest roof" },
] as const);

/** The `ooa78753` preset of AC-8: ZCTA 78753, tenure > 10 years, out-of-area owners. */
export const OOA_PRESET = Object.freeze({ id: "ooa78753", place: "78753", tenure: 10, ooa: true });

export type FilterKey = "place" | "r" | "roof" | "permit" | "openYrs" | "tenure" | "ooa" | "sort";
export type FilterPatch = Partial<Record<FilterKey | "at" | "sel", string | boolean | null>>;

/** One numeric control: its explore.search bounds, whether it takes whole numbers only, and whether an empty box means "no filter". */
interface NumberSpec {
  readonly bounds: readonly [number, number];
  readonly integer: boolean;
  readonly optional: boolean;
}
const NUMBER_SPECS: Readonly<Record<"r" | "roof" | "openYrs" | "tenure", NumberSpec>> = {
  r: { bounds: EXPLORE_BOUNDS.radiusMi, integer: false, optional: false },
  roof: { bounds: EXPLORE_BOUNDS.roof, integer: true, optional: true },
  openYrs: { bounds: EXPLORE_BOUNDS.openYrs, integer: false, optional: true },
  tenure: { bounds: EXPLORE_BOUNDS.tenure, integer: true, optional: true },
};

/** The URL value of typed text: clamped into the bounds (whole numbers rounded); null = not a number. */
export function committedNumber(text: string, spec: NumberSpec): string | null {
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n)) return null;
  const value = Math.min(
    spec.bounds[1],
    Math.max(spec.bounds[0], spec.integer ? Math.round(n) : n),
  );
  return String(value);
}

export interface FilterSheetProps {
  /** The current URL value of a control, or its default. */
  readonly value: (key: FilterKey) => string;
  readonly openOrStalled: boolean;
  readonly ooa: boolean;
  readonly onPatch: (patch: FilterPatch) => void;
  /** Gazetteer suggestions for the typed text (query-core searchPlaces). */
  readonly suggest: (text: string) => readonly ResolvedPlace[];
  /** Shown under the place box when the typed text is not a Travis County place. */
  readonly notFoundText: string;
}

export function FilterSheet({
  value,
  openOrStalled,
  ooa,
  onPatch,
  suggest,
  notFoundText,
}: FilterSheetProps): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(-1);
  // What the person is typing in a number box, until they leave it (the URL only takes valid numbers).
  const [drafts, setDrafts] = useState<Partial<Record<FilterKey, string>>>({});
  // The person's latest choice on the checkboxes and Sort, shown at once: the URL commits a moment
  // later and React would otherwise put the control back to its old value in between (ERR-39).
  // Cleared when the URL-derived value changes, or on blur if the patch never landed.
  const [pending, setPending] = useState<{ permit?: boolean; ooa?: boolean; sort?: string }>({});
  const sortUrl = value("sort");
  useEffect(() => setPending({}), [openOrStalled, ooa, sortUrl]);
  const clearPending = (key: "permit" | "ooa" | "sort"): void =>
    setPending((p) => {
      const { [key]: _gone, ...rest } = p;
      return rest;
    });
  const typed = text.trim();
  const options = typed === "" ? [] : suggest(typed);
  const listId = `${id}-places`;

  const choose = (placeId: string): void => {
    setText("");
    setActive(-1);
    onPatch({ place: placeId, at: null, sel: null });
  };
  const optionId = (index: number): string => `${id}-option-${index}`;
  const onPlaceKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const count = options.length;
    if (event.key === "Escape") {
      setText("");
      setActive(-1);
    } else if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      setActive((active + 1) % count);
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      setActive(active <= 0 ? count - 1 : active - 1);
    } else if (event.key === "Enter") {
      const chosen = options[active] ?? options[0];
      if (chosen !== undefined) {
        event.preventDefault();
        choose(chosen.id);
      }
    }
  };
  const numberField = (
    key: "r" | "roof" | "openYrs" | "tenure",
    label: string,
    unit: string,
    step: string,
  ): ReactElement => {
    const spec = NUMBER_SPECS[key];
    return (
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-${key}`}>
          {label}
        </label>
        <span className={styles.inputRow}>
          <input
            id={`${id}-${key}`}
            className={styles.input}
            type="number"
            inputMode="decimal"
            step={step}
            min={spec.bounds[0]}
            max={spec.bounds[1]}
            value={drafts[key] ?? value(key)}
            onChange={(e) => {
              const typed = e.target.value;
              setDrafts((d) => ({ ...d, [key]: typed }));
              if (typed.trim() === "" && spec.optional) onPatch({ [key]: null });
              else {
                const committed = committedNumber(typed, spec);
                if (committed !== null) onPatch({ [key]: committed });
              }
            }}
            onBlur={() =>
              setDrafts((d) => {
                const { [key]: _gone, ...rest } = d;
                return rest;
              })
            }
          />
          <span className={styles.unit}>{unit}</span>
        </span>
      </div>
    );
  };

  return (
    <div className={styles.sheet}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((o) => !o)}
      >
        Filters
      </button>
      <div id={`${id}-panel`} className={`${styles.panel} ${open ? styles.open : ""}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-place`}>
            Place
          </label>
          <input
            id={`${id}-place`}
            className={styles.input}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            {...(active >= 0 && active < options.length
              ? { "aria-activedescendant": optionId(active) }
              : {})}
            autoComplete="off"
            placeholder="Travis County place or ZIP"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(-1);
            }}
            onKeyDown={onPlaceKey}
          />
          <ul id={listId} role="listbox" aria-label="Places" className={styles.options}>
            {options.map((o, index) => (
              <li
                key={o.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                className={styles.option}
                onClick={() => choose(o.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") choose(o.id);
                }}
              >
                {o.label}
              </li>
            ))}
          </ul>
          {typed !== "" && options.length === 0 ? (
            <p className={styles.hint}>{notFoundText}</p>
          ) : null}
        </div>
        {numberField("r", "Radius", "mi", "0.25")}
        {numberField("roof", "Roof age", "yrs or older", "1")}
        <div className={styles.check}>
          <input
            id={`${id}-permit`}
            className={styles.box}
            type="checkbox"
            checked={pending.permit ?? openOrStalled}
            onChange={(e) => {
              setPending((p) => ({ ...p, permit: e.target.checked }));
              onPatch({ permit: e.target.checked ? "open_stalled" : null });
            }}
            onBlur={() => clearPending("permit")}
          />
          <label className={styles.label} htmlFor={`${id}-permit`}>
            Open or stalled
          </label>
        </div>
        {numberField("openYrs", "Open ≥", "yrs", "0.5")}
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-sort`}>
            Sort
          </label>
          <select
            id={`${id}-sort`}
            className={styles.input}
            value={pending.sort ?? sortUrl}
            onChange={(e) => {
              setPending((p) => ({ ...p, sort: e.target.value }));
              onPatch({ sort: e.target.value });
            }}
            onBlur={() => clearPending("sort")}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {numberField("tenure", "Tenure", "yrs or more (>)", "1")}
        <p className={styles.definition} data-filter-definition="tenure">
          {FILTER_DEFINITIONS.tenure}
        </p>
        <div className={styles.check}>
          <input
            id={`${id}-ooa`}
            className={styles.box}
            type="checkbox"
            checked={pending.ooa ?? ooa}
            onChange={(e) => {
              setPending((p) => ({ ...p, ooa: e.target.checked }));
              onPatch({ ooa: e.target.checked });
            }}
            onBlur={() => clearPending("ooa")}
          />
          <label className={styles.label} htmlFor={`${id}-ooa`}>
            Out-of-area owner
          </label>
        </div>
        <p className={styles.definition} data-filter-definition="ooa">
          {FILTER_DEFINITIONS.ooa}
        </p>
        <div className={styles.presets}>
          <button
            type="button"
            className={styles.chip}
            onClick={() =>
              onPatch({
                place: OOA_PRESET.place,
                at: null,
                tenure: String(OOA_PRESET.tenure),
                ooa: OOA_PRESET.ooa,
                sel: null,
              })
            }
          >
            {OOA_PRESET.id}
          </button>
        </div>
      </div>
    </div>
  );
}
