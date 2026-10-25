// County selector (A-13 T042, US10, AC-13, FR-013; TC-061, TC-071): the shell's location slot
// under `/tx/…`. Travis County, TX is the active county and the only one with data; choosing any
// other county shows "CountyLens has data for Travis County, TX only", changes nothing and leaves
// the URL alone. A link points to the Coming soon item for other counties and states. The counties
// listed besides Travis are plain names, no data. Render-only apart from the message state.
import { PAGE_TEXTS } from "@countylens/shared/texts";
import { useState, type ChangeEvent, type ReactElement } from "react";
import { ComingSoonEntry } from "./ComingSoonEntry";
import styles from "./CountySelect.module.css";

const COUNTIES = Object.freeze([
  { value: "travis", label: "Travis County, TX" },
  { value: "harris", label: "Harris County, TX" },
  { value: "dallas", label: "Dallas County, TX" },
  { value: "bexar", label: "Bexar County, TX" },
  { value: "williamson", label: "Williamson County, TX" },
]);

export function CountySelect(): ReactElement {
  const [other, setOther] = useState(false);
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setOther(event.currentTarget.value !== "travis");
  };
  return (
    <div className={styles.location}>
      <label className={styles.label} htmlFor="county-select">
        County
      </label>
      <select
        id="county-select"
        className={styles.select}
        value="travis"
        onChange={onChange}
        data-county-picker=""
        data-main-control=""
      >
        {COUNTIES.map((county) => (
          <option key={county.value} value={county.value}>
            {county.label}
          </option>
        ))}
      </select>
      <ComingSoonEntry id="other-counties" />
      {other ? (
        <p className={styles.message} role="status" data-county-message="">
          {PAGE_TEXTS.travisOnly}
        </p>
      ) : null}
    </div>
  );
}
