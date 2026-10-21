// The CountyLens CDK app (A-03 T018): five stacks in one App, deployed in the ARD § 16 AM-02
// order Data → Api → Web → Ops → Cert, tagged project_name=oracle-travis, checked by the
// cdk-nag AwsSolutions pack. `bin/countylens.ts` calls this for `cdk synth`; the tests call it
// with the same config so assertions run against exactly what deploys.
import { App, Tags, Validations } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { ApiStack } from "./api-stack.js";
import { CertStack } from "./cert-stack.js";
import { PROJECT_TAG_KEY, type InfraConfig } from "./config.js";
import { DataStack } from "./data-stack.js";
import { OpsStack } from "./ops-stack.js";
import { WebStack } from "./web-stack.js";

export interface CountyLensStacks {
  readonly data: DataStack;
  readonly api: ApiStack;
  readonly web: WebStack;
  readonly ops: OpsStack;
  readonly cert: CertStack;
}

/** The Ops stack needs the alarm and budget recipient; it is never in git (CI variable, PO shell). */
function requireOperatorEmail(config: InfraConfig): string {
  if (config.operatorEmail === undefined) {
    throw new Error(
      "infra config: OPERATOR_EMAIL is not set; export the alarm and budget recipient " +
        "(repository variable OPERATOR_EMAIL in CI, your own shell for a local synth). Never commit it.",
    );
  }
  return config.operatorEmail;
}

export function createCountyLensStacks(app: App, config: InfraConfig): CountyLensStacks {
  // `account` is only set when the CLI resolved it; synth stays env-agnostic without it.
  const env =
    config.account === undefined
      ? { region: config.region }
      : { account: config.account, region: config.region };
  // Stack-level tags (CloudFormation propagates them) are explicit props under the
  // @aws-cdk/core:explicitStackTags flag; Tags.of(app) below tags every resource.
  const base = { env, tags: { [PROJECT_TAG_KEY]: config.projectName } };

  const data = new DataStack(app, "CountyLensData", {
    ...base,
    description:
      "CountyLens CID copy: private S3 bucket + CloudFront (OAC, origin path /ipfs) serving elephant-cli output by CID (AD-02).",
  });
  const api = new ApiStack(app, "CountyLensApi", {
    ...base,
    data,
    description:
      "CountyLens API: tRPC Lambda (arm64, 1,769 MB, 15 s) behind an HTTP API with a 30-day JSON access log and X-Ray (AD-09, AM-03, AM-06).",
  });
  const web = new WebStack(app, "CountyLensWeb", {
    ...base,
    github: config.github,
    httpApiUrl: api.httpApiUrl,
    cidCopyHost: data.distribution.distributionDomainName,
    description:
      "CountyLens web: Amplify Hosting app and branches for apps/web; /api/<*> rewritten to the HTTP API.",
  });
  const ops = new OpsStack(app, "CountyLensOps", {
    ...base,
    api,
    operatorEmail: requireOperatorEmail(config),
    description:
      "CountyLens operations: SNS email, alarms (Errors, Throttles, 5xx) and the $10 budget (no CI deploy role, AM-08).",
  });
  const cert = new CertStack(app, "CountyLensCert", {
    ...base,
    web: { appId: web.appId, branchName: web.productionBranchName },
    description: "CountyLens domain: the Amplify custom-domain association only (AD-13, AM-02).",
  });

  // Deploy order (ARD § 16 AM-02): Cert last because the domain association needs the Web app.
  api.addStackDependency(data, "AM-02: Api reads the Data bucket");
  web.addStackDependency(api, "AM-02: Web rewrites /api to the HTTP API");
  ops.addStackDependency(web, "AM-02: Ops alarms reference Api and Web");
  cert.addStackDependency(ops, "AM-02: the domain association needs the Web app and branch");

  Tags.of(app).add(PROJECT_TAG_KEY, config.projectName);
  Validations.of(app).addPlugins(
    new AwsSolutionsChecks(app, { verbose: true, writeSuppressionsToCloudFormation: true }),
  );

  return { data, api, web, ops, cert };
}
