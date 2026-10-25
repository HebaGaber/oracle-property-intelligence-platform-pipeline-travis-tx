---
gate: G4
artifact: stories/A-16-cost-and-admin.md
artifact_version: "Draft with PO amendments of 2026-10-26 (uncommitted): A-14 in depends_on, AC-6 amended, AC-12 to AC-14 added, cost-window edge case"
run_date: 2026-10-26
tool: Claude
verdict: FAIL
---

# G4 pre-check: A-16 Prove zero idle cost and let the operator run the pipeline from the hosted app

Inputs read: the story; `docs/feature-list.md` (FEAT-A16, FEAT-A17); `../assessment-guide/AGENT-MAP.md` § 4 row A-16 (line 360); `docs/progress.md`; `design/prototype/`.
Treated as approved facts (PO, 2026-10-26, not gaps): A-14 in `depends_on`; AC-6 uses Task B's email + password Cognito sign-in; AC-12, AC-13, AC-14 added; AC-1 reads the last full billed days (recorded gate exception, edge case "cost window").

Verdict: FAIL, 4 of 11 checks.

| # | Check | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Front matter | FAIL | id, parent, eval_point (A4), priority, moscow, branch, depends_on, status are filled. AGENT-MAP row A-16: reviewers `metagross`, `machamp`, `audino`; skills `build-frontend-backends`, `build-batch-workflows`, `frontend-bug-fix`, `responsive-design-tests`. The story has reviewers `[metagross, machamp, audino, donphan]` and skills with an extra `figma-to-code`. design, builder and verify match. The body "Agents" row (line 38) lists three reviewers, so it disagrees with the front matter. Fix: add `donphan` (Part 3 data and MCP) and `figma-to-code` to AGENT-MAP row A-16 (PO approval), or remove them from the story; align the body row. |
| C-02 | User story form | PASS | Two "As the ... I want ... so that ..." statements and an independent test (two parts). Note: the operator statement and the independent test still say "email code" (see C-08). |
| C-03 | GWT | PASS | AC-1 to AC-14 are all Given / When / Then. |
| C-04 | Observable and real | PASS | Hosted Coverage, Runs and Activity pages, billing screenshot, SQS to bridge to Restate chain, 441,961 properties, Run 2 and Run 3 data. AC-12 compares layout only and excludes placeholder numbers. |
| C-05 | Scale + honesty | PASS | Scale: AC-3 (2,380,725-row backfill), AC-10 (30 days, p95 < 3 s), AC-13 (441,961 properties, p95 < 3 s). Missing data / error: AC-5, AC-8, AC-9, AC-14. |
| C-06 | Testable | FAIL | AC-1 still reads "Given the deployed stacks with no traffic, ... for the last full day", but the PO exception (edge case "cost window") reads the last full billed days and states Part 2 resources from pricing. Two testers would read different windows. AC-12 "layout ... match its board" is bounded by the parity file, acceptable. AC-14 depends on the carried lists, which have no stable IDs (A-13 items run 1 to 6 then 8 then 7; A-11 item 7 is struck out), so "each one" is not countable. Fix: reword AC-1 to the billed-days window with the exception reference; add a numbered closure table (item, closed / exception) to evidence and fix the A-13 numbering. |
| C-07 | Edge cases | PASS | Eight edge cases (at least 2 required), including the cost window and the merge case. |
| C-08 | Requirements traced | FAIL | FR-006 still says "sign in admins with a Cognito email code" and traces to AC-6, which is now email + password. The same stale wording is in the operator statement (line 57), the Part 2 "When done" ("built-in email code", line 61), the edge case "Code could not be sent" (line 97), and FEAT-A17 in `docs/feature-list.md`. Every other FR traces; NFRs have thresholds (NFR-002 only names widths and Atlas, acceptable). Fix: change FR-006, line 57, line 61 and the edge case to email + password; flag FEAT-A17's wording to the PO. |
| C-09 | Prototype | PASS | `ui: true`. Linked boards exist: `Coverage1440/768/390`, `CoverageStates`, `AdminSignIn1440/768/390`, `RunsAdmin1440`, `Activity1440/768/390`, `ActivityStates`. States are listed. Note: the state "code sent" matches the old email-code flow; the PO should confirm whether the AdminSignIn boards (code entry) still apply to password sign-in, or whether AC-12 lists the difference in the parity file. |
| C-10 | Ready | PASS | `depends_on: [A-03, A-11, A-13, A-14]` all Done and merged (`docs/progress.md`). No `[NEEDS CLARIFICATION]` marker in the story (the only hit is the G4-9 criterion text). |
| C-11 | Slicing | FAIL | `size_days: 2` is above the 0.5 to 1.5 day band. Scope has grown beyond that: Part 1 (A4), Part 2 (A3), plus AC-12 (all pages vs the prototype), AC-13 (full-county per-run Explore index, a new pipeline step) and AC-14 (about 40 carried items from A-11, A-13, A-14), with evaluation points A4, A1, A3 and AC-13 touching A6. The edge case also says the story must fit one 3-hour session. Fix: PO records a sizing exception in the story (size and eval-point rationale) or splits AC-12 to AC-14 into their own story (for example A-19); at minimum set `size_days` honestly and name the primary evaluation point as A4. |

## Fix list (ordered by impact on the assessment score)

1. **C-11 slicing.** Record a PO sizing exception or split Part 3 (AC-12 to AC-14) off; this is the biggest delivery risk, and AC-13 (full-county Explore index) is what unblocks demo lines D-8 and D-9.
2. **C-08 stale email-code wording.** Update FR-006, line 57, line 61 and the "Code could not be sent" edge case to email + password; tell the PO that FEAT-A17 in the feature list also says "email code".
3. **C-06 AC-1 window and AC-14 countability.** Reword AC-1 to the billed-days window; number the carried items and fix the A-13 list order.
4. **C-01 agents and skills.** Reconcile `donphan` and `figma-to-code` with AGENT-MAP row A-16 (the map change needs PO approval) and align the body "Agents" row.
5. **C-09 note.** Confirm the "code sent" board state against password sign-in.

The pre-check never approves; the user records the G4 decision. The story was not edited and nothing was committed.
