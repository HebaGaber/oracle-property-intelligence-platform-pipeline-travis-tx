# Vendored kit files

These files are copied **unmodified** from the soofi-xyz-team-kit. Do not edit them here.
To update, copy the new kit version over them and refresh every hash below.
`travis/discovery/run-validator.ts` checks the validator hash against this table before running it.

- Kit: `soofi-xyz-team-kit`
- Kit version: `0.99.1`
- Source root: `skills/use-oracle/` in the kit (plugin cache path `soofi-xyz/soofi-xyz-team-kit/0.99.1/skills/use-oracle/`)
- Vendored on: 2026-10-19 (story A-01, task T003)
- Self-test: `python3 pipeline/oracle-runtime/kit/use-oracle/scripts/validate-county-readiness.py --self-test` prints `readiness self-test passed` and exits 0

| Vendored path (under `pipeline/oracle-runtime/kit/`) | Kit source path | SHA-256 |
| --- | --- | --- |
| `use-oracle/scripts/validate-county-readiness.py` | `skills/use-oracle/scripts/validate-county-readiness.py` | `5c5b85159371184d24b929e4fd9610ed0373399a9b890715b0683ef8929abb3d` |
| `use-oracle/fixtures/readiness/advertised-listing-count-is-not-harvestable.yaml` | `skills/use-oracle/fixtures/readiness/advertised-listing-count-is-not-harvestable.yaml` | `3b722a6ef7425e159e5d33aa9fd09ac440b3d02fc7368cf63ad5dee6f42dc50d` |
| `use-oracle/fixtures/readiness/blocked-without-request-route.yaml` | `skills/use-oracle/fixtures/readiness/blocked-without-request-route.yaml` | `35300a4ee12fada7b33ac37cd004adcf336bf11744d6313efbe5207012a9e20c` |
| `use-oracle/fixtures/readiness/material-gis-assessed-discrepancy.yaml` | `skills/use-oracle/fixtures/readiness/material-gis-assessed-discrepancy.yaml` | `d0ac16c415db89756bcda38f2f5cf11e5851a4430acaebb875517eca49d372b7` |
| `use-oracle/fixtures/readiness/ready-minimal.yaml` | `skills/use-oracle/fixtures/readiness/ready-minimal.yaml` | `76ee71f4892d1f5bf4c3e63a995c24b8cea2b9f3eec3b5bcb90c0b9044140f72` |
| `use-oracle/fixtures/readiness/unclassified-permit-jurisdiction.yaml` | `skills/use-oracle/fixtures/readiness/unclassified-permit-jurisdiction.yaml` | `58d4be7e7d078f4fdbe5f0e46c2d0b9153a43cbd8a2b42ad3a9ec2562c4a3347` |
| `use-oracle/fixtures/readiness/unified-portal-not-municipal-history.yaml` | `skills/use-oracle/fixtures/readiness/unified-portal-not-municipal-history.yaml` | `f36d7b38a9118f3fbc79cf620da3b04b809e156a7ec84a65ae34c473edf0c431` |
