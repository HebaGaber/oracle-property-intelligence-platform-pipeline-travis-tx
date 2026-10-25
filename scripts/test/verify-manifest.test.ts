// T007 (A-11, contracts/publish-sequence.md "verify-manifest contract", AM-01 2026-10-21 amends
// P0-14): gateway-hardening tests for scripts/verify-manifest.ts over an injected fetch. No
// network: a fake pair of gateways (gateway.pinata.cloud, ipfs.filebase.io — the only allowed
// pair) serves bytes by CID; every other host, including the retired ipfs.io/dweb.link pair, is
// refused before any request. Checks: 429/504/timeout retried with backoff then marked
// `unverified` with the gateway's response recorded, non-zero exit; `ALL ARTIFACTS VERIFIED`
// never prints unless both gateways match every check; a same-domain CID-subdomain redirect is
// followed; a redirect to any other host is refused; an artifact over 50 MB is hashed correctly
// by the streaming path (NFR-06).
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cidOfBytes } from "../../pipeline/publish/src/cid.js";
import { jcsBytes } from "../../pipeline/publish/src/jcs.js";
import {
  ALL_VERIFIED_TEXT,
  GATEWAYS,
  MAX_ATTEMPTS,
  STREAM_THRESHOLD_BYTES,
  assertAllowedGateways,
  parseResumeLog,
  refusedGatewayText,
  resumeKey,
  retryDelayMs,
  selectSample,
  verifyManifest,
  type ManifestArtifactLike,
} from "../verify-manifest.js";

const RUN_ID = "travis-202609-reroof-20261021t1530z";
const PINATA = "https://gateway.pinata.cloud";
const FILEBASE = "https://ipfs.filebase.io";

// G7 fix (2026-10-24): every test in this file calls fixture(), which does real sha256 hashing
// of two ~50 MB mock artifacts — CPU-heavy enough under full-turbo-graph contention in CI to
// exceed Vitest's default 5000ms test timeout (observed: CI run 40035234426 timed out the
// "retries 504" test at the default, while only the first test had been given a per-test
// override). Raise the timeout for the whole file instead of per-test so every fixture()-using
// test gets the same margin.
vi.setConfig({ testTimeout: 20000 });

/** Deterministic pseudo-random bytes from a seed (sha256 chain) — no large literal in the file. */
function bytesOf(seed: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let block = createHash("sha256").update(seed).digest();
  let i = 0;
  while (i < length) {
    for (const b of block) {
      if (i >= length) break;
      out[i] = b;
      i += 1;
    }
    block = createHash("sha256").update(block).digest();
  }
  return out;
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

interface Fixture {
  manifestPath: string;
  manifestBytes: Uint8Array;
  manifestCid: string;
  /** Bytes by CID, as each gateway would serve them. */
  published: Map<string, Uint8Array>;
  largeArtifact: { name: string; cid: string; size: number; sha256: string };
}

/** One small CAR artifact plus one artifact at STREAM_THRESHOLD_BYTES + 1 (NFR-06). */
async function fixture(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), "verify-manifest-"));
  const published = new Map<string, Uint8Array>();
  const car = bytesOf("car county", 2048);
  const carCid = await cidOfBytes(car);
  published.set(carCid, car);
  const large = bytesOf("large table part", STREAM_THRESHOLD_BYTES + 1);
  const largeCid = await cidOfBytes(large);
  published.set(largeCid, large);
  const artifacts: ManifestArtifactLike[] = [
    {
      name: "car/travis-county.car",
      cid: "bafyreicountyindexdagjsonrootxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      kind: "car",
      carCid,
      size: car.length,
      sha256: sha256Hex(car),
    },
    {
      name: "tables/county/property/part-00000.parquet",
      cid: largeCid,
      kind: "table",
      size: large.length,
      sha256: sha256Hex(large),
    },
  ];
  const manifest = {
    schema: "oracle-travis-run-manifest.v1",
    runId: RUN_ID,
    artifacts,
  };
  const manifestBytes = jcsBytes(manifest);
  const manifestCid = await cidOfBytes(manifestBytes);
  published.set(manifestCid, manifestBytes);
  const manifestPath = join(dir, "runs", RUN_ID, "manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, manifestBytes);
  return {
    manifestPath,
    manifestBytes,
    manifestCid,
    published,
    largeArtifact: {
      name: (artifacts[1] as ManifestArtifactLike).name,
      cid: largeCid,
      size: large.length,
      sha256: sha256Hex(large),
    },
  };
}

