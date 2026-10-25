---
id: ERR-32
type: defect
feature: FEAT-A11
story: A-11
test_case: pipeline/oracle-runtime test/travis/permits/bbb-search-url.test.ts and write-group.test.ts (builder and planner only); end-to-end case blocked on a carrier
ac_reference: A-11
severity: High
status: Open, blocked on a PO decision (no legal carrier in the live lexicon)
found_by: Task B validation of published Run 2 (contractor and BBB columns), for HebaGaber
found_date: 2026-10-25
fix_branch: 011b-run3-corrections
fix_commit: pending (the lead commits after CI)
retest_date: pending
closed_date: pending
---

# ERR-32: Printed contractor name, contractor city, raw status, expiry date and BBB search link are not published

## Brief description

In the published Run 2, no permit carries a contractor name or a BBB link: `v_roofing_permit.contractor_name_raw`, `bbb_rating` and `bbb_url` are only listed in each row's `missing` with `no_lexicon_carrier`. The Roofing CRM (Task B) therefore shows "Contractor not published" on all 15,025 permits, although the permit prints a company name on 4,139 of them (27.5%).

## Related requirement

- **Story:** A-11 · **Requirement:** FR-012 (new) · **Follow-up:** FU-A-01-contract-address-contractor · **PO decisions (2026-10-25):** (A) publish the printed name as "as printed, unverified", never as a company record; (B) where BBB blocks, publish a BBB search link built from the printed name and city, rating missing, `bbb_status = blocked`, reason `bbb_blocked`.

## Impact and severity

- **Severity:** High. README demo line "review contractor details and BBB rating" cannot be shown with data.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | The Austin permit payload prints the contractor (`contractor_company_name`, `contractor_city`, `contractor_trade`, ...), but the transform drops it, and the live lexicon has no property that can carry it (ADR-0002 verdicts 1, 2, 3, 4, 5). `property_improvement` has `additionalProperties: false` and 18 properties, none a contractor name, raw status or expiry. |
| Carrier decision | **No legal carrier exists.** Evidence: (1) the live lexicon manifest fetched 2026-10-25 is byte-identical to the one ADR-0002 used (18,499 bytes, sha256 `7084b9334e66eb525d729e2d399f7216960abf30900081aaed194210be760640`), and the 159 cached class schemas still show the same properties. (2) `elephant-cli` 1.58.1 (`44bb182`) `export-tables` builds each table's columns only from `schema.properties` of the class, and its rows only from relationships named in the data group schema (`dist/services/tables-export.service.js`, `clazz()` and the relationship walk); it cannot emit a free-form side table. (3) The only classes with a name or URL string are `company.name` (an entity: forbidden by PO decision A and the Oracle rule), `file.name` and `file.original_url` (describe a document; ADR-0002 verdict 5 says they may not be borrowed), `business_location.name` (an Overture place with required source fields, not a permit contractor), `inspection.inspection_status` (an inspection record) and `communication` (phone and email only). (4) A hand-written side table or a sidecar file would be a parallel registry and not `export-tables` output, which the invariants forbid. |
| Smallest compliant path | File the already drafted lexicon requests as one lexicon change: R3 `property_improvement.contractor_printed_name`, R1 `permit_status_text`, R2 `permit_expiration_date`, plus one new string-or-null `property_improvement.contractor_search_url` (or R5 `business_rating.profile_url`). A lexicon pull request is a human action (PO decision D-8 says drafts stay unfiled). After it lands, re-mine the Property Improvement group, and `export-tables` emits the columns with no pipeline change beyond mapping. Until then these fields stay `missing` with `no_lexicon_carrier` (contract v1 behaviour, unchanged). |
| Alternative needing an explicit PO decision | Borrow `file` through `property_improvement_has_file` (`file.name` = search label, `file.original_url` = BBB search link). It is emitted by `export-tables` today, but it mislabels a search page as a document, publishes the name in a `name` column, and ADR-0002 ruled it out. Not implemented. |
| What was built (no publication) | `pipeline/oracle-runtime/travis/permits/bbb-search-url.ts`: `bbbSearchUrl()` and `printedContractorOf()`. `write-group.ts` computes them per emitted permit in `PlannedPropertyImprovementGroup.printed_contractors` and writes nothing into any group file. The values carry no phone, no person name and no street address. Contract v1.1 columns (`contractor_name_as_printed`, `contractor_city`, `bbb_url`, `bbb_status`, `bbb_status_reason`) are NOT added to `columns.ts`, `views.sql` or `contract/v1/columns.json`, because a column nothing can fill would be a frozen promise; the plan is in `contract/v1/README.md` (section "Planned for v1.1"). |
| Link shape caveat | `https://www.bbb.org/search?find_country=USA&find_text=<name>&find_loc=<City>%2C%20TX&find_type=Category` is UNVERIFIED. No bbb.org request was made (A-01: HTTP 403 challenge). A human must click one example before it ships. Two known weaknesses: the source truncates `contractor_city` to 12 characters ("Dripping Spr", "College Stat"), and the state is fixed to TX although some contractors are out of state (for example Syracuse). |
| Coverage on the local Run 2 data | 15,025 published permits: 4,139 carry a company name and get a link (4,039 with a printed city, 100 fall back to Austin), 961 distinct names; 0 placeholder names in this set; 416 more permits print only a person name (not published); all 15,025 carry a raw status and an expiry date. |
| Tests that pin it | `test/travis/permits/bbb-search-url.test.ts` (encoding, empties, placeholders, unicode, ampersands, long names, clerk markers); `test/travis/permits/write-group.test.ts` ("printed contractors": planned per emitted permit, absent from every file). |
| Re-test | Pending a carrier decision, a re-written Property Improvement group, new CARs and a Run 3 manifest. |
| Status | Open. Builder and planner done; publication blocked on the carrier. |
