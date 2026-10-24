// A-11: adds a run manifest's own JCS bytes to Filebase's Kubo RPC (`POST /api/v0/add`,
// cid-version=1&raw-leaves=true&pin=true&chunker=size-262144 — the same call upload.ts's
// publishRun step 5 makes for every normal run, via kubo-add.ts's kuboAddBytes/cidOfBytes).
//
// Run 1 needed this as a standalone step because its manifest.json was committed to git
// (commit 9ca5004 fixed its bytes to exact canonical JCS) but was never actually `add`ed to
// Filebase — publishRun's step 5 runs inside one `upload` invocation and was not re-run for the
// manifest alone. Rather than re-run the whole sequence (which would re-upload CARs/tables
// already pinned and read back earlier today), this script repeats only step 5 and step 6's own
// readback proof, for exactly this manifest file, so Run 2/Run 3 have a reusable command for
// the same situation instead of a one-off curl.
//
// Usage (from the repo root):
//   npx tsx pipeline/publish/scripts/upload-manifest.ts runs/<runId>/manifest.json
//
// Credentials: ~/.config/assessment/filebase.env (FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY,
// FILEBASE_BUCKET), loaded into a child env only (never process.env, never printed) — the same
// file and loader cli.ts's `upload` command uses. A value never reaches argv, a log line, or an
// error message (every printed line is redact()ed).
//
// Exit 0 only when: the Kubo RPC Hash equals the locally computed CID (kuboAddBytes already
// enforces this) AND both AM-01 gateways (Pinata, Filebase) serve back the identical bytes. Exit
// 1 otherwise, with the reason.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { cidOfBytes } from "../src/cid.js";
import { kuboAddBytes } from "../src/kubo-add.js";
import { FILEBASE_RPC_API, FILEBASE_GATEWAY, filebaseEnvProblem, redact, secretValues } from "../src/sequence.js";
import { FILEBASE_ENV_FILE, parseEnvFile } from "../src/cli.js";

/** Independent of the pin host (AM-01): Pinata's public gateway and the Filebase gateway. */
const READBACK_GATEWAYS = ["https://gateway.pinata.cloud", FILEBASE_GATEWAY] as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readbackOne(
  gateway: string,
  cid: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<{ gateway: string; ok: boolean; status?: number; reason?: string }> {
  try {
    const res = await fetch(`${gateway}/ipfs/${cid}`, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) {
      await res.body?.cancel();
      return { gateway, ok: false, status: res.status, reason: `HTTP ${res.status}` };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const ok = bytes.length === expectedSize && sha256 === expectedSha256;
    return ok
      ? { gateway, ok: true, status: res.status }
      : {
          gateway,
          ok: false,
          status: res.status,
          reason: `size ${bytes.length} (want ${expectedSize}) sha256 ${sha256} (want ${expectedSha256})`,
        };
  } catch (error) {
    return { gateway, ok: false, reason: message(error) };
  }
}

async function main(): Promise<number> {
  const manifestPath = process.argv[2];
  if (manifestPath === undefined || manifestPath.startsWith("-")) {
    console.error("usage: npx tsx pipeline/publish/scripts/upload-manifest.ts runs/<runId>/manifest.json");
    return 2;
  }
  if (!existsSync(manifestPath)) {
    console.error(`${manifestPath} does not exist`);
    return 2;
  }

  const fromFile = existsSync(FILEBASE_ENV_FILE)
    ? parseEnvFile(readFileSync(FILEBASE_ENV_FILE, "utf8"))
    : {};
  const env: NodeJS.ProcessEnv = { ...process.env, ...fromFile };
  const problem = filebaseEnvProblem(env);
  const safe = (text: string): string => redact(text, secretValues(env));
  if (problem !== undefined) {
    console.error(`refused: ${problem}`);
    return 1;
  }

  const bytes = readFileSync(manifestPath);
  const expectedCid = await cidOfBytes(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(`manifest: ${manifestPath}`);
  console.log(`expected cid (local, raw-leaves CIDv1): ${expectedCid}`);
  console.log(`size: ${bytes.length} sha256: ${sha256}`);

  try {
    const added = await kuboAddBytes(bytes, "manifest.json", expectedCid, {
      env,
      api: FILEBASE_RPC_API,
    });
    console.log(`kubo add ok: Hash ${added.cid} matches the local CID, pinned on Filebase`);
  } catch (error) {
    console.error(safe(`kubo add failed: ${message(error)}`));
    return 1;
  }

  let allOk = true;
  for (const gateway of READBACK_GATEWAYS) {
    const result = await readbackOne(gateway, expectedCid, bytes.length, sha256);
    if (result.ok) {
      console.log(`ok   ${gateway}/ipfs/${expectedCid} size=${bytes.length} sha256 match`);
    } else {
      allOk = false;
      console.log(`FAIL ${gateway}/ipfs/${expectedCid} ${result.reason ?? "mismatch"}`);
    }
  }

  if (!allOk) {
    console.error("VERIFICATION FAILED: not all gateways served back the identical manifest bytes");
    return 1;
  }
  console.log("ALL GATEWAYS VERIFIED");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
