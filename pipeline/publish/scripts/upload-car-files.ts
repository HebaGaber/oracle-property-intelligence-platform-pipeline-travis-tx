// A-11 (AM-05, D-5 follow-up): additive step that `elephant-cli upload` does NOT perform.
//
// `elephant-cli upload <car>` does a Kubo `dag/import` of the CAR's internal DAG, giving the
// `cid`/`root` that addresses the DAG (already uploaded and read back for every car/directory
// artifact via upload-manifest.ts's sibling runs). A DAG root cannot be hashed and compared
// against a plain file's bytes (no file exists at that CID from the importer's point of view),
// so AM-05 added a second, additive `carCid` to every `car` artifact and to the `tables.car`
// index inside every `directory` (tables) artifact: the plain file's own raw-leaves CIDv1, got
// by `add`ing the file's bytes (never dag/import) so verify-manifest.ts can stream and hash it
// like any other file. This script performs exactly that second step for every carCid artifact
// in a run manifest, confirms the Kubo Hash matches the manifest's recorded carCid (kuboAddFile
// enforces this; a mismatch throws and the whole run aborts rather than accepting it), and reads
// each one back from both AM-01 gateways before declaring it done.
//
// Usage (from the repo root):
//   npx tsx pipeline/publish/scripts/upload-car-files.ts runs/<runId>/manifest.json
//
// What it uploads: for every "car" kind artifact, the file at its `name` path (the .car itself).
// For every "directory" kind artifact (a tables/<batch> folder), the `tables.car` index file
// inside that folder, named by that artifact's `carCid`. Artifacts with no `carCid` are skipped
// with a note (nothing to add). Table artifacts (kind "table") are untouched; their `cid` is
// already the plain Parquet file's own CID from `elephant-cli export-tables` and needs no
// additive step.
//
// Credentials: ~/.config/assessment/filebase.env (FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY,
// FILEBASE_BUCKET), loaded into a child env only (never process.env, never printed, never put in
// a URL/argv/log line — every printed line is redact()ed). Idempotent: re-running after a partial
// failure re-adds every artifact (Kubo add is idempotent for identical bytes) and re-verifies
// readback; it does not skip based on local state, since the whole point is independent proof.
//
// Exit 0 only when every carCid artifact's Kubo Hash matched its manifest CID AND both AM-01
// gateways (Pinata, Filebase) served back byte-identical content. Exit 1 otherwise, after
// uploading everything it can and reporting every failure (it does not stop at the first one).
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { kuboAddFile, KUBO_ADD_TIMEOUT_MS } from "../src/kubo-add.js";
import { FILEBASE_RPC_API, FILEBASE_GATEWAY, filebaseEnvProblem, redact, secretValues } from "../src/sequence.js";
import { FILEBASE_ENV_FILE, parseEnvFile } from "../src/cli.js";

/** Independent of the pin host (AM-01): Pinata's public gateway and the Filebase gateway. */
const READBACK_GATEWAYS = ["https://gateway.pinata.cloud", FILEBASE_GATEWAY] as const;

interface ManifestArtifact {
  name: string;
  kind: string;
  carCid?: string;
}
interface ManifestLike {
  artifacts: ManifestArtifact[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The local path of the plain file that must exist at `artifact.carCid`. */
function carFilePath(artifact: ManifestArtifact): string {
  if (artifact.kind === "car") return artifact.name;
  if (artifact.kind === "directory") return join(artifact.name, "tables.car");
  throw new Error(`artifact ${artifact.name} has carCid but is kind ${artifact.kind}, not car/directory`);
}

async function readbackOne(
  gateway: string,
  cid: string,
  expectedSize: number,
): Promise<{ gateway: string; ok: boolean; status?: number; reason?: string }> {
  try {
    const res = await fetch(`${gateway}/ipfs/${cid}`, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) {
      await res.body?.cancel();
      return { gateway, ok: false, status: res.status, reason: `HTTP ${res.status}` };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const ok = bytes.length === expectedSize;
    return ok
      ? { gateway, ok: true, status: res.status }
      : { gateway, ok: false, status: res.status, reason: `size ${bytes.length} (want ${expectedSize}), sha256 ${sha256}` };
  } catch (error) {
    return { gateway, ok: false, reason: message(error) };
  }
}

async function main(): Promise<number> {
  const manifestPath = process.argv[2];
  if (manifestPath === undefined || manifestPath.startsWith("-")) {
    console.error("usage: npx tsx pipeline/publish/scripts/upload-car-files.ts runs/<runId>/manifest.json");
    return 2;
  }
  if (!existsSync(manifestPath)) {
    console.error(`${manifestPath} does not exist`);
    return 2;
  }

  const fromFile = existsSync(FILEBASE_ENV_FILE) ? parseEnvFile(readFileSync(FILEBASE_ENV_FILE, "utf8")) : {};
  const env: NodeJS.ProcessEnv = { ...process.env, ...fromFile };
  const problem = filebaseEnvProblem(env);
  const safe = (text: string): string => redact(text, secretValues(env));
  if (problem !== undefined) {
    console.error(`refused: ${problem}`);
    return 1;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestLike;
  const targets = manifest.artifacts.filter((a) => a.carCid !== undefined && a.carCid !== "");
  console.log(`manifest: ${manifestPath}`);
  console.log(`carCid artifacts to upload: ${targets.length}`);

  let failures = 0;
  for (const artifact of targets) {
    const path = carFilePath(artifact);
    const expectedCid = artifact.carCid as string;
    console.log(`\n${artifact.name} (${artifact.kind}) -> ${path}`);
    if (!existsSync(path)) {
      console.log(`FAIL  local file missing: ${path}`);
      failures += 1;
      continue;
    }
    // County/permit CARs run tens to hundreds of MB; the Kubo RPC `add` of a plain file (unlike
    // elephant-cli's own dag/import, which this is additive to) has been observed to need more
    // than KUBO_ADD_TIMEOUT_MS's default 300_000 ms against Filebase for a file over ~50 MB
    // (confirmed 2026-10-24: a 232 MB CAR timed out at the default). Scale generously rather than
    // retry blind: 1 ms per byte, floored at the library default, uncapped (a 300 MB file gets 5
    // min; this is a one-shot upload step, not a latency-sensitive path).
    const fileSize = readFileSync(path).length;
    const timeoutMs = Math.max(KUBO_ADD_TIMEOUT_MS, fileSize);
    try {
      const added = await kuboAddFile(path, expectedCid, { env, api: FILEBASE_RPC_API, timeoutMs });
      console.log(`ok    kubo add: Hash ${added.cid} matches manifest carCid, size=${added.size}, pinned on Filebase`);
    } catch (error) {
      console.log(`FAIL  ${safe(`kubo add: ${message(error)}`)}`);
      failures += 1;
      continue;
    }
    for (const gateway of READBACK_GATEWAYS) {
      const result = await readbackOne(gateway, expectedCid, fileSize);
      if (result.ok) {
        console.log(`ok    ${gateway}/ipfs/${expectedCid} size match`);
      } else {
        console.log(`FAIL  ${gateway}/ipfs/${expectedCid} ${result.reason ?? "mismatch"}`);
        failures += 1;
      }
    }
  }

  console.log(`\n${failures === 0 ? "ALL CARCID ARTIFACTS UPLOADED AND VERIFIED" : `${failures} check(s) failed`}`);
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
