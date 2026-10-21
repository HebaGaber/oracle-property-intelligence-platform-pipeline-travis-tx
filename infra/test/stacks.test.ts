// Whole-app CDK assertions for the five CountyLens stacks (A-03 T017; TC-052, TC-053).
// Rules asserted here come from the ARD (AD-11, AD-13, AD-14, NFR-02, P0-18, P0-19, § 16 AM-02)
// and the constitution (III: region from config, tag project_name=oracle-travis; A7: nothing
// that bills while idle). The region comes from CDK_DEFAULT_REGION exactly as in `cdk synth`:
// when it is unset these tests fail with the config error, never with a fallback literal.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";
import type { CountyLensStacks } from "../src/app.js";
import { loadConfig, type InfraConfig } from "../src/config.js";
import { appUnderTest } from "./helpers.js";

type StackName =
  "CountyLensData" | "CountyLensApi" | "CountyLensWeb" | "CountyLensOps" | "CountyLensCert";
const STACK_ORDER: readonly StackName[] = [
  "CountyLensData",
  "CountyLensApi",
  "CountyLensWeb",
  "CountyLensOps",
  "CountyLensCert",
];

interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
  Metadata?: { cdk_nag?: { rules_to_suppress?: { id?: unknown; reason?: unknown }[] } };
}
interface FlatResource {
  stack: StackName;
  logicalId: string;
  resource: CfnResource;
}

// Resource types that bill by existing (A7, P0-19) or are banned by an AD.
const BANNED_TYPES: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /^AWS::Route53::HostedZone$/, why: "AD-13: DNS stays at Namecheap" },
  { pattern: /^AWS::SecretsManager::Secret$/, why: "AD-14: SSM SecureString only" },
  { pattern: /^AWS::KMS::Key$/, why: "A7: a CMK bills while idle; SSE-S3 only" },
  { pattern: /^AWS::WAFv2::/, why: "A7: WAF bills while idle" },
  { pattern: /^AWS::CertificateManager::Certificate$/, why: "Amplify issues its own certificate" },
  { pattern: /^AWS::RDS::/, why: "AD-18: no hosted database" },
  { pattern: /^AWS::Lambda::Url$/, why: "AD-09: a Function URL bypasses the HTTP API throttles" },
];

// CloudFormation types in this app that accept tags. A resource of one of these types without
// the project tag fails; any other resource that carries a Tags property is checked too.
const TAGGABLE_TYPES = new Set([
  "AWS::S3::Bucket",
  "AWS::CloudFront::Distribution",
  "AWS::IAM::Role",
  "AWS::SSM::Parameter",
  "AWS::Lambda::Function",
  "AWS::Logs::LogGroup",
  "AWS::SNS::Topic",
  "AWS::SQS::Queue",
  "AWS::ApiGatewayV2::Api",
  "AWS::ApiGatewayV2::Stage",
  "AWS::CloudWatch::Alarm",
  "AWS::Amplify::App",
  "AWS::Amplify::Branch",
]);

const PROJECT_TAG = { key: "project_name", value: "oracle-travis" };

// Region-literal pattern built from parts so this file never contains one itself.
const REGION_LITERAL = new RegExp(
  `\\b(${["eu", "us", "ap", "ca", "sa", "af", "me", "il"].join("|")})-` +
    `(north|south|east|west|central|northeast|southeast|northwest|southwest)-\\d\\b`,
);

const TEST_CONTEXT: Record<string, unknown> = {
  "countylens:githubRepository": "owner/repo",
  "countylens:githubRef": "feature/oracle-pipeline",
};
const contextOf =
  (ctx: Record<string, unknown>) =>
  (key: string): unknown =>
    ctx[key];

function synthAll(): {
  app: App;
  config: InfraConfig;
  stacks: CountyLensStacks;
  templates: Record<StackName, Template>;
} {
  // Same cdk.json context (feature flags, countylens:* keys) as `cdk synth`.
  const { app, config, stacks } = appUnderTest();
  const templates = {
    CountyLensData: Template.fromStack(stacks.data),
    CountyLensApi: Template.fromStack(stacks.api),
    CountyLensWeb: Template.fromStack(stacks.web),
    CountyLensOps: Template.fromStack(stacks.ops),
    CountyLensCert: Template.fromStack(stacks.cert),
  };
  return { app, config, stacks, templates };
}

