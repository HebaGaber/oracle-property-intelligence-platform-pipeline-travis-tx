// A-11 Run 3.1 one-off (PO 2026-10-26): rebuild every published file of the run from the public CID
// copy (CloudFront serves S3 key ipfs/<cid> at https://<host>/<cid>) at the path the manifest names,
// and check each file's size and sha256 against the manifest. Exits 1 when any file is missing or
// differs, so nothing unverified is uploaded. Table folders get their tables.car from the
// directory artifact's carCid; CARs are read by their carCid.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const m = JSON.parse(readFileSync(process.env.MANIFEST, "utf8"));
const host = process.env.CID_COPY_HOST;
if (!host) throw new Error("CID_COPY_HOST repository variable is not set");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const items = m.artifacts.map((a) => ({
  path: a.kind === "directory" ? join(a.name, "tables.car") : a.name,
  key: a.kind === "table" ? a.cid : a.carCid,
  size: a.size,
  sha256: a.sha256,
}));
let ok = 0;
let bad = 0;
for (const it of items) {
  if (existsSync(it.path) && sha(it.path) === it.sha256) {
    ok++;
    continue;
  }
  mkdirSync(dirname(it.path), { recursive: true });
  const part = `${it.path}.part`;
  const r = spawnSync("curl", ["-fsS", "--retry", "5", "-o", part, `https://${host}/${it.key}`], { stdio: "pipe" });
  if (r.status !== 0 || !existsSync(part)) {
    console.log(`MISSING ${it.path} (${it.key}): ${String(r.stderr).trim()}`);
    bad++;
    continue;
  }
  if (sha(part) !== it.sha256) {
    console.log(`SHA MISMATCH ${it.path}`);
    rmSync(part);
    bad++;
    continue;
  }
  renameSync(part, it.path);
  ok++;
}
console.log(`verified ${ok}/${items.length}, failed ${bad}`);
process.exit(bad === 0 ? 0 : 1);
