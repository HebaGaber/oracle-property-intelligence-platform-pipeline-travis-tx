// A13-2 (A-16 T051): the SQL panel bound every contract view of the run before the first query
// (bindAllViews: every table part of the full county, about 97 s). It now binds only the views a
// query names, the first time a query names them, and remembers what it bound: a second query on
// the same views binds nothing, a query on a new view rebinds the union (bindManifest replaces the
// run schemas whole, so the union keeps the earlier views). Parts are prefetched only for the bound
// views and only once. Pure: the bind and the part reads are fakes.
import { describe, expect, it, vi } from "vitest";
import { createViewBinder, type ViewBinderDeps } from "../src/routes/ExploreSql.engine";

const part = (name: string) => ({ name, cid: `cid-${name}`, size: 10, sha256: "0".repeat(64) });

function deps(overrides: Partial<ViewBinderDeps> = {}) {
  const bind = vi.fn<ViewBinderDeps["bind"]>().mockResolvedValue(undefined);
  const fetchAndRegister = vi.fn<ViewBinderDeps["fetchAndRegister"]>().mockResolvedValue(undefined);
  const base: ViewBinderDeps = {
    partsFor: (views) => views.map((v) => `${v}.parquet`),
    prefetchable: (names) => [...names].map(part),
    fetchAndRegister,
    bind,
    remoteUrl: (a) => `https://copy/ipfs/${a.cid}`,
    registeredUrl: (a) => `registered-${a.cid}`,
    onBind: () => undefined,
    ...overrides,
  };
  return { base, bind, fetchAndRegister };
}

describe("createViewBinder (A13-2: bind only the named views, memoised)", () => {
  it("binds only the view the query names", async () => {
    const { base, bind } = deps();
    const binder = createViewBinder(base);
    await binder("SELECT count(*) FROM v_property");
    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind.mock.calls[0]?.[0]).toEqual(["v_property"]);
    expect(binder.bound()).toEqual(["v_property"]);
  });

  it("does not bind again for a query on views already bound", async () => {
    const { base, bind } = deps();
    const binder = createViewBinder(base);
    await binder("SELECT count(*) FROM v_property");
    await binder("SELECT * FROM v_property LIMIT 3");
    expect(bind).toHaveBeenCalledTimes(1);
  });

  it("rebinds the union when a new view is named, fetching only the new parts", async () => {
    const { base, bind, fetchAndRegister } = deps();
    const binder = createViewBinder(base);
    await binder("SELECT count(*) FROM v_property");
    await binder("SELECT * FROM v_roofing_permit JOIN v_property USING (property_cid)");
    expect(bind).toHaveBeenCalledTimes(2);
    expect(bind.mock.calls[1]?.[0]).toEqual(["v_property", "v_roofing_permit"]);
    expect(fetchAndRegister.mock.calls[0]?.[0].map((p) => p.name)).toEqual(["v_property.parquet"]);
    expect(fetchAndRegister.mock.calls[1]?.[0].map((p) => p.name)).toEqual([
      "v_roofing_permit.parquet",
    ]);
  });

  it("binds nothing for a query that names no contract view", async () => {
    const { base, bind } = deps();
    const binder = createViewBinder(base);
    await binder("SELECT 1");
    expect(bind).not.toHaveBeenCalled();
  });

  it("reads registered parts locally and the rest over the host when the subset is too large", async () => {
    const { base, bind } = deps({ prefetchable: () => null });
    const binder = createViewBinder(base);
    await binder("SELECT count(*) FROM v_property");
    const partUrl = bind.mock.calls[0]?.[1];
    expect(partUrl?.({ name: "v_property.parquet", cid: "c1" })).toBe("https://copy/ipfs/c1");
  });

  it("uses the registered file for a prefetched part", async () => {
    const { base, bind } = deps();
    const binder = createViewBinder(base);
    await binder("SELECT count(*) FROM v_property");
    const partUrl = bind.mock.calls[0]?.[1];
    expect(partUrl?.({ name: "v_property.parquet", cid: "cid-v_property.parquet" })).toBe(
      "registered-cid-v_property.parquet",
    );
  });

  it("reports the bind stage only when it binds", async () => {
    const onBind = vi.fn();
    const { base } = deps({ onBind });
    const binder = createViewBinder(base);
    await binder("SELECT count(*) FROM v_property");
    await binder("SELECT count(*) FROM v_property");
    expect(onBind).toHaveBeenCalledTimes(1);
    expect(onBind).toHaveBeenCalledWith(["v_property"]);
  });

  it("serialises concurrent first queries into one bind", async () => {
    const { base, bind } = deps();
    const binder = createViewBinder(base);
    await Promise.all([binder("SELECT 1 FROM v_run"), binder("SELECT 2 FROM v_run")]);
    expect(bind).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed bind so the next query tries again", async () => {
    const bind = vi
      .fn<ViewBinderDeps["bind"]>()
      .mockRejectedValueOnce(new Error("part read failed"))
      .mockResolvedValue(undefined);
    const { base } = deps({ bind });
    const binder = createViewBinder(base);
    await expect(binder("SELECT * FROM v_run")).rejects.toThrow("part read failed");
    expect(binder.bound()).toEqual([]);
    await binder("SELECT * FROM v_run");
    expect(bind).toHaveBeenCalledTimes(2);
    expect(binder.bound()).toEqual(["v_run"]);
  });
});
