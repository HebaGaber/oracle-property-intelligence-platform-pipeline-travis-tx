// Stop check before a publish: binds the manifest about to be published with query-core's
// bindManifest (the code the browser runs) and fails unless every Property Improvement property
// is a published County property (same CID) and v_roofing_permit returns the manifest's count.
// Run 1 failed exactly this: 0 of 17,387 permits joined (property.json differed between groups).
// Parts are read from the local file when the artifact name exists under --root, else from the
// CID copy. Read-only: no upload, no DB.
//
// Usage: npx tsx scripts/identity-gate.ts --manifest <path> [--copy-host <host>]
//          [--expect-permits <n>] [--pids <file>] [--root <dir>]
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
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

const sha256File = (path: string): Promise<string> =>
  new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", fail)
      .on("end", () => done(hash.digest("hex")));
  });

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bytes = readFileSync(args.manifest);
  const manifest = JSON.parse(bytes.toString("utf8")) as {
    coverage: Record<string, { count: number }>;
    artifacts: { name: string; kind: string; sha256: string }[];
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
  // A local part is read only after its bytes hash to the manifest's SHA-256 (a file changed
  // after the manifest was built must not pass the gate).
  const failures: string[] = [];
  const localOk = new Set<string>();
  for (const a of manifest.artifacts.filter((x) => x.kind === "table")) {
    const local = resolve(args.root, a.name);
    if (!existsSync(local)) continue;
    const digest = await sha256File(local);
    if (digest === a.sha256) localOk.add(a.name);
    else failures.push(`local part ${a.name} hashes to ${digest}, manifest says ${a.sha256}`);
  }
  const partUrl = ({ name, cid }: { name: string; cid: string }): string =>
    localOk.has(name) ? resolve(args.root, name) : `https://${args.copyHost}/${cid}`;
  await bindManifest(bytes, "", engine, { partUrl });

  const permits = count(await engine.all("SELECT count(*) AS n FROM v_roofing_permit"));
  const joined = count(await engine.all("SELECT count(*) AS n FROM meta.permit"));
  const piProperties = count(
    await engine.all("SELECT count(DISTINCT cid) AS n FROM property_improvement.property"),
  );
  // NOT EXISTS, never NOT IN: one NULL county cid would make NOT IN match nothing.
  const notCounty = `NOT EXISTS (SELECT 1 FROM county.property c WHERE c.cid = p.cid)`;
  const unmatched = count(
    await engine.all(`SELECT count(DISTINCT p.cid) AS n FROM property_improvement.property p
      WHERE p.cid IS NULL OR ${notCounty}`),
  );
  const nullCids = count(
    await engine.all("SELECT count(*) AS n FROM property_improvement.property WHERE cid IS NULL"),
  );
  let pidUnmatched: string[] = [];
  if (args.pids !== null) {
    const list = args.pids.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
    const rows = await engine.all(`SELECT p.request_identifier AS pid
      FROM property_improvement.property p
      WHERE p.request_identifier IN (${list}) AND (p.cid IS NULL OR ${notCounty})`);
    pidUnmatched = rows.map((r) => String(r["pid"]));
  }
  conn.closeSync();

  if (nullCids !== 0) failures.push(`${nullCids} permit-side properties have a NULL cid`);
  if (emitted === null && args.expectPermits === null) {
    failures.push(
      "no permit count to check: manifest lacks permits_emitted and no --expect-permits",
    );
  }
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
