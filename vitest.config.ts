// Root Vitest config (A-02 research R-11). Vitest 4+ removed vitest.workspace.ts;
// `test.projects` is its replacement. Each workspace package is one project.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/contract",
      "packages/query-core",
      "packages/shared",
      { test: { name: "scripts", include: ["scripts/test/**/*.test.ts"] } },
      "profiles/travis-austin@1.0.0",
      "pipeline/publish",
    ],
    coverage: {
      provider: "v8",
      include: [
        "packages/*/src/**/*.ts",
        "packages/query-core/gazetteer/**/*.ts",
        "profiles/*/*.ts",
        "pipeline/publish/src/**/*.ts",
      ],
    },
  },
});
