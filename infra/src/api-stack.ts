// CountyLensApi (A-03 T074): the tRPC Lambda behind an HTTP API. Sizing from ADR-0001 and ARD
// § 16 AM-06, updated by ERR-18 (arm64, 3,008 MB = 2 vCPU, 15 s, DuckDB threads 4, no reserved or
// provisioned concurrency: AD-11, account limit 10; per-invocation cost only, $0 idle; the AM-06
// text change is the PO's). The HTTP API is the only way in (AD-09: a Function URL would bypass
// the stage throttle of 10 rps / burst 20) and its JSON access log is the 30-day "query log"
// (AM-03); the function log group keeps 14 days. X-Ray is active on the function and a sampling
// rule with FixedRate 1 for service countylens-api records every request (NFR-004, research
// R-09). The function reads the CID copy through the Data stack's reader grant only (GetObject
// on ipfs/* and private/bench/*, contracts/storage.md) and presigns in-process; nothing here
// bills while idle (plan § "Idle-cost justification per resource").
//
// Bundling (research R-03, agent-design metagross § 5): NodejsFunction + esbuild, ESM, with
// `@duckdb/*` left external; afterBundling installs the linux/arm64/glibc DuckDB bindings at
// the exact version apps/api pins and places the `httpfs` extension where the engine's
// `extension_directory` (DUCKDB_EXTENSION_DIR) finds it. The DuckDB engine itself is
// apps/api/src/engine/duckdb-node.ts (T072); the handler is apps/api/src/handlers/trpc.ts (T073).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Validations,
} from "aws-cdk-lib";
import { AccessLogField, AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as xray from "aws-cdk-lib/aws-xray";
import type { Construct } from "constructs";
import type { DataStack } from "./data-stack.js";

/** Function name, Powertools service name and X-Ray sampling-rule service name (one identifier). */
export const API_FUNCTION_NAME = "countylens-api";
/** Powertools metrics namespace of the three business metrics (QueryDurationMs, ItemsProcessed, ItemsFailed). */
export const API_METRICS_NAMESPACE = "CountyLens";
/** FILEBASE_GATEWAY_HOST (plan § "Fixed texts and config keys"): the labelled fallback gateway. */
export const FILEBASE_GATEWAY_HOST = "ipfs.filebase.io";
/** The HTTP API route prefix; the Amplify rewrite maps the site's /api/<*> onto it (same origin). */
export const API_ROUTE_PATH = "/trpc/{proxy+}";
/** Stage throttle (AD-11, FR-007; TC-053). */
export const API_THROTTLE = { rateLimit: 10, burstLimit: 20 } as const;
/** ERR-18 sizing (ADR-0001 had 1,769 MB = 1 vCPU): 2 vCPU and more network for the cold read. */
export const API_MEMORY_MB = 3008;
/** 29 s: under the HTTP API integration limit (30 s). A full-county Explore search binds 200 table parts on a cold sandbox (A-13, Run 2); 15 s was not enough. */
export const API_TIMEOUT = Duration.seconds(29);
/** Retention (AD-16 as amended by AM-03): function log 14 days, access (query) log 30 days. */
export const FUNCTION_LOG_RETENTION = logs.RetentionDays.TWO_WEEKS;
export const ACCESS_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;
/** SSM String parameter mirroring the HttpApiUrl output. */
export const HTTP_API_URL_PARAMETER = "/countylens/api/http-api-url";

/** Where Lambda unpacks the asset; the extension directory is relative to it. */
export const LAMBDA_TASK_ROOT = "/var/task";
/** `<asset>/duckdb-extensions/<duckdb version>/<platform>/<name>.duckdb_extension` (DuckDB layout). */
export const DUCKDB_EXTENSION_DIR_NAME = "duckdb-extensions";
export const DUCKDB_PLATFORM = "linux_arm64";
export const DUCKDB_EXTENSIONS_ORIGIN = "https://extensions.duckdb.org";

const RUNTIME = lambda.Runtime.NODEJS_24_X;
/** esbuild target for the runtime above (`nodejs24.x` → `node24`). */
const ESBUILD_TARGET = `node${RUNTIME.name.replace(/^nodejs(\d+)\.x$/, "$1")}`;

const ENTRY = fileURLToPath(new URL("../../apps/api/src/handlers/trpc.ts", import.meta.url));
const API_PACKAGE_JSON = fileURLToPath(new URL("../../apps/api/package.json", import.meta.url));

/** The `@duckdb/node-api` version apps/api pins; the asset installs exactly that one. */
export function duckDbNodeApiVersion(): string {
  const pkg = JSON.parse(readFileSync(API_PACKAGE_JSON, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const version = pkg.dependencies?.["@duckdb/node-api"];
  if (version === undefined || !/^\d+\.\d+\.\d+(-r\.\d+)?$/.test(version)) {
    throw new Error(
      `apps/api/package.json must pin @duckdb/node-api to an exact version (found ${String(version)})`,
    );
  }
  return version;
}

/** DuckDB release of a node-api version: `1.5.6-r.2` → `v1.5.6` (extension repository layout). */
export function duckDbVersion(nodeApiVersion: string): string {
  return `v${nodeApiVersion.split("-")[0]}`;
}

/**
 * The esbuild/NodejsFunction options. Exposed so the CDK assertions check the options the
 * stack really uses: the shell commands below run on the synth machine (local esbuild; CI and
 * the PO laptop both have npm ≥ 10 and curl) and need no Docker.
 */
export function apiBundling(): nodejs.BundlingOptions {
  const nodeApi = duckDbNodeApiVersion();
  const release = duckDbVersion(nodeApi);
  return {
    platform: "node",
    target: ESBUILD_TARGET,
    format: nodejs.OutputFormat.ESM,
    mainFields: ["module", "main"],
    // ESM bundle: dependencies that still call require() get one from the entry's own URL.
    banner:
      "import { createRequire as __countylensRequire } from 'node:module';" +
      "const require = __countylensRequire(import.meta.url);",
    minify: true,
    keepNames: true,
    sourceMap: true,
    sourcesContent: false,
    // The DuckDB bindings are native (.node + libduckdb.so): never bundled, installed below for
    // the Lambda platform (apps/*/src/engine/** is the only importer, AD-19).
    externalModules: ["@duckdb/*"],
    forceDockerBundling: false,
    commandHooks: {
      beforeBundling: () => [],
      beforeInstall: () => [],
      afterBundling: (_inputDir: string, outputDir: string) => {
        const extensionDir = `${outputDir}/${DUCKDB_EXTENSION_DIR_NAME}/${release}/${DUCKDB_PLATFORM}`;
        return [
          `npm install --prefix ${outputDir} --os=linux --cpu=arm64 --libc=glibc ` +
            `--omit=dev --no-audit --no-fund --no-package-lock --ignore-scripts ` +
            `@duckdb/node-api@${nodeApi}`,
          `mkdir -p ${extensionDir}`,
          `curl -fsSL ${DUCKDB_EXTENSIONS_ORIGIN}/${release}/${DUCKDB_PLATFORM}/httpfs.duckdb_extension.gz ` +
            `| gunzip -c > ${extensionDir}/httpfs.duckdb_extension`,
        ];
      },
    },
  };
}

/**
 * cdk-nag's rendering of a policy resource (its `flattenCfnReference`): Join pieces concatenated,
 * `${x}` → `<x>`, Ref/GetAtt → `<id>` / `<id.attr>`, anything else JSON. Used to build the exact
 * `AwsSolutions-IAM5[Resource::…]` ids cdk-nag v3 requires (it matches ids literally).
 */
export function nagResourceSuffix(node: unknown): string {
  if (node === undefined) return "";
  if (typeof node === "string") return node.replace(/\$\{/g, "<").replace(/\}/g, ">");
  const o = node as Record<string, unknown>;
  if (Array.isArray(o["Fn::Join"])) {
    const [delimiter, items] = o["Fn::Join"] as [string, unknown[]];
    return items.map(nagResourceSuffix).join(delimiter);
  }
  if (o["Fn::Sub"] !== undefined) return nagResourceSuffix(o["Fn::Sub"]);
  if (Array.isArray(o["Fn::GetAtt"])) {
    const [resource, attribute] = o["Fn::GetAtt"] as [unknown, unknown];
    return `<${nagResourceSuffix(resource)}.${nagResourceSuffix(attribute)}>`;
  }
  if (o["Fn::ImportValue"] !== undefined) return nagResourceSuffix(o["Fn::ImportValue"]);
  if (o.Ref !== undefined) return `<${nagResourceSuffix(o.Ref)}>`;
  return JSON.stringify(node);
}

/**
 * Acknowledge `AwsSolutions-IAM5[Resource::<r>]` for every Allow resource of `documents` that
 * contains a wildcard and satisfies `accept`, with the exact id cdk-nag will report. Runs as a
 * construct validation: after cross-stack references resolve (so a bucket ARN from another stack
 * renders as it will in the template) and before the validation plugins read the metadata.
 */
export function acknowledgeWildcardResources(
  scope: Construct,
  documents: () => unknown[],
  accept: (resource: string) => boolean,
  reason: string,
): void {
  scope.node.addValidation({
    validate: () => {
      const stack = Stack.of(scope);
      const acknowledged = new Set<string>();
      for (const document of documents()) {
        const resolved = stack.resolve(document) as { Statement?: Record<string, unknown>[] };
        for (const statement of resolved.Statement ?? []) {
          if (statement.Effect !== "Allow") continue;
          const resources = Array.isArray(statement.Resource)
            ? statement.Resource
            : [statement.Resource];
          for (const resource of resources.map(nagResourceSuffix)) {
            if (!resource.includes("*") || !accept(resource) || acknowledged.has(resource))
              continue;
            acknowledged.add(resource);
            Validations.of(scope).acknowledge({
              id: `AwsSolutions-IAM5[Resource::${resource}]`,
              reason,
            });
          }
        }
      }
      return [];
    },
  });
}

export interface ApiStackProps extends StackProps {
  /** CountyLensData: the CID copy the function reads (bucket, CloudFront host, private prefix). */
  readonly data: DataStack;
}

export class ApiStack extends Stack {
  readonly fn: nodejs.NodejsFunction;
  readonly httpApi: apigwv2.HttpApi;
  readonly stage: apigwv2.HttpStage;
  /** `https://{id}.execute-api.{region}.amazonaws.com` (no trailing slash): the Web rewrite target. */
  readonly httpApiUrl: string;
  readonly functionLogGroup: logs.LogGroup;
  /** The query log (AM-03): one JSON line per request, 30 days. */
  readonly accessLogGroup: logs.LogGroup;
  /** The NodejsFunction bundling options in use (asserted by infra/test/api.test.ts). */
  readonly bundling: nodejs.BundlingOptions;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.functionLogGroup = new logs.LogGroup(this, "FunctionLogs", {
      retention: FUNCTION_LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.accessLogGroup = new logs.LogGroup(this, "AccessLogs", {
      retention: ACCESS_LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Execution role without the AWS managed basic policy: log writes are scoped to the one
    // log group; X-Ray (resource "*" by design of the service) and the S3 reads are added below.
    const role = new iam.Role(this, "FunctionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: `Execution role of ${API_FUNCTION_NAME}: its own log group, X-Ray, GetObject on the CID copy's ipfs/* and private/bench/*`,
      inlinePolicies: {
        FunctionLogs: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "WriteOwnLogGroup",
              actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [this.functionLogGroup.logGroupArn],
            }),
          ],
        }),
      },
    });

    this.bundling = apiBundling();
    this.fn = new nodejs.NodejsFunction(this, "Trpc", {
      functionName: API_FUNCTION_NAME,
      description:
        "CountyLens tRPC API: runs.summary, query.radius, query.roofAge over @duckdb/node-api and " +
        "presigned reads of the CID copy (ADR-0001 sizing; bench event by direct invoke only)",
      entry: ENTRY,
      handler: "handler",
      runtime: RUNTIME,
      architecture: lambda.Architecture.ARM_64,
      memorySize: API_MEMORY_MB,
      timeout: API_TIMEOUT,
      role,
      tracing: lambda.Tracing.ACTIVE,
      loggingFormat: lambda.LoggingFormat.JSON,
      systemLogLevelV2: lambda.SystemLogLevel.WARN,
      applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
      logGroup: this.functionLogGroup,
      environment: {
        // apps/api/src/config.ts (Zod): the four required keys.
        CID_COPY_BUCKET: props.data.bucket.bucketName,
        CID_COPY_HOST: props.data.distribution.distributionDomainName,
        FILEBASE_GATEWAY_HOST,
        READPATH_PRIVATE_PREFIX: props.data.privateBenchPrefix,
        // apps/api/src/engine/duckdb-node.ts (EXTENSION_DIRECTORY_ENV): DuckDB's
        // `extension_directory`; httpfs sits at <dir>/<release>/<platform>/httpfs.duckdb_extension.
        DUCKDB_EXTENSION_DIRECTORY: `${LAMBDA_TASK_ROOT}/${DUCKDB_EXTENSION_DIR_NAME}`,
        // Powertools Logger / Tracer / Metrics (constitution VIII).
        POWERTOOLS_SERVICE_NAME: API_FUNCTION_NAME,
        POWERTOOLS_METRICS_NAMESPACE: API_METRICS_NAMESPACE,
        POWERTOOLS_LOG_LEVEL: "INFO",
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: this.bundling,
    });
    // Reader grant (contracts/storage.md): GetObject on ipfs/* and private/bench/* only.
    props.data.grantApiRead(this.fn);

    // HTTP API: routes under /trpc only; any other path is a gateway 404 and never invokes the
    // function (contracts/api.md). No CORS: the site reaches it same-origin via Amplify.
    this.httpApi = new apigwv2.HttpApi(this, "Http", {
      apiName: API_FUNCTION_NAME,
      description:
        "CountyLens tRPC over HTTP API v2; reached as /api/trpc/* through the Amplify rewrite",
      createDefaultStage: false,
    });
    this.httpApi.addRoutes({
      path: API_ROUTE_PATH,
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("Trpc", this.fn, {
        payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0,
      }),
    });
    this.stage = new apigwv2.HttpStage(this, "Default", {
      httpApi: this.httpApi,
      stageName: "$default",
      autoDeploy: true,
      throttle: { ...API_THROTTLE },
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(this.accessLogGroup),
        // Identifiers and counts only (FR-007): no caller identity, no query string.
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: AccessLogField.contextRequestId(),
            requestTime: AccessLogField.contextRequestTimeEpoch(),
            httpMethod: AccessLogField.contextHttpMethod(),
            routeKey: AccessLogField.contextRouteKey(),
            path: AccessLogField.contextPath(),
            status: AccessLogField.contextStatus(),
            responseLength: AccessLogField.contextResponseLength(),
            responseLatency: AccessLogField.contextResponseLatency(),
            integrationLatency: AccessLogField.contextIntegrationLatency(),
            integrationError: "$context.integrationErrorMessage",
          }),
        ),
      },
    });
    this.httpApiUrl = this.httpApi.apiEndpoint;

    // X-Ray samples 100 % of countylens-api (NFR-004); the rule is free while idle.
    new xray.CfnSamplingRule(this, "SampleAll", {
      samplingRule: {
        ruleName: API_FUNCTION_NAME,
        priority: 1000,
        fixedRate: 1,
        reservoirSize: 1,
        serviceName: API_FUNCTION_NAME,
        serviceType: "*",
        host: "*",
        httpMethod: "*",
        urlPath: "*",
        resourceArn: "*",
        version: 1,
      },
    });

    // cdk-nag acknowledgements, each with its reason (constitution: findings acknowledged, not hidden).
    Validations.of(this.httpApi).acknowledge({
      id: "AwsSolutions-APIG4",
      reason:
        "Public read-only queries over published open data (AD-09, contracts/api.md): every procedure is " +
        "a tRPC query with Zod-validated input, nothing mutates, and the stage throttle (10 rps / burst 20) " +
        "bounds the only compute. An authorizer would add a Cognito or Lambda resource that no user has.",
    });
    const defaultPolicy = role.node.tryFindChild("DefaultPolicy") as iam.Policy | undefined;
    if (defaultPolicy !== undefined) {
      Validations.of(defaultPolicy).acknowledge({
        id: "AwsSolutions-IAM5[Resource::*]",
        reason:
          "xray:PutTraceSegments and xray:PutTelemetryRecords support no resource-level permission " +
          "(the service accepts only *); this is the active-tracing policy CDK attaches (NFR-03).",
      });
      // The reader grant's resources are cross-stack references whose rendered form is only known
      // once references resolve; the exact finding ids are acknowledged then (see the helper).
      acknowledgeWildcardResources(
        defaultPolicy,
        () => [(defaultPolicy.node.defaultChild as iam.CfnPolicy).policyDocument],
        (resource) => /\/(ipfs|private\/bench)\/\*$/.test(resource),
        "GetObject on <bucket>/ipfs/* and <bucket>/private/bench/* is the exact reader boundary of " +
          "contracts/storage.md: objects are keyed by CID under ipfs/, the bench prefix is private and " +
          "deleted after TC-NF-05; s3:ListBucket only with s3:prefix private/bench/*, no Put or Delete (Data.grantApiRead).",
      );
    }

    new CfnOutput(this, "HttpApiUrl", {
      value: this.httpApiUrl,
      description: `HTTP API invoke URL, no trailing slash (mirrored to SSM ${HTTP_API_URL_PARAMETER}); the Web /api/<*> rewrite target`,
    });
    new CfnOutput(this, "ApiFunctionName", {
      value: this.fn.functionName,
      description: "Lambda function name (aws lambda invoke target of the TC-NF-05 bench event)",
    });
    new CfnOutput(this, "ApiFunctionLogGroupName", {
      value: this.functionLogGroup.logGroupName,
      description:
        "Function log group (14 days): the one JSON line per request with correlation_id (TC-050)",
    });
    new CfnOutput(this, "ApiAccessLogGroupName", {
      value: this.accessLogGroup.logGroupName,
      description: "HTTP API access log group (30 days): the query log (AM-03)",
    });
    new ssm.StringParameter(this, "HttpApiUrlParameter", {
      parameterName: HTTP_API_URL_PARAMETER,
      stringValue: this.httpApiUrl,
      description: "HTTP API invoke URL (CountyLensApi output HttpApiUrl)",
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}
