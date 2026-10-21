// A-03 T072 (G-C2a): the Lambda's reads of the CID copy (contracts/storage.md, research R-03).
// `getManifest` GETs `ipfs/<cid>` from CID_COPY_BUCKET, rejects bytes whose raw-leaves CIDv1 is
// not the requested one (INTERNAL_SERVER_ERROR) and reports NOT_FOUND when the key is absent;
// verified bytes are cached under the sandbox's /tmp by CID and re-verified on every read.
// `presignPart` presigns an in-region GET of `ipfs/<cid>` for DuckDB's range reads;
// `presignPrefix` lists `*.parquet` under one `private/bench/<name>/` prefix (READPATH_PRIVATE_PREFIX
// only, for the direct-invoke bench) and presigns each, reusing a part's URL while its ETag is
// unchanged (ERR-18: DuckDB caches footers and bytes by URL). No function reads any other key
// (contracts/api.md). The region is the runtime's AWS_REGION, never a literal (P0-18). Presigned
// URLs are returned to the engine and never logged (FR-007).
// metagross N3: a GetObject 403 is reported to the client as NOT_FOUND (see isAbsent), so a broken
// read grant would otherwise be silent; that branch logs one warning (identifiers only) and emits
// the ManifestAccessDenied Count metric so a wave of them is visible in CloudWatch.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { TRPCError } from "@trpc/server";
import { isCidV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { getConfig } from "./config.js";
import { METRICS_NAMESPACE, SERVICE_NAME } from "./observability.js";

export interface PresignedObject {
  readonly key: string;
  readonly url: string;
}

/** Presigned URLs live one hour; a bound run is replaced well before that (duckdb-node.ts). */
export const PRESIGN_EXPIRES_S = 3600;
/** ERR-18: how long presignPrefix hands out the same URL for an unchanged part (half its life). */
export const PRESIGN_REUSE_MS = 30 * 60 * 1000;
if (PRESIGN_REUSE_MS >= PRESIGN_EXPIRES_S * 1000) {
  throw new Error("PRESIGN_REUSE_MS must be shorter than the presigned URL lifetime");
}
/** The /tmp cache of verified manifests: one file per CID under the sandbox's temp directory. */
export const MANIFEST_CACHE_DIR = "countylens-manifests";

/** Count metric: one per GetObject 403 that getManifest reported as NOT_FOUND (metagross N3). */
export const METRIC_MANIFEST_ACCESS_DENIED = "ManifestAccessDenied";

/** The two Powertools calls the 403 branch makes; injectable for tests. */
export interface S3ReadObservability {
  readonly logger: Pick<Logger, "warn">;
  readonly metrics: Pick<Metrics, "addMetric" | "publishStoredMetrics">;
}

let observability: S3ReadObservability | undefined;

/** Replaces the 403 reporter (tests); `undefined` restores the lazily built Powertools pair. */
export function setS3ReadObservability(next: S3ReadObservability | undefined): void {
  observability = next;
}

function s3ReadObservability(): S3ReadObservability {
  observability ??= {
    logger: new Logger({ serviceName: SERVICE_NAME }),
    metrics: new Metrics({ serviceName: SERVICE_NAME, namespace: METRICS_NAMESPACE }),
  };
  return observability;
}

let client: S3Client | undefined;

/** One client per sandbox. No region or credentials here: the SDK reads the runtime's. */
function s3(): S3Client {
  client ??= new S3Client({});
  return client;
}

/** `ipfs/<cid>`: the only public key shape. Anything else is refused before any request. */
function ipfsKey(cid: string): string {
  if (!isCidV1(cid)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "expected a base32 CIDv1 (the copy serves ipfs/<cid> keys only)",
    });
  }
  return `ipfs/${cid}`;
}

const cacheDir = (): string => join(tmpdir(), MANIFEST_CACHE_DIR);

/** The cached bytes of `cid` if present and still hashing to it; a stale file is removed. */
async function readCached(cid: string): Promise<Uint8Array | undefined> {
  const file = join(cacheDir(), cid);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(file));
  } catch {
    return undefined;
  }
  try {
    if ((await rawCid(bytes)) === cid) return bytes;
  } catch {
    // not a manifest-sized file: treated as corrupted below
  }
  await rm(file, { force: true });
  return undefined;
}

/** Best-effort atomic write (temp file + rename); the verified bytes are already in hand. */
async function writeCached(cid: string, bytes: Uint8Array): Promise<void> {
  const dir = cacheDir();
  try {
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `${cid}.${randomUUID()}.tmp`);
    await writeFile(tmp, bytes);
    await rename(tmp, join(dir, cid));
  } catch {
    // the cache is an optimisation only
  }
}

const statusOf = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null
    ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    : undefined;

