// A-07 T017 (Track A): the Loader `comptroller` track (migration 0401_comptroller_registry.sql)
// and crosswalk ledger table (0402). The Loader is the only writer: this module writes only
// through the transaction it is handed. Reads the single shared adapter's staged artifact
// (oracle-runtime travis/adapters/socrata/tx-comptroller.ts, T010) -- one writer, Track C's
// business transform (T039) reads the same loaded rows, never a second fetch.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { z } from "zod";
import { registrySnapshotDigest, type ComptrollerRow } from "../../../oracle-runtime/travis/adapters/socrata/tx-comptroller.js";
import type { LoaderTrack, MergeOutcome } from "../loader.js";

export const COMPTROLLER_SOURCE_KEY = "tx-comptroller-9cir-efmm";

const JobId = z.string().regex(/^travis-a07-[a-z0-9-]+$/);
const Sha = z.string().regex(/^[a-f0-9]{64}$/);

const LoadRegistryInput = z.object({
  kind: z.literal("load_registry"),
  jobId: JobId,
  artifactPath: z.string().min(1),
  artifactSha256: Sha,
  scope: z.enum(["travis", "statewide"]),
  /** Max `:updated_at` of the loaded rows (Socrata watermark field), null if none observed. */
  watermark: z.string().nullable(),
  sourceUrl: z.string().min(1),
  capturedAt: z.string().min(1),
});
export type ComptrollerMergeInput = z.infer<typeof LoadRegistryInput>;

const StagedRow = z.object({
  taxpayerNumber: z.string().min(1),
  legalName: z.string().min(1),
  sosStatusCode: z.string().min(1),
  mailingAddress: z.string().nullable(),
  sosFileNumber: z.string().nullable(),
});

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** Reads the staged artifact back, verifying it against its declared digest (never trust a path alone). */
function readStagedRows(path: string, expectedSha256: string): ComptrollerRow[] {
  const body = readFileSync(path);
  const actual = sha256(body);
  if (actual !== expectedSha256) {
    throw new Error(`comptroller artifact ${path} sha256 ${actual} differs from declared ${expectedSha256}`);
  }
  return z.array(StagedRow).parse(JSON.parse(body.toString("utf8")));
}

async function mergeLoadRegistry(
  tx: postgres.TransactionSql,
  input: ComptrollerMergeInput,
): Promise<MergeOutcome> {
  const rows = readStagedRows(input.artifactPath, input.artifactSha256);
  let written = 0;
  if (rows.length > 0) {
    const col = (f: (r: ComptrollerRow) => string | null): (string | null)[] => rows.map(f);
    const out = await tx<{ taxpayer_number: string }[]>`
      INSERT INTO comptroller_registry (taxpayer_number, legal_name, sos_status_code, mailing_address, sos_file_number, source_url, captured_at, updated_at, job_id)
      SELECT u.taxpayer_number, u.legal_name, u.sos_status_code, u.mailing_address, u.sos_file_number,
             ${input.sourceUrl}, ${input.capturedAt}::timestamptz, ${input.watermark}::timestamptz, ${input.jobId}
      FROM unnest(${col((r) => r.taxpayerNumber)}::text[], ${col((r) => r.legalName)}::text[],
                  ${col((r) => r.sosStatusCode)}::text[], ${col((r) => r.mailingAddress)}::text[],
                  ${col((r) => r.sosFileNumber)}::text[])
           AS u(taxpayer_number, legal_name, sos_status_code, mailing_address, sos_file_number)
      ON CONFLICT (taxpayer_number) DO UPDATE SET
        legal_name = excluded.legal_name, sos_status_code = excluded.sos_status_code,
        mailing_address = excluded.mailing_address, sos_file_number = excluded.sos_file_number,
        source_url = excluded.source_url, captured_at = excluded.captured_at,
        updated_at = excluded.updated_at, job_id = excluded.job_id
      WHERE comptroller_registry.updated_at IS DISTINCT FROM excluded.updated_at
         OR comptroller_registry.legal_name IS DISTINCT FROM excluded.legal_name
         OR comptroller_registry.sos_status_code IS DISTINCT FROM excluded.sos_status_code
      RETURNING comptroller_registry.taxpayer_number`;
    written = out.length;
  }
  const digest = registrySnapshotDigest(rows);
  await tx`
    INSERT INTO comptroller_registry_loads (job_id, scope, row_count, watermark, snapshot_digest, source_url, loaded_at)
    VALUES (${input.jobId}, ${input.scope}, ${rows.length}, ${input.watermark}, ${digest}, ${input.sourceUrl}, ${input.capturedAt}::timestamptz)
    ON CONFLICT (job_id) DO NOTHING`;
  return {
    rowsWritten: written,
    watermark:
      // Written even when `watermark` (the Socrata field) is null: the row count and digest
      // still need to reach the identity report section (T017's other deliverable).
      {
        sourceKey: COMPTROLLER_SOURCE_KEY,
        value: {
          watermark: input.watermark,
          rowCount: rows.length,
          snapshotDigest: digest,
          jobId: input.jobId,
          scope: input.scope,
          sourceUrl: input.sourceUrl,
        },
      },
  };
}

async function merge(tx: postgres.TransactionSql, input: ComptrollerMergeInput): Promise<MergeOutcome> {
  switch (input.kind) {
    case "load_registry":
      return mergeLoadRegistry(tx, input);
  }
}

export const track: LoaderTrack<ComptrollerMergeInput> = {
  name: "comptroller",
  input: LoadRegistryInput as unknown as z.ZodType<ComptrollerMergeInput>,
  merge,
};
