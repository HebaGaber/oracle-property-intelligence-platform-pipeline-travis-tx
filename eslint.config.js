// ESLint flat config for the A-02 workspace (packages/*, profiles/*, pipeline/publish).
// Boundary rules from docs/architecture-constitution.md § 4:
// - no database engines (pg, postgres, @duckdb/*) in packages/*/src and pipeline/publish/src;
// - no direct LLM provider SDKs anywhere (Vercel AI SDK only).
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
];
const enginePatternBan = [
  { group: ["@duckdb/*"], message: "Runtime code must not depend on a database engine (ARD § 4)." },
];

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/coverage/**",
      "**/dist/**",
      "pipeline/oracle-runtime/**",
      "pipeline/data/**",
      "pipeline/local-stack/**",
      "design/**",
      "tests/**",
      "scripts/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["**/*.ts", "**/*.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": ["error", { paths: providerSdkBan }],
    },
  },
  {
    // Later config wins for this rule, so repeat the provider ban here.
    files: ["packages/*/src/**/*.ts", "pipeline/publish/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [...providerSdkBan, ...engineBan], patterns: enginePatternBan },
      ],
    },
  },
);
