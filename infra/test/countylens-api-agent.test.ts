// A-14 T009 (write-only this pass; tasks.md "T016 ... done in a follow-up pass"). Asserts the
// agent-owned CDK resource block of CountyLensApi (infra/src/api-stack.ts): the agent Lambda
// (arm64, 1,769 MB per AD-27, timeout 25 s, no reserved concurrency — research.md "no reserved
// Lambda concurrency"), the spend-counter DynamoDB table (on-demand billing, data-model.md
// "Spend counter"), and the CloudWatch alarm at 80% of the $3/day cap (agent-design.md § "ash"
// > "Spend-cap + alarm design").
//
// EXPECTED RED until T016 (G-2, wave 1 follow-up, after oracle's concurrent MCP-Lambda edit to
// the same file lands first): today infra/src/api-stack.ts exports only the tRPC Lambda (`fn`)
// and no DynamoDB table or alarm, so every assertion below fails — intentionally, per the TDD
// ordering this builder pass was given. The constant names (`AGENT_FUNCTION_NAME`,
// `AGENT_MEMORY_MB`, `AGENT_TIMEOUT_SECONDS`, `SPEND_TABLE_NAME`, `SPEND_ALARM_THRESHOLD_USD`)
// are this builder's proposed contract for T016 to implement against; T016 may rename them, in
// which case this file's imports (not its assertions) need a one-line update.
import { Duration } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
// These six exports do not exist until T016 lands (expected red, see header): both `tsc
// --noEmit` and `vitest run` fail on this file until then, which is the correct state for this
// builder pass (ash builds T016 in the follow-up pass once oracle's concurrent MCP-Lambda edit
// to this same file is done).
import {
  AGENT_FUNCTION_NAME,
  AGENT_MEMORY_MB,
  AGENT_TIMEOUT_SECONDS,
  DAILY_SPEND_CAP_USD,
  SPEND_ALARM_THRESHOLD_USD,
  SPEND_TABLE_NAME,
} from "../src/api-stack.js";
import { appUnderTest } from "./helpers.js";

const TEST_OPERATOR_EMAIL = "countylens-tests@example.invalid";
process.env.OPERATOR_EMAIL ??= TEST_OPERATOR_EMAIL;

const SKIP_BUNDLING = { "aws:cdk:bundling-stacks": [] as string[] };

function synthApi(): { template: Template; resources: Record<string, unknown> } {
  const { stacks } = appUnderTest(SKIP_BUNDLING);
  const template = Template.fromStack(stacks.api);
  return { template, resources: template.toJSON().Resources as Record<string, unknown> };
}

describe("CountyLensApi agent resources (A-14 T009/T016): Lambda, spend table, 80% alarm", () => {
  it("the agent Lambda: arm64, 1,769 MB, 25 s timeout, no reserved or provisioned concurrency", () => {
    const { template } = synthApi();
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: AGENT_FUNCTION_NAME,
      Architectures: ["arm64"],
      MemorySize: AGENT_MEMORY_MB,
      Timeout: AGENT_TIMEOUT_SECONDS,
    });
    expect(AGENT_MEMORY_MB).toBe(1769);
    expect(AGENT_TIMEOUT_SECONDS).toBe(Duration.seconds(25).toSeconds());

    // No ReservedConcurrentExecutions/ProvisionedConcurrencyConfig anywhere in the stack
    // (research.md: the account's ConcurrentExecutions limit is 10, account-wide).
    const { resources } = synthApi();
    const allProps = JSON.stringify(Object.values(resources));
    expect(allProps).not.toContain("ReservedConcurrentExecutions");
    expect(allProps).not.toContain("ProvisionedConcurrencyConfig");
  });

  it("the spend-counter DynamoDB table: on-demand billing, pk only, no TTL", () => {
    const { template } = synthApi();
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: SPEND_TABLE_NAME,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [Match.objectLike({ AttributeName: "pk", KeyType: "HASH" })],
    });
    const { resources } = synthApi();
    const tables = Object.values(resources).filter(
      (r) => (r as { Type?: string }).Type === "AWS::DynamoDB::Table",
    ) as { Properties?: Record<string, unknown> }[];
    expect(tables).toHaveLength(1);
    expect(tables[0]?.Properties).not.toHaveProperty("TimeToLiveSpecification");
  });

  it("a CloudWatch alarm fires at 80% of the $3/day spend cap ($2.40)", () => {
    expect(DAILY_SPEND_CAP_USD).toBe(3);
    expect(SPEND_ALARM_THRESHOLD_USD).toBeCloseTo(2.4, 5);
    const { template } = synthApi();
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Threshold: SPEND_ALARM_THRESHOLD_USD,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
    });
  });
});

describe("CountyLensApi agent Bedrock grant (found on the first hosted call: the role had none)", () => {
  it("the agent role may invoke only the eu. Sonnet 4.6 profile and its base models via that profile, nothing broader", () => {
    const { stacks } = appUnderTest({ "aws:cdk:bundling-stacks": [] as string[] });
    const policies = Template.fromStack(stacks.api).findResources("AWS::IAM::Policy");
    const statements = Object.values(policies).flatMap(
      (p) =>
        (p.Properties as { PolicyDocument: { Statement: Array<Record<string, unknown>> } })
          .PolicyDocument.Statement,
    );
    const bedrock = statements.filter((s) => JSON.stringify(s.Action).includes("bedrock:"));
    expect(bedrock).toHaveLength(1);
    const [statement] = bedrock as [Record<string, unknown>];
    expect(statement.Effect).toBe("Allow");
    expect(statement.Action).toEqual([
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]);
    const text = JSON.stringify(statement);
    expect(text).toContain("inference-profile/eu.anthropic.claude-sonnet-4-6");
    expect(text).toContain("foundation-model/anthropic.claude-sonnet-4-6");
    expect(text).toContain("bedrock:InferenceProfileArn");
    expect(text).not.toMatch(/"Resource":"\*"/);
  });
});
