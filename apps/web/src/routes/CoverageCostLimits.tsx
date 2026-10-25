// Coverage · "Source speed and constraints" and "Cost" (A-16 T041, AC-3..AC-5, FR-003..FR-005;
// boards Coverage1440/768/390 and CoverageStates). Every figure is a cell of `docs/cost.md` or
// `docs/source-limits.md`, carried by `content/cost-limits.generated.json` (scripts/
// build-cost-limits.mjs, drift-tested), so the page cannot say more than the docs. The JSON is
// parsed with its Zod schema at load: a doc change that breaks the shape fails here, not as a
// half-rendered table.
//
// Honesty rules (AC-5): a figure the docs call "not available" shows `not available · {reason}`
// and never a zero; Cost Explorer lags a day, so the section says "as of {last billed day}" and a
// partial day is shown apart as partial; gross usage and credits are shown apart so the $0.00
// net is never read as "no cost"; a source that never became reachable shows "Blocked" with the
// dates, not a throughput.
// Justified differences from the board: the board's "Last bill · September" tile is the docs'
// "Gross usage" window (real figures, a window of billed days rather than a calendar month); the
// board's "Cost evidence: cost.json" link is the docs file named in the source line, since no
// cost.json is built at deploy time.
import type { ReactElement } from "react";
import { Icon } from "../components/Icon";
import { StatusPill } from "../components/StatusPill";
import raw from "../content/cost-limits.generated.json";
import { CostLimits, type CostRow, type LimitRow } from "../content/cost-limits.schema";
import styles from "./CoverageCostLimits.module.css";
import runsStyles from "./Runs.module.css";

const DATA = CostLimits.parse(raw);

/** `$9.2469` / `-$9.2469`: four decimals, as the docs print Cost Explorer figures. */
export function usd(value: number): string {
  const text = `$${Math.abs(value).toFixed(4)}`;
  return value < 0 ? `-${text}` : text;
}

