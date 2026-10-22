// A-14 T024-T026 follow-up (G-3/G-4): `apps/api/src/mcp/runs-index.ts`'s `loadRunsIndex` now
// mirrors `apps/api/src/agent/ask.ts`'s `defaultResolveManifestCid` — the hosted MCP Lambda reads
// `runs/index.json` with one S3 GetObject from `CID_COPY_BUCKET`, the same bucket/key the agent
// Lambda reads, instead of a local file path that would not exist on that Lambda. The local-file
// fallback (`RUNS_INDEX_PATH_ENV`) stays for the stdio build and for tests that don't set
// `CID_COPY_BUCKET`. Nothing here reaches a real AWS account: S3 is mocked (aws-sdk-client-mock),
// and the local-file case points at a temp file.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { latestOf, loadRunsIndex, RUNS_INDEX_PATH_ENV } from "../src/mcp/runs-index.js";

const CID1 = `ba${"a".repeat(60)}`;
const CID2 = `ba${"b".repeat(60)}`;

const INDEX = {
  schema: "oracle-travis-runs-index.v1",
  runs: [
    { runId: "a", manifestCid: CID1, finishedAt: "2026-01-01T00:00:00.000Z" },
    { runId: "b", manifestCid: CID2, finishedAt: "2026-06-01T00:00:00.000Z" },
  ],
};

describe("loadRunsIndex: CID_COPY_BUCKET set -> reads runs/index.json from S3", () => {
  const s3 = mockClient(S3Client);

  beforeEach(() => {
    s3.reset();
  });

  it("GETs the same bucket/key the agent Lambda reads, and Zod-validates the result", async () => {
    s3.on(GetObjectCommand, { Bucket: "copy-bucket", Key: "runs/index.json" }).resolves({
      Body: { transformToString: async () => JSON.stringify(INDEX) } as unknown as never,
    });

    const index = await loadRunsIndex({ CID_COPY_BUCKET: "copy-bucket" });

    expect(index.runs).toHaveLength(2);
    expect(latestOf(index)).toEqual({ runId: "b", manifestCid: CID2, finishedAt: "2026-06-01T00:00:00.000Z" });
    expect(s3.calls()).toHaveLength(1);
  });

  it("throws (no default/empty index) when the body is empty", async () => {
    s3.on(GetObjectCommand, { Bucket: "copy-bucket", Key: "runs/index.json" }).resolves({});
    await expect(loadRunsIndex({ CID_COPY_BUCKET: "copy-bucket" })).rejects.toThrow();
  });

  it("throws (no default/empty index) when S3 itself fails", async () => {
    s3.on(GetObjectCommand, { Bucket: "copy-bucket", Key: "runs/index.json" }).rejects(
      new Error("AccessDenied"),
    );
    await expect(loadRunsIndex({ CID_COPY_BUCKET: "copy-bucket" })).rejects.toThrow();
  });

  it("throws when the body fails RunsIndexV1 (never silently coerced)", async () => {
    s3.on(GetObjectCommand, { Bucket: "copy-bucket", Key: "runs/index.json" }).resolves({
      Body: { transformToString: async () => JSON.stringify({ schema: "wrong", runs: [] }) } as unknown as never,
    });
    await expect(loadRunsIndex({ CID_COPY_BUCKET: "copy-bucket" })).rejects.toThrow();
  });
});

describe("loadRunsIndex: CID_COPY_BUCKET unset -> local-file fallback (stdio build, tests)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "countylens-mcp-runs-index-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads RUNS_INDEX_PATH when CID_COPY_BUCKET is not set", async () => {
    const path = join(dir, "index.json");
    writeFileSync(path, JSON.stringify(INDEX));

    const index = await loadRunsIndex({ [RUNS_INDEX_PATH_ENV]: path });

    expect(latestOf(index)).toEqual({ runId: "b", manifestCid: CID2, finishedAt: "2026-06-01T00:00:00.000Z" });
  });

  it("never calls S3 for the local-file path", async () => {
    const s3 = mockClient(S3Client);
    s3.reset();
    const path = join(dir, "index.json");
    writeFileSync(path, JSON.stringify(INDEX));

    await loadRunsIndex({ [RUNS_INDEX_PATH_ENV]: path });

    expect(s3.calls()).toHaveLength(0);
    s3.restore();
  });

  it("throws when the local file is missing (no default/empty index)", async () => {
    await expect(loadRunsIndex({ [RUNS_INDEX_PATH_ENV]: join(dir, "missing.json") })).rejects.toThrow();
  });
});
