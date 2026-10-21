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
    description:
      "CountyLens API: tRPC Lambda behind an HTTP API with access log and X-Ray (filled in W3).",
  });
  const web = new WebStack(app, "CountyLensWeb", {
    ...base,
    description: "CountyLens web: Amplify Hosting app and branches for apps/web (filled in W3).",
  });
  const ops = new OpsStack(app, "CountyLensOps", {
    ...base,
    description:
      "CountyLens operations: SNS email, alarms, $10 budget and the GitHub OIDC deploy role (filled in W3).",
  });
  const cert = new CertStack(app, "CountyLensCert", {
    ...base,
    description: "CountyLens domain: the Amplify custom-domain association only (filled in W3).",
  });

  // Deploy order (ARD § 16 AM-02): Cert last because the domain association needs the Web app.
  api.addStackDependency(data, "AM-02: Api reads the Data bucket");
  web.addStackDependency(api, "AM-02: Web rewrites /api to the HTTP API");
  ops.addStackDependency(web, "AM-02: Ops alarms reference Api and Web");
  cert.addStackDependency(ops, "AM-02: the domain association needs the Web app and branch");

  // W2 stubs: CDK's template validator flags an empty Resources section. Each W3 group removes
  // the acknowledgement for its stack with its first resource; the first deploy is gated on D-10.
  for (const stub of [api, web, ops, cert]) {
    Validations.of(stub).acknowledge({
      id: "CloudFormation-Validate::F0001",
      reason:
        `${stub.stackName} is an empty stub in A-03 wave W2 (tasks.md T018); its resources arrive in W3 ` +
        "and the first deploy (D-10) comes after that. Remove this acknowledgement with the first resource.",
    });
  }

  Tags.of(app).add(PROJECT_TAG_KEY, config.projectName);
  Validations.of(app).addPlugins(
    new AwsSolutionsChecks(app, { verbose: true, writeSuppressionsToCloudFormation: true }),
  );

  return { data, api, web, ops, cert };
}
