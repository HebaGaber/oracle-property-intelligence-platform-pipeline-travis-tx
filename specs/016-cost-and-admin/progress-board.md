# A-16 progress board

Updated every 15 minutes by the main session. Times are EEST (UTC+3). Session target: finish by about **02:40 EEST** (3 hours from the start at about 23:40).

Status: ✅ done · 🔄 running · ⏳ waiting on a dependency · ✋ needs the PO · 🛑 PO decision · ⚠️ at risk

**Last update:** 02:20 EEST · **Elapsed:** 2 h 40 m · **Revised target:** ≈ 03:15

## Rounds

| Round | Window (EEST) | Goal |
| --- | --- | --- |
| R1 Gates | 23:40–00:40 | G4, spec, design, plan, tasks, tests, G5, G6 ✅ |
| R2 Build + batch 1 | 00:40–01:40 | five builders, merge, unit + synth, index upload, batch 1 push, infra deploy, test users |
| R3 Prove + merge | 01:40–02:40 | batch 2 push, review round, hosted tests, parity re-run, bridge live, evidence, G7, merge |
| After the session | next | release R1–R7 (deep review, G8, PR, slowking, demo video); Run 3 index once the other session publishes it |

## Remaining work

| ID | Work | Owner | Round | Depends on | Est. | ETA | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B-G4 | Index build CLI + reader + agent/MCP read path (T010–T015) | G4 machamp | R2 | wave 1 ✅ | 50 m | 01:30 | ✅ merged 28ae25c |
| B-G4i | Upload Run 2 then Run 1 index; Run 3 local check only | G4 machamp | R2 | B-G4 CLI | 15 m | 02:25 | 🔄 Run 1 + 2 uploaded; Run 3 (now published by the other session) index uploading — prod Explore on Run 3 shows index_not_built until done |
| B-G1 | Infra (pool, timeout 15 s, throttle, alarms, grants) + admin API + idle-cost tests (T020–T025) | G1 metagross | R2 | wave 1 ✅; G3 queue construct for T023 | 50 m | 01:30 | ✅ merged 68e9862 (+ post-merge fixes df55f82) |
| B-G3 | Queue construct, bridge, pipeline closures (T030–T036) | G3 machamp | R2 | wave 1 ✅ | 50 m | 01:30 | ✅ merged 49db39e |
| B-G2a | Sign-in, Activity, Runs admin, Coverage Cost/Limits, Runs/Compare/Log/Coverage parity (T039–T046) | G2a metagross | R2→R3 | G1 API types (for wiring) | 70 m | 01:50 | ✅ merged 38ea8b3 |
| B-G2b | Speed fixes, then parity: shell → Explore + drawer → Data → Hub/Help/Legal (T050–T052) | G2b metagross | R2→R3 | parity matrix ✅ | 80 m | 02:20 | ✅ merged 898e075 (all demo-path families, index error copy, speed) |
| M1 | Merge the five worktree branches into `016-cost-and-admin`; run `pnpm check`, format, grep gates, stylelint, bundle gate, `cdk synth` | Me | R2 | each builder done | 15 m | 01:45 | ✅ lint, format, gates, stylelint, typecheck, full tests (2 load-timeouts rerun green) |
| D1 | 🛑 Laptop CDK deploy (Api → Web → Ops) + smoke `admin.me` 401, `explore.search` on Run 2 + spike log retention 14 d | Me + PO OK | R2 | B-G1, B-G3, M1 | 15 m | 01:55 | ✅ deployed 01:45; ERR-75 (was 72) Api redeploy ✅ 02:05 |
| U1 | ✋ PO creates admin + non-admin Cognito users and the test env file (commands pre-filled) | PO | R2 | D1 | 5 m | 02:00 | ✅ test users created by Claude (Task B pattern, .test addresses), env file mode 600 |
| P1 | Batch 1 push (web parity families done + Coverage + docs) → Amplify preview → smoke | Me | R2 | M1 (G2a/G2b first commits) | 25 m | 02:00 | ✅ pushed 01:53 (one push after the deploy); Amplify preview + CI building |
| P2 | Batch 2 push (admin UI/API, index read path, rest of parity) → preview | Me | R3 | B-G2a, B-G2b, B-G4, D1 | 25 m | 02:35 | ⏳ push after Run 3 index + final checks (merge of feature with Run 3 done ed96848) |
| RV | One review round in parallel while P2 builds: `/code-review medium` + metagross, machamp, audino (≥ 75) | Me + reviewers | R3 | P2 pushed | 20 m | 02:15 | ✅ audino 82, metagross 81, machamp 78, /code-review medium 10 findings |
| UP | Unpark A-13/A-14 tests (T053/T026) | G2b | R3 | B-G4i live on preview | 5 m | 02:10 | ⏳ |
| T1 | Hosted Playwright on the preview: A-16 specs, unparked cases, responsive; index p95 20 cold + 20 warm; golden G1–G6 on Run 2 | Me | R3 | P2, UP, U1 | 20 m | 03:00 | ⏳ after P2 preview |
| T2 | Parity re-run (smeargle) on the preview, after-fix verdicts | Me | R3 | P2 | 15 m (parallel with T1) | 03:00 | ⏳ after P2 preview |
| BR | ✋ PO starts local stack + bridge; admin Start (`dry_run`) → SQS → bridge → Restate → "Running"; stop bridge → expired; DLQ email | Me + PO | R3 | D1, U1, B-G3 | 15 m (parallel with T1) | 02:50 | ⏳ PO starts local stack + bridge |
| FX | Fixes from review and hosted tests (ERR-75+), re-tests | builders | R3 | RV, T1, T2 | 15 m | 02:35 | ✅ all Majors + code-review fixes committed (2b424b1); Api redeploy + push needed |
| EV | Evidence `docs/evidence/A-16.md` (Closure table), cost/limits final + ✋ billing screenshot, statuses, PR body, kit-usage, converge | Me (+ PO screenshot) | R3 | T1, BR | 15 m (parallel with FX) | 03:05 | ⏳ |
| G7 | G7 pre-check → 🛑 G7 → merge `--no-ff` → `progress.sh` → push | Me + PO | R3 | FX, EV | 10 m | 03:15 | ⏳ |

## Decisions and actions still needed from the PO

| When | Item |
| --- | --- |
| ≈ 01:35 | 🛑 OK to deploy infra from the laptop (D1) |
| ≈ 01:40 | ✋ create the two Cognito users + test env file (U1) |
| ≈ 02:15 | ✋ start the local stack and the bridge (BR) |
| ≈ 02:30 | ✋ Cost Explorer screenshot (EV) |
| ≈ 02:40 | 🛑 G7 approval and merge |

## Risks

- Parity work is the largest; families not finished by 02:00 go in as recorded differences.
- Amplify builds can queue 10–25 min; batch 2 must be pushed by about 02:05.
- Second pin (Storacha) moved to a separate PO session (2026-10-26); A11-3/A11-14 recorded as handled there.
- Run 3 publish is another session's GitHub job (started 23:21 EEST); not in this story's path.
