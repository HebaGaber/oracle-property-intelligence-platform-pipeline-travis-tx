#!/usr/bin/env -S npx tsx
// verify-manifest (A-11 T007/T011, contracts/publish-sequence.md "verify-manifest contract",
// AM-01 2026-10-21 — amends P0-14): independent proof that every published artifact is what the
// committed manifest says, read from the two public gateways this environment does not operate
// for storage — Pinata's public gateway (gateway.pinata.cloud, the independent one) and the
// Filebase gateway (ipfs.filebase.io) — and ONLY those two. ipfs.io and dweb.link retired on
// 2026-09-21 (every request now answers 429 with a Sunset header; docs/decisions/0001-read-path.md
// Finding 3) and are no longer valid verify targets. Our CloudFront CID copy and w3s.link are
// pin/serve infrastructure we run; they are refused as verify targets before the first request,
// because they would prove nothing a stranger couldn't fake by trusting us. Filebase is also the
// pin host, so Pinata — not Filebase — is the independent half of the pair (AM-01); both are still
// required for a verified run.
//
//   npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json [--gateway <url>]... [--verbose]
//   npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json --sample      (CI, very small)
//
// `--sample` (PO decision 2026-10-25) checks the manifest itself on both gateways exactly as
// below, then only two artifacts: the smallest table part and the smallest CAR (by size, then
// name). A full-county run lists 225 table parts and 15 CARs (about 2.8 GB of CARs) and a full
// check took about two hours locally because Pinata answers 429, so the hosted job checks a
// sample. In a sample the CAR is read from Filebase only: Pinata's gateway answers 429 to CAR
// downloads (story A-16 item 14, a second independent pin); the manifest and the table part are
// still read from both gateways. A sample prints SAMPLE VERIFIED, never ALL ARTIFACTS VERIFIED,
// and exits 3 when it passes (0 is reserved for a full verification; 1 = a check failed; 2 = usage).
// The default (no flag) is the full check the operator runs after a publish.
//
// Order: the manifest itself, by its own raw-leaves CIDv1, from both gateways, compared
// byte-for-byte with the local file; any gateway answering 200 with other bytes stops the run
// before any artifact is checked. Then every artifact: tables by `cid`, car/directory artifacts
// by `carCid` (never the dag-json root as a file). Every GET retries 429/504/timeout up to
// MAX_ATTEMPTS (5) with backoff honouring `Retry-After`; TIMEOUT_MS (default 300000 ms) bounds
// each attempt. A redirect is followed only when its target stays on the same gateway's domain
// (host-generic: covers a CID-subdomain redirect such as dweb.link's old `<cid>.ipfs.dweb.link`
// pattern, should any future gateway do the same) — any redirect elsewhere is a failed check,
// never followed. Pinata and Filebase both serve `/ipfs/<cid>` directly with a plain 200 and no
// redirect (confirmed empirically 2026-10-24), so this path is not exercised against them today;
// it stays in place as a safety net rather than being removed. A miss of any kind marks that check
// `unverified` and the run exits non-zero; printing `ALL ARTIFACTS VERIFIED` (exit 0) requires
// every check to match on BOTH gateways. The body is hashed while streaming (never buffered
// whole), so an artifact over 50 MB is checked the same way as a small one (NFR-06).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cidOfBytes } from "../pipeline/publish/src/cid.js";
import { jcsBytes } from "../pipeline/publish/src/jcs.js";

// This script lives outside every workspace package (scripts/ is not in pnpm-workspace.yaml),
// so it cannot resolve "@countylens/contract" the way pipeline/publish's own modules do (Node
// resolves a bare import from the importing FILE's own location, and pipeline/publish/src/cid.js
// and jcs.js resolve their own imports fine for that reason). Rather than reach into another
// package's node_modules by a relative path, this script checks the manifest structurally: every
// artifact the verify contract needs (name, cid, kind, carCid, size, sha256) plus the exact-JCS-
// bytes guarantee, computed with the same canonicalizer the real schema's bytes are built from.
// It is deliberately a looser check than RunManifestV1.parse (pipeline/publish/src/verify.ts
// uses the full Zod schema); a CI wiring that wants the stronger schema check should run that
// module's verifyManifest in-process instead of shelling out to this script.
export interface ManifestArtifactLike {
  name: string;
  cid: string;
  kind: string;
  carCid?: string;
  size: number;
  sha256: string;
}
interface ManifestLike {
  artifacts: ManifestArtifactLike[];
}

