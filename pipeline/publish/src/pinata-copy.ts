// A-16 T079 (AM-10, amends AD-22): the second copy on Pinata's free plan. Pinata refuses
// pin-by-CID and CAR import on that plan, but a file upload with `pinataOptions={"cidVersion":1}`
// reproduces our CIDs exactly (probe 2026-10-26: the Run 3 manifest, raw codec, and a 3 MB dag-pb
// table part). So this module uploads, from local disk, every run manifest plus as many of the
// latest run's table files as fit in the quota (~1 GB, ~500 files), and keeps a pin only when
// Pinata's CID equals the manifest CID. The Lexicon CARs and directory roots stay on Filebase
// plus the GitHub Release (AM-10); this module never uploads them.
//
// Per file, in order: (1) the local file is checked first — a table part's size + SHA-256 must
// equal the manifest entry; a manifest must be its own exact JCS bytes and, when runs/index.json
// (or `path=cid`) names a CID for it, hash to that CID — else it is skipped and reported, never
// uploaded; (2) a CID Pinata already lists as pinned is skipped (idempotent re-runs); (3) the
// budget (bytes and files) is reserved before the upload and the run stops cleanly at the first
// file that does not fit, listing what was left; (4) after the upload Pinata's `IpfsHash` is
// compared with the manifest CID: on a mismatch the pin is removed at once and recorded, and when
// stop-on-mismatch applies (default for manifests) nothing else is uploaded. One receipt JSON per
// processed file, plus summary.json. 429/503 answers back off (Retry-After, else capped
// exponential) for at most MAX_ATTEMPTS; at most 3 uploads run at once.
//
// The JWT is passed in by the caller (the CLI reads PINATA_JWT from process.env) and is redacted
// from every message, receipt and summary this module produces.
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { cidOfBytes } from "./cid.js";
import { jcsBytes } from "./jcs.js";
import {
  PinataHttpError,
  isPinned,
  redactJwt,
  unpin,
  uploadFile,
  usage,
  type FetchLike,
  type PinataUsage,
  type UploadResult,
} from "./pinata-pin.js";

/** About 1 GB on the free plan; leave headroom for Pinata's own DAG overhead. */
export const DEFAULT_QUOTA_BYTES = 950_000_000;
/** The free plan's file limit. */
export const DEFAULT_QUOTA_FILES = 500;
export const MAX_CONCURRENCY = 3;
export const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_CAP_MS = 60_000;
export const DEFAULT_RECEIPTS_ROOT = "specs/016-cost-and-admin/pinata-receipts";

export type CopyKind = "manifest" | "table";
export const COPY_KINDS: readonly CopyKind[] = ["manifest", "table"];

interface ArtifactLike {
  name: string;
  cid: string;
  kind: string;
  size: number;
  sha256: string;
}

export interface ExtraManifest {
  path: string;
  /** Expected CID given on the command line (`path=cid`); otherwise runs/index.json is used. */
  cid?: string;
}

export interface PinataCopyOptions {
  jwt: string;
  manifestPath: string;
  runId: string;
  filesRoot: string;
  kinds?: readonly CopyKind[];
  /** Bytes this run may add; default DEFAULT_QUOTA_BYTES minus current usage. */
  budgetBytes?: number;
  /** Files this run may add; default DEFAULT_QUOTA_FILES minus current pin count. */
  budgetFiles?: number;
  extraManifests?: readonly ExtraManifest[];
  /** runs/index.json (runId -> manifestCid); used when present. */
  runsIndexPath?: string;
  dryRun?: boolean;
  firstOnly?: boolean;
  /** Stop after a mismatch on a manifest (default true) / on a table (default false). */
  stopOnMismatchManifest?: boolean;
  stopOnMismatchTable?: boolean;
  concurrency?: number;
  receiptsRoot?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
  log?: (line: string) => void;
}

export type ItemStatus =
  | "pinned"
  | "already_pinned"
  | "mismatch_unpinned"
  | "mismatch_unpin_failed"
  | "error"
  | "skipped_local"
  | "left_budget"
  | "left_stopped"
  | "planned";

