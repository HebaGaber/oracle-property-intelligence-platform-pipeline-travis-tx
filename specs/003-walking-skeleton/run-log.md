# A-03 run log

One line per step: time (local) · stage · step · result. PO answers are quoted word for word.

## Stage 0 facts (from dependencies)

- A-01 merged `6c1383a`, A-02 merged `e98c12e`, both `status: Done`.
- Austin `3syk-w9eu`: 2,380,725 rows (A-01, 2026-10-19T20:59:36Z); 2,380,939 (A-02, 2026-10-20T21:33Z); 120,043 rows/min median at 50,000 rows/page, no app token.
- Profile `travis-austin@1.0.0` DIGEST `c8fd15cf8deb654c2959d7cca3b05560bc9830de2518c56a092bd87bdf53dfa6`; candidates 19,031 of 22,084 include matches (2026-10-20T21:33Z).
- A-02 pilot roots (unpublished): county CAR `baguqeerarr6swb6ylmo6ybct27f7bkkyww2fejrckukhcbiu3fzabcssytha`, tables `baguqeeraw6ig6khaxqllae7jb25iqrl2ohmwgaajarta3dd676u5x6l742ca`; property_improvement CAR `baguqeeral3h4vpzxkn2fskyhksppilosxupl6jqcsmscn6xtaajpk4e7zaqq`, tables `baguqeerahdudplmrd4lnzglb7qlhvbeptzjey24sepiyfu6rapmryuw6haxq`. `tables-export.json` SHA-256 county `6f16dda9…9c3b`, property_improvement `af7caa18…cdcf5` (embed `exportedAt`, change per run).
- Frozen views: `v_property`, `v_roofing_permit`, `v_contractor`, `v_run` (`contract/v1/columns.json`); `status_raw` and `contractor_name_raw` are `no_lexicon_carrier` (ADR-0002).
- Slice re-measure 2026-10-20T23:46:23Z: 42 match reroof terms, 38 accepted by the profile (4 `trade_permit`), 1 of 38 with no `tcad_id`, 0 without `contractor_company_name`. HTTP 200.
- Lambda account concurrency limit 10 → no reserved concurrency (AD-11). AWS free plan ACTIVE, $120 credits, ends 2027-04-16.

## Log

| Time | Stage | Step | Result |
| --- | --- | --- | --- |
| 02:45 | 0 | S0.1–S0.7 | all ✅ (Node 22.23.3, pnpm 10.34.7, DuckDB 1.5.6, Docker 29.8.2, Restate 308, gh ok, Filebase 3 key names, runtime tests 594/594, CDKToolkit present) |
| 02:47 | 0 | S0.8 | TIME-STATS A-03 section started |
| 02:48 | 1 | S1.1 | G4 run 1 FAIL: C-04, C-06 (AC-3/AC-5 vs frozen contract), C-08 (NFR traces); wording fixes applied |
| 02:48 | 2S | S2S.1 | spike plan drafted in parallel (read-only) |
| 02:51 | 1 | 🛑 D-1 (R1) | PO: AC-3 "Use contract columns (Recommended)"; AC-5 "Labels + Runs count (Recommended)"; NFR traces "Add to AC-2/3 and AC-7 (Recommended)"; TCAD scope "Yes, show both sources (Recommended)" |
| 02:52 | 1 | S1.2 | G4 run 2 PASS 11/11 |
| 02:54 | 1–2S | 🛑 D-1 + D-3 | PO: G4 "Ready (Recommended)"; D-3 scale "Smaller test"; gateways "Public CIDs now, ours later (Recommended)" |
| 02:54 | 2S | 🛑 D-3 follow-up | PO: AC-4 "Full Austin table, keep AC-4 (Recommended)"; spike stack "Yes, deploy and remove (Recommended)" |
| 02:56 | 2S | S2S.3 | spike started (background) |
| 02:57 | 2 | S2.1–S2.3 | `/speckit-specify` + `/speckit-clarify`: branch 003-walking-skeleton, 13 FRs + NFR-001…004, 6 clarify answers from docs; 3 open → D-2 held for R3 |
| 02:57 | 4 | S4.1 (early) | test-case draft: 29 TCs, DRAFT |
| 03:01 | 3 | S3.1 | metagross + oracle design (read-only, parallel, before the spike ended) → agent-design.md, 9 disagreement rows |
| 03:09 | 3 | 🛑 D-5 + D-2 (R4, asked early) | PO: kit runtime "Adapter module now (Recommended)"; CAR check "Approve additive carCid (Recommended)"; infra "Approve both (Recommended)" (deploy order Data → Api → Web → Ops → Cert; query log = API JSON access log 30 days); spec D-2 "Approve all three (Recommended)" (fallback on error / non-200 / > 4 s; 'Contractor not printed on permit' only for contractor `source_missing`; 21 labels as in spec.md) |
| 05:18 | 2S | S2S.3–S2S.4 | spike done (3 h 22 min): browser first load p95 3.3 s, COUNT p95 25 ms; radius p95 ≈ 40 s, roof-age 16–31 s → Lambda fallback; part size 48m; Filebase Free; ipfs.io + dweb.link retired 2026-09-21 (429 + Sunset, re-confirmed 10:29 by Claude); Austin 2,380,939 rows, 49 requests all 200; stack destroyed, key deleted; 2 inert CDK asset files (14.8 KB) left in the bootstrap bucket (PO decides later) |
| 10:29 | 2S | paused | 05:18 → 10:28 PO away (logged as paused) |
| 10:31 | 2S | 🛑 D-4 (R3) | PO: "Accept (Recommended)"; verify gateways "Pinata + Filebase (Recommended)"; Lambda proof "Private prefix + direct invoke (Recommended)" |
| 10:36 | 2S | S2S.6 | PO amendments applied (story AC-4/AC-6, spec, ARD § 16 AM-01…05, 0001 Accepted, contract README carCid note); query-core tests 198/198 (one earlier run had 1 failure at 71 s duration, likely a timeout under load: watch as flaky) |
