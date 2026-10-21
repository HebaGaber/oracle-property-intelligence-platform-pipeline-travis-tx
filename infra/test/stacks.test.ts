// Whole-app CDK assertions for the five CountyLens stacks (A-03 T017; TC-052, TC-053).
// Rules asserted here come from the ARD (AD-11, AD-13, AD-14, NFR-02, P0-18, P0-19, § 16 AM-02)
// and the constitution (III: region from config, tag project_name=oracle-travis; A7: nothing
// that bills while idle). The region comes from CDK_DEFAULT_REGION exactly as in `cdk synth`:
// when it is unset these tests fail with the config error, never with a fallback literal.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { App, Stack, Tags } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";
import type { CountyLensStacks } from "../src/app.js";
import { loadConfig, type InfraConfig } from "../src/config.js";
import { BudgetStack } from "../src/ops-stack.js";
import { appUnderTest, cdkJsonContext } from "./helpers.js";

// The alarm and budget recipient is never in git: the Ops stack reads OPERATOR_EMAIL from the
// environment (CI variable, PO shell); the tests use this placeholder when it is unset.
const TEST_OPERATOR_EMAIL = "countylens-tests@example.invalid";
process.env.OPERATOR_EMAIL ??= TEST_OPERATOR_EMAIL;

/** Skip NodejsFunction bundling in unit tests (no esbuild, no npm, no network). */
const SKIP_BUNDLING = { "aws:cdk:bundling-stacks": [] as string[] };

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
  "AWS::XRay::SamplingRule",
  "AWS::IAM::OIDCProvider",
  "AWS::Budgets::Budget",
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
  // Same cdk.json context (feature flags, countylens:* keys) as `cdk synth`, bundling skipped.
  const { app, config, stacks } = appUnderTest(SKIP_BUNDLING);
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

/**
 * Tags as CloudFormation renders them: a Key/Value list or a map (SSM, API Gateway v2);
 * AWS::Budgets::Budget calls the list ResourceTags.
 */
function tagsOf(props: Record<string, unknown> | undefined): Record<string, string> {
  const raw = props?.Tags ?? props?.ResourceTags;
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

  it("deploys Data → Api → Web → Ops → Cert (ARD § 16 AM-02): explicit chain, and no stack depends on a later one", () => {
    // Cross-stack references (Data.bucket → Api, Api.fn → Ops, …) add implicit dependencies
    // next to the explicit addStackDependency chain; every one must point backwards in AM-02.
    const dependsOn = (s: Stack) => s.dependencies.map((d) => d.stackName as StackName);
    expect(dependsOn(stacks.data)).toEqual([]);
    expect(dependsOn(stacks.api)).toContain("CountyLensData");
    expect(dependsOn(stacks.web)).toContain("CountyLensApi");
    expect(dependsOn(stacks.ops)).toContain("CountyLensWeb");
    expect(dependsOn(stacks.cert)).toContain("CountyLensOps");
    for (const name of STACK_ORDER) {
      const stack = [stacks.data, stacks.api, stacks.web, stacks.ops, stacks.cert].find(
        (s) => s.stackName === name,
      ) as Stack;
      for (const dep of dependsOn(stack)) {
        expect(
          STACK_ORDER.indexOf(dep),
          `${name} depends on ${dep}, which must deploy earlier`,
        ).toBeLessThan(STACK_ORDER.indexOf(name));
      }
    }
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
      // cdk-nag AwsSolutions findings, or CDK's own template validator (F0001: an empty stack
      // that is deliberately unwired until its cross-stack props arrive).
      expect(s.id, `${s.at} acknowledgement id`).toMatch(
        /^(AwsSolutions-[A-Z0-9]+(\[.+\])?|CloudFormation-Validate::F\d{4})$/,
      );
      expect(
        typeof s.reason === "string" && s.reason.length >= 40,
        `${s.at} ${String(s.id)} reason`,
      ).toBe(true);
    }
  });
});

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
  Principal?: unknown;
  Condition?: Record<string, unknown>;
}
const asList = (a: string | string[]): string[] => (Array.isArray(a) ? a : [a]);
const json = (v: unknown): string => JSON.stringify(v);