export function SourceSpeed(): ReactElement {
  const { limits } = DATA;
  return (
    <section
      className={runsStyles.card}
      aria-labelledby="speed-heading"
      data-section="source-limits"
    >
      <div>
        <h3 id="speed-heading" className={runsStyles.sectionTitle}>
          Source speed and constraints
        </h3>
        <p className={runsStyles.helperText} data-as-of={limits.asOf}>
          as of {limits.asOf} · source: measurements from this repository&apos;s runs
          (docs/source-limits.md)
        </p>
      </div>
      <div className={runsStyles.tableWrap}>
        <table className={`${runsStyles.table} ${styles.stack}`} aria-label="Source limits">
          <thead>
            <tr>
              <th>Source</th>
              <th>Access and page size</th>
              <th>Throughput</th>
              <th>Rate limit</th>
              <th>Full capture</th>
              <th>Constraints</th>
            </tr>
          </thead>
          <tbody>
            {limits.rows.map((row) => (
              <LimitTableRow key={row.source} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      <p className={runsStyles.provenance}>
        <Icon name="info" size="small" />
        <span>
          Throughput and times are measurements from the run log. &quot;Not available&quot; says why
          a figure was never measured; &quot;Blocked&quot; lists the days the source refused access.
        </span>
      </p>
      <h4 className={runsStyles.sectionTitle}>Publication and read path</h4>
      <div className={runsStyles.tableWrap}>
        <table
          className={`${runsStyles.table} ${styles.stack}`}
          aria-label="Publication and read path"
        >
          <thead>
            <tr>
              <th>Step</th>
              <th>Measured</th>
              <th>Limit and effect</th>
            </tr>
          </thead>
          <tbody>
            {limits.readPath.map((row) => (
              <tr key={row.step} data-path-step={row.step}>
                <td data-label="Step">{row.step}</td>
                <td data-label="Measured">{row.measured}</td>
                <td data-label="Limit and effect">{row.limit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LimitTableRow({ row }: { readonly row: LimitRow }): ReactElement {
  return (
    <tr data-limit-source={row.source} data-status={row.status}>
      <td data-label="Source">{row.source}</td>
      <td data-label="Access and page size">{row.pageSize}</td>
      <td data-label="Throughput" className={runsStyles.num}>
        {row.status === "blocked" ? (
          <StatusPill status="error" icon="block" text="Blocked" />
        ) : row.status === "not_measured" ? (
          <StatusPill
            status="unavailable"
            text={`Not available · ${row.missingReason ?? ""}`}
            data={{ field: "throughput" }}
          />
        ) : (
          row.throughput
        )}
        {row.status === "blocked" ? (
          <span className={runsStyles.helper} data-blocked-dates={row.blockedDates.join(",")}>
            {" "}
            refused on {row.blockedDates.join(", ")}
          </span>
        ) : null}
      </td>
      <td data-label="Rate limit">{row.rateLimit}</td>
      <td data-label="Full capture" className={runsStyles.num}>
        {row.fullCapture}
      </td>
      <td data-label="Constraints">
        {row.antiBot}
        {row.optimisation === null ? null : (
          <span className={runsStyles.helper}> · Applied: {row.optimisation}</span>
        )}
      </td>
    </tr>
  );
}

export function CostSection(): ReactElement {
  const { cost } = DATA;
  return (
    <section className={runsStyles.card} aria-labelledby="cost-heading" data-section="cost">
      <div className={runsStyles.cardHead}>
        <div>
          <h3 id="cost-heading" className={runsStyles.sectionTitle}>
            Cost
          </h3>
          <p className={runsStyles.helperText} data-as-of={cost.asOf}>
            as of {cost.asOf} (last full billed day) · source: {cost.source} (docs/cost.md)
          </p>
        </div>
        <StatusPill
          status="verified"
          icon="savings"
          text={`${cost.fixedPerMonth} fixed per month`}
        />
      </div>
      {cost.partialDay === null ? null : (
        <div role="status" className={styles.notice} data-partial-day={cost.partialDay.day}>
          <Icon name="schedule" size="medium" />
          <p className={styles.noticeText}>
            <b>Partial (as of {cost.asOf}).</b> {cost.partialDay.day} is a partial, estimated day:{" "}
            {usd(cost.partialDay.grossUsd)} gross so far. It is shown apart and not added to the
            totals below.
          </p>
        </div>
      )}
      <div className={runsStyles.tiles}>
        <div className={runsStyles.tile} data-tile="gross">
          <span className={runsStyles.tileLabel}>Gross usage · {cost.gross.window}</span>
          {cost.gross.usd === null ? (
            <StatusPill
              status="unavailable"
              text={`Not available · ${cost.gross.missingReason ?? ""}`}
            />
          ) : (
            <b className={runsStyles.tileBig}>{usd(cost.gross.usd)}</b>
          )}
          <span className={runsStyles.tileLabel}>
            Real usage before credits (Cost Explorer, record type Usage)
          </span>
        </div>
        <div className={runsStyles.tile} data-tile="credits">
          <span className={runsStyles.tileLabel}>Credits · {cost.credits.window}</span>
          {cost.credits.usd === null ? (
            <StatusPill
              status="unavailable"
              text={`Not available · ${cost.credits.missingReason ?? ""}`}
            />
          ) : (
            <b className={runsStyles.tileBig}>{usd(cost.credits.usd)}</b>
          )}
          <span className={runsStyles.tileLabel}>
            Shown apart from usage: a net bill offset by credits is not &quot;no cost&quot;
          </span>
        </div>
        <div className={runsStyles.tile} data-tile="budget">
          <span className={runsStyles.tileLabel}>Budget alert</span>
          {cost.budget.text === null ? (
            <StatusPill
              status="unavailable"
              text={`Not available · ${cost.budget.missingReason ?? ""}`}
            />
          ) : (
            <b className={runsStyles.tileBig}>{cost.budget.text}</b>
          )}
          <span className={runsStyles.tileLabel}>Owned by the CDK Ops stack</span>
        </div>
      </div>
      <div className={runsStyles.tableWrap}>
        <table
          className={`${runsStyles.table} ${styles.stack}`}
          aria-label="Deployed resources and idle cost"
        >
          <thead>
            <tr>
              <th>Deployed resource</th>
              <th>Fixed (idle) per month</th>
              <th>Per use</th>
              <th>Who pays per use</th>
              <th>Seen in the bill</th>
            </tr>
          </thead>
          <tbody>
            {cost.rows.map((row) => (
              <CostTableRow key={row.component} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      <p className={runsStyles.provenance}>
        <Icon name="info" size="small" />
        <span>
          Fixed means recurring fees; per-use lines are real and are paid from credits. Figures are
          estimated by AWS and the account also hosts another project, so they are an upper bound.
        </span>
      </p>
    </section>
  );
}

function CostTableRow({ row }: { readonly row: CostRow }): ReactElement {
  const filebase = row.idle === null;
  return (
    <tr data-cost-row={row.component}>
      <td data-label="Deployed resource">{row.component}</td>
      <td data-label="Fixed (idle) per month">
        {filebase ? (
          <StatusPill
            status="unavailable"
            text={`Filebase usage: not available · ${row.missingReason ?? ""}`}
            data={{ field: "filebase_usage" }}
          />
        ) : (
          row.idle
        )}
      </td>
      <td data-label="Per use">{row.perUse}</td>
      <td data-label="Who pays per use">{row.whoPays}</td>
      <td data-label="Seen in the bill">{row.seenInBill}</td>
    </tr>
  );
}