export interface CopyItem {
  kind: CopyKind;
  name: string;
  cid: string;
  size: number;
  sha256: string;
  /** Local file read for the upload. */
  path: string;
}

export interface Receipt {
  schema: "pinata-copy-receipt.v1";
  run_id: string;
  kind: CopyKind;
  name: string;
  cid: string;
  size: number;
  sha256: string;
  status: ItemStatus;
  pinata_cid: string | null;
  match: boolean | null;
  pinned_at: string | null;
  pin_size: number | null;
  is_duplicate: boolean | null;
  recorded_at: string;
  reason?: string;
}

export interface SkippedItem {
  kind: CopyKind;
  name: string;
  cid: string;
  status: ItemStatus;
  reason: string;
  size?: number;
}

export interface CopySummary {
  schema: "pinata-copy-summary.v1";
  run_id: string;
  manifest_path: string;
  manifest_cid: string;
  dry_run: boolean;
  first_only: boolean;
  kinds: CopyKind[];
  budget: { bytes: number; files: number; source: "flag" | "usage" | "default (dry run)" };
  usage_before: PinataUsage | null;
  usage_after: PinataUsage | null;
  counts: Record<ItemStatus, number>;
  bytes: { uploaded: number; pin_size_uploaded: number; left: number };
  mismatches: Array<{ name: string; cid: string; pinata_cid: string; unpinned: boolean }>;
  skipped: SkippedItem[];
  left: SkippedItem[];
  errors: Array<{ name: string; cid: string; reason: string }>;
  stopped: null | "mismatch" | "budget";
  ok: boolean;
  finished_at: string;
}

export interface CopyResult {
  summary: CopySummary;
  receipts: Receipt[];
  /** 0 ok (a clean budget stop included), 1 a mismatch or upload error, 2 a precondition. */
  exitCode: number;
}

export class PreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreconditionError";
  }
}

/** A file-system-safe receipt name for a repo-relative artifact path. */
export function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "") || "artifact";
}

/** Retry-After (seconds or HTTP-date) when sent, else full jitter over a capped exponential. */
export function backoffMs(
  attempt: number,
  retryAfter: string | null,
  random: () => number = Math.random,
  now: () => number = Date.now,
): number {
  if (retryAfter !== null) {
    const trimmed = retryAfter.trim();
    if (/^\d+$/.test(trimmed)) return Math.min(BACKOFF_CAP_MS, Number(trimmed) * 1000);
    const at = Date.parse(trimmed);
    if (!Number.isNaN(at)) return Math.min(BACKOFF_CAP_MS, Math.max(0, at - now()));
  }
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return Math.max(1, Math.round(random() * ceiling));
}

