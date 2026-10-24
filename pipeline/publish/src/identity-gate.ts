// The pre-publish identity gate as an importable module. It binds the manifest about to be
// published with query-core's bindManifest (the code the browser runs) and fails unless every
// Property Improvement property is a published County property (same CID), meta.permit is not
// empty, and v_roofing_permit returns the manifest's permits_emitted count. Run 1 failed exactly
// this: 0 of 17,387 permits joined (property.json differed between groups).
//
// Local table parts are used only when their SHA-256 matches the manifest; otherwise (and always
// with `remoteOnly`) a part is read from the CID copy, the bytes the app reads. Read-only: no
// upload, no database. The script scripts/identity-gate.ts is a thin CLI over runIdentityGate.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bindManifest, type QueryEngine, type Row } from "@countylens/query-core";

export interface IdentityGateOptions {
  /** Path of the manifest; read when `manifestBytes` is not given. */
  manifestPath?: string;
  /** The exact manifest bytes to bind (the driver passes the bytes whose CID it publishes). */
  manifestBytes?: Uint8Array;
  /** Host of the CID copy, e.g. d2xsqoqv09bd0q.cloudfront.net. */
  copyHost: string;
  /** Directory the manifest's artifact names resolve against for local parts. */
  root: string;
  expectPermits?: number | null;
  pids?: readonly string[] | null;
  /** Never read a local part: bind every table part from the CID copy. */
  remoteOnly?: boolean;
  /** Opens the query engine (AD-19: DuckDB is wired by the caller, scripts/duckdb-engine.ts). */
  openEngine: () => Promise<OpenedEngine>;
}

export interface OpenedEngine {
  engine: QueryEngine;
  close: () => void;
}

export interface IdentityGateSummary {
  manifest: string;
  v_roofing_permit: number;
  meta_permit: number;
  permits_emitted: number | null;
  permit_side_properties: number;
  unmatched_properties: number;
  pids_checked: number;
  pids_unmatched: number;
  result: "PASS" | "FAIL";
  failures: string[];
}

export type IdentityGate = (
  options: Pick<IdentityGateOptions, "remoteOnly">,
) => Promise<IdentityGateSummary>;

const count = (rows: Row[]): number => Number(rows[0]?.["n"] ?? -1);

const sha256File = (path: string): Promise<string> =>
  new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", fail)
      .on("end", () => done(hash.digest("hex")));
  });

export async function runIdentityGate(options: IdentityGateOptions): Promise<IdentityGateSummary> {
  const { copyHost, root } = options;
  const expectPermits = options.expectPermits ?? null;
  const pids = options.pids ?? null;
  const remoteOnly = options.remoteOnly === true;
  if (options.manifestBytes === undefined && options.manifestPath === undefined)
    throw new Error("runIdentityGate needs manifestPath or manifestBytes");
  if (copyHost === "") throw new Error("runIdentityGate needs a CID copy host");
  const bytes = Buffer.from(options.manifestBytes ?? readFileSync(options.manifestPath ?? ""));
  const manifest = JSON.parse(bytes.toString("utf8")) as {
    coverage: Record<string, { count: number }>;
    artifacts: { name: string; kind: string; sha256: string }[];
  };
  const emitted = manifest.coverage["permits_emitted"]?.count ?? null;

  const opened = await options.openEngine();
  const { engine } = opened;
  try {
    // A local part is read only after its bytes hash to the manifest's SHA-256 (a file changed
    // after the manifest was built must not pass the gate).
    const failures: string[] = [];
    const localOk = new Set<string>();
    if (!remoteOnly) {
      for (const a of manifest.artifacts.filter((x) => x.kind === "table")) {
        const local = resolve(root, a.name);
        if (!existsSync(local)) continue;
        const digest = await sha256File(local);
        if (digest === a.sha256) localOk.add(a.name);
        else failures.push(`local part ${a.name} hashes to ${digest}, manifest says ${a.sha256}`);
      }
    }
    const partUrl = ({ name, cid }: { name: string; cid: string }): string =>
      localOk.has(name) ? resolve(root, name) : `https://${copyHost}/${cid}`;
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
    if (pids !== null) {
      const list = pids.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
      const rows = await engine.all(`SELECT p.request_identifier AS pid
      FROM property_improvement.property p
      WHERE p.request_identifier IN (${list}) AND (p.cid IS NULL OR ${notCounty})`);
      pidUnmatched = rows.map((r) => String(r["pid"]));
    }

    if (nullCids !== 0) failures.push(`${nullCids} permit-side properties have a NULL cid`);
    if (emitted === null && expectPermits === null) {
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
    if (expectPermits !== null && permits !== expectPermits) {
      failures.push(`v_roofing_permit ${permits} != expected ${expectPermits}`);
    }
    if (pidUnmatched.length > 0)
      failures.push(`pIDs not matched: ${pidUnmatched.slice(0, 20).join(",")}`);

    return {
      manifest: options.manifestPath ?? "(manifest bytes)",
      v_roofing_permit: permits,
      meta_permit: joined,
      permits_emitted: emitted,
      permit_side_properties: piProperties,
      unmatched_properties: unmatched,
      pids_checked: pids?.length ?? 0,
      pids_unmatched: pidUnmatched.length,
      result: failures.length === 0 ? "PASS" : "FAIL",
      failures,
    };
  } finally {
    opened.close();
  }
}
