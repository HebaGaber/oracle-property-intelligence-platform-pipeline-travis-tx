// A-11, AD-22: a genuine SECOND INDEPENDENT PIN. `elephant-cli upload --pinata-jwt` only pins
// its own ZIP-of-hashed-properties format; it cannot pin a CAR or a tables export, so it is not
// a second pin of OUR artifacts. This module calls Pinata's OWN REST API directly (never
// elephant-cli) to pin a CID that is already reachable on public IPFS (e.g. via the Filebase
// gateway), with a local-file upload as the only fallback when pin-by-CID does not apply.
//
// This file is a reusable, narrowly-scoped utility only: it does not touch the manifest,
// runs/index.json, the GitHub Release, or docs/atlas-pr.md. Those are wired up separately, once
// Run 1's real CIDs are known from the Filebase upload this task must not interfere with.
//
// API surface actually used, and why: Pinata's current docs describe a newer v3 Files API
// (POST /v3/files/public/pin_by_cid, POST https://uploads.pinata.cloud/v3/files, GET
// /v3/files/public). A real smoke test against the saved PINATA_JWT (2026-10-23) found that key
// cannot use v3 at all -- every v3 call, including a plain authenticated GET, returned 401
// {"error":"not authenticated"} -- while the legacy `/pinning/*` and `/data/*` endpoints work
// fine with the same key (confirmed live: `data/testAuthentication` succeeds, `pinning/
// pinFileToIPFS` pinned a throwaway file, `data/pinList` found it). The legacy pin-by-hash
// endpoint itself (`pinning/pinByHash`) is reachable but 403s with `NO_SCOPES_FOUND` for this
// key -- a real admin-scope gap, not a missing feature -- so this module still attempts it
// first (the "ideally pin-by-CID without re-upload" path) and falls back to re-uploading bytes
// only when it fails, exactly as it would for any other key that lacks that one scope:
//   - pin by CID (no bytes re-uploaded; content must already be fetchable from public IPFS):
//       POST https://api.pinata.cloud/pinning/pinByHash
//       body: { hashToPin: <cid>, pinataMetadata?: { name } }
//   - fallback upload (re-uploads raw bytes; used when pin-by-CID fails and a local file path
//     was given):
//       POST https://api.pinata.cloud/pinning/pinFileToIPFS
//       multipart: file, pinataMetadata? (JSON string { name })
//   - poll/confirm (the legacy pin-jobs listing; a non-empty, non-"pin_queued" row for the CID
//     under ?status=pinned is Pinata's own documented "already pinned" signal):
//       GET https://api.pinata.cloud/data/pinList?hashContains=<cid>&status=pinned
// Auth: `Authorization: Bearer <PINATA_JWT>` on every call. The JWT is passed in by the caller
// (never read from process.env by this module) and is never logged; every thrown error redacts
// it out of any response body it quotes.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const PINATA_API = "https://api.pinata.cloud";
export const PINATA_PIN_BY_HASH_PATH = "/pinning/pinByHash";
export const PINATA_UPLOAD_PATH = "/pinning/pinFileToIPFS";
export const PINATA_PIN_LIST_PATH = "/data/pinList";

