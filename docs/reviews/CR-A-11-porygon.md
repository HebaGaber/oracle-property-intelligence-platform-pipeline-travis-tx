# CR-A-11-porygon: counts-agreement review (Run 1 dry run)

**Reviewer**: `porygon` (metrics unification), read-only
**Scope**: do the source/capture denominators (A-04, A-07), the dry run's actual output, and the manifest's planned `coverage` section agree, across every layer, for a full-county run?
**Score: 48/100** — not G7-ready. One finding is a real counts mismatch the dry run itself produced; a second is a coverage-schema gap that would let a mismatch like it through silently.

## Finding 1 (blocking): the dry run's own "done" line mislabels what it actually wrote — published rows are 17,387, not 2,007,514

`pipeline/local-stack/scripts/run-permits-full.ts`'s completion log reads:

```
[permits-full] done job_id=... groups=10867 empty=227268 permits=2007514 ... elapsed_s=291.8
```

`run-log.md`'s own S5.2 entries, and this review's own brief, both repeat "2,007,514 permits" as what the dry run produced. It did not. Verified directly against the actual export:

- `groups/property_improvement/` has exactly 10,867 pID directories (matches `groups=10867`). ✓
- Counting `property_improvement_*.json` files on disk across all 10,867 directories: **17,387**, not 2,007,514.
- The batched `export-tables` output (the thing that will actually become the published Parquet table) confirms it independently: `b01-export.json` → `property_improvement.rows = 7,834`; `b02-export.json` → `property_improvement.rows = 9,553`. **7,834 + 9,553 = 17,387.**

So three different artifacts (loose files, batch 1 table, batch 2 table) all agree with each other at **17,387** — the pipeline is internally consistent — but none of them agree with the `permits=2007514` the script itself reported as "done," and that is the number the run-log and this task's own framing carried forward as "what the dry run produced."

Root cause, read from `write-group.ts`: `planPropertyImprovementGroup()` runs every pID's permits through `transformAustinPropertyImprovement()`, and only permits the transform classifies as `emitted` (roofing-relevant, not `status_exclude`/`needs_review`/skip) become a written file; a pID with zero emitted permits is counted as `empty`, not a group. `run-permits-full.ts`'s `permits` counter, by contrast, counts every **linked** permit read from the batched DB query — before that classification. The two numbers measure different things (DB rows read vs. roofing-emitted rows written) but share one undifferentiated label, `permits`, in the one place (the run-log "done" line) a reader would check to know what got published.

This is not necessarily a correctness bug in the transform — the property_improvement group has been roofing-scoped since A-02's 42-reroof pilot, and 17,387 is in the right neighborhood of A-04/A-07's roofing population (19,031 roofing-verdict permits, 16,816 of them linked). But:
- `plan.md`'s Scale/Scope line says "property_improvement 2,381,226 captured rows" and the size projection (2.95–3.73 GB) is built on that number. The actual published group is two orders of magnitude smaller. If 17,387 is the intended scope, the plan's own scale section is wrong and the size budget (the Filebase-5GB D-3 analysis) was never actually tested against the real output.
- If 17,387 is *not* the intended scope — if the real intent (matching "permits linked 2,007,514" in this task's own framing) was to publish every linked permit regardless of roofing classification — then the transform is silently dropping ~1.99M real, linked permit records from the public dataset with no `limitations[]` entry or coverage count naming that drop anywhere.

Either reading is a G7 blocker: this has to be resolved with a PO/oracle decision on what `property_improvement`'s denominator actually is, stated once, and then the manifest's `permits_emitted` coverage key, `plan.md`'s scale section, and the run-log's own completion line all need to agree with it and with each other. Right now none of them do.

## Finding 2 (blocking for a full-county run): `GROUP_COVERAGE_KEYS`'s permit-gap accounting is incomplete, so a mismatch like Finding 1 would not be caught by the schema

`pipeline/publish/src/manifest.ts`'s `property_improvement` coverage keys are `permits_emitted` (`published_rows`, checked tautologically against the table's own row count — this only proves internal consistency, never that the count is the *right* one), `permits_no_tcad_geoid` (`aggregate_match`), and three `contractor_*` buckets. A-04's own unmatched breakdown for all Austin permits is five reasons, not one:

| Reason | Count |
|---|---|
| `no_tcad_geoid` | 275,764 |
| `ambiguous_geoid` | 36,560 |
| `no_tcad_id` | 31,824 |
| `address_unmatched` | 29,475 |
| `ambiguous_address` | 89 |
| **Total unmatched** | **373,712** (= 2,381,226 − 2,007,514) |

Only the first reason has a named coverage key. The other 97,948 (36,560+31,824+29,475+89) have no coverage key at all — captured (`sources[0].records` = 2,381,226) and published (`permits_emitted`) will legitimately differ by hundreds of thousands of rows with the manifest naming only part of why. That is exactly the gap Constitution Article XI and this plan's own line ("Coverage section labels every count's derivation; zero-delta sources carry a stated reason, never silently omitted") say must not happen. It was invisible at pilot scale (near-zero unmatched in a 1-month/14-parcel pilot) and becomes a real, large, unexplained number at full-county scale — the plan.md Correction note itself flags that the 2-group/5-group scope was already corrected once this stage for the same reason (design written for a scale the real lexicon didn't support); this is the same class of problem recurring one layer down, in the coverage keys rather than the group list.

## What does agree (not blocking)

- **County**: 10 batches × ~44,197 = 441,961 total `property` rows (verified directly against all 10 `bNN-export.json` files) = exactly A-04's R-account count, and `county`'s empty `GROUP_COVERAGE_KEYS[]` correctly reflects that the group deliberately excludes P/MH/MN (documented `out_of_scope` since A-04, not a new decision). No mismatch here.
- `manifest.ts`'s `checkInput`/`buildManifest` do have a real internal guard (`emitted.count !== published` throws) that would catch a human typing the wrong number into `coverage.permits_emitted` by hand — it just can't catch the actual table being short, since the check is tautological against that same table.
- The three-derivation vocabulary (`published_rows`/`capture_receipt`/`aggregate_match`) is a reasonable design and the manifest-CID/CAR-root cross-checks (`groupArtifacts`) are solid, unrelated to this gap.

## Recommendation before G7

1. Get an explicit PO/oracle decision on `property_improvement`'s intended denominator (roofing-only vs. all-linked-permits), restate it once in `plan.md`'s Scale/Scope and in a code comment next to `transformAustinPropertyImprovement`'s emit/skip classification, and re-run the size projection against whichever is correct.
2. Fix the run-log/script labeling: `run-permits-full.ts`'s "done" line should report `permits_read` (DB rows) and `permits_emitted` (rows actually written) as two distinct numbers, not one `permits=` that silently means the former while readers assume the latter.
3. Either add the remaining four unmatched-reason coverage keys (or one combined `permits_unmatched_other` bucket with a stated derivation) so captured − emitted is fully reconciled for a full-county run, or get an explicit, recorded PO exception (same pattern as D-17/D-18) if full reconciliation is out of scope for this story.
