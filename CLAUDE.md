# CLAUDE.md: oracle-property-intelligence-platform-pipeline-travis-tx

This repo is a PrismTeam assessment task (Task A). `README.md` is the assignment, and its Demo Transcript is the evaluator's script. The `soofi-xyz-team-kit:slowking` agent scores it.

## Branches and PR

- Feature branch: `feature/oracle-pipeline`. PR from `{fork}:feature/oracle-pipeline` to `prismteam-ai/oracle-property-intelligence-platform-pipeline-travis-tx:main`. Never commit to `main`.
- Each story gets its own Spec Kit branch `NNN-slug` (created by `/speckit-specify`). Merge it back with `git merge --no-ff` only after its G7 pre-check passes, then run `bash scripts/progress.sh`.
- Commit messages start with the story ID: `A-03: add manifest writer`.
- Hosted runtime: `https://explorer.{domain}` (see docs/hosting.md). localhost is never evidence.

## The guide (read before acting)

- `../assessment-guide/07-story-loop.md`: **the per-story card (S0–S17) and the agent per story. Follow it.**
- `../assessment-guide/02-oracle-pipeline.md`: this task's intent, architecture, backlog and demo map.
- `../assessment-guide/06-walkthrough.md`: story-specific prompts. `05-validation.md`: checks.
- Templates: `../assessment-guide/templates/`. Design system: `../assessment-guide/design-system/` (Atlas, Material 3, mobile-first, § 14 interaction patterns).

## Rules

- `.specify/memory/constitution.md` and `docs/architecture-constitution.md` are binding.
- Build with the kit agent that owns the work (`oracle` for data, `metagross` for the app, `alakazam` + `ash` for the agent, `machamp` for schedules; `mew`, `donphan`, `porygon`, `audino`, `smeargle` consult, review and test), loading its skills plus `apply-engineering-guidelines`. Code must show that agent's patterns, since the evaluator asks the same agents to score it.
- Gate pre-checks are the `developmentsupport-*` skills. They report gaps only; the user approves.
- Use only the kit-bundled Elephant skills (`soofi-xyz-team-kit/skills/`). Never use `../skills` (deprecated upstream copy).
- UI uses only Atlas tokens and components. Every data display shows provenance, and missing data says why.
- Never: secrets in git or logs, invented or synthetic data presented as real, Python outside PySpark/Glue, non-CDK IaC, direct LLM provider SDKs (use the Vercel AI SDK with Bedrock), merging the PR.

## Per story (summary of 07 Part 2)

G4 story → `/speckit-specify` → `/speckit-clarify` → agent design (read-only) → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` + G5 → test cases + G6 → `/speckit-checklist` → `/speckit-implement` → unit tests → `/code-review` + reviewer agent → deploy → scenario Playwright tests on the hosted URL → evidence → `/speckit-converge` → G7 → merge --no-ff.
