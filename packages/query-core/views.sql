-- T060 (A-02, FR-002 / FR-007 / FR-009): the four contract/v1 views.
-- Bound by bindManifest() (src/bind-manifest.ts), which first creates:
--   meta.run, meta.source, meta.group_source, meta.part, meta.jurisdiction_host, meta.zcta_area;
--   county.<table> and property_improvement.<table> over export-tables output (each with _part);
--   travis_austin_status_map (generated from the profile) and the macros in src/derive.ts.
-- Rules: columns, order and types are packages/contract/src/columns.ts; joins go only through
-- relationship tables (from_cid / to_cid); roofing is enum equality on improvement_type and
-- improvement_action; every derivation is a derive.ts macro over meta.run.as_of (the manifest
-- finishedAt); every empty value gets a {field, reason} entry in `missing`.
-- Address properties are not in the export (ADR-0002), so the address-only fields appear in
-- `missing` as not_in_export and the owner mailing ZIP lookup has no input yet.

CREATE OR REPLACE VIEW v_property AS
WITH
prop AS (
  SELECT * FROM county.property
  QUALIFY row_number() OVER (PARTITION BY cid ORDER BY _part) = 1
),
geo AS (
  SELECT pp.from_cid AS property_cid,
         arg_min(g.latitude, g.cid) AS latitude,
         arg_min(g.longitude, g.cid) AS longitude
  FROM county.property_has_parcel pp
  JOIN county.parcel_has_geometry pg ON pg.from_cid = pp.to_cid
  JOIN county.geometry g ON g.cid = pg.to_cid
  GROUP BY pp.from_cid
),
roof AS (
  SELECT ps.from_cid AS property_cid, arg_min(s.roof_date, s.cid) AS roof_date
  FROM county.property_has_structure ps
  JOIN county.structure s ON s.cid = ps.to_cid
  GROUP BY ps.from_cid
),
roof_match AS (
  SELECT r.property_cid,
         bool_or(pi.improvement_type = 'Roofing' AND pi.improvement_action = 'Replacement'
           AND (date_matches_at_precision(r.roof_date, pi.completion_date)
             OR date_matches_at_precision(r.roof_date, pi.permit_close_date))) AS replacement_match,
         bool_or(pi.improvement_action = 'New'
           AND (date_matches_at_precision(r.roof_date, pi.completion_date)
             OR date_matches_at_precision(r.roof_date, pi.permit_close_date))) AS new_match
  FROM roof r
  JOIN property_improvement.property_has_property_improvement h ON h.from_cid = r.property_cid
  JOIN property_improvement.property_improvement pi ON pi.cid = h.to_cid
  GROUP BY r.property_cid
),
latest_sale AS (
  SELECT psh.from_cid AS property_cid, sh.cid AS sale_cid,
         TRY_CAST(sh.ownership_transfer_date AS DATE) AS transfer_date
  FROM county.property_has_sales_history psh
  JOIN county.sales_history sh ON sh.cid = psh.to_cid
  QUALIFY row_number() OVER (
    PARTITION BY psh.from_cid
    ORDER BY TRY_CAST(sh.ownership_transfer_date AS DATE) DESC NULLS LAST, sh.cid) = 1
),
owner AS (
  SELECT ls.property_cid,
         CASE WHEN count(pe.cid) > 0 THEN 'person'
              WHEN count(co.cid) > 0 THEN 'company' ELSE 'unknown' END AS owner_kind,
         CASE WHEN count(pe.cid) > 0
              THEN string_agg(pe.first_name || ' ' || pe.last_name, '; ' ORDER BY pe.last_name, pe.first_name)
              ELSE string_agg(co.name, '; ' ORDER BY co.name) END AS owner_name
  FROM latest_sale ls
  LEFT JOIN county.sales_history_has_person shp ON shp.from_cid = ls.sale_cid
  LEFT JOIN county.person pe ON pe.cid = shp.to_cid
  LEFT JOIN county.sales_history_has_company shc ON shc.from_cid = ls.sale_cid
  LEFT JOIN county.company co ON co.cid = shc.to_cid
  GROUP BY ls.property_cid
),
-- The owner mailing ZIP: address.postal_code through *_has_mailing_address once the export
-- emits address properties. Until then it has no value and the area class stays unknown.
mailing AS (
  SELECT p.cid AS property_cid, NULL::VARCHAR AS postal_code FROM prop p
),
county_source AS (
  SELECT s.url, s.captured_at FROM meta.source s
  JOIN meta.group_source g ON g.source_name = s.name AND g.data_group = 'county'
),
base AS (
  SELECT
    p.cid AS property_cid,
    p.request_identifier,
    p.parcel_identifier,
    p.property_type,
    p.property_usage_type,
    CAST(p.property_structure_built_year AS INTEGER) AS property_structure_built_year,
    geo.latitude,
    geo.longitude,
    coordinate_source(geo.latitude, geo.longitude, NULL::DOUBLE, NULL::DOUBLE) AS coordinate_source,
    roof.roof_date,
    roof_age_years(roof.roof_date, run.as_of) AS roof_age_years,
    roof_age_basis(roof.roof_date, coalesce(rm.replacement_match, false),
      coalesce(rm.new_match, false), p.property_structure_built_year) AS roof_age_basis,
    ls.transfer_date AS last_ownership_transfer_date,
    tenure_years(ls.transfer_date, run.as_of) AS tenure_years,
    tenure_basis(ls.transfer_date) AS tenure_basis,
    coalesce(o.owner_kind, 'unknown') AS owner_kind,
    o.owner_name,
    owner_area_class(za.area_class) AS owner_area_class,
    run.area_list_sha256,
    p.cid,
    source_url(p.source_http_request) AS record_url,
    src.url AS record_source_url,
    src.captured_at AS record_captured_at,
    cs.url AS group_source_url,
    cs.captured_at AS group_captured_at,
    part.table_cid,
    run.run_id,
    run.manifest_cid,
    run.as_of
  FROM prop p
  CROSS JOIN meta.run run
  CROSS JOIN county_source cs
  LEFT JOIN geo ON geo.property_cid = p.cid
  LEFT JOIN roof ON roof.property_cid = p.cid
  LEFT JOIN roof_match rm ON rm.property_cid = p.cid
  LEFT JOIN latest_sale ls ON ls.property_cid = p.cid
  LEFT JOIN owner o ON o.property_cid = p.cid
  LEFT JOIN mailing m ON m.property_cid = p.cid
  LEFT JOIN meta.zcta_area za ON za.zcta = m.postal_code
  LEFT JOIN meta.source src ON src.url = json_extract_string(p.source_http_request, '$.url')
  LEFT JOIN meta.part part ON part.name = p._part
)
SELECT
  property_cid,
  request_identifier,
  parcel_identifier,
  property_type,
  property_usage_type,
  property_structure_built_year,
  latitude,
  longitude,
  coordinate_source,
  roof_date,
  roof_age_years,
  roof_age_basis,
  roof_age_confidence(roof_age_basis) AS roof_age_confidence,
  last_ownership_transfer_date,
  tenure_years,
  tenure_basis,
  is_long_tenure(tenure_years) AS is_long_tenure,
  owner_kind,
  owner_name,
  owner_area_class,
  owner_is_out_of_area(owner_area_class) AS owner_is_out_of_area,
  area_list_sha256,
  cid,
  coalesce(record_url, group_source_url) AS source_url,
  coalesce(record_captured_at, group_captured_at) AS captured_at,
  'property' AS "table",
  table_cid,
  run_id,
  manifest_cid,
  as_of,
  list_filter([
    CASE WHEN parcel_identifier IS NULL THEN miss('parcel_identifier', 'source_missing') END,
    CASE WHEN property_type IS NULL THEN miss('property_type', 'source_missing') END,
    CASE WHEN property_usage_type IS NULL THEN miss('property_usage_type', 'source_missing') END,
    CASE WHEN property_structure_built_year IS NULL
      THEN miss('property_structure_built_year', 'source_missing') END,
    miss('unnormalized_address', 'not_in_export'),
    miss('city_name', 'not_in_export'),
    miss('postal_code', 'not_in_export'),
    CASE WHEN latitude IS NULL THEN miss('latitude', 'no_coordinates') END,
    CASE WHEN longitude IS NULL THEN miss('longitude', 'no_coordinates') END,
    CASE WHEN coordinate_source = 'none' THEN miss('coordinate_source', 'no_coordinates') END,
    CASE WHEN roof_date IS NULL THEN miss('roof_date', 'no_roof_date') END,
    CASE WHEN roof_age_years IS NULL THEN miss('roof_age_years', 'no_roof_date') END,
    CASE WHEN roof_age_basis = 'unknown'
      THEN miss('roof_age_basis', roof_basis_reason(roof_date)) END,
    CASE WHEN roof_age_basis = 'unknown'
      THEN miss('roof_age_confidence', roof_basis_reason(roof_date)) END,
    CASE WHEN last_ownership_transfer_date IS NULL
      THEN miss('last_ownership_transfer_date', 'no_dated_sale') END,
    CASE WHEN tenure_years IS NULL THEN miss('tenure_years', 'no_dated_sale') END,
    CASE WHEN tenure_basis = 'unknown' THEN miss('tenure_basis', 'no_dated_sale') END,
    CASE WHEN tenure_years IS NULL THEN miss('is_long_tenure', 'no_dated_sale') END,
    CASE WHEN owner_kind = 'unknown' THEN miss('owner_kind', 'no_owner_record') END,
    CASE WHEN owner_name IS NULL THEN miss('owner_name', 'no_owner_record') END,
    miss('owner_mailing_postal_code', 'not_in_export'),
    miss('owner_mailing_state_code', 'not_in_export'),
    CASE WHEN owner_area_class = 'unknown' THEN miss('owner_area_class', 'not_in_export') END,
    CASE WHEN owner_is_out_of_area(owner_area_class) IS NULL
      THEN miss('owner_is_out_of_area', 'not_in_export') END,
    CASE WHEN record_url IS NULL THEN miss('source_url', 'not_in_export') END
  ], lambda e: e IS NOT NULL) AS missing
