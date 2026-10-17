---
gate: G1
artifact: docs/feature-list.md
artifact_version: 0.1
run_date: 2026-10-17
tool: Claude
verdict: PASS
---

# G1 pre-check: FL-A (Feature List Approval)

Inputs read: `docs/feature-list.md` v0.1, `docs/01-intent.md` (VIS-A, approved 2026-10-17), `README.md` at `e778d6f`, `docs/traceability.md`, `.specify/memory/constitution.md`. The product owner records the G1 decision; this check never approves.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | ID format | PASS | 16 unique IDs, FEAT-A01 to FEAT-A16, each matching story A-01 to A-16. No gaps, no merged stories. |
| C-02 | Description quality | PASS | Every description is one sentence of 13 to 18 words, with a concrete subject, action and testable result. |
| C-03 | MoSCoW and eval point | PASS | All 16 rows have MoSCoW (all Must) and at least one evaluation point A1–A6. |
| C-04 | Classification | PASS | FEAT-A01 and FEAT-A02 are Project (no UI: sources doc and readiness validator; views and sample rows). The other 14 are Feature, observable on the hosted runtime. |
| C-05 | No duplicates | PASS | No two rows share a capability. FEAT-A04 to A09 are separated by source type, FEAT-A10 by merging and roof age, FEAT-A11 and A12 by full publication and incremental runs. |
| C-06 | No vague verbs | PASS | No "manage", "handle" or "support" in any name or description. |
| C-07 | Vision traceability | PASS | Every row cites VIS-A. |
| C-08 | Scope alignment | PASS | No row touches OS-01 to OS-05. FEAT-A13 is an exploration UI over Oracle data, not the CRM UI or its map/pin design, which the README excludes. |
| C-09 | README coverage | PASS | 47 of 47 acceptance criteria and 12 of 12 demo lines have at least one FEAT in `docs/traceability.md` § 1. No uncovered line. Every FEAT is referenced by at least one row. |
| C-10 | NFRs | PASS | NFR-01 to NFR-09 each have a measurable threshold or a binary rule. No Must contradicts them: the scheduler (inside FEAT-A12) is off by default per NFR-02, and BBB (FEAT-A08) stops on 403 per NFR-07. |

## Notes (not failures)

1. **MoSCoW is 100% Must**, above the template's 70% guideline. This is justified in the feature list: every row is behind a README criterion or demo line, and deferred scope is recorded as out of scope. The evaluator may still read a flat priority as weak prioritization. If you want visible tiers, split the optional parts (Overture places in A-09, the CDK scheduler in A-12) into their own Could/Should rows. That would add story IDs.
2. **NFR-01's 3-second p95** is a planning target, not a README number. Confirm it at G3, once the DuckDB query path is chosen.

## Fix list

None needed for PASS. In order of value to the assessment score:
1. Optional: decide on note 1 (tiered priorities) before stories are written in P8.
2. Optional: confirm or change NFR-01 at G3.
