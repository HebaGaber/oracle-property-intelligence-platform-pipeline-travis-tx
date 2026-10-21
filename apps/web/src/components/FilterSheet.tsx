// Explore · Filters controls (A-13 T025/T031; AC-4, AC-5, AC-8, FR-004, FR-004a, FR-008,
// FR-018). Every control reads and writes the URL (the caller's `onPatch`): the place combobox
// (gazetteer suggestions as `role=option`), Radius, Roof age, Open or stalled, Open ≥, Sort,
// Tenure and Out-of-area owner, each with an exact accessible name, plus the `ooa78753` preset
// (ZCTA 78753, tenure > 10, out-of-area). Tenure and out-of-area each carry a one-line definition.
// Below 840 px the controls collapse into a sheet behind a "Filters" button (aria-expanded); from
// 840 px they sit beside the results. Atlas outlined text fields, 48 px targets. Render-only.
import type { ResolvedPlace } from "@countylens/query-core";
import { useId, useState, type KeyboardEvent, type ReactElement } from "react";
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
  const typed = text.trim();
  const options = typed === "" ? [] : suggest(typed);
  const listId = `${id}-places`;

  const choose = (placeId: string): void => {
    setText("");
    onPatch({ place: placeId, at: null, sel: null });
  };
  const onPlaceKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const first = options[0];
    if (event.key === "Enter" && first !== undefined) {
      event.preventDefault();
      choose(first.id);
    }
  };
  const numberField = (key: FilterKey, label: string, unit: string, step: string): ReactElement => (
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
          min="0"
          value={value(key)}
          onChange={(e) => onPatch({ [key]: e.target.value } as FilterPatch)}
        />
        <span className={styles.unit}>{unit}</span>
      </span>
    </div>
  );

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
            autoComplete="off"
            placeholder="Travis County place or ZIP"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onPlaceKey}
          />
          <ul id={listId} role="listbox" aria-label="Places" className={styles.options}>
            {options.map((o) => (
              <li
                key={o.id}
                role="option"
                aria-selected="false"
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
            checked={openOrStalled}
            onChange={(e) => onPatch({ permit: e.target.checked ? "open_stalled" : null })}
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
            value={value("sort")}
            onChange={(e) => onPatch({ sort: e.target.value })}
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
            checked={ooa}
            onChange={(e) => onPatch({ ooa: e.target.checked })}
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