FROM base;

CREATE OR REPLACE VIEW v_roofing_permit AS
WITH
contractor AS (
  SELECT from_cid AS permit_cid, min(to_cid) AS company_cid
  FROM property_improvement.property_improvement_has_contractor
  GROUP BY from_cid
),
permit_source AS (
  SELECT s.url, s.captured_at FROM meta.source s
  JOIN meta.group_source g ON g.source_name = s.name AND g.data_group = 'property_improvement'
),
base AS (
  SELECT
    pi.cid AS permit_cid,
    h.from_cid AS property_cid,
    jh.jurisdiction,
    pi.permit_number,
    pi.improvement_type,
    pi.improvement_action,
    pi.improvement_status,
    status_class_of(pi.improvement_status, pi.permit_issue_date) AS status_class,
    TRY_CAST(pi.permit_issue_date AS DATE) AS issue_date,
    TRY_CAST(pi.completion_date AS DATE) AS final_date,
    TRY_CAST(pi.permit_close_date AS DATE) AS permit_close_date,
    TRY_CAST(pi.final_inspection_date AS DATE) AS final_inspection_date,
    contractor_resolution(c.company_cid) AS contractor_resolution,
    c.company_cid AS contractor_company_cid,
    run.profile_version,
    run.profile_sha256,
    pi.cid,
    source_url(pi.source_http_request) AS record_url,
    src.captured_at AS record_captured_at,
    ps.url AS group_source_url,
    ps.captured_at AS group_captured_at,
    part.table_cid,
    run.run_id,
    run.manifest_cid,
    run.as_of
  FROM property_improvement.property_improvement pi
  JOIN property_improvement.property_has_property_improvement h ON h.to_cid = pi.cid
  JOIN (SELECT DISTINCT cid FROM county.property) cp ON cp.cid = h.from_cid
  CROSS JOIN meta.run run
  CROSS JOIN permit_source ps
  LEFT JOIN contractor c ON c.permit_cid = pi.cid
  LEFT JOIN meta.jurisdiction_host jh
    ON jh.host = url_host(json_extract_string(pi.source_http_request, '$.url'))
  LEFT JOIN meta.source src ON src.url = json_extract_string(pi.source_http_request, '$.url')
  LEFT JOIN meta.part part ON part.name = pi._part
  WHERE pi.improvement_type = 'Roofing' AND pi.improvement_action = 'Replacement'
    AND pi.improvement_status IS DISTINCT FROM 'Cancelled'
),
derived AS (
  SELECT *, open_days(status_class, issue_date, as_of) AS open_days FROM base
)
SELECT
  permit_cid,
  property_cid,
  jurisdiction,
  permit_number,
  improvement_type,
  improvement_action,
  improvement_status,
  status_class,
  is_open(status_class) AS is_open,
  issue_date,
  final_date,
  permit_close_date,
  final_inspection_date,
  open_days,
  contractor_resolution,
  contractor_company_cid,
  bbb_status() AS bbb_status,
  bbb_status_reason(contractor_resolution) AS bbb_status_reason,
  profile_version,
  profile_sha256,
  cid,
  coalesce(record_url, group_source_url) AS source_url,
  coalesce(record_captured_at, group_captured_at) AS captured_at,
  'property_improvement' AS "table",
  table_cid,
  run_id,
  manifest_cid,
  as_of,
  list_filter([
    CASE WHEN jurisdiction IS NULL THEN miss('jurisdiction', 'needs_review') END,
    CASE WHEN permit_number IS NULL THEN miss('permit_number', 'source_missing') END,
    CASE WHEN improvement_status IS NULL THEN miss('improvement_status', 'no_lexicon_carrier') END,
    miss('status_raw', 'no_lexicon_carrier'),
    miss('expiry_date', 'no_lexicon_carrier'),
    CASE WHEN issue_date IS NULL THEN miss('issue_date', 'source_missing') END,
    CASE WHEN final_date IS NULL THEN miss('final_date', final_date_reason(status_class)) END,
    CASE WHEN permit_close_date IS NULL THEN miss('permit_close_date', 'source_missing') END,
    CASE WHEN final_inspection_date IS NULL
      THEN miss('final_inspection_date', 'source_missing') END,
    CASE WHEN open_days IS NULL THEN miss('open_days', 'not_open') END,
    CASE WHEN contractor_company_cid IS NULL
      THEN miss('contractor_company_cid', 'contractor_unresolved') END,
    miss('contractor_name_raw', 'no_lexicon_carrier'),
    miss('bbb_rating', 'no_lexicon_carrier'),
    miss('bbb_url', 'no_lexicon_carrier'),
    miss('description', 'no_lexicon_carrier'),
    miss('work_class_raw', 'no_lexicon_carrier'),
    CASE WHEN record_url IS NULL THEN miss('source_url', 'not_in_export') END
  ], lambda e: e IS NOT NULL) AS missing
