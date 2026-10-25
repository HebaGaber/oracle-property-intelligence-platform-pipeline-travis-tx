# Run 3 build state (resume pointer)

Worktree: /Users/hebagaber/Github/run3-integration (branch 011c-run3-integrated). Data dir: pipeline/data (symlink to the -p checkout).
Run id: travis-full-run3-20261025. No upload or publish anywhere in this build (dry run only).

Machine (measured 2026-10-25 UTC): 10 CPU, 16 GiB RAM, 111 GiB free disk. Worker cap: cpu-2 = 8 total. RAM is tight (16 GiB), so county hash/validate uses 5 workers like Run 1/2 unless memory pressure is low.
Disk need: Run 1's whole county job dir is 8.8 GB, so the real need is about 15 GB, not 250 GB. 111 GiB is enough.

| Phase | Status | Started UTC | Finished UTC | Command / log | Check result | Next action |
| --- | --- | --- | --- | --- | --- | --- |

| P0 preconditions | done | 2026-10-25T07:40Z | 2026-10-25T07:46Z | dump log run3/logs/p0-dump.log | PASS (watermark OK, dump 1.07 GB, services restarted from this worktree, pid in run3/services.pid) | none |
| P1 migrations | done | 2026-10-25T07:47Z | 2026-10-25T07:49Z | cd pipeline/local-stack && npm run migrate | PASS (0202 and 0410 applied; rerun applies 0) | none |
| P2 Austin capture + merge | todo |  |  |  |  | run backbone permits --mode incremental (detached) |
