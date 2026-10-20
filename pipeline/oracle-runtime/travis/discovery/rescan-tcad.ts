// Operator command `npm --prefix pipeline/oracle-runtime run rescan-tcad` (offline, no network).
//
// Re-reads the TCAD Certified Special Export that discovery ALREADY downloaded and refreshes
// only the parcel key fields of pipeline/docs/travis-sources.yaml (identifier_name,
// identifier_layout_name, identifier_proven, identifier_format), then re-runs the
// readiness validator.
//
// Provenance stays the original download's: the export receipt (URL, bytes, SHA-256,
// captured_at), the roll-count measurement and snapshot_time are never touched. Before any
// scan the file must match the receipt byte-for-byte (size and SHA-256), and the rescan's
// record count must equal the recorded assessed_parcel_count; any mismatch writes nothing
// and asks for a fresh discovery run instead.
//
// Exit codes: 0 validator PASS, 1 validator BLOCKED (passed through), 2 refused (nothing written).
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { redact } from "../lib/log.js";
import { DEFAULT_REPO_ROOT } from "./blocked-evidence.js";
import type { Parcel } from "./assemble.js";
import { scanExport, type ExportScan } from "./probes/tcad.js";
import { main as runValidatorMain } from "./run-validator.js";
import { DEFAULT_CATALOG_PATH, readCatalog, writeCatalog } from "./write-catalog.js";

export interface RescanOptions {
  repoRoot?: string;
  catalogPath?: string;
  /** Validator step; defaults to `npm run validate` (exit 0 PASS, 1 BLOCKED, 2 error). */
  validate?: () => Promise<number>;
  scan?: (path: string) => Promise<ExportScan>;
  out?: (line: string) => void;
}

const FRESH_RUN = "a fresh discovery run (npm run discover) is needed";

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

class Refusal extends Error {}

export async function rescanTcad(options: RescanOptions = {}): Promise<number> {
  const root = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
  const out =
    options.out ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const say = (line: string): void => out(redact(line));

  try {
    const catalog = readCatalog(catalogPath);
    const current = catalog.parcel;
    if (!current) throw new Refusal(`catalog has no parcel block; ${FRESH_RUN}`);
    const receipt = current.export_receipt;
    if (!receipt) {
      throw new Refusal(
        `parcel has no export_receipt (nothing downloaded to rescan); ${FRESH_RUN}`,
      );
    }
    const file = join(root, receipt.file_path);
    if (!existsSync(file)) {
      throw new Refusal(`export ${receipt.file_path} not found; ${FRESH_RUN}`);
    }
    const size = statSync(file).size;
    if (size !== receipt.bytes) {
      throw new Refusal(
        `export ${receipt.file_path} is ${size} bytes but the receipt says ${receipt.bytes}; ${FRESH_RUN}`,
      );
    }
    say(`rescan-tcad: hashing ${receipt.file_path} (${size} bytes)`);
    const digest = await sha256File(file);
    if (digest !== receipt.sha256) {
      throw new Refusal(
        `export SHA-256 ${digest} does not match the receipt ${receipt.sha256}; ${FRESH_RUN}`,
      );
    }
    say(`rescan-tcad: sha256 matches the export receipt (captured_at ${receipt.captured_at})`);

    const scan = await (options.scan ?? ((p: string) => scanExport(p)))(file);
    const recorded = current.assessed_parcel_count;
    if (scan.count !== recorded) {
      throw new Refusal(
        `rescan count ${scan.count} != recorded assessed_parcel_count ${String(recorded)}; ${FRESH_RUN}`,
      );
    }
    if (
      current.deed_or_sale_dates_present !== undefined &&
      current.deed_or_sale_dates_present !== scan.deed_or_sale_dates_present
    ) {
      say(
        `rescan-tcad: note: deed_or_sale_dates_present would be ${String(scan.deed_or_sale_dates_present)} (left unchanged)`,
      );
    }

    const {
      identifier_name: _name,
      identifier_layout_name: _layout,
      identifier_format: _format,
      ...rest
    } = current;
    const parcel: Parcel = {
      ...rest,
      identifier_proven: scan.identifier_proven,
      ...(scan.identifier_name ? { identifier_name: scan.identifier_name } : {}),
      ...(scan.identifier_layout_name
        ? { identifier_layout_name: scan.identifier_layout_name }
        : {}),
      ...(scan.identifier_format ? { identifier_format: scan.identifier_format } : {}),
    };
    writeCatalog({ ...catalog, parcel }, catalogPath);
    for (const c of scan.identifier_candidates ?? []) {
      say(
        `rescan-tcad: candidate ${c.name}: present on ${c.present} of ${c.records} records, ${c.distinct} distinct, proven ${String(c.proven)}`,
      );
    }
    say(
      `rescan-tcad: parcel.identifier_name ${scan.identifier_name ?? "(none)"} (layout ${scan.identifier_layout_name ?? "none"}), identifier_proven ${String(scan.identifier_proven)}, identifier_format ${scan.identifier_format ?? "(none)"}; ${scan.count} records`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    say(`rescan-tcad: refused: ${message}`);
    return 2;
  }

  const validate = options.validate ?? (() => runValidatorMain({ repoRoot: root }));
  return validate();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void rescanTcad().then((code) => {
    process.exitCode = code;
  });
}