function retryable(err: unknown, write: boolean): err is PinataHttpError {
  if (!(err instanceof PinataHttpError)) return false;
  // A rejected write (429, or 503 "try later") pinned nothing, so it is safe to resend. A 500/502/
  // 504 on a write may have pinned; it is not resent blind (the idempotent re-run picks it up).
  return write ? err.status === 429 || err.status === 503 : err.status === 429 || err.status >= 500;
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function isArtifactLike(value: unknown): value is ArtifactLike {
  const a = value as Partial<ArtifactLike> | null;
  return (
    typeof a === "object" &&
    a !== null &&
    typeof a.name === "string" &&
    typeof a.cid === "string" &&
    typeof a.kind === "string" &&
    typeof a.size === "number" &&
    typeof a.sha256 === "string"
  );
}

function readRunsIndex(path: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (path === undefined || !existsSync(path)) return map;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { runs?: unknown };
  if (!Array.isArray(parsed.runs)) return map;
  for (const r of parsed.runs as Array<{ runId?: unknown; manifestCid?: unknown }>)
    if (typeof r.runId === "string" && typeof r.manifestCid === "string")
      map.set(r.runId, r.manifestCid);
  return map;
}

interface CheckedManifest {
  item: CopyItem;
  runId: string | undefined;
  artifacts: ArtifactLike[];
  problem?: string;
}

/** Reads a manifest and proves its bytes: exact JCS, and the expected CID when one is known. */
async function checkManifest(
  path: string,
  expectedCid: string | undefined,
  index: Map<string, string>,
): Promise<CheckedManifest> {
  const bytes = readFileSync(path);
  const cid = await cidOfBytes(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    parsed = undefined;
  }
  const runId =
    typeof (parsed as { runId?: unknown } | undefined)?.runId === "string"
      ? (parsed as { runId: string }).runId
      : undefined;
  const rawArtifacts = (parsed as { artifacts?: unknown } | undefined)?.artifacts;
  const artifacts = Array.isArray(rawArtifacts) ? rawArtifacts.filter(isArtifactLike) : [];
  const item: CopyItem = {
    kind: "manifest",
    name: runId === undefined ? path : `runs/${runId}/manifest.json`,
    cid,
    size: bytes.length,
    sha256,
    path,
  };
  const out: CheckedManifest = { item, runId, artifacts };
  if (parsed === undefined || !Array.isArray(rawArtifacts)) {
    out.problem = "not a run manifest (no artifacts[])";
  } else if (!bytes.equals(Buffer.from(jcsBytes(parsed)))) {
    out.problem = "not the exact JCS bytes of its own content";
  } else {
    const expected = expectedCid ?? (runId === undefined ? undefined : index.get(runId));
    if (expected !== undefined && expected !== cid)
      out.problem = `hashes to ${cid}, but ${expectedCid === undefined ? "runs/index.json" : "the command line"} names ${expected}`;
  }
  return out;
}

/** Resolves a manifest entry's repo-relative name under filesRoot; refuses any path escape. */
export function localPathFor(filesRoot: string, name: string): string | null {
  if (isAbsolute(name)) return null;
  const root = resolve(filesRoot);
  const full = resolve(root, name);
  const rel = relative(root, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return full;
}

async function checkTable(
  filesRoot: string,
  a: ArtifactLike,
): Promise<{ item: CopyItem } | { problem: string }> {
  const path = localPathFor(filesRoot, a.name);
  if (path === null) return { problem: `name ${a.name} escapes --files-root` };
  if (!existsSync(path)) return { problem: `missing on disk: ${path}` };
  const size = statSync(path).size;
  if (size !== a.size) return { problem: `size on disk ${size}, manifest says ${a.size}` };
  const sha256 = await sha256OfFile(path);
  if (sha256 !== a.sha256)
    return { problem: `sha256 on disk ${sha256}, manifest says ${a.sha256}` };
  return {
    item: { kind: "table", name: a.name, cid: a.cid, size: a.size, sha256: a.sha256, path },
  };
}

function emptyCounts(): Record<ItemStatus, number> {
  return {
    pinned: 0,
    already_pinned: 0,
    mismatch_unpinned: 0,
    mismatch_unpin_failed: 0,
    error: 0,
    skipped_local: 0,
    left_budget: 0,
    left_stopped: 0,
    planned: 0,
  };
}

/** Runs the copy. Throws PreconditionError (exit 2) before any upload when the inputs are wrong. */
export async function runPinataCopy(options: PinataCopyOptions): Promise<CopyResult> {
  const jwt = options.jwt;
  const dryRun = options.dryRun ?? false;
  if (!dryRun && !jwt) throw new PreconditionError("PINATA_JWT is not set in the environment");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.runId))
    throw new PreconditionError(`--run-id ${options.runId} is not a safe run id`);
  const kinds = [...new Set(options.kinds ?? COPY_KINDS)];
  for (const k of kinds)
    if (!COPY_KINDS.includes(k))
      throw new PreconditionError(`--kinds: ${String(k)} is not one of ${COPY_KINDS.join(",")}`);
  const firstOnly = options.firstOnly ?? false;
  if (firstOnly && !kinds.includes("manifest"))
    throw new PreconditionError(
      "--first-only uploads the run manifest, so --kinds must include manifest",
    );
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, options.concurrency ?? 2));
  const stopManifest = options.stopOnMismatchManifest ?? true;
  const stopTable = options.stopOnMismatchTable ?? false;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => new Date());
  const rawLog = options.log ?? ((line: string) => console.log(line));
  const log = (line: string): void => rawLog(redactJwt(line, jwt));
  const clean = (text: string): string => redactJwt(text, jwt);
  const pinata = { jwt, ...(options.fetch ? { fetch: options.fetch } : {}) };
  const receiptsDir = join(options.receiptsRoot ?? DEFAULT_RECEIPTS_ROOT, options.runId);

  async function withRetry<T>(what: string, write: boolean, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS || !retryable(err, write)) throw err;
        const ms = backoffMs(attempt, err.retryAfter, random);
        log(`wait ${what}: HTTP ${err.status}, retry ${attempt + 1}/${MAX_ATTEMPTS} in ${ms} ms`);
        await sleep(ms);
      }
    }
  }

  // 1. Local checks, before any network call.
  const index = readRunsIndex(options.runsIndexPath);
  if (!existsSync(options.manifestPath))
    throw new PreconditionError(`${options.manifestPath} does not exist`);
  const main = await checkManifest(options.manifestPath, undefined, index);
  if (main.problem !== undefined)
    throw new PreconditionError(`${options.manifestPath}: ${main.problem}`);
  if (main.runId !== undefined && main.runId !== options.runId)
    throw new PreconditionError(
      `${options.manifestPath} is run ${main.runId}, not --run-id ${options.runId}`,
    );

  const skipped: SkippedItem[] = [];
  const queue: CopyItem[] = [];
  if (kinds.includes("manifest")) {
    queue.push(main.item);
    if (!firstOnly)
      for (const extra of options.extraManifests ?? []) {
        if (!existsSync(extra.path)) {
          skipped.push({
            kind: "manifest",
            name: extra.path,
            cid: extra.cid ?? "",
            status: "skipped_local",
            reason: "missing on disk",
          });
          log(`skip ${extra.path}: missing on disk`);
          continue;
        }
        const checked = await checkManifest(extra.path, extra.cid, index);
        if (checked.problem !== undefined) {
          skipped.push({
            kind: "manifest",
            name: checked.item.name,
            cid: checked.item.cid,
            status: "skipped_local",
            reason: checked.problem,
          });
          log(`skip ${checked.item.name}: ${checked.problem}`);
        } else queue.push(checked.item);
      }
  }
  if (kinds.includes("table") && !firstOnly) {
    for (const a of main.artifacts.filter((x) => x.kind === "table")) {
      const checked = await checkTable(options.filesRoot, a);
      if ("problem" in checked) {
        skipped.push({
          kind: "table",
          name: a.name,
          cid: a.cid,
          status: "skipped_local",
          reason: checked.problem,
          size: a.size,
        });
        log(`skip ${a.name}: ${checked.problem}`);
      } else queue.push(checked.item);
    }
  }

  // 2. Budget.
  let usageBefore: PinataUsage | null = null;
  if (!dryRun) usageBefore = await withRetry("usage", false, () => usage(pinata));
  const budgetSource: CopySummary["budget"]["source"] =
    options.budgetBytes !== undefined ? "flag" : dryRun ? "default (dry run)" : "usage";
  let bytesLeft = options.budgetBytes ?? DEFAULT_QUOTA_BYTES - (usageBefore?.pinSizeTotal ?? 0);
  let filesLeft = options.budgetFiles ?? DEFAULT_QUOTA_FILES - (usageBefore?.pinCount ?? 0);
  const budget = { bytes: bytesLeft, files: filesLeft, source: budgetSource };
  log(
    `budget: ${bytesLeft} bytes, ${filesLeft} files (${budgetSource})${usageBefore ? `; usage before: ${usageBefore.pinCount} pins, ${usageBefore.pinSizeTotal} bytes` : ""}`,
  );

  const receipts: Receipt[] = [];
  const left: SkippedItem[] = [];
  const mismatches: CopySummary["mismatches"] = [];
  const errors: CopySummary["errors"] = [];
  const counts = emptyCounts();
  for (const s of skipped) counts[s.status] += 1;
  let uploadedBytes = 0;
  let pinSizeUploaded = 0;
  let stopped: CopySummary["stopped"] = null;

  function writeReceipt(r: Receipt): void {
    receipts.push(r);
    if (dryRun) return;
    mkdirSync(receiptsDir, { recursive: true });
    writeFileSync(
      join(receiptsDir, `${safeName(r.name)}.json`),
      `${clean(JSON.stringify(r, null, 2))}\n`,
    );
  }

  function receiptOf(item: CopyItem, status: ItemStatus, extra: Partial<Receipt> = {}): Receipt {
    return {
      schema: "pinata-copy-receipt.v1",
      run_id: options.runId,
      kind: item.kind,
      name: item.name,
      cid: item.cid,
      size: item.size,
      sha256: item.sha256,
      status,
      pinata_cid: null,
      match: null,
      pinned_at: null,
      pin_size: null,
      is_duplicate: null,
      recorded_at: now().toISOString(),
      ...extra,
    };
  }

  /** Uploads one item; returns false when the run must stop (a stop-on-mismatch). */
  async function copyOne(item: CopyItem): Promise<boolean> {
    if (dryRun) {
      counts.planned += 1;
      receipts.push(receiptOf(item, "planned"));
      log(`plan ${item.kind} ${item.name} cid=${item.cid} size=${item.size}`);
      return true;
    }
    let uploaded: UploadResult;
    try {
      uploaded = await withRetry(`upload ${item.name}`, true, () =>
        uploadFile(item.path, item.name, pinata),
      );
    } catch (err) {
      const reason = clean(err instanceof Error ? err.message : String(err));
      counts.error += 1;
      errors.push({ name: item.name, cid: item.cid, reason });
      writeReceipt(receiptOf(item, "error", { reason }));
      log(`FAIL ${item.name}: ${reason}`);
      return true;
    }
    const match = uploaded.cid === item.cid;
    const pinFields = {
      pinata_cid: uploaded.cid,
      match,
      pinned_at: uploaded.timestamp ?? null,
      pin_size: uploaded.pinSize ?? null,
      is_duplicate: uploaded.isDuplicate ?? null,
    };
    if (match) {
      counts.pinned += 1;
      uploadedBytes += item.size;
      pinSizeUploaded += uploaded.pinSize ?? item.size;
      writeReceipt(receiptOf(item, "pinned", pinFields));
      log(`ok   ${item.kind} ${item.name} cid=${item.cid} pinata=${uploaded.cid} match`);
      return true;
    }
    let unpinned = true;
    let reason = `Pinata returned ${uploaded.cid}, manifest says ${item.cid}`;
    try {
      await withRetry(`unpin ${uploaded.cid}`, false, () => unpin(uploaded.cid, pinata));
    } catch (err) {
      unpinned = false;
      reason += `; unpin failed: ${clean(err instanceof Error ? err.message : String(err))}`;
    }
    const status: ItemStatus = unpinned ? "mismatch_unpinned" : "mismatch_unpin_failed";
    counts[status] += 1;
    mismatches.push({ name: item.name, cid: item.cid, pinata_cid: uploaded.cid, unpinned });
    writeReceipt(receiptOf(item, status, { ...pinFields, reason }));
    log(`FAIL MISMATCH ${item.name}: ${reason}${unpinned ? " (unpinned)" : ""}`);
    const stop = item.kind === "manifest" ? stopManifest : stopTable;
    return !stop;
  }

  // 3. Dispatch: manifests one at a time (first), then tables at `concurrency`. The budget is
  //    reserved here, in order, so the run stops at the first file that does not fit.
  let next = 0;
  let halt = false;
  let haltStatus: ItemStatus = "left_budget";
  let haltReason = "";
  function leaveOne(item: CopyItem): void {
    counts[haltStatus] += 1;
    left.push({
      kind: item.kind,
      name: item.name,
      cid: item.cid,
      status: haltStatus,
      reason: haltReason,
      size: item.size,
    });
  }
  /** Stops dispatching: everything not yet claimed is reported as left, with the reason. */
  function haltRun(
    why: "budget" | "mismatch",
    status: ItemStatus,
    reason: string,
    first?: CopyItem,
  ): void {
    if (halt) return;
    halt = true;
    stopped = why;
    haltStatus = status;
    haltReason = reason;
    if (first !== undefined) leaveOne(first);
    for (const item of queue.slice(next)) leaveOne(item);
    next = queue.length;
  }

  /** Claims the next item (synchronously, so concurrent workers never share one). */
  async function take(): Promise<CopyItem | null> {
    for (;;) {
      if (halt || next >= queue.length) return null;
      const item = queue[next] as CopyItem;
      next += 1;
      if (!dryRun) {
        let already = false;
        try {
          already = await withRetry(`pinList ${item.cid}`, false, () => isPinned(item.cid, pinata));
        } catch (err) {
          log(
            `note ${item.name}: pinList failed (${clean(err instanceof Error ? err.message : String(err))}); uploading anyway`,
          );
        }
        if (already) {
          counts.already_pinned += 1;
          writeReceipt(receiptOf(item, "already_pinned", { pinata_cid: item.cid, match: true }));
          log(`skip ${item.name}: already pinned on Pinata`);
          continue;
        }
      }
      // Claimed before another worker halted the run: it is left too, never uploaded.
      if (halt) {
        leaveOne(item);
        return null;
      }
      if (item.size > bytesLeft || filesLeft < 1) {
        const reason = `budget: ${item.name} needs ${item.size} bytes, ${bytesLeft} bytes and ${filesLeft} files left`;
        log(`stop ${reason}`);
        haltRun("budget", "left_budget", reason, item);
        return null;
      }
      bytesLeft -= item.size;
      filesLeft -= 1;
      return item;
    }
  }

  async function copyAndMaybeHalt(item: CopyItem): Promise<void> {
    const cont = await copyOne(item);
    if (!cont) haltRun("mismatch", "left_stopped", `stopped after the mismatch on ${item.name}`);
  }

  // Manifests first, one at a time; --first-only stops after the run manifest.
  while (!halt && next < queue.length && (queue[next] as CopyItem).kind === "manifest") {
    const item = await take();
    if (item === null) break;
    await copyAndMaybeHalt(item);
    if (firstOnly) break;
  }

  async function worker(): Promise<void> {
    for (;;) {
      const item = await take();
      if (item === null) return;
      await copyAndMaybeHalt(item);
    }
  }
  if (!halt && !firstOnly) await Promise.all(Array.from({ length: concurrency }, worker));

  // 4. Summary.
  let usageAfter: PinataUsage | null = null;
  if (!dryRun) {
    try {
      usageAfter = await withRetry("usage", false, () => usage(pinata));
    } catch (err) {
      log(`note usage after: ${clean(err instanceof Error ? err.message : String(err))}`);
    }
  }
  const ok = mismatches.length === 0 && errors.length === 0;
  const summary: CopySummary = {
    schema: "pinata-copy-summary.v1",
    run_id: options.runId,
    manifest_path: options.manifestPath,
    manifest_cid: main.item.cid,
    dry_run: dryRun,
    first_only: firstOnly,
    kinds,
    budget,
    usage_before: usageBefore,
    usage_after: usageAfter,
    counts,
    bytes: {
      uploaded: uploadedBytes,
      pin_size_uploaded: pinSizeUploaded,
      left: left.reduce((n, x) => n + (x.size ?? 0), 0),
    },
    mismatches,
    skipped,
    left,
    errors,
    stopped,
    ok,
    finished_at: now().toISOString(),
  };
  if (!dryRun) {
    mkdirSync(receiptsDir, { recursive: true });
    writeFileSync(
      join(receiptsDir, "summary.json"),
      `${clean(JSON.stringify(summary, null, 2))}\n`,
    );
  }
  log(
    `${ok ? "DONE" : "FAILED"}: ${counts.pinned} pinned, ${counts.already_pinned} already pinned, ${mismatches.length} mismatches, ${errors.length} errors, ${skipped.length} skipped, ${left.length} left${stopped ? ` (stopped: ${stopped})` : ""}${dryRun ? " [dry run: nothing uploaded, nothing written]" : ""}`,
  );
  return { summary, receipts, exitCode: ok ? 0 : 1 };
}
