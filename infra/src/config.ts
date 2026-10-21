// Infra configuration (A-03 T018). The region is read from CDK_DEFAULT_REGION, which the CDK
// CLI sets from the AWS profile; it is never a literal in infra/** (constitution III, ARD
// P0-18) and `cdk synth` throws when it is missing, or when it is not in the
// `countylens:allowedRegions` context list (infra/cdk.json; the project is region-locked, so a
// stray CDK_DEFAULT_REGION/AWS_REGION can never put a stack elsewhere: metagross review M3).
// OPERATOR_EMAIL feeds the Ops stack (SNS subscription, budget); the GitHub repository and ref feed the Web and Cert stacks (Amplify)
// and come from CDK context (infra/cdk.json or `-c key=value`).
import { z } from "zod";

export const PROJECT_NAME = "oracle-travis" as const;
export const PROJECT_TAG_KEY = "project_name" as const;

export const CONTEXT_KEYS = {
  githubRepository: "countylens:githubRepository",
  githubRef: "countylens:githubRef",
  allowedRegions: "countylens:allowedRegions",
} as const;

/** The context key listing the only regions a synth may target (infra/cdk.json). */
export const ALLOWED_REGIONS_CONTEXT_KEY = CONTEXT_KEYS.allowedRegions;

/** CDK_DEFAULT_REGION is not in `countylens:allowedRegions`: nothing is synthesised. */
export class RegionNotAllowedError extends Error {
  override readonly name = "RegionNotAllowedError";

  constructor(
    readonly region: string,
    readonly allowed: readonly string[],
  ) {
    super(
      `infra config: CDK_DEFAULT_REGION ${region} is not in ${ALLOWED_REGIONS_CONTEXT_KEY} ` +
        `[${allowed.join(", ")}] (infra/cdk.json). Check AWS_REGION / CDK_DEFAULT_REGION and the profile.`,
    );
  }
}

const REGION_HINT =
  "CDK_DEFAULT_REGION is not set; export it from the AWS profile, for example " +
  "`export CDK_DEFAULT_REGION=$(aws configure get region --profile assess)`. " +
  "The region is never a literal in infra/ (constitution III).";

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const EnvSchema = z.object({
  CDK_DEFAULT_REGION: z.string(REGION_HINT).trim().min(1, REGION_HINT),
  CDK_DEFAULT_ACCOUNT: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{12}$/, "CDK_DEFAULT_ACCOUNT must be a 12-digit AWS account id")
      .optional(),
  ),
  OPERATOR_EMAIL: z.preprocess(
    emptyToUndefined,
    z.email("OPERATOR_EMAIL must be an email address (alarm and budget recipient)").optional(),
  ),
});

const ContextSchema = z.object({
  [CONTEXT_KEYS.githubRepository]: z
    .string(
      `${CONTEXT_KEYS.githubRepository} is missing: set it in infra/cdk.json context or with -c`,
    )
    .regex(/^[\w.-]+\/[\w.-]+$/, `${CONTEXT_KEYS.githubRepository} must be owner/repo`),
  [CONTEXT_KEYS.githubRef]: z
    .string(`${CONTEXT_KEYS.githubRef} is missing: set it in infra/cdk.json context or with -c`)
    .min(1, `${CONTEXT_KEYS.githubRef} must name the production branch`),
  [CONTEXT_KEYS.allowedRegions]: z
    .array(
      z.string().regex(/^[a-z]{2}(-gov)?-[a-z]+-\d$/, "must be AWS region ids"),
      `${CONTEXT_KEYS.allowedRegions} is missing: list the project's region(s) in infra/cdk.json context`,
    )
    .min(1, `${CONTEXT_KEYS.allowedRegions} must list at least one region`),
});

export interface InfraConfig {
  /** Tag value on every stack and resource (`project_name`). */
  readonly projectName: typeof PROJECT_NAME;
  /** From CDK_DEFAULT_REGION only, and one of `countylens:allowedRegions`. */
  readonly region: string;
  /** From CDK_DEFAULT_ACCOUNT when the CLI resolved credentials; optional for env-agnostic synth. */
  readonly account?: string;
  /** Alarm, DLQ-alarm and budget recipient (Ops stack); optional until Ops is built. */
  readonly operatorEmail?: string;
  /** Amplify source: GitHub `owner/repo` and the production branch. */
  readonly github: { readonly repository: string; readonly ref: string };
}

export type ContextReader = (key: string) => unknown;

function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ");
}

/**
 * Build the typed config from the process environment and CDK context. Throws with every
 * problem listed when anything is missing or malformed.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  context: ContextReader,
): InfraConfig {
  const parsedEnv = EnvSchema.safeParse(env);
  const parsedContext = ContextSchema.safeParse({
    [CONTEXT_KEYS.githubRepository]: context(CONTEXT_KEYS.githubRepository),
    [CONTEXT_KEYS.githubRef]: context(CONTEXT_KEYS.githubRef),
    [CONTEXT_KEYS.allowedRegions]: context(CONTEXT_KEYS.allowedRegions),
  });
  if (!parsedEnv.success || !parsedContext.success) {
    const issues = [
      ...(parsedEnv.success ? [] : parsedEnv.error.issues),
      ...(parsedContext.success ? [] : parsedContext.error.issues),
    ];
    throw new Error(`infra config: ${formatIssues(issues)}`);
  }
  const { CDK_DEFAULT_REGION, CDK_DEFAULT_ACCOUNT, OPERATOR_EMAIL } = parsedEnv.data;
  const allowed = parsedContext.data[CONTEXT_KEYS.allowedRegions];
  if (!allowed.includes(CDK_DEFAULT_REGION)) {
    throw new RegionNotAllowedError(CDK_DEFAULT_REGION, allowed);
  }
  return {
    projectName: PROJECT_NAME,
    region: CDK_DEFAULT_REGION,
    ...(CDK_DEFAULT_ACCOUNT === undefined ? {} : { account: CDK_DEFAULT_ACCOUNT }),
    ...(OPERATOR_EMAIL === undefined ? {} : { operatorEmail: OPERATOR_EMAIL }),
    github: {
      repository: parsedContext.data[CONTEXT_KEYS.githubRepository],
      ref: parsedContext.data[CONTEXT_KEYS.githubRef],
    },
  };
}
