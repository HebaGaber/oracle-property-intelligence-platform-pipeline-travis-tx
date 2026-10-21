#!/usr/bin/env -S npx tsx
// verify-manifest (contracts/cli.md, TC-040…043): a thin CLI over pipeline/publish/src/verify.ts.
//
//   npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json [--gateway <host>]... [--verbose]
//
// Fetches the manifest by its CID from the Pinata public gateway and the Filebase gateway and
// compares it byte-for-byte with the local file, then every artifact (tables by cid, CARs and
// directories by carCid) with plain GETs, checking size and SHA-256. Prints one line per artifact
// per gateway and `ALL ARTIFACTS VERIFIED`; exit 0 only when everything matches on both gateways.
// Exit 1 on a verification failure, 2 on a refused gateway or a usage error. Hosts come from
// `--gateway`, else from PINATA_GATEWAY_HOST / FILEBASE_GATEWAY_HOST in the environment, else the
// defaults; any host outside the allowlist is refused before the first request. TIMEOUT_MS in the
// environment overrides the 120 s per-request timeout.
import {
  FILEBASE_GATEWAY_HOST,
  PINATA_GATEWAY_HOST,
  TIMEOUT_MS,
  verifyManifest,
} from "../pipeline/publish/src/verify.js";

interface Args {
  manifestPath: string;
  gateways: string[];
  verbose: boolean;
}

function usage(): never {
  console.error(
    "usage: npx tsx scripts/verify-manifest.ts runs/<runId>/manifest.json [--gateway <host>]... [--verbose]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  let manifestPath: string | undefined;
  const gateways: string[] = [];
  let verbose = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--gateway") {
      const host = argv[i + 1];
      if (host === undefined || host.startsWith("--")) usage();
      gateways.push(host);
      i += 1;
    } else if (arg.startsWith("--gateway=")) {
      gateways.push(arg.slice("--gateway=".length));
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg.startsWith("-")) {
      usage();
    } else if (manifestPath === undefined) {
      manifestPath = arg;
    } else {
      usage();
    }
  }
  if (manifestPath === undefined) usage();
  if (gateways.length === 0) {
    gateways.push(
      process.env.PINATA_GATEWAY_HOST ?? PINATA_GATEWAY_HOST,
      process.env.FILEBASE_GATEWAY_HOST ?? FILEBASE_GATEWAY_HOST,
    );
  }
  return { manifestPath, gateways, verbose };
}

function timeoutMs(): number {
  const raw = process.env.TIMEOUT_MS;
  if (raw === undefined || raw === "") return TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`TIMEOUT_MS must be a positive integer of milliseconds, not "${raw}"`);
    process.exit(2);
  }
  return n;
}

const args = parseArgs(process.argv.slice(2));
try {
  const report = await verifyManifest({
    manifestPath: args.manifestPath,
    gateways: args.gateways,
    timeoutMs: timeoutMs(),
    verbose: args.verbose,
  });
  process.exit(report.ok ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}
