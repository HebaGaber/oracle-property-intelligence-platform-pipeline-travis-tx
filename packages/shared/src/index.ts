// @countylens/shared: UI wording and read-path URL helpers shared by apps/web, apps/api and
// the scripts (plan.md § Project Structure). Browser-safe: no node: imports, no env reads.
export {
  CONTRACTOR_NOT_PRINTED_LABEL,
  COVERAGE_LABELS,
  MISSING_REASON_LABELS,
  assertMissingReasonLabels,
  isContractorField,
  missingLabel,
  missingReasonLabel,
  type CoverageLabelKey,
} from "./labels.js";
export { SOURCE_LABELS, isSourceName, sourceLabel, type SourceName } from "./sources.js";
export { readPathUrls, type GatewayName, type ReadPathHosts, type ReadPathUrls } from "./urls.js";