FROM derived;

CREATE OR REPLACE VIEW v_contractor AS
WITH
edges AS (
  SELECT DISTINCT from_cid, to_cid
  FROM property_improvement.property_improvement_has_contractor
),
counts AS (
  SELECT e.to_cid AS company_cid,
         CAST(count(DISTINCT e.from_cid) AS INTEGER) AS permit_count,
         CAST(count(DISTINCT r.permit_cid) AS INTEGER) AS roofing_permit_count
  FROM edges e
  LEFT JOIN v_roofing_permit r ON r.permit_cid = e.from_cid
  GROUP BY e.to_cid
),
permit_source AS (
  SELECT s.url, s.captured_at FROM meta.source s
  JOIN meta.group_source g ON g.source_name = s.name AND g.data_group = 'property_improvement'
),
base AS (
  SELECT
    co.cid AS contractor_company_cid,
    co.name,
    url_host(json_extract_string(co.source_http_request, '$.url')) AS identity_source,
    n.permit_count,
    n.roofing_permit_count,
    co.cid,
    source_url(co.source_http_request) AS record_url,
    src.captured_at AS record_captured_at,
    ps.url AS group_source_url,
    ps.captured_at AS group_captured_at,
    part.table_cid,
    run.run_id,
    run.manifest_cid,
    run.as_of
  FROM property_improvement.company co
  JOIN counts n ON n.company_cid = co.cid
  CROSS JOIN meta.run run
  CROSS JOIN permit_source ps
  LEFT JOIN meta.source src ON src.url = json_extract_string(co.source_http_request, '$.url')
  LEFT JOIN meta.part part ON part.name = co._part
  QUALIFY row_number() OVER (PARTITION BY co.cid ORDER BY co._part) = 1
)
SELECT
  contractor_company_cid,
  name,
  'resolved' AS contractor_resolution,
  identity_source,
  bbb_status() AS bbb_status,
  bbb_status_reason('resolved') AS bbb_status_reason,
  permit_count,
  roofing_permit_count,
  cid,
  coalesce(record_url, group_source_url) AS source_url,
  coalesce(record_captured_at, group_captured_at) AS captured_at,
  'company' AS "table",
  table_cid,
  run_id,
  manifest_cid,
  as_of,
  list_filter([
    CASE WHEN name IS NULL THEN miss('name', 'source_missing') END,
    CASE WHEN identity_source IS NULL THEN miss('identity_source', 'needs_review') END,
    miss('bbb_rating', 'no_lexicon_carrier'),
    miss('bbb_url', 'no_lexicon_carrier'),
    CASE WHEN record_url IS NULL THEN miss('source_url', 'not_in_export') END
  ], lambda e: e IS NOT NULL) AS missing
FROM base;

CREATE OR REPLACE VIEW v_run AS
SELECT
  run_id,
  county_fips,
  started_at,
  finished_at,
  manifest_cid,
  previous_manifest_cid,
  from_json(tables_root_cids, '[{"data_group":"VARCHAR","cid":"VARCHAR"}]') AS tables_root_cids,
  from_json(sources, '[{"name":"VARCHAR","watermark":"VARCHAR","captured_at":"VARCHAR","records":"BIGINT","added":"BIGINT","changed":"BIGINT","removed":"BIGINT","limitations":["VARCHAR"]}]') AS sources,
  coverage,
  profile_version,
  profile_sha256,
  area_list_sha256
FROM meta.run;
