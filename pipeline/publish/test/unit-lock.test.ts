// Per-unit upload lock for two filebase workers (ERR-33 follow-up).
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tryUnitLock, unitSelected } from "../src/publish-run.js";

const lockIn = (): string =>
  join(mkdtempSync(join(tmpdir(), "unit-lock-")), "county-b01-car.json.lock");

describe("tryUnitLock", () => {
  it("takes a free lock, records the pid and releases it", () => {
    const path = lockIn();
    const release = tryUnitLock(path, 111, () => true);
    expect(release).toBeTypeOf("function");
    expect(readFileSync(path, "utf8")).toBe("111");
    release?.();
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a lock held by another live worker", () => {
    const path = lockIn();
    writeFileSync(path, "222");
    expect(tryUnitLock(path, 111, () => true)).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe("222");
  });

  it("takes over a lock whose owner is gone", () => {
    const path = lockIn();
    writeFileSync(path, "333");
    const release = tryUnitLock(path, 111, () => false);
    expect(release).toBeTypeOf("function");
    expect(readFileSync(path, "utf8")).toBe("111");
  });

  it("takes over an unreadable lock", () => {
    const path = lockIn();
    writeFileSync(path, "not-a-pid");
    expect(tryUnitLock(path, 111, () => true)).toBeTypeOf("function");
  });
});

describe("unitSelected", () => {
  it("uploads every kind when no limit is set", () => {
    expect(unitSelected("tables", undefined)).toBe(true);
    expect(unitSelected("tables", [])).toBe(true);
  });
  it("limits a worker to the listed kinds", () => {
    expect(unitSelected("car", ["car"])).toBe(true);
    expect(unitSelected("tables", ["car"])).toBe(false);
  });
});