describe("CountyLensOps: alarms → SNS email, $10 budget, GitHub OIDC deploy role (research R-09, D-04)", () => {
  const { config, stacks, templates } = synthAll();
  const all = flatten(templates);
  const ops = templates.CountyLensOps;
  const opsResources = ops.toJSON().Resources as Record<string, CfnResource>;
  const operatorEmail = process.env.OPERATOR_EMAIL as string;

  it("A-03-TC-052: every Lambda traces Active; function log groups keep 14 days, the API access log 30", () => {
    const functions = all.filter((r) => r.resource.Type === "AWS::Lambda::Function");
    expect(functions.length).toBeGreaterThan(0);
    const groups = new Map(
      all
        .filter((r) => r.resource.Type === "AWS::Logs::LogGroup")
        .map((r) => [`${r.stack}/${r.logicalId}`, r.resource] as const),
    );
    for (const fn of functions) {
      expect(fn.resource.Properties?.TracingConfig, `${fn.stack}/${fn.logicalId}`).toEqual({
        Mode: "Active",
      });
      const ref = (fn.resource.Properties as { LoggingConfig?: { LogGroup?: { Ref?: string } } })
        .LoggingConfig?.LogGroup?.Ref;
      expect(ref, `${fn.stack}/${fn.logicalId} has an explicit log group`).toBeDefined();
      expect(groups.get(`${fn.stack}/${ref}`)?.Properties?.RetentionInDays).toBe(14);
    }
    const stages = all.filter((r) => r.resource.Type === "AWS::ApiGatewayV2::Stage");
    expect(stages).toHaveLength(1);
    const arn = json(
      (stages[0]?.resource.Properties as { AccessLogSettings?: { DestinationArn?: unknown } })
        .AccessLogSettings?.DestinationArn,
    );
    const accessGroup = [...groups.entries()].find(([key]) =>
      arn.includes(`"${key.split("/")[1]}"`),
    );
    expect(accessGroup, "the stage's access log group is in the app").toBeDefined();
    expect(accessGroup?.[1].Properties?.RetentionInDays).toBe(30);
    for (const [, group] of groups) {
      expect([14, 30]).toContain(group.Properties?.RetentionInDays);
    }
  });

  it("A-03-TC-052: one SNS topic with exactly one email subscription from OPERATOR_EMAIL, SSL enforced", () => {
    ops.resourceCountIs("AWS::SNS::Topic", 1);
    ops.resourceCountIs("AWS::SNS::Subscription", 1);
    ops.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: operatorEmail,
      TopicArn: { Ref: Match.anyValue() },
    });
    const [, policy] = Object.entries(ops.findResources("AWS::SNS::TopicPolicy"))[0] ?? [];
    expect(policy, "topic policy (enforceSSL)").toBeDefined();
    expect(json(policy?.Properties)).toContain('"aws:SecureTransport":"false"');
    ops.resourceCountIs("AWS::KMS::Key", 0);
  });

  it("the operator email is never in git: no email literal in infra/src or infra/bin", () => {
    const infraRoot = fileURLToPath(new URL("..", import.meta.url));
    const files = [
      ...listTsFiles(join(infraRoot, "src"), new Set()),
      ...listTsFiles(join(infraRoot, "bin"), new Set()),
    ];
    expect(files.length).toBeGreaterThan(0);
    const emailLiteral = /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}\b/i;
    const offenders = files
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return emailLiteral.test(text) || text.includes(operatorEmail);
      })
      .map((f) => relative(infraRoot, f));
    expect(offenders).toEqual([]);
    expect(readFileSync(join(infraRoot, "cdk.json"), "utf8")).not.toMatch(emailLiteral);
  });

  it("A-03-TC-052: three alarms (Lambda Errors ≥ 1 / 5 min, Throttles ≥ 1, HTTP API 5xx ≥ 1), each ALARM + OK → the topic, notBreaching", () => {
    const alarms = Object.values(ops.findResources("AWS::CloudWatch::Alarm"));
    expect(alarms).toHaveLength(3);
    const [topicId] = Object.keys(ops.findResources("AWS::SNS::Topic"));
    const metrics = alarms
      .map((a) => {
        const p = a.Properties as {
          Namespace: string;
          MetricName: string;
          Dimensions?: { Name: string }[];
        };
        return `${p.Namespace}/${p.MetricName}[${(p.Dimensions ?? []).map((d) => d.Name).join(",")}]`;
      })
      .sort();
    expect(metrics).toEqual([
      "AWS/ApiGateway/5xx[ApiId]",
      "AWS/Lambda/Errors[FunctionName]",
      "AWS/Lambda/Throttles[FunctionName]",
    ]);
    for (const a of alarms) {
      expect(a.Properties).toMatchObject({
        Statistic: "Sum",
        Period: 300,
        EvaluationPeriods: 1,
        Threshold: 1,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        TreatMissingData: "notBreaching",
        AlarmActions: [{ Ref: topicId }],
        OKActions: [{ Ref: topicId }],
      });
      // The function name and API id come from CountyLensApi (cross-stack exports).
      expect(json(a.Properties?.Dimensions)).toMatch(/Fn::GetStackOutput|Fn::ImportValue/);
      expect(json(a.Properties?.Dimensions)).toContain("CountyLensApi");
    }
  });

  // AWS::Budgets::Budget exists only in US East (N. Virginia) as a CloudFormation type, so the budget is its
  // own stack (BudgetStack) whose region comes from the environment: BUDGET_REGION=<region>
  // runs this case; without it the case is skipped, never faked.
  it.skipIf(!process.env.BUDGET_REGION)(
    "A-03-TC-052: AWS::Budgets::Budget 10 USD monthly, notifications at 80 % actual and 100 % forecast to the operator email, no budget action",
    () => {
      ops.resourceCountIs("AWS::Budgets::Budget", 0);
      const budgetApp = new App({ context: { ...cdkJsonContext(), ...SKIP_BUNDLING } });
      const stack = new BudgetStack(budgetApp, "CountyLensBudget", {
        env: { region: process.env.BUDGET_REGION },
        tags: { [PROJECT_TAG.key]: PROJECT_TAG.value },
        operatorEmail,
      });
      Tags.of(budgetApp).add(PROJECT_TAG.key, PROJECT_TAG.value);
      const budgetTemplate = Template.fromStack(stack);
      budgetTemplate.resourceCountIs("AWS::Budgets::Budget", 1);
      budgetTemplate.resourceCountIs("AWS::Budgets::BudgetsAction", 0);
      budgetTemplate.hasResourceProperties("AWS::Budgets::Budget", {
        ResourceTags: [{ Key: PROJECT_TAG.key, Value: PROJECT_TAG.value }],
      });
      budgetAssertions(budgetTemplate, operatorEmail);
    },
  );

  function budgetAssertions(ops: Template, operatorEmail: string): void {
    ops.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({
        BudgetType: "COST",
        TimeUnit: "MONTHLY",
        BudgetLimit: { Amount: 10, Unit: "USD" },
      }),
    });
    const [, budget] = Object.entries(ops.findResources("AWS::Budgets::Budget"))[0] as [
      string,
      CfnResource,
    ];
    const notifications = (
      budget.Properties as {
        NotificationsWithSubscribers: {
          Notification: Record<string, unknown>;
          Subscribers: { SubscriptionType: string; Address: string }[];
        }[];
      }
    ).NotificationsWithSubscribers;
    expect(notifications.map((n) => n.Notification)).toEqual([
      {
        NotificationType: "ACTUAL",
        ComparisonOperator: "GREATER_THAN",
        Threshold: 80,
        ThresholdType: "PERCENTAGE",
      },
      {
        NotificationType: "FORECASTED",
        ComparisonOperator: "GREATER_THAN",
        Threshold: 100,
        ThresholdType: "PERCENTAGE",
      },
    ]);
    for (const n of notifications) {
      expect(n.Subscribers).toEqual([{ SubscriptionType: "EMAIL", Address: operatorEmail }]);
    }
  }

  it("GitHub OIDC: one native provider; the deploy role trusts only the fork's 0* and feature/oracle-pipeline refs and may assume only cdk-hnb659fds-* roles", () => {
    ops.resourceCountIs("AWS::IAM::OIDCProvider", 1);
    ops.hasResourceProperties("AWS::IAM::OIDCProvider", {
      Url: "https://token.actions.githubusercontent.com",
      ClientIdList: ["sts.amazonaws.com"],
    });
    // The L2 OpenIdConnectProvider would add a custom-resource Lambda; the native L1 does not.
    ops.resourceCountIs("AWS::Lambda::Function", 0);
    ops.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);

    const roles = Object.values(ops.findResources("AWS::IAM::Role"));
    expect(roles).toHaveLength(1);
    const role = roles[0]?.Properties as {
      RoleName?: string;
      AssumeRolePolicyDocument: { Statement: Statement[] };
      Policies?: { PolicyDocument: { Statement: Statement[] } }[];
      ManagedPolicyArns?: unknown[];
    };
    expect(role.RoleName).toBe("CountyLensGitHubDeploy");
    expect(role.ManagedPolicyArns ?? []).toEqual([]);

    const trust = role.AssumeRolePolicyDocument.Statement;
    expect(trust).toHaveLength(1);
    const [statement] = trust as [Statement];
    expect(asList(statement.Action)).toEqual(["sts:AssumeRoleWithWebIdentity"]);
    const [providerId] = Object.keys(ops.findResources("AWS::IAM::OIDCProvider"));
    expect(json(statement.Principal)).toContain(`"${providerId}"`);
    expect(json(statement.Principal)).not.toMatch(/Service|AWS"/);
    const repository = config.github.repository;
    expect(statement.Condition).toEqual({
      StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      StringLike: {
        "token.actions.githubusercontent.com:sub": [
          `repo:${repository}:ref:refs/heads/0*`,
          `repo:${repository}:ref:refs/heads/${config.github.ref}`,
        ],
      },
    });

    const inline = (role.Policies ?? []).flatMap((p) => p.PolicyDocument.Statement);
    const attached = Object.values(ops.findResources("AWS::IAM::Policy")).flatMap(
      (p) =>
        (p.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument.Statement ??
        [],
    );
    const statements = [...inline, ...attached];
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      expect(s.Effect).toBe("Allow");
      expect(asList(s.Action)).toEqual(["sts:AssumeRole"]);
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      for (const r of resources) {
        const rendered = json(r);
        expect(rendered).toContain(":role/cdk-hnb659fds-*");
        // The account from CDK_DEFAULT_ACCOUNT, or the AWS::AccountId pseudo parameter when unset.
        expect(rendered).toMatch(/AWS::AccountId|:iam::\d{12}:role\//);
        expect(rendered).not.toBe('"*"');
      }
    }
    ops.hasOutput("DeployRoleArn", { Value: { "Fn::GetAtt": [Match.anyValue(), "Arn"] } });
    ops.hasOutput("AlertsTopicArn", { Value: { Ref: Match.anyValue() } });
  });

  it("Ops has no Lambda, queue, key, secret or Function URL of its own; every alarm/topic is tagged", () => {
    for (const type of ["AWS::SQS::Queue", "AWS::KMS::Key", "AWS::SecretsManager::Secret"]) {
      ops.resourceCountIs(type, 0);
    }
    const tagged = Object.values(opsResources).filter((r) =>
      [
        "AWS::SNS::Topic",
        "AWS::CloudWatch::Alarm",
        "AWS::IAM::Role",
        "AWS::IAM::OIDCProvider",
      ].includes(r.Type),
    );
    expect(tagged.length).toBeGreaterThanOrEqual(6);
    for (const r of tagged) {
      expect(json(r.Properties?.Tags), r.Type).toContain(PROJECT_TAG.value);
    }
    expect(stacks.ops.stackName).toBe("CountyLensOps");
  });
});
