// A-03 T021: the bundle gate (plan § Constitution Check X; agent-design metagross § 7). The
// gzipped size of `apps/web/dist/assets/*.js`, DuckDB chunks excluded, must stay at or under
// 300 KB; the DuckDB-WASM engine is lazy-loaded and measured separately by the hosted perf
// cases, not here. A chunk counts as DuckDB when its file name contains `duckdb`.
//
//   pnpm exec tsx scripts/bundle-size.ts [--dist apps/web/dist] [--limit-kb 300]
//
// Exit 0 when the total is within the limit, 1 when it is over or the dist folder is missing
// (a build that did not run is not a pass), 2 on a usage error.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const DEFAULT_LIMIT_BYTES = 300 * 1024;
export const DEFAULT_DIST = "apps/web/dist";
export const DUCKDB_CHUNK = /duckdb/i;

export interface BundleFile {
  name: string;
  bytes: number;
  gzipBytes: number;
  /** DuckDB chunk: listed for information, not counted. */
  excluded: boolean;
}

export interface BundleReport {
  distDir: string;
  files: BundleFile[];
  /** Sum of `gzipBytes` over the files that are not excluded. */
  totalGzipBytes: number;
  limitBytes: number;
  ok: boolean;
}

export interface CheckOptions {
  distDir: string;
  limitBytes?: number;
}

/** Measures `assets/*.js` under `distDir` (one level, as Vite writes them). */
export function checkBundle({
  distDir,
  limitBytes = DEFAULT_LIMIT_BYTES,
}: CheckOptions): BundleReport {
  const assets = join(distDir, "assets");
  if (!existsSync(assets)) {
    throw new Error(`bundle-size: not found: ${assets} (run the web build first)`);
  }
  const files = readdirSync(assets)
    .filter((name) => name.endsWith(".js") && statSync(join(assets, name)).isFile())
    .sort()
    .map((name): BundleFile => {
      const content = readFileSync(join(assets, name));
      return {
        name,
        bytes: content.byteLength,
        gzipBytes: gzipSync(content).byteLength,
        excluded: DUCKDB_CHUNK.test(name),
      };
    });
  const totalGzipBytes = files.filter((f) => !f.excluded).reduce((sum, f) => sum + f.gzipBytes, 0);
  return { distDir, files, totalGzipBytes, limitBytes, ok: totalGzipBytes <= limitBytes };
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

export function formatReport(report: BundleReport): string {
  const lines = report.files.map(
    (f) =>
      `  ${f.excluded ? "excluded" : "counted "}  ${kb(f.gzipBytes).padStart(10)} gz  ${kb(f.bytes).padStart(10)} raw  ${f.name}`,
  );
  const verdict = report.ok ? "OK" : "FAIL";
  lines.push(
    `bundle-size: ${verdict}: ${report.totalGzipBytes} bytes gzipped (${kb(report.totalGzipBytes)}) against limit ${report.limitBytes} (${kb(report.limitBytes)}) for ${report.distDir}/assets/*.js, DuckDB chunks excluded`,
  );
  return lines.join("\n");
}

interface CliOptions {
  distDir: string;
  limitBytes: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { distDir: DEFAULT_DIST, limitBytes: DEFAULT_LIMIT_BYTES };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--dist" && value !== undefined) {
      options.distDir = value;
      i += 1;
    } else if (arg === "--limit-kb" && value !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`bundle-size: bad --limit-kb ${value}`);
      options.limitBytes = Math.round(n * 1024);
      i += 1;
    } else {
      throw new Error(`bundle-size: unknown argument ${arg}`);
    }
  }
  return options;
}

/** Runs the gate; returns the process exit code. */
export function main(argv: string[]): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  try {
    const report = checkBundle({
      distDir: resolve(options.distDir),
      limitBytes: options.limitBytes,
    });
    console.log(formatReport(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
