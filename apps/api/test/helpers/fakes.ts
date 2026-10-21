// TEST FIXTURES (test-only, A-03 T062 / T070): everything the router tests need without AWS,
// DuckDB files or the network (plan Notes: unit tests build their own data). A RunManifestV1 is
// built here with the in-repo profile digests so `bindManifest` accepts it; its CID is the real
// raw-leaves CIDv1 of its bytes, so the rawCid check in s3-read.ts is exercised for real. The
// fake engine records every statement and answers DESCRIBE with the columns views.sql requires.
import { createHash } from "node:crypto";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { RUN_MANIFEST_SCHEMA, RunManifestV1 } from "@countylens/contract";
import { PROFILE } from "@countylens/profile-travis-austin";
import {
  REQUIRED_TABLES,
  gazetteer,
  rawCid,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";

/** The Lambda env of the tests: the four config keys plus a fake region and AWS's documented
 *  example credentials (never real), so presigning works offline. */
export const ENV: Readonly<Record<string, string>> = {
  CID_COPY_BUCKET: "copy-bucket",
  CID_COPY_HOST: "copy.example",
  FILEBASE_GATEWAY_HOST: "gateway.example",
  READPATH_PRIVATE_PREFIX: "private/bench/",
  AWS_REGION: "xx-test-1",
  AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

/** The fixture run's finishedAt: the only as-of instant the queries may use (never now()). */
export const FINISHED_AT = "2026-10-20T22:00:10.663Z";

export interface Fixture {
  readonly manifest: RunManifestV1;
  readonly bytes: Uint8Array;
  /** rawCid(bytes): what a client passes as manifestCid. */
  readonly cid: string;
  /** The CID of the one table part (tables/county/property/part-00000.parquet). */
  readonly partCid: string;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A minimal, schema-valid manifest with one county.property part; `runId` changes its CID. */
export async function fixtureManifest(
  options: { runId?: string; finishedAt?: string } = {},
): Promise<Fixture> {
  const runId = options.runId ?? "travis-fixture";
  const partBytes = new TextEncoder().encode(`fixture parquet bytes for ${runId}`);
  const partCid = await rawCid(partBytes);
  const manifest = RunManifestV1.parse({
    schema: RUN_MANIFEST_SCHEMA,
    runId,
    county: "Travis",
    state: "TX",
    fips: "48453",
    startedAt: "2026-10-20T21:00:00.000Z",
    finishedAt: options.finishedAt ?? FINISHED_AT,
    previousManifestCid: null,
    sources: [
      {
        name: "austin-3syk-w9eu",
        url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
        watermark: null,
        captured_at: "2026-10-20T21:30:00.000Z",
        records: 1,
        added: 1,
        changed: 0,
        removed: 0,
        limitations: [],
      },
      {
        name: "tcad-2026-certified-json",
        url: "https://traviscad.org/2026-certified.json",
        watermark: null,
        captured_at: "2026-10-20T21:40:00.000Z",
        records: 1,
        added: 1,
        changed: 0,
        removed: 0,
        limitations: [],
      },
    ],
    artifacts: [
      {
        name: "tables/county/property/part-00000.parquet",
        cid: partCid,
        codec: "raw",
        size: partBytes.length,
        sha256: sha256(partBytes),
        kind: "table",
      },
    ],
    profiles: [
      {
        name: PROFILE.name,
        version: PROFILE.version,
        sha256: PROFILE.sha256,
        path: "profiles/travis-austin@1.0.0/rules.json",
        gitCommit: "0123abc",
      },
      {
        name: "travis-places",
        version: "1.0.0",
        sha256: gazetteer.GAZETTEER.sha256,
        path: "packages/query-core/gazetteer/travis-places@1.0.0/DIGEST",
        gitCommit: "0123abc",
      },
    ],
    coverage: { permits_emitted: { count: 0, derivation: "published_rows" } },
    limitations: [],
  });
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  return { manifest, bytes, cid: await rawCid(bytes), partCid };
}

export interface FakeEngine extends QueryEngine {
  /** Every `run()` statement, in order (the bind sequence). */
  readonly statements: string[];
  /** Every `all()` query, in order. */
  readonly queries: string[];
  /** Rows for a query; undefined → `[]`. DESCRIBE is answered by the fake itself. */
  rowsFor: (sql: string) => Row[] | undefined;
}

const DESCRIBE = /^DESCRIBE SELECT \* FROM (\w+)\.(\w+)$/;

/** A recording QueryEngine. DESCRIBE of a required table returns exactly the columns
 *  bind-manifest.ts checks for, so `bindManifest` binds without a database. */
export function fakeEngine(): FakeEngine {
  const engine: FakeEngine = {
    statements: [],
    queries: [],
    rowsFor: () => undefined,
    async run(sql: string): Promise<void> {
      engine.statements.push(sql);
    },
    async all(sql: string): Promise<Row[]> {
      engine.queries.push(sql);
      const described = DESCRIBE.exec(sql);
      if (described) {
        const table = REQUIRED_TABLES.find(
          (t) => t.group === described[1] && t.table === described[2],
        );
        return Object.entries(table?.columns ?? {}).map(([column_name, column_type]) => ({
          column_name,
          column_type,
        }));
      }
      return engine.rowsFor(sql) ?? [];
    },
  };
  return engine;
}

/** A GetObject output whose Body yields `bytes` (the SDK's transformToByteArray shape). */
export function s3Body(bytes: Uint8Array): GetObjectCommandOutput {
  return {
    $metadata: { httpStatusCode: 200 },
    Body: { transformToByteArray: async () => bytes },
  } as unknown as GetObjectCommandOutput;
}