/**
 * A missing `ipfs/<cid>`. The reader role may list `private/bench/` only (Data.grantApiRead), so S3
 * answers a GetObject on a missing public key with 403 AccessDenied rather than 404: both mean
 * "not in the copy" here, and the client gets NOT_FOUND, never a 500 that fires the 5xx alarm.
 */
const isAccessDenied = (error: unknown): boolean =>
  (error instanceof Error && error.name === "AccessDenied") || statusOf(error) === 403;

const isAbsent = (error: unknown): boolean =>
  error instanceof NoSuchKey ||
  error instanceof NotFound ||
  statusOf(error) === 404 ||
  isAccessDenied(error);

/** One warning (IDs only: no message, URL or stack) and one Count metric per mapped 403. */
function reportAccessDenied(cid: string, key: string, error: unknown): void {
  const { logger, metrics } = s3ReadObservability();
  logger.warn("manifest GetObject answered 403; reported as NOT_FOUND", {
    manifestCid: cid,
    key,
    httpStatusCode: statusOf(error) ?? 403,
    errorName: error instanceof Error ? error.name : "unknown",
  });
  metrics.addMetric(METRIC_MANIFEST_ACCESS_DENIED, MetricUnit.Count, 1);
  metrics.publishStoredMetrics();
}

/** The manifest bytes of `ipfs/<cid>`, verified by rawCid; throws when absent or mismatched. */
export async function getManifest(cid: string): Promise<Uint8Array> {
  const key = ipfsKey(cid);
  const cached = await readCached(cid);
  if (cached !== undefined) return cached;
  let bytes: Uint8Array;
  try {
    const object = await s3().send(
      new GetObjectCommand({ Bucket: getConfig().cidCopyBucket, Key: key }),
    );
    if (object.Body === undefined) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${key}: empty body` });
    }
    bytes = await object.Body.transformToByteArray();
  } catch (error) {
    if (isAbsent(error)) {
      if (isAccessDenied(error)) reportAccessDenied(cid, key, error);
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `manifest ${cid} is not in the CID copy`,
        cause: error,
      });
    }
    throw error;
  }
  const actual = await rawCid(bytes);
  if (actual !== cid) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `manifest ${cid}: the copy's bytes hash to ${actual}`,
    });
  }
  await writeCached(cid, bytes);
  return bytes;
}

const presign = (bucket: string, key: string): Promise<string> =>
  getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: PRESIGN_EXPIRES_S,
  });

/** A presigned in-region GET URL for `ipfs/<cid>`. */
export async function presignPart(cid: string): Promise<string> {
  return presign(getConfig().cidCopyBucket, ipfsKey(cid));
}

/** The `<name>/` part of `private/bench/<name>/`. */
const BENCH_NAME = /^[a-z0-9-]+\/$/;

/** Presigned GET URLs for every `*.parquet` object under a `private/bench/<name>/` prefix. */
export async function presignPrefix(prefix: string): Promise<PresignedObject[]> {
  const { cidCopyBucket, readPathPrivatePrefix } = getConfig();
  if (
    !prefix.startsWith(readPathPrivatePrefix) ||
    !BENCH_NAME.test(prefix.slice(readPathPrivatePrefix.length))
  ) {
    throw new Error(`presignPrefix: ${prefix} is not ${readPathPrivatePrefix}<name>/`);
  }
  const keys: { key: string; etag: string }[] = [];
  let token: string | undefined;
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: cidCopyBucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key !== undefined && object.Key.endsWith(".parquet"))
        keys.push({ key: object.Key, etag: object.ETag ?? "" });
    }
    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  keys.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return Promise.all(
    keys.map(async ({ key, etag }) => ({
      key,
      url: await reusablePresign(cidCopyBucket, key, etag),
    })),
  );
}

interface ReusableUrl {
  readonly url: string;
  readonly signedAt: number;
}

/** bucket/key/ETag → the URL last signed for it (ERR-18). One sandbox, a handful of parts. */
const prefixUrls = new Map<string, ReusableUrl>();

/** Tests only: forget every reusable URL. */
export function resetPresignedPrefixCache(): void {
  prefixUrls.clear();
}

/** The URL signed for this exact object version within PRESIGN_REUSE_MS, else a fresh one. */
async function reusablePresign(bucket: string, key: string, etag: string): Promise<string> {
  const id = `${bucket}/${key}#${etag}`;
  const now = Date.now();
  const known = prefixUrls.get(id);
  if (known !== undefined && now - known.signedAt < PRESIGN_REUSE_MS) return known.url;
  const url = await presign(bucket, key);
  for (const [other] of prefixUrls)
    if (other.startsWith(`${bucket}/${key}#`)) prefixUrls.delete(other);
  prefixUrls.set(id, { url, signedAt: now });
  return url;
}
