// .github/workflows/ci.yml after the metagross review (M4): the workflow parses as YAML, and the
// credential-free `e2e-hosted` job carries the environment its specs need. build-checks.spec.ts
// (TC-052/053) spawns the infra suites, which need CDK_DEFAULT_REGION (infra/src/config.ts) and
// OPERATOR_EMAIL; fallback.spec.ts (TC-032–034) and cid-copy.spec.ts need CID_COPY_HOST and the
// gateway hosts. Every value comes from a repository variable (never a literal: P0-18), and the
// job gets no AWS credentials, so @needs-aws cases stay excluded and announced.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// infra declares no YAML parser; the workspace's copy (pipeline/oracle-runtime) is used read-only.
const { parse } = createRequire(join(ROOT, "pipeline/oracle-runtime/package.json"))("yaml") as {
  parse: (text: string) => unknown;
};

interface Job {
  needs?: string | string[];
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  steps: { uses?: string; run?: string; with?: Record<string, unknown> }[];
}
const workflow = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, Job>;
};

describe("ci.yml (metagross M4): e2e-hosted environment", () => {
  const job = workflow.jobs["e2e-hosted"] as Job;

  it("parses as YAML and has the e2e-hosted job after deploy", () => {
    expect(job).toBeDefined();
    expect(job.needs).toBe("deploy");
    expect(job.steps.length).toBeGreaterThan(0);
  });

  it("sets the region, CID copy host, gateway hosts and operator email from repository variables", () => {
    expect(job.env).toMatchObject({
      AMPLIFY_APP_ID: "${{ vars.AMPLIFY_APP_ID }}",
      AWS_REGION: "${{ vars.AWS_REGION }}",
      CDK_DEFAULT_REGION: "${{ vars.AWS_REGION }}",
      OPERATOR_EMAIL: "${{ vars.OPERATOR_EMAIL }}",
      CID_COPY_HOST: "${{ vars.CID_COPY_HOST }}",
      FILEBASE_GATEWAY_HOST: "${{ vars.FILEBASE_GATEWAY_HOST }}",
      PINATA_GATEWAY_HOST: "${{ vars.PINATA_GATEWAY_HOST }}",
    });
    for (const value of Object.values(job.env ?? {})) {
      expect(value, "every value is a repository variable").toMatch(/^\$\{\{ vars\.[A-Z_]+ \}\}$/);
    }
  });

  it("stays credential-free: no AWS credentials step, no id-token permission, no secrets", () => {
    expect(job.steps.some((s) => s.uses?.startsWith("aws-actions/configure-aws-credentials"))).toBe(
      false,
    );
    expect(job.permissions?.["id-token"]).not.toBe("write");
    expect(JSON.stringify(job)).not.toContain("secrets.");
  });
});
