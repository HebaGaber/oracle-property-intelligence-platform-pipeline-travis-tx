---
gate: G2
artifact: docs/plan.md
artifact_version: 0.1
run_date: 2026-10-17
tool: Claude
verdict: PASS
---

# G2 pre-check: PROJ-A (Plan Approval)

Inputs read: `docs/plan.md` v0.1, `docs/feature-list.md` v0.1, `docs/01-intent.md` (VIS-A, approved), `.specify/memory/constitution.md`, `../assessment-guide/PLAYBOOK-A-oracle.md` Part 3, `../assessment-guide/reference/A-oracle.md` § 3. The product owner records the G2 decision; this check never approves.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Artifact type | PASS | A plan (PROJ-A), classification `Project`. |
| C-02 | Scope | PASS | § 5: in scope S-01 to S-10, each assigned to a phase. Out of scope OS-01 to OS-05 matches the feature list exactly. |
| C-03 | Dependencies | PASS | § 6: 5 inter-phase (DEP-01 to DEP-05), 8 external (EXT-01 to EXT-08), 3 organisational (ORG-01 to ORG-03). |
| C-04 | Constraints | PASS | § 7: technical, budget, timeline, resourcing and access (CON-01 to CON-05). |
| C-05 | Risks mitigated | PASS | § 9: 13 risks, each with at least one concrete mitigation and an owner. Includes the guide's seeds: gateway 429s, Filebase limits, source 403s, Free-plan availability, Task A delays blocking Task B. |
| C-06 | Success criteria traced | PASS | § 10: 10 criteria, each measurable and quoting a VIS-A evaluation point (SC-1 to SC-6, A1–A6). |
| C-07 | Coverage | PASS | § 8.x: 16 of 16 Must features, each in exactly one phase with one branch. Branch names match `AGENT-MAP.md` § 4. |
| C-08 | Walking skeleton first | PASS | Phase 0 ships one month of real Austin reroof permits to the hosted URL by day 3, before any full-county feature work. |
| C-09 | No placeholders | PASS | No template `{placeholders}` remain. `explorer.{domain}` is the project's URL pattern from `CLAUDE.md`, and the unknown domain is Q-02. Day dates are relative, with the calendar start in Q-01. |

**Constitution check:** consistent with II (TypeScript), III (CDK, region from config), IV (monorepo layout), VI (AI SDK, `AI_PROVIDER`), VII–VIII (DLQ, Powertools), XI (provenance), A1–A8 (kit runtime, `elephant-cli`, CIDv1, manifest, official identity, source terms, zero idle cost, kit skills). One text conflict: article VI still says Claude runs through the Gateway until the Bedrock quota is raised, but the quota is now raised. The plan follows the current fact and logs it as Q-05.

## Notes (not failures)

1. **Days 3, 5 and 7 are dense.**
   - Day 3: the end of A-03, plus the start of A-04.
   - Day 5: four stories at once (A-07 to A-10).
   - Day 7: A-12 Run 2, the end of A-13, and A-14.

   This follows the playbook's order. Starting the long Austin backfill and the TCAD load early (RISK-07) is what keeps it realistic.
2. **The G1 decision is not yet recorded** (Q-04). The plan is built on feature list v0.1; record G1 before approving G2.

## Fix list

None needed for PASS. By value to the assessment score:
1. Record G1, then G2 (Q-04).
2. Fix the calendar dates for Day 1 to Day 8 (Q-01), so speed can be measured against the plan.
3. Update constitution VI, `CLAUDE.md` and `PUBLISHING.md` for Bedrock (Q-05).
