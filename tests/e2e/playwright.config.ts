// Hosted Playwright harness (A-03 T023, constitution I: localhost is never evidence).
//
// - Every spec runs against RUNTIME_URL only. Loading this file throws exactly
//   `RUNTIME_URL must be a hosted URL, not localhost: {value}` for a loopback URL and exactly
//   `RUNTIME_URL is not set; set it to the hosted URL` when it is unset (TC-060, lib/runtime-url.ts).
// - One test per G6 test case, titled `@scenario:A-03-TC-nnn`, in the spec file the G6
//   coverage matrix names; `npx playwright test -g "A-03-TC-nnn"` runs one case.
// - Cases that use an AWS profile (lib/aws.ts) also carry `@needs-aws` in their title. Under
//   CI without AWS credentials they are excluded with `grepInvert` and a stderr notice, never
//   reported as passed (lib/needs-aws.ts). Everywhere else they run.
// - Config keys the specs read from the environment: CID_COPY_HOST (required by the specs that
//   read the copy directly), FILEBASE_GATEWAY_HOST, PINATA_GATEWAY_HOST, READPATH_PRIVATE_PREFIX
//   (lib/runtime.ts). The AWS region comes from the profile configuration, never a literal.
import { defineConfig, devices } from "@playwright/test";
import { NEEDS_AWS_EXCLUDED_NOTICE, NEEDS_AWS_PATTERN, needsAwsExcluded } from "./lib/needs-aws.js";
import { runtimeUrl } from "./lib/runtime-url.js";

const baseURL = runtimeUrl();

const excludeNeedsAws = needsAwsExcluded();
if (excludeNeedsAws && process.env.TEST_WORKER_INDEX === undefined) {
  process.stderr.write(`${NEEDS_AWS_EXCLUDED_NOTICE}\n`);
}

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  testIgnore: ["**/node_modules/**", "**/test-results/**", "**/playwright-report/**"],
  outputDir: "test-results",
  ...(excludeNeedsAws ? { grepInvert: NEEDS_AWS_PATTERN } : {}),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL,
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
