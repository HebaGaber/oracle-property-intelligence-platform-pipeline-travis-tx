// A-03 T008 stub (interface fixed for T072 / T065, G-C2a / G-C2b): the Lambda's reads of the
// CID copy. T072 implements them with @aws-sdk/client-s3 + s3-request-presigner over the bucket
// and prefixes from config: `getManifest` GETs `ipfs/<cid>` and rejects bytes whose rawCid is
// not the requested CID (NOT_FOUND when absent; cached in /tmp by CID); `presignPart` presigns
// a GET of `ipfs/<cid>` for DuckDB's range reads; `presignPrefix` lists `*.parquet` under the
// private bench prefix (READPATH_PRIVATE_PREFIX only) and presigns each. No route reads any
// other key (contracts/api.md). Presigned URLs are never logged (FR-007).
export interface PresignedObject {
  readonly key: string;
  readonly url: string;
}

/** The manifest bytes of `ipfs/<cid>`, verified by rawCid; throws when absent or mismatched. */
export function getManifest(_cid: string): Promise<Uint8Array> {
  throw new Error("not implemented");
}

/** A presigned in-region GET URL for `ipfs/<cid>`. */
export function presignPart(_cid: string): Promise<string> {
  throw new Error("not implemented");
}

/** Presigned GET URLs for every `*.parquet` object under a `private/<name>/` prefix. */
export function presignPrefix(_prefix: string): Promise<PresignedObject[]> {
  throw new Error("not implemented");
}
