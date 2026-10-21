// A-03 T007 stub (interface fixed for T042, G-C3): the run manifest read by CID. The bytes are
// accepted only when `rawCid(bytes)` equals the requested CID (constitution A3), then parsed
// with the frozen `RunManifestV1` schema (contract/v1). Every count the pages show comes from
// this object (FR-009); nothing is padded or derived elsewhere.
import type { RunManifestV1 } from "@countylens/contract";
import type { FetchByCidOptions, FetchByCidResult } from "./fetch-by-cid";

export interface LoadedManifest {
  readonly manifest: RunManifestV1;
  /** The CID the bytes were verified against (equal to the index entry's manifestCid). */
  readonly manifestCid: string;
  /** The read that served the bytes: source (for the fallback chip) and the bound `partUrl`. */
  readonly read: FetchByCidResult;
}

/** Parses JCS manifest bytes after checking `rawCid(bytes) === expectedCid`; throws otherwise. */
export function parseManifest(_bytes: Uint8Array, _expectedCid: string): Promise<RunManifestV1> {
  throw new Error("not implemented");
}

/** `fetchByCid` + `parseManifest` for the run index's latest entry. */
export function loadManifest(_cid: string, _options: FetchByCidOptions): Promise<LoadedManifest> {
  throw new Error("not implemented");
}
