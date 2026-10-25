# Run 3 build state (resume pointer)
Worktree: /Users/hebagaber/Github/run3-integration (branch 011c-run3-integrated). Data dir: pipeline/data (symlink to the -p checkout).
Run id: travis-full-run3-20261025. No upload or publish anywhere in this build (dry run only).
Machine (measured 2026-10-25 UTC): 10 CPU, 16 GiB RAM, 111 GiB free disk. Worker cap: cpu-2 = 8 total. RAM is tight (16 GiB), so county hash/validate uses 5 workers like Run 1/2 unless memory pressure is low.
Disk need: Run 1's whole county job dir is 8.8 GB, so the real need is about 15 GB, not 250 GB. 111 GiB is enough.
| Phase | Status | Started UTC | Finished UTC | Command / log | Check result | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| P0 preconditions | done | 2026-10-25T07:36Z | 2026-10-25T07:41Z | dump log run3/logs/p0-dump.log | PASS (watermark OK, dump 1.07 GB, services restarted from this worktree, pid in run3/services.pid) | none |
| P1 migrations | done | 2026-10-25T07:42Z | 2026-10-25T07:43Z | cd pipeline/local-stack && npm run migrate | PASS (0202 and 0410 applied; rerun applies 0) | none |
| P2 Austin capture + merge + link + facts | done | 2026-10-25T07:44Z | 2026-10-25T08:25Z | job travis-a04-permits-incremental-20261025074427, link job travis-a04-permits-link-20261025082311; logs run3/logs/p2-*.log | PASS: 660/9922/0, recordsRead 2381886 = endTotal, watermarkUsed = Run 2 | P3 |
| P3 address layer, address_points load, coords assemble, roof-age check | done | 2026-10-25T08:26Z | 2026-10-25T08:40Z | coords job travis-a04-coords-20261025083149; log run3/logs/p3-coords.log | PASS: 43,955 address points, 434,016 of 441,961 R with a point; ledger 391,747/9,611/91,888 current | P4 |
| P4 County group re-write | running | 2026-10-25T08:42Z |  |  |  | single run, OWNER_PERSONS=publish set on the services process |
PO approval: PO approved the public upload of Run 3 on 2026-10-25; conditions: identity gate PASS including the previous-run check, no county property_cid moves, headline numbers within expectation, no 403, rehearsal dry run clean. This agent does not publish; the lead runs the real publish-run.ts after the rehearsal.
