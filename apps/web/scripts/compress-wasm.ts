// A-03 T057 (ADR-0001 Finding 2; TC-028): Brotli-compress the self-hosted DuckDB-WASM eh bundle
// in the Vite output, keeping the file name, so the hosting's `*.wasm` header rule
// (`Content-Encoding: br`, `Content-Type: application/wasm`) applies to the same URL the engine
// loads. CloudFront compresses only files of 1 KB–10 MB; duckdb-eh.wasm is ~36 MB and would be
// served uncompressed (first load p95 8.6 s instead of 3.3 s). Level 11 makes it ~5.3 MB.
//
//   pnpm --filter @countylens/web exec tsx scripts/compress-wasm.ts [--dist dist]
//
// Runs after `vite build` (package.json `build`). Idempotent: a file that no longer starts with
// the WASM magic (`\0asm`) is already compressed and is left alone. Exit 0 when the bundle was
// compressed (or already was), 1 when no eh bundle is in the output (the engine is not bundled:
// not a pass), 2 on a usage error.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

/** `duckdb-eh.wasm` as Vite emits it: the base name plus an optional content hash. */
export const WASM_FILE_PATTERN = /^duckdb-eh(?:-[A-Za-z0-9_-]+)?\.wasm$/;
export const DEFAULT_DIST = "dist";
export const BROTLI_QUALITY = 11;

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

export interface CompressedFile {
  path: string;
  /** Size before (or, when skipped, as found). */
  bytes: number;
  compressedBytes: number;
  /** Already compressed (no WASM magic): left as is. */
  skipped: boolean;
}

export interface CompressReport {
  distDir: string;
  quality: number;
  files: CompressedFile[];
}

export interface CompressOptions {
  /** Brotli quality 0–11; defaults to BROTLI_QUALITY. */
  quality?: number;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Compresses every eh-bundle WASM under `distDir` in place; returns what it did. */
export function compressWasm(distDir: string, options: CompressOptions = {}): CompressReport {
  const quality = options.quality ?? BROTLI_QUALITY;
  const targets = walk(distDir)
    .filter((path) => WASM_FILE_PATTERN.test(basename(path)))
    .sort();
  const files = targets.map((path): CompressedFile => {
    const original = readFileSync(path);
    if (!original.subarray(0, WASM_MAGIC.length).equals(WASM_MAGIC)) {
      return { path, bytes: original.length, compressedBytes: original.length, skipped: true };
    }
    const compressed = brotliCompressSync(original, {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
        [constants.BROTLI_PARAM_QUALITY]: quality,
        [constants.BROTLI_PARAM_SIZE_HINT]: original.length,
      },
    });
    writeFileSync(path, compressed);
    return { path, bytes: original.length, compressedBytes: compressed.length, skipped: false };
  });
  return { distDir, quality, files };
}

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function formatReport(report: CompressReport): string {
  const lines = report.files.map((f) =>
    f.skipped
      ? `  already compressed  ${mb(f.bytes).padStart(9)}  ${f.path}`
      : `  brotli ${report.quality}  ${mb(f.bytes).padStart(9)} → ${mb(f.compressedBytes).padStart(9)}  ${f.path}`,
  );
  lines.push(
    report.files.length === 0
      ? `compress-wasm: FAIL: no ${WASM_FILE_PATTERN.source} under ${report.distDir} (is the engine bundled?)`
      : `compress-wasm: OK: ${report.files.length} file(s) under ${report.distDir}`,
  );
  return lines.join("\n");
}

function parseArgs(argv: string[]): { distDir: string } {
  const options = { distDir: DEFAULT_DIST };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--dist" && value !== undefined) {
      options.distDir = value;
      i += 1;
    } else {
      throw new Error(`compress-wasm: unknown argument ${String(arg)}`);
    }
  }
  return options;
}

/** Runs the step; returns the process exit code. */
export function main(argv: string[]): number {
  let options: { distDir: string };
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  try {
    const report = compressWasm(resolve(options.distDir));
    console.log(formatReport(report));
    return report.files.length === 0 ? 1 : 0;
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