function flatten(templates: Record<StackName, Template>): FlatResource[] {
  const out: FlatResource[] = [];
  for (const stack of STACK_ORDER) {
    const resources = (templates[stack].toJSON().Resources ?? {}) as Record<string, CfnResource>;
    for (const [logicalId, resource] of Object.entries(resources)) {
      out.push({ stack, logicalId, resource });
    }
  }
  return out;
}

/** Tags as CloudFormation renders them: a Key/Value list or a map (SSM, API Gateway v2). */
function tagsOf(props: Record<string, unknown> | undefined): Record<string, string> {
  const raw = props?.Tags;
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const entry of raw as { Key?: unknown; Value?: unknown }[]) {
      if (typeof entry.Key === "string" && typeof entry.Value === "string") {
        out[entry.Key] = entry.Value;
      }
    }
    return out;
  }
  if (raw && typeof raw === "object") return raw as Record<string, string>;
  return {};
}

/** Every property key reachable in a JSON value (for keys that must not exist anywhere). */
function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
  return into;
}

function listTsFiles(dir: string, skip: Set<string>): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full, skip));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("infra config (constitution III: region from config)", () => {
  it("synth throws when CDK_DEFAULT_REGION is missing", () => {
    expect(() => loadConfig({}, contextOf(TEST_CONTEXT))).toThrow(/CDK_DEFAULT_REGION/);
    expect(() => loadConfig({ CDK_DEFAULT_REGION: "   " }, contextOf(TEST_CONTEXT))).toThrow(
      /CDK_DEFAULT_REGION/,
    );
  });

  it("reads the region from CDK_DEFAULT_REGION and the GitHub repo/ref from context", () => {
    const config = loadConfig(process.env, contextOf(TEST_CONTEXT));
    expect(config.region).toBe(process.env.CDK_DEFAULT_REGION);
    expect(config.github).toEqual({ repository: "owner/repo", ref: "feature/oracle-pipeline" });
    expect(config.projectName).toBe(PROJECT_TAG.value);
  });

  it("rejects a malformed OPERATOR_EMAIL, account or GitHub repository", () => {
    const env = { CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION };
    expect(() =>
      loadConfig({ ...env, OPERATOR_EMAIL: "not-an-email" }, contextOf(TEST_CONTEXT)),
    ).toThrow(/OPERATOR_EMAIL/);
    expect(() =>
      loadConfig({ ...env, CDK_DEFAULT_ACCOUNT: "12" }, contextOf(TEST_CONTEXT)),
    ).toThrow(/CDK_DEFAULT_ACCOUNT/);
    expect(() =>
      loadConfig(env, contextOf({ ...TEST_CONTEXT, "countylens:githubRepository": "no-slash" })),
    ).toThrow(/githubRepository/);
    expect(() => loadConfig(env, contextOf({}))).toThrow(/countylens:githubRepository/);
  });
});

