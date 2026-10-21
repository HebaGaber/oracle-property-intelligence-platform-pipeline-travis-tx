// Hosted-harness helpers for the A-13 specs (T017; test plan § 2 "Run oracle", research R8).
//
// - Run oracle: `{RUNTIME_URL}/runs/index.json` lists the published runs; "latest" is the
//   greatest `finishedAt` and Run {n} the 1-based `finishedAt` order. Each manifest is fetched
//   by CID from the Pinata gateway, so the oracle is independent of the app's read path (CID
//   copy first, Filebase fallback); the bytes must hash to the CID before they are trusted.
// - Allowlist: every CID a page may show is the manifest CID, `previousManifestCid`,
//   `artifacts[].cid` or `carCid` of some manifest reachable from that index.
// - Denylist: tests/e2e/fixtures/prototype-placeholders.json plus every CID-shaped token in
//   design/prototype/**, so no prototype sample can pass as real data.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { cidOfBytes } from "@countylens/publish";
import { z } from "zod";
import { e2eRoot, harnessConfig, repoRoot } from "./runtime.js";
import { runtimeUrl } from "./runtime-url.js";

export type FetchImpl = typeof fetch;

const FETCH_TIMEOUT_MS = 60_000;

async function getBytes(url: string, fetchImpl: FetchImpl, timeoutMs: number): Promise<Uint8Array> {
  const res = await fetchImpl(url, {
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------------------
// Run oracle
// ---------------------------------------------------------------------------------------

export interface OracleOptions {
  /** Defaults to the guarded RUNTIME_URL (never localhost). */
  runtimeUrl?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

/** `{RUNTIME_URL}/runs/index.json`, validated as RunsIndexV1. */
export async function fetchA13RunsIndex(options: OracleOptions = {}): Promise<RunsIndexV1> {
  const base = (options.runtimeUrl ?? runtimeUrl()).replace(/\/+$/, "");
  const bytes = await getBytes(
    `${base}/runs/index.json`,
    options.fetchImpl ?? fetch,
    options.timeoutMs ?? FETCH_TIMEOUT_MS,
  );
  return RunsIndexV1.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

export type RunsIndexEntry = RunsIndexV1["runs"][number];

/** The index entries in `finishedAt` order (oldest first), whatever the array order. */
export function runsByFinishedAt(index: RunsIndexV1): RunsIndexEntry[] {
  return [...index.runs].sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
}

/** The latest run: the greatest `finishedAt`. */
export function latestRunEntry(index: RunsIndexV1): RunsIndexEntry {
  const latest = runsByFinishedAt(index).at(-1);
  if (!latest) throw new Error("runs/index.json lists no runs");
  return latest;
}

/** Run {n}: the 1-based position of `runId` in `finishedAt` order. */
export function runNumber(index: RunsIndexV1, runId: string): number {
  const position = runsByFinishedAt(index).findIndex((r) => r.runId === runId);
  if (position < 0) throw new Error(`runs/index.json does not list run ${runId}`);
  return position + 1;
}

export interface PinataOptions {
  /** Defaults to PINATA_GATEWAY_HOST (gateway.pinata.cloud). */
  host?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

export function pinataManifestUrl(cid: string, host = harnessConfig().PINATA_GATEWAY_HOST): string {
  return `https://${host}/ipfs/${cid}`;
}

export interface OracleManifest {
  manifestCid: string;
  manifest: RunManifestV1;
  bytes: Uint8Array;
  url: string;
}

/** A manifest by CID from Pinata; the bytes must hash to that CID, then RunManifestV1 parses. */
export async function fetchManifestFromPinata(
  manifestCid: string,
  options: PinataOptions = {},
): Promise<OracleManifest> {
  const url = pinataManifestUrl(manifestCid, options.host);
  const bytes = await getBytes(
    url,
    options.fetchImpl ?? fetch,
    options.timeoutMs ?? FETCH_TIMEOUT_MS,
  );
  const actual = await cidOfBytes(bytes);
  if (actual !== manifestCid) {
    throw new Error(`manifest bytes from ${url} hash to ${actual}, not ${manifestCid}`);
  }
  const manifest = RunManifestV1.parse(JSON.parse(new TextDecoder().decode(bytes)));
  return { manifestCid, manifest, bytes, url };
}

/** Every manifest the index lists, in `finishedAt` order, fetched one at a time (Pinata rate limits). */
export async function fetchAllManifests(
  index: RunsIndexV1,
  options: PinataOptions = {},
): Promise<OracleManifest[]> {
  const out: OracleManifest[] = [];
  for (const entry of runsByFinishedAt(index)) {
    out.push(await fetchManifestFromPinata(entry.manifestCid, options));
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// CID allowlist and CID-shaped tokens
// ---------------------------------------------------------------------------------------

/** The union over all manifests of manifest CID, previousManifestCid, artifacts[].cid, carCid. */
export function buildCidAllowlist(
  manifests: readonly Pick<OracleManifest, "manifestCid" | "manifest">[],
): Set<string> {
  const allow = new Set<string>();
  for (const { manifestCid, manifest } of manifests) {
    allow.add(manifestCid);
    if (manifest.previousManifestCid) allow.add(manifest.previousManifestCid);
    for (const artifact of manifest.artifacts) {
      allow.add(artifact.cid);
      if (artifact.carCid) allow.add(artifact.carCid);
    }
  }
  return allow;
}

/** Atlas § 3 middle truncation: first 4 characters, U+2026, last 4. */
export function truncateCid(cid: string): string {
  return `${cid.slice(0, 4)}…${cid.slice(-4)}`;
}

/** `baf…`/`bag…` base32: a full CID (≥ 23 characters) or a truncated form with U+2026. */
const CID_SHAPED = /\b(ba[fg][a-z2-7]*)(…[a-z2-7]+)?/g;
const FULL_CID_MIN_LENGTH = 23;

/** CID-shaped tokens in `text`, in order of appearance (test plan TC-083 regex, plus truncation). */
export function cidTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(CID_SHAPED)) {
    const [token, , truncatedTail] = match;
    if (truncatedTail !== undefined || token.length >= FULL_CID_MIN_LENGTH) tokens.push(token);
  }
  return tokens;
}

/** A full token must be in the allowlist; a truncated one must be a prefix…suffix of an allowed CID. */
export function isAllowedCidToken(token: string, allow: ReadonlySet<string>): boolean {
  const cut = token.indexOf("…");
  if (cut < 0) return allow.has(token);
  const prefix = token.slice(0, cut);
  const suffix = token.slice(cut + 1);
  for (const cid of allow) {
    if (cid.startsWith(prefix) && cid.endsWith(suffix)) return true;
  }
  return false;
}

/** The CID-shaped tokens in `text` that no reachable manifest names. */
export function disallowedCidTokens(text: string, allow: ReadonlySet<string>): string[] {
  return cidTokens(text).filter((token) => !isAllowedCidToken(token, allow));
}

// ---------------------------------------------------------------------------------------
// Prototype-placeholder denylist
// ---------------------------------------------------------------------------------------

export const PLACEHOLDER_DENYLIST_PATH = resolve(
  e2eRoot,
  "fixtures",
  "prototype-placeholders.json",
);
export const PROTOTYPE_DIR = resolve(repoRoot, "design", "prototype");

const PlaceholderDenylist = z.object({
  schema: z.literal("countylens-prototype-placeholders.v1"),
  description: z.string(),
  strings: z
    .array(
      z.object({
        text: z.string().min(1),
        reason: z.string().min(1),
        allowWhenRunCountAtLeast: z.number().int().positive().optional(),
      }),
    )
    .min(1),
  selectors: z.array(z.string().min(1)),
});
export type PlaceholderDenylist = z.infer<typeof PlaceholderDenylist>;

export function loadPlaceholderDenylist(path = PLACEHOLDER_DENYLIST_PATH): PlaceholderDenylist {
  return PlaceholderDenylist.parse(JSON.parse(readFileSync(path, "utf8")));
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Denylisted phrases in `text`: whole phrase, case-insensitive, not inside a longer word or number. */
export function denylistHits(
  text: string,
  denylist: PlaceholderDenylist,
  context: { runCount: number },
): string[] {
  return denylist.strings
    .filter(
      (entry) =>
        entry.allowWhenRunCountAtLeast === undefined ||
        context.runCount < entry.allowWhenRunCountAtLeast,
    )
    .filter((entry) =>
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(entry.text)}(?![\\p{L}\\p{N}])`, "iu").test(
        text,
      ),
    )
    .map((entry) => entry.text);
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/** Every CID-shaped token in design/prototype/** (unique, sorted); bare prefixes are not tokens. */
export function prototypeCidTokens(dir = PROTOTYPE_DIR): string[] {
  const tokens = new Set<string>();
  for (const file of listFiles(dir)) {
    for (const token of cidTokens(readFileSync(file, "utf8"))) tokens.add(token);
  }
  return [...tokens].sort();
}
