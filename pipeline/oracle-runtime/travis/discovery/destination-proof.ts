// T044: destination proof for the catalog's `destination` block (FR-001c, research R9,
// validator rule 4).
//
// Two identities from two independent sources, never from the connection string:
// - Docker side: `docker compose ps` names the Postgres container of the local stack and
//   `docker inspect` gives its container ID, image name and image digest (Docker metadata).
// - SQL side: psql runs *inside that container* (local socket, no host, port, URL or
//   password) and the database itself reports `pg_control_system()` system identifier,
//   `current_database()` and its server version.
// Only these names and digests are recorded. Every value is checked against a strict
// shape, so arbitrary command output (for example a connection URL) is never copied.
// Any failure gives `proven: false` with a reason: the validator then blocks the
// destination gate, which is the fail-closed outcome.
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { execRunner, type CommandRunner } from "../lib/command.js";
import type { DestinationSchema } from "./catalog.schema.js";

export type Destination = z.infer<typeof DestinationSchema>;

export const DEFAULT_COMPOSE_FILE = fileURLToPath(
  new URL("../../../local-stack/docker-compose.yml", import.meta.url),
);

export interface DestinationProofOptions {
  /** Docker-side runner (`docker compose ps`, `docker inspect`). */
  docker?: CommandRunner;
  /** SQL-side runner (`docker exec <container> psql ...`). */
  sql?: CommandRunner;
  /** Absolute compose file of the local stack; used as an argument, never recorded. */
  composeFile?: string;
  service?: string;
  database?: string;
  dbUser?: string;
  now?: () => Date;
}

const CONTAINER_ID = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE_NAME = /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?$/;
const SYSTEM_ID = /^\d{1,20}$/;
const DB_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const VERSION = /^\d+(?:\.\d+){0,2}$/;

const SQL =
  "SELECT system_identifier, current_database(), current_setting('server_version') FROM pg_control_system()";

class ProofError extends Error {}

function utcSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function call(
  runner: CommandRunner,
  side: string,
  file: string,
  args: readonly string[],
): Promise<string> {
  let result;
  try {
    result = await runner(file, args);
  } catch {
    throw new ProofError(`${side}: ${file} could not be started`);
  }
  if (result.exit_code !== 0) {
    throw new ProofError(`${side}: ${file} ${args[0] ?? ""} exited ${result.exit_code}`);
  }
  return result.stdout.trim();
}

async function dockerSide(
  docker: CommandRunner,
  composeFile: string,
  service: string,
): Promise<{ id: string; identity: string }> {
  const side = "docker-side";
  const ps = await call(docker, side, "docker", [
    "compose",
    "-f",
    composeFile,
    "ps",
    "-q",
    service,
  ]);
  const ids = ps.split("\n").filter((l) => l.trim().length > 0);
  if (ids.length !== 1 || !CONTAINER_ID.test(ids[0] ?? "")) {
    throw new ProofError(`${side}: compose service ${service} has no single running container`);
  }
  const id = ids[0] as string;
  const inspect = await call(docker, side, "docker", [
    "inspect",
    "--format",
    "{{.Id}} {{.Image}} {{.Config.Image}} {{.State.Status}}",
    id,
  ]);
  const [inspectedId, digest, image, state] = inspect.split(/\s+/);
  if (inspectedId !== id) throw new ProofError(`${side}: inspected container differs from compose`);
  if (!digest || !IMAGE_DIGEST.test(digest)) throw new ProofError(`${side}: no image digest`);
  if (!image || !IMAGE_NAME.test(image)) throw new ProofError(`${side}: unexpected image name`);
  if (state !== "running") throw new ProofError(`${side}: container is not running`);
  return {
    id,
    identity: `docker-side: container ${id.slice(0, 12)} of compose service ${service} runs image ${image} (image digest ${digest})`,
  };
}

async function sqlSide(
  sql: CommandRunner,
  containerId: string,
  database: string,
  user: string,
): Promise<string> {
  const side = "sql-side";
  const out = await call(sql, side, "docker", [
    "exec",
    containerId,
    "psql",
    "-U",
    user,
    "-d",
    database,
    "-X",
    "-A",
    "-t",
    "-F",
    "|",
    "-c",
    SQL,
  ]);
  const [systemId, db, versionText] = out.split("|");
  const version = (versionText ?? "").trim().split(/\s+/)[0] ?? "";
  if (!systemId || !SYSTEM_ID.test(systemId)) throw new ProofError(`${side}: no system identifier`);
  if (!db || !DB_NAME.test(db)) throw new ProofError(`${side}: unexpected database name`);
  if (db !== database) throw new ProofError(`${side}: connected database differs from expected`);
  if (!VERSION.test(version)) throw new ProofError(`${side}: unexpected server version`);
  return `sql-side: pg_control_system system_identifier ${systemId}, database ${db}, server version ${version}`;
}

/** Proves the internal destination; never throws, never records a URL or password. */
export async function proveDestination(
  options: DestinationProofOptions = {},
): Promise<Destination> {
  const docker = options.docker ?? execRunner;
  const sql = options.sql ?? execRunner;
  const service = options.service ?? "postgres";
  const database = options.database ?? "elephant";
  const user = options.dbUser ?? "postgres";
  const capturedAt = utcSeconds((options.now ?? (() => new Date()))());
  try {
    const a = await dockerSide(docker, options.composeFile ?? DEFAULT_COMPOSE_FILE, service);
    const b = await sqlSide(sql, a.id, database, user);
    return {
      writes_in_scope: true,
      proven: true,
      independent_identity_sources: [a.identity, b],
      captured_at: capturedAt,
    };
  } catch (error) {
    const reason =
      error instanceof ProofError ? error.message : "destination proof failed unexpectedly";
    return {
      writes_in_scope: true,
      proven: false,
      missing_reason: `destination not proven: ${reason}`,
      captured_at: capturedAt,
    };
  }
}
