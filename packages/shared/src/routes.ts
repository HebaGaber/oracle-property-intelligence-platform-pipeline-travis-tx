// A-13 (contracts/ui-routes.md): the route paths and Explore URL parameters, stable for A-14 and
// A-16 (FR-025). apps/web's route-list.ts maps each path to its lazy page. No imports, so the
// shell reads it through `@countylens/shared/routes` without the contract schemas.
export const ROUTES = Object.freeze({
  hub: "/",
  runs: "/runs",
  runsCompare: "/runs/compare",
  runsLog: "/runs/log",
  coverage: "/tx/travis/coverage",
  explore: "/tx/travis/explore",
  dataManifest: "/data/manifest",
  dataVerify: "/data/verify/:cid",
  dataCatalog: "/data/catalog",
  helpMcp: "/help/mcp",
  legalData: "/legal/data",
  legalPrivacy: "/legal/privacy",
  legalTerms: "/legal/terms",
  comingSoon: "/soon/:item",
  permits: "/permits",
});

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** `/data/verify/{cid}`. */
export const verifyPath = (cid: string): string => `/data/verify/${encodeURIComponent(cid)}`;
/** `/soon/{item}`. */
export const comingSoonPath = (item: string): string => `/soon/${encodeURIComponent(item)}`;

/** Explore URL state (FR-004a): no `z`; `view=map` falls back to `view=list`. */
export const EXPLORE_URL_PARAMS = Object.freeze([
  "at",
  "r",
  "roof",
  "permit",
  "openYrs",
  "tenure",
  "ooa",
  "sort",
  "sel",
  "mode",
  "place",
  "view",
] as const);
export type ExploreUrlParam = (typeof EXPLORE_URL_PARAMS)[number];