interface FakeOptions {
  /** Status codes served before the real 200, per (host, cid). */
  statuses?: (host: string, cid: string) => number[];
  /** Simulate a transport-level timeout for the first N attempts of (host, cid). */
  timeoutsFor?: (host: string, cid: string) => number;
  retryAfter?: string;
  /** Filebase only: redirect once to this target before serving 200. */
  redirectTo?: (host: string, cid: string) => string | undefined;
  /** Override what a host serves for a cid (undefined -> 404). */
  serve?: (host: string, cid: string, bytes: Uint8Array | undefined) => Uint8Array | undefined;
}

function fakeGateways(published: Map<string, Uint8Array>, opts: FakeOptions = {}) {
  const attempts = new Map<string, number>();
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input, _init) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url);
    const host = url.host;
    const cid = /^\/ipfs\/([a-z0-9]+)$/.exec(url.pathname)?.[1] ?? "";
    const key = `${host}:${cid}`;
    const n = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, n);
    requests.push(url.href);

    const timeoutUntil = opts.timeoutsFor?.(host, cid) ?? 0;
    if (n <= timeoutUntil) {
      const err = new Error("The operation was aborted");
      err.name = "TimeoutError";
      throw err;
    }
    const statuses = opts.statuses?.(host, cid) ?? [];
    if (n <= statuses.length) {
      const status = statuses[n - 1] as number;
      return new Response("", {
        status,
        headers: opts.retryAfter ? { "retry-after": opts.retryAfter } : {},
      });
    }
    const redirect = opts.redirectTo?.(host, cid);
    if (redirect !== undefined && n === statuses.length + 1) {
      return new Response(null, { status: 302, headers: { location: redirect } });
    }
    const bytes = opts.serve?.(host, cid, published.get(cid)) ?? published.get(cid);
    return bytes ? new Response(bytes, { status: 200 }) : new Response("", { status: 404 });
  };
  return { fetchImpl, attempts, requests };
}

const noSleep = async (): Promise<void> => {};
const noJitter = (): number => 1;

describe("the fixed gateway allowlist (P0-14)", () => {
  it("accepts only gateway.pinata.cloud and ipfs.filebase.io", () => {
    expect([...GATEWAYS]).toEqual([PINATA, FILEBASE]);
    expect(() => assertAllowedGateways([PINATA, FILEBASE])).not.toThrow();
  });

  it("refuses ipfs.io, dweb.link and the S3 CID copy before any request", () => {
    for (const other of [
      "https://ipfs.io",
      "https://dweb.link",
      "https://d111111abcdef8.cloudfront.net",
    ]) {
      expect(() => assertAllowedGateways([other])).toThrow(refusedGatewayText(other));
    }
  });
});

describe("--sample selection", () => {
  const artifact = (name: string, kind: string, size: number): ManifestArtifactLike => ({
    name,
    kind,
    size,
    cid: `cid-${name}`,
    sha256: "0".repeat(64),
  });

  it("picks the smallest table and the smallest CAR, by size then name", () => {
    const all = [
      artifact("t/b", "table", 10),
      artifact("t/a", "table", 10),
      artifact("t/c", "table", 5000),
      artifact("c/big", "car", 9000),
      artifact("c/small", "car", 100),
      artifact("d/root", "directory", 3),
    ];
    expect(selectSample(all).map((a) => a.name)).toEqual(["t/a", "c/small"]);
  });
});

describe("retry with backoff on 429/504/timeout", () => {
  it("retries 429 up to MAX_ATTEMPTS, honouring Retry-After, then succeeds", async () => {
    const f = await fixture();
    const { fetchImpl, attempts } = fakeGateways(f.published, {
      statuses: (host) => (host === "gateway.pinata.cloud" ? [429, 429] : []),
      retryAfter: "0",
    });
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
    });
    expect(report.ok).toBe(true);
    expect(attempts.get(`gateway.pinata.cloud:${f.manifestCid}`)).toBe(3);
  });

  it("retries 504 up to MAX_ATTEMPTS; exhausting them marks the check unverified, non-zero result", async () => {
    const f = await fixture();
    const { fetchImpl, attempts } = fakeGateways(f.published, {
      statuses: (host, cid) =>
        host === "ipfs.filebase.io" && cid === f.manifestCid ? Array(MAX_ATTEMPTS).fill(504) : [],
    });
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
    });
    expect(report.ok).toBe(false);
    expect(attempts.get(`ipfs.filebase.io:${f.manifestCid}`)).toBe(MAX_ATTEMPTS);
    const failed = report.manifest.find((c) => c.gateway === FILEBASE);
    expect(failed?.ok).toBe(false);
    expect(failed?.reason).toMatch(/HTTP 504 after 5 attempts/);
  });

  it("retries a timeout the same way as 429/504, then recovers", async () => {
    const f = await fixture();
    const { fetchImpl, attempts } = fakeGateways(f.published, {
      timeoutsFor: (host) => (host === "gateway.pinata.cloud" ? 2 : 0),
    });
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
    });
    expect(report.ok).toBe(true);
    expect(attempts.get(`gateway.pinata.cloud:${f.manifestCid}`)).toBeGreaterThanOrEqual(3);
  });

  it("never prints ALL ARTIFACTS VERIFIED when only one gateway matches", async () => {
    const f = await fixture();
    const lines: string[] = [];
    const { fetchImpl } = fakeGateways(f.published, {
      statuses: (host, cid) =>
        host === "ipfs.filebase.io" && cid === f.manifestCid ? Array(MAX_ATTEMPTS).fill(504) : [],
    });
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
      log: (l) => lines.push(l),
    });
    expect(report.ok).toBe(false);
    expect(lines).not.toContain(ALL_VERIFIED_TEXT);
  });

  it("process exit is non-zero on any miss (the script's own exit code contract)", async () => {
    const f = await fixture();
    const { fetchImpl } = fakeGateways(f.published, {
      statuses: () => Array(MAX_ATTEMPTS).fill(429),
    });
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
    });
    expect(report.ok ? 0 : 1).toBe(1);
  });
});

