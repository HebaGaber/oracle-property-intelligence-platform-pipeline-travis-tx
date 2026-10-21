// CountyLensOps (A-03 T075): operations with nothing that bills while idle (plan § "Idle-cost
// justification per resource"). One SNS topic with the operator's email subscription (the
// PagerDuty substitute, plan Complexity Tracking D-04; the address comes from OPERATOR_EMAIL
// and is never in git), three self-resolving alarms (Lambda Errors ≥ 1 per 5 min, Throttles ≥ 1,
// HTTP API 5xx ≥ 1; ALARM and OK both notify, missing data is not breaching so each clears
// itself), the $10 monthly budget with 80 % actual and 100 % forecast notifications (NFR-02,
// TC-052) as an AwsCustomResource over the Budgets API (CloudFormation has no
// AWS::Budgets::Budget type in the project region, F3006, and no stack may live in another
// region; a budget is an account-level object, so the call needs no regional resource), and the
// GitHub OIDC deploy role for ci.yml's `deploy` job (research R-09): the trust
// is limited to the fork's 0* story branches and feature/oracle-pipeline, and the role may only
// assume the CDK bootstrap roles (cdk-hnb659fds-*). The native OIDC provider is an L1 resource,
// so the only Lambda here is the budget's singleton provider, which runs on deploy only ($0 idle). Alarms reference the Api stack's function and HTTP
// API through cross-stack exports (ARD § 16 AM-02 order: Api before Ops).
import {
  Aws,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
  type StackProps,
} from "aws-cdk-lib";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as cr from "aws-cdk-lib/custom-resources";
import type { Construct } from "constructs";
import { acknowledgeWildcardResources, type ApiStack } from "./api-stack.js";
import { PROJECT_NAME, PROJECT_TAG_KEY, type InfraConfig } from "./config.js";

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
/** CloudFormation type of the budget custom resource (AwsCustomResource `resourceType`). */
export const BUDGET_RESOURCE_TYPE = "Custom::CountyLensBudget";
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

export class OpsStack extends Stack {
  readonly topic: sns.Topic;
  readonly alarms: readonly cw.Alarm[];
  readonly oidcProvider: iam.OidcProviderNative;
  readonly deployRole: iam.Role;
  readonly budget: cr.AwsCustomResource;

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

    this.budget = this.monthlyBudget(props.operatorEmail);

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
  /**
   * The $10 MONTHLY COST budget (NFR-02, TC-052): notifications only (a budget action bills per
   * day), 80 % actual and 100 % forecast to the operator email. Create/Update/Delete call the
   * Budgets API; the physical id is the budget name. Update replaces the budget definition only
   * (UpdateBudget); the two notifications are fixed at create.
   */
  private monthlyBudget(operatorEmail: string): cr.AwsCustomResource {
    const definition = {
      BudgetName: BUDGET_NAME,
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
      BudgetLimit: { Amount: String(MONTHLY_BUDGET_USD), Unit: "USD" },
    };
    const subscribers = [{ SubscriptionType: "EMAIL", Address: operatorEmail }];
    const notification = (NotificationType: string, Threshold: number) => ({
      Notification: {
        NotificationType,
        ComparisonOperator: "GREATER_THAN",
        Threshold,
        ThresholdType: "PERCENTAGE",
      },
      Subscribers: subscribers,
    });
    const physicalResourceId = cr.PhysicalResourceId.of(BUDGET_NAME);
    const budgetArn = this.formatArn({
      service: "budgets",
      region: "",
      resource: "budget",
      resourceName: BUDGET_NAME,
    });
    const logGroup = new logs.LogGroup(this, "BudgetProviderLogs", {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const budget = new cr.AwsCustomResource(this, "MonthlyBudget", {
      resourceType: BUDGET_RESOURCE_TYPE,
      installLatestAwsSdk: false,
      logGroup,
      timeout: Duration.minutes(2),
      onCreate: {
        service: "Budgets",
        action: "CreateBudget",
        parameters: {
          AccountId: Aws.ACCOUNT_ID,
          Budget: definition,
          NotificationsWithSubscribers: [
            notification("ACTUAL", 80),
            notification("FORECASTED", 100),
          ],
          ResourceTags: [{ Key: PROJECT_TAG_KEY, Value: PROJECT_NAME }],
        },
        physicalResourceId,
        logging: cr.Logging.withDataHidden(), // the operator email is in the parameters
      },
      onUpdate: {
        service: "Budgets",
        action: "UpdateBudget",
        parameters: { AccountId: Aws.ACCOUNT_ID, NewBudget: definition },
        physicalResourceId,
        logging: cr.Logging.withDataHidden(), // the operator email is in the parameters
      },
      onDelete: {
        service: "Budgets",
        action: "DeleteBudget",
        parameters: { AccountId: Aws.ACCOUNT_ID, BudgetName: BUDGET_NAME },
        physicalResourceId,
        logging: cr.Logging.withDataHidden(), // the operator email is in the parameters
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          sid: "MonthlyBudgetOnly",
          actions: ["budgets:ModifyBudget", "budgets:ViewBudget", "budgets:TagResource"],
          resources: [budgetArn],
        }),
      ]),
    });

    // The singleton provider Lambda: X-Ray active like every function here (NFR-03, TC-052).
    // The singleton lives at stack scope as "AWS" + the provider UUID without dashes.
    const provider = this.node.findChild(
      `AWS${cr.AwsCustomResource.PROVIDER_FUNCTION_UUID.replace(/-/g, "")}`,
    ) as lambda.Function;
    (provider.node.defaultChild as lambda.CfnFunction).tracingConfig = { mode: "Active" };
    provider.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
        resources: ["*"],
      }),
    );
    Validations.of(provider).acknowledge({
      id: "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
      reason:
        "AwsCustomResource's singleton provider uses AWSLambdaBasicExecutionRole for its own log " +
        "writes; it runs on deploy only and holds no permission beyond the budget statement and X-Ray.",
    });
    Validations.of(provider).acknowledge({
      id: "AwsSolutions-L1",
      reason:
        "The provider runtime is chosen by aws-cdk-lib for AwsCustomResource and moves with CDK upgrades.",
    });
    Validations.of(provider).acknowledge({
      id: "AwsSolutions-IAM5[Resource::*]",
      reason:
        "xray:PutTraceSegments and xray:PutTelemetryRecords support no resource-level permission " +
        "(the service accepts only *); active tracing on the provider (NFR-03).",
    });
    new CfnOutput(this, "BudgetName", {
      value: BUDGET_NAME,
      description: `AWS Budget of ${MONTHLY_BUDGET_USD} USD per month (80 % actual, 100 % forecast → email)`,
    });
    return budget;
  }
}
