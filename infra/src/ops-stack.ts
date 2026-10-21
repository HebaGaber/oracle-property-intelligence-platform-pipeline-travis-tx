// CountyLensOps (A-03 T075): operations with nothing that bills while idle (plan § "Idle-cost
// justification per resource"). One SNS topic with the operator's email subscription (the
// PagerDuty substitute, plan Complexity Tracking D-04; the address comes from OPERATOR_EMAIL
// and is never in git), three self-resolving alarms (Lambda Errors ≥ 1 per 5 min, Throttles ≥ 1,
// HTTP API 5xx ≥ 1; ALARM and OK both notify, missing data is not breaching so each clears
// itself), the $10 monthly budget with 80 % actual and 100 % forecast notifications (NFR-02,
// TC-052), and the GitHub OIDC deploy role for ci.yml's `deploy` job (research R-09): the trust
// is limited to the fork's 0* story branches and feature/oracle-pipeline, and the role may only
// assume the CDK bootstrap roles (cdk-hnb659fds-*). The native OIDC provider is an L1 resource,
// so no custom-resource Lambda is created. Alarms reference the Api stack's function and HTTP
// API through cross-stack exports (ARD § 16 AM-02 order: Api before Ops).
import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import { acknowledgeWildcardResources, type ApiStack } from "./api-stack.js";
import type { InfraConfig } from "./config.js";

export const ALERTS_TOPIC_NAME = "countylens-alerts";
/** Fixed so the repository variable AWS_DEPLOY_ROLE_ARN (ci.yml) is stable across deploys. */
export const DEPLOY_ROLE_NAME = "CountyLensGitHubDeploy";
export const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";
export const GITHUB_OIDC_AUDIENCE = "sts.amazonaws.com";
/** Story branches `NNN-slug` (constitution XX) deploy their previews; same pattern as Amplify's. */
export const STORY_BRANCH_PATTERN = "0*";
/** The default CDK bootstrap qualifier of this account (`cdk-hnb659fds-*` roles, ADR-0001 teardown proof). */
export const CDK_BOOTSTRAP_QUALIFIER = "hnb659fds";
export const MONTHLY_BUDGET_USD = 10;
export const BUDGET_NAME = "countylens-monthly";
/** Alarm evaluation window (FR-007: "Errors ≥ 1 per 5 min"); one period, threshold 1. */
export const ALARM_PERIOD = Duration.minutes(5);

const GITHUB_CLAIM = "token.actions.githubusercontent.com";

/** The OIDC `sub` claims GitHub Actions presents on a push to a branch of the fork. */
export function deploySubjects(github: InfraConfig["github"]): string[] {
  return [
    `repo:${github.repository}:ref:refs/heads/${STORY_BRANCH_PATTERN}`,
    `repo:${github.repository}:ref:refs/heads/${github.ref}`,
  ];
}

export interface OpsStackProps extends StackProps {
  /** CountyLensApi: the function and HTTP API the alarms watch. */
  readonly api: ApiStack;
  /** Alarm and budget recipient (OPERATOR_EMAIL, from the environment; never in git). */
  readonly operatorEmail: string;
  /** The fork (`owner/repo`) and its production branch: the deploy role's trust boundary. */
  readonly github: InfraConfig["github"];
}

export interface BudgetStackProps extends StackProps {
  /** Budget notification recipient (OPERATOR_EMAIL; never in git). */
  readonly operatorEmail: string;
}

/**
 * The $10 monthly cost budget (NFR-02, TC-052): notifications only (a budget action bills per
 * day), 80 % actual and 100 % forecast to the operator email. It is its own stack because the
 * AWS::Budgets::Budget CloudFormation type exists only in the US East (N. Virginia) region (CDK's
 * template validator rejects it in the project region, F3006). Not yet instantiated by src/app.ts:
 * deploying it needs a PO decision on a N. Virginia stack (CLAUDE.md allows it only for CloudFront, WAF and
 * CloudWatch Logs) and a config key for its region (never a literal, P0-18).
 */
export class BudgetStack extends Stack {
  readonly budget: budgets.CfnBudget;

  constructor(scope: Construct, id: string, props: BudgetStackProps) {
    super(scope, id, props);
    const subscribers = [{ subscriptionType: "EMAIL", address: props.operatorEmail }];
    this.budget = new budgets.CfnBudget(this, "Monthly", {
      budget: {
        budgetName: BUDGET_NAME,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: MONTHLY_BUDGET_USD, unit: "USD" },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 80,
            thresholdType: "PERCENTAGE",
          },
          subscribers,
        },
        {
          notification: {
            notificationType: "FORECASTED",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers,
        },
      ],
      // AWS::Budgets::Budget is not taggable through Tags.of(); the stack tags are copied by hand.
      resourceTags: Object.entries(this.tags.tagValues()).map(([key, value]) => ({ key, value })),
    });
    new CfnOutput(this, "BudgetName", {
      value: BUDGET_NAME,
      description: `AWS Budget of ${MONTHLY_BUDGET_USD} USD per month (80 % actual, 100 % forecast → email)`,
    });
  }
}