function isManifestLike(value: unknown): value is ManifestLike {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { artifacts?: unknown }).artifacts)
  );
}

/** The complete, fixed allowlist (AM-01, 2026-10-21, amends P0-14): Pinata's public gateway (the
 *  independent one) and the Filebase gateway. Never ipfs.io/dweb.link (retired 2026-09-21), our
 *  CloudFront CID copy, or w3s.link. */
export const GATEWAYS: readonly string[] = [
  "https://gateway.pinata.cloud",
  "https://ipfs.filebase.io",
];
export const TIMEOUT_MS_DEFAULT = 300_000;
export const MAX_ATTEMPTS = 5;
export const ALL_VERIFIED_TEXT = "ALL ARTIFACTS VERIFIED";

/** The `--sample` selection: the smallest table part and the smallest CAR (size, then name). */
export function selectSample<T extends ManifestArtifactLike>(artifacts: readonly T[]): T[] {
  const smallest = (kind: string): T | undefined =>
    artifacts
      .filter((a) => a.kind === kind)
      .sort((x, y) => x.size - y.size || x.name.localeCompare(y.name))[0];
  return [smallest("table"), smallest("car")].filter((a): a is T => a !== undefined);
}
/** NFR-06: artifacts at or above this size are proof the streaming path is exercised, not a
 *  special code path — the same streaming hash runs for every size. */
export const STREAM_THRESHOLD_BYTES = 50 * 1024 * 1024;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 60_000;
const RETRYABLE_STATUS = new Set([429, 504]);

export function refusedGatewayText(gateway: string): string {
  return `Refused gateway ${gateway}: verify-manifest only uses ${GATEWAYS.join(", ")}`;
}

/** Throws before the first request when `gateways` names anything outside the fixed allowlist. */
export function assertAllowedGateways(gateways: readonly string[]): void {
  for (const g of gateways) if (!GATEWAYS.includes(g)) throw new Error(refusedGatewayText(g));
}

/** The wait before the next attempt: `Retry-After` when sent, else full jitter over a capped
 *  exponential base. Exported so TC-040's backoff assertions can pin exact values. */
export function retryDelayMs(
  attempt: number,
  retryAfter: string | null,
  random: () => number = Math.random,
  now: () => number = Date.now,
): number {
  if (retryAfter !== null) {
    const trimmed = retryAfter.trim();
    // Honor the server's Retry-After, but capped: Pinata has been observed (2026-10-24) to
    // return values over 2800s under sustained load, which would make a single artifact check
    // wait most of an hour per attempt. Capping at BACKOFF_CAP_MS keeps us a good citizen
    // (still waiting, never hammering immediately) without making the tool impractical.
    if (/^\d+$/.test(trimmed)) return Math.min(BACKOFF_CAP_MS, Number(trimmed) * 1000);
    const at = Date.parse(trimmed);
    if (!Number.isNaN(at)) return Math.min(BACKOFF_CAP_MS, Math.max(0, at - now()));
  }
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
  return Math.max(1, Math.round(random() * ceiling));
}

function sameGatewayHost(gateway: string, host: string): boolean {
  const gw = new URL(gateway).host;
  return host === gw || host.endsWith(`.${gw}`);
}

// Pinata's public gateway rate-limits sustained sequential traffic tighter than the per-request
// 429 backoff alone can clear during a full-manifest run (observed 2026-10-24: ~30% of requests
// hit HTTP 429 after 5 retries). A small fixed pause between requests to that gateway keeps us
// under its limit instead of relying on retries to recover from it. Filebase's gateway has not
// shown this behavior, so the pause is scoped to Pinata only.
const PINATA_THROTTLE_MS = 4000;

function isPinataGateway(gateway: string): boolean {
  return new URL(gateway).host === "gateway.pinata.cloud";
}

export interface FetchedBytes {
  ok: boolean;
  status: number | null;
  size: number | null;
  sha256: string | null;
  reason?: string;
}

export interface Transport {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  timeoutMs: number;
  verbose: boolean;
  log: (line: string) => void;
}

function errorText(err: unknown): string {
  if (err instanceof Error)
    return err.name === "Error" ? err.message : `${err.name}: ${err.message}`;
  return String(err);
}

