// The committed run index (RunsIndexV1, research R-08): published runs only, ordered by
// finishedAt, stored as exact RFC 8785 JCS bytes in runs/index.json. Each listed run's
// runs/<runId>/manifest.json is the exact JCS bytes of its manifest, and its raw-leaves CIDv1
// is the manifestCid in the index. The index is written only after the manifest's upload read
// back. The index CID goes in the evidence, never inside the index.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS_INDEX_SCHEMA, RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { cidOfBytes } from "./cid.js";
import { jcsBytes } from "./jcs.js";

export type RunEntry = RunsIndexV1["runs"][number];

export function emptyRunsIndex(): RunsIndexV1 {
  return RunsIndexV1.parse({ schema: RUNS_INDEX_SCHEMA, runs: [] });
}

/** A new index with `entry` added, ordered by finishedAt. Duplicate runId or manifestCid fail. */
export function addRun(index: RunsIndexV1, entry: RunEntry): RunsIndexV1 {
  if (index.runs.some((r) => r.runId === entry.runId))
    throw new Error(`runId ${entry.runId} is already in the index`);
  if (index.runs.some((r) => r.manifestCid === entry.manifestCid))
    throw new Error(`manifestCid ${entry.manifestCid} is already in the index`);
  const runs = [...index.runs, { ...entry }].sort(
    (a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt),
  );
  return RunsIndexV1.parse({ schema: RUNS_INDEX_SCHEMA, runs });
}

/** The exact bytes of runs/index.json: JCS, no trailing newline. */
export function runsIndexBytes(index: RunsIndexV1): Uint8Array {
  return jcsBytes(RunsIndexV1.parse(index));
}

export function parseRunsIndex(text: string | Uint8Array): RunsIndexV1 {
  const json = typeof text === "string" ? text : new TextDecoder().decode(text);
  return RunsIndexV1.parse(JSON.parse(json));
}

export interface CommittedRunCheck {
  runId: string;
  manifestCid: string;
  ok: boolean;
  reason?: string;
}

export interface CommittedRunsResult {
  ok: boolean;
  checks: CommittedRunCheck[];
}

/**
 * Checks a committed `runs/` directory: index.json is exact JCS bytes of a RunsIndexV1, and each
 * listed run's manifest.json is the exact JCS bytes of a RunManifestV1 for that runId whose
 * raw-leaves CIDv1 equals the manifestCid in the index.
 */
export async function verifyCommittedRuns(runsDir: string): Promise<CommittedRunsResult> {
  const indexPath = join(runsDir, "index.json");
  const indexBytes = readFileSync(indexPath);
  const index = parseRunsIndex(indexBytes);
  if (!indexBytes.equals(Buffer.from(runsIndexBytes(index))))
    throw new Error(`${indexPath} is not the exact JCS bytes of its RunsIndexV1`);
  const checks: CommittedRunCheck[] = [];
  for (const run of index.runs) {
    const path = join(runsDir, run.runId, "manifest.json");
    const check = (reason?: string): CommittedRunCheck =>
      reason === undefined
        ? { runId: run.runId, manifestCid: run.manifestCid, ok: true }
        : { runId: run.runId, manifestCid: run.manifestCid, ok: false, reason };
    if (!existsSync(path)) {
      checks.push(check(`${path} is missing`));
      continue;
    }
    const bytes = readFileSync(path);
    const parsed = RunManifestV1.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success) {
      checks.push(check(`${path} is not a RunManifestV1: ${parsed.error.message}`));
      continue;
    }
    const manifest = parsed.data;
    if (!bytes.equals(Buffer.from(jcsBytes(manifest)))) {
      checks.push(check(`${path} is not the exact JCS bytes of its manifest`));
      continue;
    }
    if (manifest.runId !== run.runId) {
      checks.push(check(`${path} is the manifest of ${manifest.runId}`));
      continue;
    }
    if (manifest.finishedAt !== run.finishedAt) {
      checks.push(check(`${path} finishedAt ${manifest.finishedAt} differs from the index`));
      continue;
    }
    const cid = await cidOfBytes(bytes);
    if (cid !== run.manifestCid) {
      checks.push(check(`${path} has CID ${cid}, the index lists ${run.manifestCid}`));
      continue;
    }
    checks.push(check());
  }
  return { ok: checks.every((c) => c.ok), checks };
}