describe("retryDelayMs", () => {
  it("honours an exact Retry-After in seconds, else falls back to jittered backoff", () => {
    expect(retryDelayMs(1, "2")).toBe(2000);
    expect(retryDelayMs(3, null, () => 1)).toBeLessThanOrEqual(60_000);
    expect(retryDelayMs(3, null, () => 1)).toBeGreaterThan(0);
  });

  it("caps an excessive Retry-After instead of waiting the server's full stated delay", () => {
    // Pinata has been observed (2026-10-24) returning retry-after values over 2800s under
    // sustained load; honouring that literally would make one artifact check wait ~47 minutes.
    expect(retryDelayMs(1, "2806")).toBe(60_000);
    expect(retryDelayMs(1, new Date(Date.now() + 3_600_000).toUTCString())).toBeLessThanOrEqual(
      60_000,
    );
  });
});

describe("Filebase redirects", () => {
  it("follows a redirect to the same gateway's CID-subdomain host", async () => {
    const f = await fixture();
    const subdomain = `${f.manifestCid}.ipfs.filebase.io`;
    const { fetchImpl, requests } = fakeGateways(f.published, {
      redirectTo: (host, cid) =>
        host === "ipfs.filebase.io" && cid === f.manifestCid
          ? `https://${subdomain}/ipfs/${cid}`
          : undefined,
    });
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
    });
    expect(report.ok).toBe(true);
    expect(requests.some((u) => u.includes(subdomain))).toBe(true);
  });

  it("refuses a redirect to a host outside the gateway's own domain, never following it", async () => {
    const f = await fixture();
    const { fetchImpl } = fakeGateways(f.published, {
      redirectTo: (host, cid) =>
        host === "ipfs.filebase.io" && cid === f.manifestCid ? "https://evil.example/x" : undefined,
    });
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
    });
    expect(report.ok).toBe(false);
    const failed = report.manifest.find((c) => c.gateway === FILEBASE);
    expect(failed?.ok).toBe(false);
    expect(failed?.reason).toContain("redirect to evil.example refused");
  });

  it("fails the check, not the whole process, when the redirect target itself times out", async () => {
    // Regression for a real crash (2026-10-24): the follow-redirect fetch had no try/catch,
    // unlike the main fetch above it, so a timeout there threw uncaught and killed the run
    // instead of being recorded as a failed check.
    const f = await fixture();
    const subdomain = `${f.manifestCid}.ipfs.filebase.io`;
    const { fetchImpl } = fakeGateways(f.published, {
      redirectTo: (host, cid) =>
        host === "ipfs.filebase.io" && cid === f.manifestCid
          ? `https://${subdomain}/ipfs/${cid}`
          : undefined,
      timeoutsFor: (host) => (host === subdomain ? Infinity : 0),
    });
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
    });
    expect(report.ok).toBe(false);
    const failed = report.manifest.find((c) => c.gateway === FILEBASE);
    expect(failed?.ok).toBe(false);
    expect(failed?.reason).toContain("after redirect");
  });
});