/** Streams the body while hashing (NFR-06): never `response.arrayBuffer()`, whatever the size. */
async function streamHash(
  body: ReadableStream<Uint8Array> | null,
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  if (body) {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      size += value.byteLength;
    }
  }
  return { size, sha256: hash.digest("hex") };
}

/**
 * One logical GET of `cid` from `gateway`: retries 429/504/transport-errors/timeouts up to
 * MAX_ATTEMPTS with backoff honouring Retry-After; follows at most one redirect, and only when
 * its target is the same gateway's domain (never a cross-domain redirect, which would make the
 * "we verified from a gateway we don't operate" guarantee meaningless).
 */
export async function fetchArtifact(
  t: Transport,
  gateway: string,
  cid: string,
): Promise<FetchedBytes> {
  const url = `${gateway}/ipfs/${cid}`;
  let lastReason = "no response";
  let lastStatus: number | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (t.verbose) t.log(`GET ${url}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
    let res: Response;
    try {
      res = await t.fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(t.timeoutMs),
      });
    } catch (err) {
      lastReason = errorText(err);
      if (attempt < MAX_ATTEMPTS) {
        await t.sleep(retryDelayMs(attempt, null, t.random));
        continue;
      }
      return {
        ok: false,
        status: null,
        size: null,
        sha256: null,
        reason: `${lastReason} after ${MAX_ATTEMPTS} attempts`,
      };
    }
    if (RETRYABLE_STATUS.has(res.status)) {
      await res.body?.cancel();
      lastStatus = res.status;
      lastReason = `HTTP ${res.status}`;
      if (attempt < MAX_ATTEMPTS) {
        await t.sleep(retryDelayMs(attempt, res.headers.get("retry-after"), t.random));
        continue;
      }
      return {
        ok: false,
        status: res.status,
        size: null,
        sha256: null,
        reason: `${lastReason} after ${MAX_ATTEMPTS} attempts`,
      };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      const target = location ? new URL(location, url) : null;
      await res.body?.cancel();
      if (target !== null && sameGatewayHost(gateway, target.host)) {
        if (t.verbose) t.log(`redirect ${url} -> ${target.href} (same gateway, followed)`);
        // This fetch previously had no try/catch, unlike the main one above: a timeout or
        // network error here crashed the whole process instead of failing just this check
        // (observed 2026-10-24 under concurrent load — higher concurrency simply made a slow
        // redirect target more likely to occur, not a new failure mode).
        let followed: Response;
        try {
          followed = await t.fetch(target.href, {
            method: "GET",
            redirect: "manual",
            signal: AbortSignal.timeout(t.timeoutMs),
          });
        } catch (err) {
          return {
            ok: false,
            status: null,
            size: null,
            sha256: null,
            reason: `${errorText(err)} (after redirect)`,
          };
        }
        if (followed.status !== 200) {
          await followed.body?.cancel();
          return {
            ok: false,
            status: followed.status,
            size: null,
            sha256: null,
            reason: `HTTP ${followed.status} after redirect`,
          };
        }
        // Same gap as the fetch above: the signal can abort mid-stream, after headers already
        // arrived, surfacing here instead of at the fetch call. Uncaught, this crashed the
        // whole run (observed 2026-10-24) instead of failing just this one check.
        try {
          const got = await streamHash(followed.body);
          return { ok: true, status: 200, ...got };
        } catch (err) {
          return {
            ok: false,
            status: 200,
            size: null,
            sha256: null,
            reason: `${errorText(err)} (reading body after redirect)`,
          };
        }
      }
      return {
        ok: false,
        status: res.status,
        size: null,
        sha256: null,
        reason: `redirect to ${target === null ? "an unknown host" : target.host} refused; verify-manifest only reads ${new URL(gateway).host}`,
      };
    }
    if (res.status !== 200) {
      await res.body?.cancel();
      return {
        ok: false,
        status: res.status,
        size: null,
        sha256: null,
        reason: `HTTP ${res.status}`,
      };
    }
    // Same gap as the initial fetch's try/catch above: the abort signal can fire mid-stream,
    // after headers already arrived with status 200, surfacing here instead of at the fetch
    // call. Uncaught, this crashed the whole run (observed 2026-10-24, twice, under load on
    // large ~230MB artifacts) instead of failing just this one check. Retried like any other
    // transport error, since a mid-stream abort on one attempt says nothing about the next.
    try {
      const got = await streamHash(res.body);
      return { ok: true, status: 200, ...got };
    } catch (err) {
      lastReason = errorText(err);
      lastStatus = res.status;
      if (attempt < MAX_ATTEMPTS) {
        await t.sleep(retryDelayMs(attempt, null, t.random));
        continue;
      }
      return {
        ok: false,
        status: res.status,
        size: null,
        sha256: null,
        reason: `${lastReason} after ${MAX_ATTEMPTS} attempts`,
      };
    }
  }
  return {
    ok: false,
    status: lastStatus,
    size: null,
    sha256: null,
    reason: `${lastReason} after ${MAX_ATTEMPTS} attempts`,
  };
}

export type VerifyField = "cid" | "carCid" | "manifest";

export interface VerifyCheck {
  name: string;
  cid: string;
  field: VerifyField;
  gateway: string;
  status: number | null;
  size: number | null;
  sha256: string | null;
  ok: boolean;
  reason?: string;
}

export interface VerifyReport {
  ok: boolean;
  manifestPath: string;
  manifestCid: string;
  gateways: string[];
  manifest: VerifyCheck[];
  artifacts: VerifyCheck[];
  /** Set for a `--sample` run: how many artifacts were checked out of how many are listed. */
  sample?: { checked: number; total: number };
}

export interface VerifyManifestOptions {
  manifestPath: string;
  gateways?: readonly string[];
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  verbose?: boolean;
  /** Check only selectSample(artifacts) instead of every artifact. */
  sample?: boolean;
  log?: (line: string) => void;
  /**
   * Artifact checks to skip, already known-good from a prior run (key: `${gateway}\u0000${name}`).
   * This script has no other persisted state between runs -- a crash, a concurrency change, or
   * any other restart otherwise re-checks all 458 checks from zero. Does not skip the manifest
   * self-check (cheap, and correctness-critical to re-verify every run).
   */
  resumeSkip?: ReadonlySet<string> | undefined;
}

export function resumeKey(gateway: string, name: string): string {
  return `${gateway}\u0000${name}`;
}

/** Parses a prior run's log output for `ok` artifact-check lines, for --resume-from. */
export function parseResumeLog(text: string): Set<string> {
  const skip = new Set<string>();
  const re = /^ok\s+(\S+)\s+(\S+)\s+(?:cid|carCid)=/;
  for (const line of text.split("\n")) {
    const m = re.exec(line);
    if (m) skip.add(resumeKey(m[1] as string, m[2] as string));
  }
  return skip;
}

function target(a: ManifestArtifactLike): { field: VerifyField; cid: string | null } {
  if (a.kind === "table") return { field: "cid", cid: a.cid };
  return { field: "carCid", cid: a.carCid ?? null };
}

function formatLine(c: VerifyCheck): string {
  const head = `${c.ok ? "ok  " : "FAIL"} ${c.gateway} ${c.name} ${c.field === "manifest" ? "cid" : c.field}=${c.cid}`;
  return c.ok ? `${head} size=${c.size} match sha256 match` : `${head} ${c.reason ?? "failed"}`;
}

export async function verifyManifest(options: VerifyManifestOptions): Promise<VerifyReport> {
  const gateways = [...new Set(options.gateways ?? GATEWAYS)];
  assertAllowedGateways(gateways);
  const log = options.log ?? ((line: string) => console.log(line));
  const t: Transport = {
    fetch: options.fetch ?? fetch,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    random: options.random ?? Math.random,
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS_DEFAULT,
    verbose: options.verbose ?? false,
    log,
  };

  const bytes = readFileSync(options.manifestPath);
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isManifestLike(parsed))
    throw new Error(`${options.manifestPath} does not look like a run manifest (no artifacts[])`);
  if (!bytes.equals(Buffer.from(jcsBytes(parsed))))
    throw new Error(
      `${options.manifestPath} is not the exact JCS (canonical JSON) bytes of its own content`,
    );
  const manifest = parsed;
  const manifestCid = await cidOfBytes(bytes);
  const manifestSha = createHash("sha256").update(bytes).digest("hex");

  const manifestChecks: VerifyCheck[] = [];
  for (const gateway of gateways) {
    if (isPinataGateway(gateway)) await t.sleep(PINATA_THROTTLE_MS);
    const fetched = await fetchArtifact(t, gateway, manifestCid);
    const ok = fetched.ok && fetched.size === bytes.length && fetched.sha256 === manifestSha;
    const check: VerifyCheck = {
      name: "manifest",
      cid: manifestCid,
      field: "manifest",
      gateway,
      status: fetched.status,
      size: fetched.size,
      sha256: fetched.sha256,
      ok,
      ...(ok ? {} : { reason: fetched.reason ?? "bytes differ" }),
    };
    manifestChecks.push(check);
    log(formatLine(check));
  }
  const report: VerifyReport = {
    ok: false,
    manifestPath: options.manifestPath,
    manifestCid,
    gateways,
    manifest: manifestChecks,
    artifacts: [],
  };
  if (manifestChecks.some((c) => !c.ok)) {
    log("VERIFICATION FAILED: manifest bytes differ or are unreachable; artifacts not checked");
    return report;
  }

  // Concurrency is asymmetric per gateway, not uniform: Filebase's gateway has shown no rate
  // limiting all day at concurrency 10. Pinata's gateway is the real constraint -- it gave a
  // ~47-minute retry-after penalty under sustained sequential load earlier (2026-10-24), then
  // empirically tolerated 3 and 5 cleanly for a while, but 5 eventually produced a burst of 429s
  // (97 failures) under sustained load over time, not instantly. Settled on 3 as the value that
  // held up for the longest sustained run today; revisit if Pinata's limit is ever documented.
  const FILEBASE_CONCURRENCY = 10;
  const PINATA_CONCURRENCY = 1;
  function concurrencyFor(gateway: string): number {
    return isPinataGateway(gateway) ? PINATA_CONCURRENCY : FILEBASE_CONCURRENCY;
  }

  interface Task {
    index: number;
    artifact: (typeof manifest.artifacts)[number];
    gateway: string;
  }
  const resumeSkip = options.resumeSkip;
  const tasks: Task[] = [];
  const artifactChecks: (VerifyCheck | undefined)[] = [];
  const selected = options.sample ? selectSample(manifest.artifacts) : manifest.artifacts;
  if (options.sample)
    report.sample = { checked: selected.length, total: manifest.artifacts.length };
  let idx = 0;
  for (const artifact of selected) {
    for (const gateway of gateways) {
      if (options.sample && artifact.kind === "car" && isPinataGateway(gateway)) continue;
      const { field, cid } = target(artifact);
      if (resumeSkip?.has(resumeKey(gateway, artifact.name))) {
        const check: VerifyCheck = {
          name: artifact.name,
          cid: cid ?? artifact.cid,
          field,
          gateway,
          status: 200,
          size: artifact.size,
          sha256: artifact.sha256,
          ok: true,
        };
        artifactChecks[idx] = check;
        log(
          `ok   ${gateway} ${artifact.name} ${field === "manifest" ? "cid" : field}=${check.cid} resumed from a prior run, not re-fetched`,
        );
        idx += 1;
        continue;
      }
      tasks.push({ index: idx++, artifact, gateway });
    }
  }
  artifactChecks.length = idx;

  async function runOne(task: Task): Promise<void> {
    const { artifact, gateway } = task;
    const { field, cid } = target(artifact);
    let check: VerifyCheck;
    if (cid === null) {
      check = {
        name: artifact.name,
        cid: artifact.cid,
        field,
        gateway,
        status: null,
        size: null,
        sha256: null,
        ok: false,
        reason: `${artifact.kind} artifact has no carCid (AM-05); its cid is a DAG root, not a file`,
      };
    } else {
      if (isPinataGateway(gateway)) await t.sleep(PINATA_THROTTLE_MS);
      const fetched = await fetchArtifact(t, gateway, cid);
      const ok = fetched.ok && fetched.size === artifact.size && fetched.sha256 === artifact.sha256;
      check = {
        name: artifact.name,
        cid,
        field,
        gateway,
        status: fetched.status,
        size: fetched.size,
        sha256: fetched.sha256,
        ok,
        ...(ok ? {} : { reason: fetched.reason ?? "size or sha256 mismatch" }),
      };
    }
    artifactChecks[task.index] = check;
    log(formatLine(check));
  }

  async function runPool(poolTasks: Task[], concurrency: number): Promise<void> {
    let next = 0;
    async function worker(): Promise<void> {
      for (;;) {
        const i = next++;
        if (i >= poolTasks.length) return;
        const task = poolTasks[i];
        if (task === undefined) return;
        await runOne(task);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, poolTasks.length) }, worker));
  }

  const tasksByGateway = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = tasksByGateway.get(task.gateway) ?? [];
    list.push(task);
    tasksByGateway.set(task.gateway, list);
  }
  await Promise.all(
    [...tasksByGateway.entries()].map(([gateway, poolTasks]) =>
      runPool(poolTasks, concurrencyFor(gateway)),
    ),
  );
  report.artifacts = artifactChecks.filter((c): c is VerifyCheck => c !== undefined);

  const missing = GATEWAYS.filter((g) => !gateways.includes(g));
  for (const g of missing) log(`FAIL ${g} not checked: ${ALL_VERIFIED_TEXT} needs both gateways`);
  const checks = [...report.manifest, ...report.artifacts];
  const failed = checks.filter((c) => !c.ok).length;
  report.ok = failed === 0 && missing.length === 0;
  if (report.ok && report.sample)
    log(
      `SAMPLE VERIFIED ${report.sample.checked} of ${report.sample.total} artifacts (the CAR on Filebase only)`,
    );
  else if (report.ok) log(ALL_VERIFIED_TEXT);
  else
    log(
      `VERIFICATION FAILED: ${failed} of ${checks.length} checks failed${missing.length > 0 ? `, ${missing.join(", ")} not checked` : ""}`,
    );
  return report;
}

/**
 * 0 when every check run passed (a full run, or a `--sample` run: the log line says "sample only",
 * so a partial check never reads as a full verification); 1 for any failure. (2 = usage.)
 * A passing sample used to exit 3 (A11-16), which broke hosted TC-040; the wording carries it now.
 */
export function exitCodeFor(report: Pick<VerifyReport, "ok" | "sample">): number {
  return report.ok ? 0 : 1;
}

interface Args {
  manifestPath: string;
  gateways: string[];
  verbose: boolean;
  resumeFrom?: string | undefined;
  sample: boolean;
}

function usage(): never {
  console.error(
    "usage: npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json [--gateway <url>]... [--verbose] [--resume-from <prior-log-file>] [--sample]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  let manifestPath: string | undefined;
  const gateways: string[] = [];
  let verbose = false;
  let sample = false;
  let resumeFrom: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--gateway") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) usage();
      gateways.push(value);
      i += 1;
    } else if (arg.startsWith("--gateway=")) {
      gateways.push(arg.slice("--gateway=".length));
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--sample") {
      sample = true;
    } else if (arg === "--resume-from") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) usage();
      resumeFrom = value;
      i += 1;
    } else if (arg.startsWith("--resume-from=")) {
      resumeFrom = arg.slice("--resume-from=".length);
    } else if (arg.startsWith("-")) {
      usage();
    } else if (manifestPath === undefined) {
      manifestPath = arg;
    } else {
      usage();
    }
  }
  if (manifestPath === undefined) usage();
  return {
    manifestPath,
    gateways: gateways.length > 0 ? gateways : [...GATEWAYS],
    verbose,
    resumeFrom,
    sample,
  };
}

function timeoutMsFromEnv(): number {
  const raw = process.env.TIMEOUT_MS;
  if (raw === undefined || raw === "") return TIMEOUT_MS_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`TIMEOUT_MS must be a positive integer of milliseconds, not "${raw}"`);
    process.exit(2);
  }
  return n;
}

// Only run the CLI when invoked directly (not when imported by the test suite).
if (process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file:").href) {
  const args = parseArgs(process.argv.slice(2));
  let resumeSkip: Set<string> | undefined;
  if (args.resumeFrom !== undefined) {
    const priorText = readFileSync(args.resumeFrom, "utf8");
    resumeSkip = parseResumeLog(priorText);
    console.error(
      `--resume-from ${args.resumeFrom}: skipping ${resumeSkip.size} already-ok checks`,
    );
  }
  try {
    const report = await verifyManifest({
      manifestPath: args.manifestPath,
      gateways: args.gateways,
      timeoutMs: timeoutMsFromEnv(),
      verbose: args.verbose,
      resumeSkip,
      sample: args.sample,
    });
    process.exit(exitCodeFor(report));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}
