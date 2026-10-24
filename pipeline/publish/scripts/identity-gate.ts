// Stop check before a publish: binds the manifest about to be published with query-core's
// bindManifest (the code the browser runs) and fails unless every Property Improvement property
// is a published County property (same CID) and v_roofing_permit returns the manifest's count.
// Run 1 failed exactly this: 0 of 17,387 permits joined (property.json differed between groups).
// Parts are read from the local file when the artifact name exists under --root, else from the
// CID copy. Read-only: no upload, no DB.
//
// Usage: npx tsx scripts/identity-gate.ts --manifest <path> [--copy-host <host>]
//          [--expect-permits <n>] [--pids <file>] [--root <dir>]
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bindManifest, type QueryEngine, type Row } from "@countylens/query-core";
import { DuckDBInstance } from "@duckdb/node-api";

interface Args {
  manifest: string;
  copyHost: string;
  expectPermits: number | null;
  pids: string[] | null;
  root: string;
}

function parseArgs(argv: readonly string[]): Args {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const manifest = value("--manifest");
  if (manifest === undefined) throw new Error("--manifest <path> is required");
  const copyHost = value("--copy-host") ?? process.env.CID_COPY_HOST;
  if (copyHost === undefined || copyHost === "") {
    throw new Error("--copy-host or CID_COPY_HOST is required");
  }
  const expect = value("--expect-permits");
  const pidsFile = value("--pids");
  return {
    manifest,
    copyHost,
    expectPermits: expect === undefined ? null : Number(expect),
    pids:
      pidsFile === undefined
        ? null
        : readFileSync(pidsFile, "utf8")
            .split(/\s+/)
            .filter((p) => p !== ""),
    root: value("--root") ?? process.cwd(),
  };
}

const count = (rows: Row[]): number => Number(rows[0]?.["n"] ?? -1);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bytes = readFileSync(args.manifest);
  const manifest = JSON.parse(bytes.toString("utf8")) as {
    coverage: Record<string, { count: number }>;
  };
  const emitted = manifest.coverage["permits_emitted"]?.count ?? null;

  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  await conn.run("LOAD parquet; LOAD httpfs; LOAD json; LOAD icu; SET TimeZone = 'UTC'");
  const engine: QueryEngine = {
    run: async (sql) => {
      await conn.run(sql);
    },
    all: async (sql) => (await conn.runAndReadAll(sql)).getRowObjectsJson() as Row[],
  };
  const partUrl = ({ name, cid }: { name: string; cid: string }): string => {
    const local = resolve(args.root, name);
    return existsSync(local) ? local : `https://${args.copyHost}/${cid}`;
  };
  await bindManifest(bytes, "", engine, { partUrl });

  const permits = count(await engine.all("SELECT count(*) AS n FROM v_roofing_permit"));
  const joined = count(await engine.all("SELECT count(*) AS n FROM meta.permit"));
  const piProperties = count(
    await engine.all("SELECT count(DISTINCT cid) AS n FROM property_improvement.property"),
  );
  const unmatched = count(
    await engine.all(`SELECT count(DISTINCT p.cid) AS n FROM property_improvement.property p
      WHERE p.cid NOT IN (SELECT cid FROM county.property)`),
  );
  let pidUnmatched: string[] = [];
  if (args.pids !== null) {
    const list = args.pids.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
    const rows = await engine.all(`SELECT p.request_identifier AS pid
      FROM property_improvement.property p
      WHERE p.request_identifier IN (${list})
        AND p.cid NOT IN (SELECT cid FROM county.property)`);
    pidUnmatched = rows.map((r) => String(r["pid"]));
  }
  conn.closeSync();

  const failures: string[] = [];
  if (unmatched !== 0)
    failures.push(`${unmatched} permit-side properties are not county properties`);
  if (joined <= 0) failures.push("meta.permit is empty");
  if (emitted !== null && permits !== emitted) {
    failures.push(`v_roofing_permit ${permits} != manifest permits_emitted ${emitted}`);
  }
  if (args.expectPermits !== null && permits !== args.expectPermits) {
    failures.push(`v_roofing_permit ${permits} != expected ${args.expectPermits}`);
  }
  if (pidUnmatched.length > 0)
    failures.push(`pIDs not matched: ${pidUnmatched.slice(0, 20).join(",")}`);

  console.log(
    JSON.stringify(
      {
        manifest: args.manifest,
        v_roofing_permit: permits,
        meta_permit: joined,
        permits_emitted: emitted,
        permit_side_properties: piProperties,
        unmatched_properties: unmatched,
        pids_checked: args.pids?.length ?? 0,
        pids_unmatched: pidUnmatched.length,
        result: failures.length === 0 ? "PASS" : "FAIL",
        failures,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`[identity-gate] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
