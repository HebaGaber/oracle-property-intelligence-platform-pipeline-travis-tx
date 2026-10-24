// A-11: a run lock for scripts that wipe and rewrite a shared output (re-export, batch export).
// The lock is a file holding the owner's PID, placed OUTSIDE any hashed directory. A live owner
// makes a second instance refuse to start; a lock whose PID is gone is stale and is taken over.
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
}

function tryCreate(path: string): boolean {
  try {
    const fd = openSync(path, "wx"); // fails if it exists: atomic acquire
    writeSync(fd, `${process.pid}\n`);
    closeSync(fd);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

/** Takes the lock or throws naming the live owner. Returns a release function (idempotent). */
export function acquireRunLock(path: string): () => void {
  if (!tryCreate(path)) {
    let owner = NaN;
    try {
      owner = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    } catch {
      /* lock vanished or unreadable: treated as stale below */
    }
    if (Number.isInteger(owner) && owner > 0 && alive(owner)) {
      throw new Error(`${path} is held by running pid ${owner}; refusing to start a second run`);
    }
    rmSync(path, { force: true }); // stale: the owner is gone
    if (!tryCreate(path)) throw new Error(`${path}: lost the race for the lock; not starting`);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (Number.parseInt(readFileSync(path, "utf8").trim(), 10) === process.pid)
        rmSync(path, { force: true });
    } catch {
      /* already gone */
    }
  };
}
