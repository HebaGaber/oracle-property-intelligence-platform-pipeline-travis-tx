// A-03 T072 (G-C2a): the Lambda's reads of the CID copy (contracts/storage.md, research R-03).
// `getManifest` GETs `ipfs/<cid>` from CID_COPY_BUCKET, rejects bytes whose raw-leaves CIDv1 is
// not the requested one (INTERNAL_SERVER_ERROR) and reports NOT_FOUND when the key is absent;
// verified bytes are cached under the sandbox's /tmp by CID and re-verified on every read.
// `presignPart` presigns an in-region GET of `ipfs/<cid>` for DuckDB's range reads;
// `presignPrefix` lists `*.parquet` under one `private/bench/<name>/` prefix (READPATH_PRIVATE_PREFIX
// only, for the direct-invoke bench) and presigns each. No function reads any other key
// (contracts/api.md). The region is the runtime's AWS_REGION, never a literal (P0-18). Presigned
// URLs are returned to the engine and never logged (FR-007).
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
import { TRPCError } from "@trpc/server";
import { isCidV1 } from "@countylens/contract";
import { rawCid } from "@countylens/query-core";
import { getConfig } from "./config.js";

export interface PresignedObject {
  readonly key: string;
  readonly url: string;
}

/** Presigned URLs live one hour; a bound run is replaced well before that (duckdb-node.ts). */
export const PRESIGN_EXPIRES_S = 3600;
/** The /tmp cache of verified manifests: one file per CID under the sandbox's temp directory. */
export const MANIFEST_CACHE_DIR = "countylens-manifests";

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
const isAbsent = (error: unknown): boolean =>
  error instanceof NoSuchKey ||
  error instanceof NotFound ||
  (error instanceof Error && error.name === "AccessDenied") ||
  statusOf(error) === 404 ||
  statusOf(error) === 403;

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
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: cidCopyBucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key !== undefined && object.Key.endsWith(".parquet")) keys.push(object.Key);
    }
    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  keys.sort();
  return Promise.all(keys.map(async (key) => ({ key, url: await presign(cidCopyBucket, key) })));
}
