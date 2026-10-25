// A-14 T001 (shared pre-task): the two env keys `s3-read.ts` reads (CID_COPY_BUCKET,
// READPATH_PRIVATE_PREFIX), kept as its own small reader alongside apps/api/src/config.ts
// (which handlers/bench.ts and its tests read independently). Same Zod schema, same validation,
// same behavior (constitution III, V): a missing or invalid key fails at load time, naming the
// key; the region is never configured here (P0-18).
import { z } from "zod";

export const REQUIRED_ENGINE_ENV_KEYS = ["CID_COPY_BUCKET", "READPATH_PRIVATE_PREFIX"] as const;

/** `private/<name>/`: the only prefix the bench may read (research R-02, contracts/storage.md). */
const PRIVATE_PREFIX = /^private\/[a-z0-9-]+\/$/;

const EngineEnv = z.object({
  CID_COPY_BUCKET: z.string().min(1),
  READPATH_PRIVATE_PREFIX: z.string().regex(PRIVATE_PREFIX, "must match private/<name>/"),
});

export interface EngineConfig {
  readonly cidCopyBucket: string;
  readonly readPathPrivatePrefix: string;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Validates `env` (default: `process.env`) and returns the typed config. Throws an Error whose
 * message names every missing key, or the first invalid one.
 */
export function loadEngineConfig(env: EnvSource = process.env): EngineConfig {
  const missing = REQUIRED_ENGINE_ENV_KEYS.filter((key) => {
    const value = env[key];
    return value === undefined || value === "";
  });
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
  const parsed = EngineEnv.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment variable(s): ${issues.join("; ")}`);
  }
  return {
    cidCopyBucket: parsed.data.CID_COPY_BUCKET,
    readPathPrivatePrefix: parsed.data.READPATH_PRIVATE_PREFIX,
  };
}

let cached: EngineConfig | undefined;

/** The process config, validated once per sandbox. */
export function getEngineConfig(): EngineConfig {
  cached ??= loadEngineConfig();
  return cached;
}
