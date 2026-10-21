// Manifest and tables-root helpers for the published-data cases (TC-003…005, TC-040…044).
// The `elephant-cli export-tables` output is a tables directory whose `tables.car` holds one
// dag-json "CountyTables" root block: the part size, the group's archive CAR root
// (`county_root`) and every table's parts with their CIDs and sizes. Reading that root from
// the published CAR lets the hosted tests check the manifest against the CLI output itself.
import { CarReader } from "@ipld/car";
import * as dagJson from "@ipld/dag-json";
import { CidV1, type ManifestArtifact, type RunManifestV1 } from "@countylens/contract";
import { z } from "zod";

/** `--part-size 48m` (PO decision D-4): 48 MiB = 50,331,648 bytes (TC-005). */
export const PART_SIZE_48M = 48 * 1024 * 1024;

/** A dag-json link, `{"/": "<cid>"}`, unwrapped to the CID string. */
const Link = z.object({ "/": CidV1 }).transform((link) => link["/"]);

const Count = z.number().int().nonnegative();

export const TablePart = z.object({ cid: Link, bytes: Count, rows: Count }).loose();
export const TableEntry = z.object({ rows: Count, parts: z.array(TablePart) }).loose();

export const TablesRoot = z
  .object({
    label: z.literal("CountyTables"),
    codec: z.string().min(1),
    part_size_bytes: z.number().int().positive(),
    county_root: Link,
    tables: z.record(z.string().min(1), TableEntry),
  })
  .loose();
export type TablesRoot = z.infer<typeof TablesRoot>;

export interface ReadTablesRoot {
  rootCid: string;
  root: TablesRoot;
  blockCount: number;
}

/** Reads the CountyTables root of a `tables.car` (its only root; every link unwrapped). */
export async function readTablesRoot(carBytes: Uint8Array): Promise<ReadTablesRoot> {
  const car = await CarReader.fromBytes(carBytes);
  const roots = await car.getRoots();
  const rootCid = roots[0];
  if (!rootCid || roots.length !== 1) {
    throw new Error(`tables.car must have exactly one root, found ${roots.length}`);
  }
  const block = await car.get(rootCid);
  if (!block) throw new Error(`tables.car does not contain its root block ${rootCid.toString()}`);
  let blockCount = 0;
  for await (const _block of car.blocks()) blockCount += 1;
  // dag-json → plain JSON (links become {"/": cid}) → Zod, so the test never handles CID objects.
  const plain: unknown = JSON.parse(
    new TextDecoder().decode(dagJson.encode(dagJson.decode(block.bytes))),
  );
  return { rootCid: rootCid.toString(), root: TablesRoot.parse(plain), blockCount };
}

/** The CID whose bytes are public for an artifact: tables by `cid`, directories and CARs by `carCid` (AM-05). */
export function publicCid(artifact: ManifestArtifact): string {
  if (artifact.kind === "table") return artifact.cid;
  if (!artifact.carCid) {
    throw new Error(`${artifact.kind} artifact ${artifact.name} has no carCid (AM-05)`);
  }
  return artifact.carCid;
}

export function artifactsOf(
  manifest: RunManifestV1,
  kind: ManifestArtifact["kind"],
): ManifestArtifact[] {
  return manifest.artifacts.filter((artifact) => artifact.kind === kind);
}

/** The data group an artifact belongs to, from its name (`tables/<group>[/…]`, `car/travis-<group>.car`). */
export function groupOf(artifact: ManifestArtifact): string {
  const tables = /^tables\/([a-z_]+)(?:\/|$)/.exec(artifact.name);
  if (tables?.[1]) return tables[1];
  const car = /^car\/travis-([a-z_]+)\.car$/.exec(artifact.name);
  if (car?.[1]) return car[1];
  throw new Error(`artifact name does not name a data group: ${artifact.name}`);
}

/** Every `ipfs/<cid>` key the CID copy may hold for one run: its artifacts and the manifest itself. */
export function expectedCidCopyKeys(manifest: RunManifestV1, manifestCid: string): Set<string> {
  const keys = new Set<string>([`ipfs/${manifestCid}`]);
  for (const artifact of manifest.artifacts) keys.add(`ipfs/${publicCid(artifact)}`);
  return keys;
}

/** Content types by artifact kind (contracts/storage.md "Object headers"). */
export const CONTENT_TYPES: Record<ManifestArtifact["kind"] | "manifest", string> = {
  table: "application/vnd.apache.parquet",
  car: "application/vnd.ipld.car",
  directory: "application/vnd.ipld.car",
  manifest: "application/json",
};

/** CIDv0 (`Qm…`) must never appear anywhere in a published manifest (constitution A3). */
export const CID_V0_PATTERN = /\bQm[1-9A-HJ-NP-Za-km-z]{44}\b/;