export class OpsStack extends Stack {
  readonly topic: sns.Topic;
  readonly alarms: readonly cw.Alarm[];
  readonly oidcProvider: iam.OidcProviderNative;
  readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: OpsStackProps) {
    super(scope, id, props);

    // Email channel. No KMS: a customer-managed key bills while idle (A7) and the AWS-managed
    // SNS key cannot be used by CloudWatch alarms; the messages carry alarm state names only.
    this.topic = new sns.Topic(this, "Alerts", {
      topicName: ALERTS_TOPIC_NAME,
      displayName: "CountyLens alerts",
      enforceSSL: true,
    });
    this.topic.addSubscription(new subs.EmailSubscription(props.operatorEmail));

    const notify = (alarm: cw.Alarm): cw.Alarm => {
      alarm.addAlarmAction(new cwActions.SnsAction(this.topic));
      alarm.addOkAction(new cwActions.SnsAction(this.topic));
      return alarm;
    };
    const alarm = (
      alarmId: string,
      alarmName: string,
      metric: cw.Metric,
      alarmDescription: string,
    ): cw.Alarm =>
      notify(
        new cw.Alarm(this, alarmId, {
          alarmName,
          alarmDescription,
          metric,
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          // Zero traffic is healthy: the alarm clears itself when the next window has no errors.
          treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        }),
      );
    const sum = { period: ALARM_PERIOD, statistic: "Sum" };
    this.alarms = [
      alarm(
        "LambdaErrors",
        "countylens-api-errors",
        props.api.fn.metricErrors(sum),
        "countylens-api: one or more invocation errors in 5 minutes (FR-007)",
      ),
      alarm(
        "LambdaThrottles",
        "countylens-api-throttles",
        props.api.fn.metricThrottles(sum),
        "countylens-api: one or more throttled invocations in 5 minutes (account concurrency limit 10, AD-11)",
      ),
      alarm(
        "HttpApi5xx",
        "countylens-api-5xx",
        props.api.httpApi.metricServerError(sum),
        "countylens-api HTTP API: one or more 5xx responses in 5 minutes (FR-007)",
      ),
    ];

    // The $10 budget is BudgetStack (below): the AWS::Budgets::Budget CloudFormation type exists
    // only in US East (N. Virginia), so it cannot live in this region-locked stack (🛑 needs a PO decision).

    // GitHub OIDC (native L1: no custom-resource Lambda). IAM fetches the thumbprint itself.
    this.oidcProvider = new iam.OidcProviderNative(this, "GitHub", {
      url: GITHUB_OIDC_URL,
      clientIds: [GITHUB_OIDC_AUDIENCE],
    });
    this.deployRole = new iam.Role(this, "GitHubDeploy", {
      roleName: DEPLOY_ROLE_NAME,
      description:
        `cdk deploy from ci.yml on the fork's ${STORY_BRANCH_PATTERN} and ${props.github.ref} branches only; ` +
        `may assume only the cdk-${CDK_BOOTSTRAP_QUALIFIER}-* bootstrap roles`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.OpenIdConnectPrincipal(this.oidcProvider, {
        StringEquals: { [`${GITHUB_CLAIM}:aud`]: GITHUB_OIDC_AUDIENCE },
        StringLike: { [`${GITHUB_CLAIM}:sub`]: deploySubjects(props.github) },
      }),
      inlinePolicies: {
        AssumeCdkBootstrapRoles: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "AssumeCdkBootstrapRolesOnly",
              actions: ["sts:AssumeRole"],
              resources: [
                this.formatArn({
                  service: "iam",
                  region: "",
                  resource: "role",
                  resourceName: `cdk-${CDK_BOOTSTRAP_QUALIFIER}-*`,
                }),
              ],
            }),
          ],
        }),
      },
    });
    acknowledgeWildcardResources(
      this.deployRole,
      () =>
        (
          (this.deployRole.node.defaultChild as iam.CfnRole).policies as {
            policyDocument: unknown;
          }[]
        ).map((p) => p.policyDocument),
      (resource) => resource.endsWith(`:role/cdk-${CDK_BOOTSTRAP_QUALIFIER}-*`),
      "The only statement is sts:AssumeRole on arn:<partition>:iam::<account>:role/cdk-hnb659fds-*: the " +
        "CDK bootstrap roles (deploy, file-publishing, image-publishing, lookup) of this account's one " +
        "qualifier. Every deploy permission lives in those roles; this role holds none of its own.",
    );

    new CfnOutput(this, "AlertsTopicArn", {
      value: this.topic.topicArn,
      description: "SNS topic of the alarms (email subscription confirmed by the PO, ✋ A-3)",
    });
    new CfnOutput(this, "DeployRoleArn", {
      value: this.deployRole.roleArn,
      description:
        "GitHub OIDC deploy role: set the repository variable AWS_DEPLOY_ROLE_ARN to this value",
    });
    new CfnOutput(this, "GitHubOidcProviderArn", {
      value: this.oidcProvider.oidcProviderArn,
      description: "IAM OIDC provider for token.actions.githubusercontent.com",
    });
  }
}
