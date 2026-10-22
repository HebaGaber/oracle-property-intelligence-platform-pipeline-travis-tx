// T024-T026 support (A-14, G-3/G-4): a loader for the committed `runs/index.json`
// (`RunsIndexV1`, contracts/manifest.md), used by `list_runs` and by every other tool's
// "no manifest_cid given -> use the latest published run" default.
//
// Mirrors `apps/api/src/agent/ask.ts`'s `defaultResolveManifestCid` (same bucket, same key,
// same honesty rule): when `env.CID_COPY_BUCKET` is set (the hosted MCP Lambda's env — the CDK
// Api stack's MCP block sets it the same way it sets it for the agent Lambda), this reads
// `runs/index.json` with one S3 GetObject from that bucket and Zod-validates it. A missing
// bucket/key, an unreadable body, or a schema failure all throw (never a default/empty index) —
// the MCP adapters (tools.ts) turn that into the typed `run_not_found` envelope, never a guess.
//
// `CID_COPY_BUCKET` unset falls back to reading a local file path (`RUNS_INDEX_PATH_ENV`,
// default the repo-root `runs/index.json`) — the legitimate case for the local stdio build
// (apps/api/src/mcp/stdio.ts, T027, which has no AWS credentials and reads a local export) and
// for tests.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { RunsIndexV1 } from "@countylens/contract";

/** Overrides the local-file fallback's default repo-root `runs/index.json` path (the stdio
 *  build, or tests). Only consulted when `CID_COPY_BUCKET` is unset. */
export const RUNS_INDEX_PATH_ENV = "RUNS_INDEX_PATH";

/** `apps/api/src/mcp/runs-index.ts` -> repo root is four directories up. */
function defaultRunsIndexPath(): string {
  return fileURLToPath(new URL("../../../../runs/index.json", import.meta.url));
}

export type RunsIndexEnv = Readonly<Record<string, string | undefined>>;

/** The same key `apps/api/src/agent/ask.ts`'s `defaultResolveManifestCid` and
 *  `apps/web/src/data/runs-index.ts` read, beside the CID copy in the same bucket. */
const RUNS_INDEX_KEY = "runs/index.json";

async function loadFromS3(bucket: string): Promise<RunsIndexV1> {
  const s3 = new S3Client({});
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: RUNS_INDEX_KEY }));
  if (Body === undefined) throw new Error(`${RUNS_INDEX_KEY}: empty body`);
  const text = await Body.transformToString();
  return RunsIndexV1.parse(JSON.parse(text));
}

async function loadFromLocalFile(env: RunsIndexEnv): Promise<RunsIndexV1> {
  const path = env[RUNS_INDEX_PATH_ENV] ?? defaultRunsIndexPath();
  const text = await readFile(path, "utf8");
  return RunsIndexV1.parse(JSON.parse(text));
}

/** Reads and Zod-validates `runs/index.json`: from the CID-copy bucket (`CID_COPY_BUCKET` set —
 *  the hosted Lambda) or from a local file (unset — the stdio build, tests). Throws (never a
 *  default/empty index) on any failure. */
export async function loadRunsIndex(env: RunsIndexEnv = process.env): Promise<RunsIndexV1> {
  const bucket = env.CID_COPY_BUCKET;
  return bucket !== undefined ? loadFromS3(bucket) : loadFromLocalFile(env);
}

export interface RunsIndexEntry {
  readonly runId: string;
  readonly manifestCid: string;
  readonly finishedAt: string;
}

/** The newest entry by `finishedAt`, or `undefined` for an empty index. Same ordering as
 *  query-core's `listRuns`. */
export function latestOf(index: Pick<RunsIndexV1, "runs">): RunsIndexEntry | undefined {
  return [...index.runs].sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0];
}