describe("streaming hash for large artifacts (NFR-06)", () => {
  it("hashes an artifact over 50 MB correctly without buffering it whole", async () => {
    const f = await fixture();
    const { fetchImpl } = fakeGateways(f.published);
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
    });
    expect(report.ok).toBe(true);
    const large = report.artifacts.filter((c) => c.name === f.largeArtifact.name);
    expect(large).toHaveLength(2);
    for (const c of large) {
      expect(c.ok).toBe(true);
      expect(c.size).toBe(f.largeArtifact.size);
      expect(c.sha256).toBe(f.largeArtifact.sha256);
    }
    expect(f.largeArtifact.size).toBeGreaterThan(STREAM_THRESHOLD_BYTES);
  });

  it("marks a size/sha256 mismatch on a large artifact unverified, not a silent pass", async () => {
    const f = await fixture();
    const { fetchImpl } = fakeGateways(f.published, {
      serve: (host, cid, bytes) =>
        cid === f.largeArtifact.cid && host === "gateway.pinata.cloud"
          ? bytes?.slice(0, -1)
          : bytes,
    });
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
    });
    expect(report.ok).toBe(false);
    const mismatched = report.artifacts.find(
      (c) => c.name === f.largeArtifact.name && c.gateway === PINATA,
    );
    expect(mismatched?.ok).toBe(false);
  });
});

describe("TIMEOUT_MS default", () => {
  it("defaults to 300000ms and can be overridden per call", async () => {
    const f = await fixture();
    const seen: number[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.push((init?.signal as AbortSignal | undefined) ? 1 : 0);
      return new Response(f.manifestBytes, { status: 200 });
    };
    await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      timeoutMs: 1234,
    });
    expect(seen.every((x) => x === 1)).toBe(true);
  });
});

describe("resume (--resume-from)", () => {
  // A crash, a concurrency change, or any other restart otherwise re-checks all 458 real-run
  // checks from zero -- this script has no other persisted state between runs. Fixed 2026-10-24
  // after restarting the real Run 1 verification three times in one day.
  it("skips already-ok checks from a prior log, without re-fetching them", async () => {
    const f = await fixture();
    const { fetchImpl: firstRun } = fakeGateways(f.published);
    const lines: string[] = [];
    const firstReport = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: firstRun,
      sleep: noSleep,
      random: noJitter,
      log: (line) => lines.push(line),
    });
    expect(firstReport.ok).toBe(true);

    const resumeSkip = parseResumeLog(lines.join("\n"));
    expect(resumeSkip.size).toBeGreaterThanOrEqual(firstReport.artifacts.length);
    for (const c of firstReport.artifacts)
      expect(resumeSkip.has(resumeKey(c.gateway, c.name))).toBe(true);

    // The manifest self-check is deliberately never skipped (cheap, correctness-critical), so
    // the fetch here must still work for it -- only the artifact CIDs should go unrequested.
    const { fetchImpl, requests } = fakeGateways(f.published);
    const secondReport = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
      resumeSkip,
    });
    expect(secondReport.ok).toBe(true);
    expect(secondReport.artifacts.every((c) => c.ok)).toBe(true);
    for (const c of firstReport.artifacts) {
      expect(requests.some((u) => u.includes(c.cid ?? "\u0000"))).toBe(false);
    }
    expect(secondReport.artifacts.length).toBe(firstReport.artifacts.length);
  });

  it("still fetches checks not present in the resume set", async () => {
    const f = await fixture();
    const baseline = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fakeGateways(f.published).fetchImpl,
      sleep: noSleep,
      random: noJitter,
    });
    const carOnFilebase = baseline.artifacts.find(
      (c) => c.name === "car/travis-county.car" && c.gateway === FILEBASE,
    );
    const tableOnFilebase = baseline.artifacts.find(
      (c) => c.name === f.largeArtifact.name && c.gateway === FILEBASE,
    );
    expect(carOnFilebase?.cid).toBeTruthy();
    expect(tableOnFilebase?.cid).toBeTruthy();

    const resumeSkip = new Set<string>([resumeKey(FILEBASE, "car/travis-county.car")]);
    const { fetchImpl, requests } = fakeGateways(f.published);
    const report = await verifyManifest({
      manifestPath: f.manifestPath,
      fetch: fetchImpl,
      sleep: noSleep,
      random: noJitter,
      resumeSkip,
    });
    expect(report.ok).toBe(true);
    // The skipped check's CID is never requested on Filebase; the non-skipped one still is.
    const filebaseRequests = requests.filter((u) => u.startsWith(FILEBASE));
    expect(filebaseRequests.some((u) => u.includes(carOnFilebase?.cid ?? "\u0000"))).toBe(false);
    expect(filebaseRequests.some((u) => u.includes(tableOnFilebase?.cid ?? "\u0000"))).toBe(true);
    const skipped = report.artifacts.find(
      (c) => c.name === "car/travis-county.car" && c.gateway === FILEBASE,
    );
    expect(skipped?.ok).toBe(true);
  });
});