export interface PinataPinOptions {
  /** The bearer token. Read by the CALLER from PINATA_JWT; never read from process.env here. */
  jwt: string;
  fetch?: FetchLike;
  apiBase?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PinByCidResult {
  id: string | undefined;
  status: string | undefined;
}

export interface UploadResult {
  id: string | undefined;
  cid: string;
}

export interface PinataPinResult {
  cid: string;
  id: string | undefined;
  method: "pin_by_cid" | "upload";
  pinned: true;
  polledMs: number;
}

function redactJwt(text: string, jwt: string): string {
  return jwt ? text.split(jwt).join("[redacted]") : text;
}

function authHeaders(jwt: string): Record<string, string> {
  return { Authorization: `Bearer ${jwt}` };
}

function base(url: string | undefined): string {
  return (url ?? PINATA_API).replace(/\/+$/, "");
}

async function parseJson(text: string, jwt: string, what: string): Promise<unknown> {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} returned non-JSON: ${redactJwt(text.slice(0, 200), jwt)}`);
  }
}

/** Asks Pinata to fetch and pin content already reachable on public IPFS, by CID alone. */
export async function pinByCid(
  cid: string,
  name: string | undefined,
  options: PinataPinOptions,
): Promise<PinByCidResult> {
  const fetchImpl = options.fetch ?? fetch;
  const api = base(options.apiBase);
  const body: { hashToPin: string; pinataMetadata?: { name: string } } = { hashToPin: cid };
  if (name) body.pinataMetadata = { name };
  const response = await fetchImpl(`${api}${PINATA_PIN_BY_HASH_PATH}`, {
    method: "POST",
    headers: { ...authHeaders(options.jwt), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `pinByHash of ${cid} failed: ${response.status} ${response.statusText}: ${redactJwt(text.slice(0, 500), options.jwt)}`,
    );
  }
  const parsed = await parseJson(text, options.jwt, `pinByHash of ${cid}`);
  const data = parsed as { id?: unknown; status?: unknown };
  return {
    id: typeof data.id === "string" ? data.id : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
  };
}

/** Fallback only: re-uploads the file's bytes so Pinata holds a copy directly. */
export async function uploadFile(
  filePath: string,
  name: string | undefined,
  options: PinataPinOptions,
): Promise<UploadResult> {
  const fetchImpl = options.fetch ?? fetch;
  const api = base(options.apiBase);
  const bytes = await readFile(filePath);
  const form = new FormData();
  const fileName = name ?? basename(filePath);
  form.append("file", new Blob([bytes]), fileName);
  if (name) form.append("pinataMetadata", JSON.stringify({ name }));
  const response = await fetchImpl(`${api}${PINATA_UPLOAD_PATH}`, {
    method: "POST",
    headers: authHeaders(options.jwt),
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `pinFileToIPFS of ${filePath} failed: ${response.status} ${response.statusText}: ${redactJwt(text.slice(0, 500), options.jwt)}`,
    );
  }
  const parsed = await parseJson(text, options.jwt, `pinFileToIPFS of ${filePath}`);
  const data = parsed as { ID?: unknown; IpfsHash?: unknown };
  if (typeof data.IpfsHash !== "string") {
    throw new Error(
      `pinFileToIPFS of ${filePath} returned no IpfsHash: ${redactJwt(text.slice(0, 200), options.jwt)}`,
    );
  }
  return { id: typeof data.ID === "string" ? data.ID : undefined, cid: data.IpfsHash };
}

/** Pinata's own "already pinned" signal: the CID appears in `pinList?status=pinned`. */
export async function isPinned(cid: string, options: PinataPinOptions): Promise<boolean> {
  const fetchImpl = options.fetch ?? fetch;
  const api = base(options.apiBase);
  const query = `hashContains=${encodeURIComponent(cid)}&status=pinned`;
  const response = await fetchImpl(`${api}${PINATA_PIN_LIST_PATH}?${query}`, {
    method: "GET",
    headers: authHeaders(options.jwt),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `pinList for ${cid} failed: ${response.status} ${response.statusText}: ${redactJwt(text.slice(0, 500), options.jwt)}`,
    );
  }
  const parsed = await parseJson(text, options.jwt, `pinList for ${cid}`);
  const rows = (parsed as { rows?: unknown[] }).rows;
  return Array.isArray(rows) && rows.length > 0;
}

/** Polls `isPinned` until it is true, or throws once `pollTimeoutMs` elapses. Returns elapsed ms. */
export async function pollUntilPinned(cid: string, options: PinataPinOptions): Promise<number> {
  const interval = options.pollIntervalMs ?? 3000;
  const timeout = options.pollTimeoutMs ?? 120_000;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const start = now();
  for (;;) {
    if (await isPinned(cid, options)) return now() - start;
    if (now() - start >= timeout) {
      throw new Error(`pin of ${cid} did not confirm as pinned within ${timeout}ms`);
    }
    await sleep(interval);
  }
}

/**
 * Pins `args.cid` via pin-by-CID; if that fails and `args.filePath` is given, falls back to
 * uploading that file's bytes. Either way, does not return until `pollUntilPinned` confirms the
 * resulting CID is actually pinned (not just an initial ack).
 */
export async function pinataPin(
  args: { cid?: string; filePath?: string; name?: string },
  options: PinataPinOptions,
): Promise<PinataPinResult> {
  if (!options.jwt) throw new Error("PINATA_JWT is required and must not be empty");
  if (!args.cid && !args.filePath) throw new Error("pinataPin requires a cid or a filePath");

  let cid = args.cid;
  let id: string | undefined;
  let method: "pin_by_cid" | "upload" = "pin_by_cid";

  if (cid) {
    try {
      const result = await pinByCid(cid, args.name, options);
      id = result.id;
    } catch (err) {
      if (!args.filePath) throw err;
      method = "upload";
      const result = await uploadFile(args.filePath, args.name, options);
      cid = result.cid;
      id = result.id;
    }
  } else if (args.filePath) {
    method = "upload";
    const result = await uploadFile(args.filePath, args.name, options);
    cid = result.cid;
    id = result.id;
  }

  if (!cid) throw new Error("pinataPin: no cid resolved");
  const pollMs = await pollUntilPinned(cid, options);
  return { cid, id, method, pinned: true, polledMs: pollMs };
}
