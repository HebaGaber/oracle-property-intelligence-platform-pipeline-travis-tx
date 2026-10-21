// Shared ESLint flat config for the CountyLens workspace (A-03 T004).
// Boundary rules from docs/architecture-constitution.md § 4 and the plan:
// - no direct LLM provider SDKs anywhere (Vercel AI SDK only, constitution VI);
// - no database engine and no Query DB client in packages/*, apps/* and pipeline/publish;
// - DuckDB only in the engine adapters, apps/*/src/engine/** (AD-19);
// - no AWS SDK in the browser app (apps/web reads public data over HTTPS only);
// - no inline style literals in apps/web (CSS Modules with Atlas tokens only).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

const providerSdkBan = [
  { name: "openai", message: "Use the Vercel AI SDK (`ai`), not a provider SDK." },
  { name: "@anthropic-ai/sdk", message: "Use the Vercel AI SDK (`ai`), not a provider SDK." },
  {
    name: "@aws-sdk/client-bedrock-runtime",
    message: "Use the Vercel AI SDK (`ai`), not a provider SDK.",
  },
];
const engineBan = [
  { name: "pg", message: "Runtime code must not depend on a database engine (ARD § 4)." },
  { name: "postgres", message: "Runtime code must not depend on a database engine (ARD § 4)." },
  {
    name: "@elephant-xyz/query-db",
    message: "The Query DB is never read by app code; publish only elephant-cli output (A2).",
  },
];
const duckdbBan = {
  group: ["@duckdb/*"],
  message: "DuckDB is wired only in apps/*/src/engine/** (ARD § 4, AD-19).",
};
const awsSdkBan = {
  group: ["@aws-sdk/*", "aws-sdk"],
  message: "apps/web reads public data over HTTPS only; no AWS SDK in the browser bundle.",
};

/**
 * `no-restricted-imports` replaces its options wholesale, so every block below restates
 * the complete list for the files it covers.
 * @param {{ name: string; message: string }[]} paths
 * @param {{ group: string[]; message: string }[]} patterns
 */
const restrictedImports = (paths, patterns = []) => [
  "error",
  patterns.length > 0 ? { paths, patterns } : { paths },
];

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/coverage/**",
      "**/dist/**",
      "**/cdk.out/**",
      "**/.turbo/**",
      "pipeline/oracle-runtime/**",
      "pipeline/data/**",
      "pipeline/local-stack/**",
      "design/**",
      "spikes/**",
      "runs/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": restrictedImports(providerSdkBan),
    },
  },
  {
    // Workspace code (including tests and scripts): no database engine, no Query DB client.
    files: ["packages/**", "apps/**", "pipeline/publish/**"],
    rules: {
      "no-restricted-imports": restrictedImports([...providerSdkBan, ...engineBan]),
    },
  },
  {
    // Runtime trees: DuckDB is banned too. Test and script harnesses in these packages
    // (packages/query-core/scripts, packages/*/test) may still drive DuckDB directly.
    files: ["packages/*/src/**", "apps/*/src/**", "pipeline/publish/src/**"],
    rules: {
      "no-restricted-imports": restrictedImports([...providerSdkBan, ...engineBan], [duckdbBan]),
    },
  },
  {
    // The browser app: no AWS SDK and no inline style literals.
    files: ["apps/web/**"],
    rules: {
      "no-restricted-imports": restrictedImports(
        [...providerSdkBan, ...engineBan],
        [duckdbBan, awsSdkBan],
      ),
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression",
          message: "No inline style literals: use CSS Modules with the Atlas tokens.",
        },
      ],
    },
  },
  {
    files: ["apps/web/src/**"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Engine adapters are the only place DuckDB may be imported.
    files: ["apps/*/src/engine/**"],
    rules: {
      "no-restricted-imports": restrictedImports([...providerSdkBan, ...engineBan]),
    },
  },
  {
    files: ["apps/web/src/engine/**"],
    rules: {
      "no-restricted-imports": restrictedImports([...providerSdkBan, ...engineBan], [awsSdkBan]),
    },
  },
);