describe("CountyLens app: five stacks in the AM-02 order", () => {
  const { app, config, stacks, templates } = synthAll();
  const all = flatten(templates);

  it("has exactly CountyLensData, CountyLensApi, CountyLensWeb, CountyLensOps, CountyLensCert", () => {
    const names = app.node.children
      .filter((c): c is Stack => Stack.isStack(c))
      .map((s) => s.stackName);
    expect(names.sort()).toEqual([...STACK_ORDER].sort());
    expect(stacks.data.stackName).toBe("CountyLensData");
    expect(stacks.cert.stackName).toBe("CountyLensCert");
  });

  it("deploys Data → Api → Web → Ops → Cert (ARD § 16 AM-02) through addDependency", () => {
    const dependsOn = (s: Stack) => s.dependencies.map((d) => d.stackName);
    expect(dependsOn(stacks.data)).toEqual([]);
    expect(dependsOn(stacks.api)).toEqual(["CountyLensData"]);
    expect(dependsOn(stacks.web)).toEqual(["CountyLensApi"]);
    expect(dependsOn(stacks.ops)).toEqual(["CountyLensWeb"]);
    expect(dependsOn(stacks.cert)).toEqual(["CountyLensOps"]);
  });

  it("every stack takes its region from config, never from a literal", () => {
    for (const stack of Object.values(stacks)) {
      expect(stack.region).toBe(config.region);
      expect(stack.region).toBe(process.env.CDK_DEFAULT_REGION);
    }
  });

  it("no region literal in infra/**/*.ts (P0-18)", () => {
    const infraRoot = fileURLToPath(new URL("..", import.meta.url));
    const files = listTsFiles(infraRoot, new Set(["node_modules", "cdk.out", "coverage", "dist"]));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((f) => REGION_LITERAL.test(readFileSync(f, "utf8")))
      .map((f) => relative(infraRoot, f));
    expect(offenders).toEqual([]);
  });

  it("creates nothing that bills while idle (A7, P0-19): banned resource types are absent", () => {
    const found = all
      .map((r) => ({ ...r, ban: BANNED_TYPES.find((b) => b.pattern.test(r.resource.Type)) }))
      .filter((r) => r.ban !== undefined)
      .map((r) => `${r.stack}/${r.logicalId} (${r.resource.Type}: ${r.ban?.why})`);
    expect(found).toEqual([]);
  });

  it("A-03-TC-053: no Lambda sets ReservedConcurrentExecutions or a ProvisionedConcurrencyConfig (AD-11)", () => {
    const keys = collectKeys(
      Object.fromEntries(STACK_ORDER.map((s) => [s, templates[s].toJSON()])),
      new Set<string>(),
    );
    expect(keys.has("ReservedConcurrentExecutions")).toBe(false);
    expect(keys.has("ProvisionedConcurrencyConfig")).toBe(false);
  });

  it("tags project_name=oracle-travis on every stack and every taggable resource (constitution III)", () => {
    const assembly = app.synth();
    for (const name of STACK_ORDER) {
      expect(assembly.getStackByName(name).tags, `${name} stack tags`).toMatchObject({
        [PROJECT_TAG.key]: PROJECT_TAG.value,
      });
    }
    const untagged = all
      .filter(
        (r) => TAGGABLE_TYPES.has(r.resource.Type) || r.resource.Properties?.Tags !== undefined,
      )
      .filter((r) => tagsOf(r.resource.Properties)[PROJECT_TAG.key] !== PROJECT_TAG.value)
      .map((r) => `${r.stack}/${r.logicalId} (${r.resource.Type})`);
    expect(untagged).toEqual([]);
  });

  it("A-03-TC-052: every AWS::SQS::Queue has a RedrivePolicy or is a DLQ with exactly one alarm (AD-12)", () => {
    const queues = all.filter((r) => r.resource.Type === "AWS::SQS::Queue");
    const alarms = all.filter((r) => r.resource.Type === "AWS::CloudWatch::Alarm");
    const dlqTargets = new Set(
      queues
        .map((q) =>
          JSON.stringify(
            (q.resource.Properties?.RedrivePolicy as { deadLetterTargetArn?: unknown })
              ?.deadLetterTargetArn ?? null,
          ),
        )
        .filter((s) => s !== "null"),
    );
    for (const q of queues) {
      if (q.resource.Properties?.RedrivePolicy !== undefined) continue;
      const isDlq = [...dlqTargets].some((target) => target.includes(q.logicalId));
      expect(isDlq, `${q.stack}/${q.logicalId} has no RedrivePolicy and is not a DLQ`).toBe(true);
      const alarmsOnQueue = alarms.filter((a) =>
        JSON.stringify(a.resource.Properties).includes(q.logicalId),
      );
      expect(alarmsOnQueue, `${q.stack}/${q.logicalId} DLQ alarms`).toHaveLength(1);
    }
  });

  it("cdk-nag AwsSolutions: no unacknowledged finding, and every acknowledgement carries a documented reason", () => {
    // cdk-nag v3 reports through CDK's Validations API: synth already throws on an
    // unacknowledged finding; validateScope() gives the readable list for this assertion.
    for (const stack of Object.values(stacks)) {
      const report = new AwsSolutionsChecks(app, { verbose: true }).validateScope(stack);
      expect(
        report.violations.map(
          (v) =>
            `${v.ruleName}: ${v.violatingResources.map((r) => r.resourceLogicalId).join(", ")}`,
        ),
        `${stack.stackName} cdk-nag findings`,
      ).toEqual([]);
      expect(report.success, `${stack.stackName} cdk-nag success`).toBe(true);
    }
    const acknowledged = all.flatMap((r) =>
      (r.resource.Metadata?.cdk_nag?.rules_to_suppress ?? []).map((s) => ({
        ...s,
        at: `${r.stack}/${r.logicalId}`,
      })),
    );
    expect(
      acknowledged.length,
      "acknowledgements are written to the template metadata",
    ).toBeGreaterThan(0);
    for (const s of acknowledged) {
      expect(s.id, `${s.at} acknowledgement id`).toMatch(/^AwsSolutions-[A-Z0-9]+(\[.+\])?$/);
      expect(
        typeof s.reason === "string" && s.reason.length >= 40,
        `${s.at} ${String(s.id)} reason`,
      ).toBe(true);
    }
  });
});
