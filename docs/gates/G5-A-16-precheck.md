---
gate: G5
artifact: specs/016-cost-and-admin
artifact_version: spec.md + plan.md + tasks.md + agent-design.md as of 2026-10-26 (commit 33dc713)
run_date: 2026-10-26
tool: Claude
verdict: FAIL
---

# Gate G5 pre-check: A-16 tasks + low-level design

G4 exceptions recorded by the PO on 2026-10-26 (sizing, AC-1 billed-days window, AC-6 Task B email+password) are accepted and not counted as findings. G6 test cases exist (`testplans/A-16-test-cases.md`, PASS).

| # | Check | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Clarified | FAIL | No `[NEEDS CLARIFICATION]` markers, but `spec.md` has no Clarifications section and its Status is still "Draft"; nothing shows `/speckit-clarify` ran. |
| C-02 | Phase structure | PASS | Phase 1 (frozen interfaces = Setup/Foundational) → Phase 2 (group build waves) → Phase 3 (batches, deploy, proof). Unconventional (groups instead of P1/P2/P3 story phases) but ordered and justified by the disjoint-group design, as in A-14. |
| C-03 | Task format | FAIL | IDs and `[P]` present and groups replace `[US#]`, but several tasks have no exact file path: T041, T043, T044, T046, T050 ("parity fixes ... family by family"), T016, T060-T068. Fix: add the file paths (e.g. `Coverage.tsx`, `Runs.admin.tsx`, `Activity.tsx`) or mark T060-T068 as operator/process steps. |
| C-04 | Tests first | FAIL | G2a's e2e tests (T047) come last in the group, after T041-T046 they cover. T013-T015, T032, T045, T051, T052 name no test that precedes them. Fix: move T047 first in G2a and add "Tests then" to the other tasks. |
| C-05 | Live verification last | FAIL | `tasks.md` ends with T060-T068, not the Phase Z tasks TZ01-TZ06. Content is mostly there (review round T064, deploy T061, hosted Playwright + smeargle T065, evidence T068) but there is no explicit kit-usage task and no `agents.verify` check (billing screenshot, non-admin 403). Fix: relabel as TZ01-TZ06 and add both. |
| C-06 | LLD complete | FAIL | `plan.md` has components and a (stale) file tree, but no data-flow section, no integration-point contracts (queue message, `live.json`, index header, admin router I/O are only in `agent-design.md`) and no test-approach section beyond one line. Its tree also disagrees with `tasks.md` (`pipeline/index/*` vs `pipeline/publish/src/explore-index.ts`). Fix: add a Data flow / Integration points / Test approach section and align the tree. |
| C-07 | Architecture conformance | PASS | Constitution Check all green; deviations (Cognito pool in `CountyLensApi`, `adminProcedure` instead of an authorizer, private derived index) are in Complexity Tracking with reasons, and T005 amends ADR-0001 and the architecture constitution. |
| C-08 | Kit usage | PASS | `agent-design.md` has verbatim answers (metagross, machamp x2, smeargle per its header). `plan.md` Kit Agent Ownership cites it, names skills and lists code patterns. Note: the pattern path `pipeline/index/` is stale (see C-06). |
| C-09 | Coverage | FAIL | FR-001 and FR-003 (write `docs/cost.md` and `docs/source-limits.md` from billing and measurements) have no task; T040 only parses the documents. Fix: add a task to finalise both documents from the bill and the A-01..A-11 measurements. |
| C-10 | Analyze | FAIL | No `/speckit-analyze` report exists for this story (none in `specs/016-cost-and-admin/` or `docs/`). Fix: run `/speckit-analyze` and clear any CRITICAL/HIGH. |

## Fix list

1. C-10: run `/speckit-analyze`; fix CRITICAL/HIGH.
2. C-09: add the `docs/cost.md` / `docs/source-limits.md` finalisation task (FR-001, FR-003).
3. C-05: rename T060-T068 as TZ01-TZ06; add kit-usage and the `agents.verify` check.
4. C-06: add data flow, integration points, test approach to `plan.md`; align file tree.
5. C-04: tests first in G2a (T047 up) and for T013-T015, T032, T045, T051-T052.
6. C-03: exact file paths for T016, T041, T043, T044, T046, T050.
7. C-01: run `/speckit-clarify` (or record its result) and set spec Status.

## Verdict

**FAIL.** 3 of 10 criteria pass (C-02, C-07, C-08); 7 fail (C-01, C-03, C-04, C-05, C-06, C-09, C-10).
