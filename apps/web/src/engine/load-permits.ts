// The Permits load (A-03 T054/T056): run index → latest run → manifest by CID (the read decides
// the host: CID copy or the labelled Filebase fallback, D-2) → engine → bind the parts with the
// same read's `partUrl` (no mixed hosts in one load) → the single page of rows. The engine
// module is imported dynamically, so DuckDB-WASM, apache-arrow and query-core stay in their own
// chunk until this runs. Every count comes from the manifest (FR-009). Dependencies are
// injectable for the unit tests; the defaults are the real modules.
import type { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { readPathUrls, type ReadPathUrls } from "@countylens/shared";
import {
  fallbackLabel as defaultFallbackLabel,
  type FetchByCidOptions,
  type ReadSource,
} from "../data/fetch-by-cid";
import { loadManifest as defaultLoadManifest, type LoadedManifest } from "../data/manifest";
import {
  latestRun as defaultLatestRun,
  loadRunsIndex as defaultLoadRunsIndex,
  type RunsIndexEntry,
} from "../data/runs-index";
import type { bindRun, listPermits, openEngine } from "./duckdb-wasm";
import type { PermitListRow } from "./permit-list";
import { STAGE_TEXTS } from "./stages";

/** What the page renders from: manifest facts plus the listed rows. */
export interface PermitsLoaded {
  readonly runId: string;
  readonly manifestCid: string;
  /** `coverage.permits_emitted.count` from the manifest. */
  readonly permitsEmitted: number;
  readonly rows: readonly PermitListRow[];
  /** `fallback · {host}` when the Filebase gateway served the manifest and parts; null for the copy. */
  readonly fallbackLabel: string | null;
}

export type PermitsLoader = (
  report: (stage: string) => void,
  signal: AbortSignal,
) => Promise<PermitsLoaded>;

/** The engine chunk's surface (`import("./duckdb-wasm")`). */
export interface EngineModule {
  readonly openEngine: typeof openEngine;
  readonly bindRun: typeof bindRun;
  readonly listPermits: typeof listPermits;
}

export interface PermitsLoaderDeps {
  readonly loadRunsIndex: (options: { readonly signal: AbortSignal }) => Promise<RunsIndexV1>;
  readonly latestRun: (index: RunsIndexV1) => RunsIndexEntry;
  readonly loadManifest: (cid: string, options: FetchByCidOptions) => Promise<LoadedManifest>;
  readonly fallbackLabel: (source: ReadSource) => string | null;
  readonly urls: ReadPathUrls;
  readonly engine: () => Promise<EngineModule>;
}

function envHost(key: "VITE_CID_COPY_HOST" | "VITE_FILEBASE_GATEWAY_HOST"): string {
  const value: unknown =
    key === "VITE_CID_COPY_HOST"
      ? import.meta.env.VITE_CID_COPY_HOST
      : import.meta.env.VITE_FILEBASE_GATEWAY_HOST;
  if (typeof value !== "string" || value === "") {
    throw new Error(`${key} is not set: the web build reads the public hosts from its environment`);
  }
  return value;
}

/** The read-path URLs from the build environment (plan § "Fixed texts and config keys"). */
export function readPathUrlsFromEnv(): ReadPathUrls {
  return readPathUrls({
    cidCopyHost: envHost("VITE_CID_COPY_HOST"),
    filebaseGatewayHost: envHost("VITE_FILEBASE_GATEWAY_HOST"),
  });
}

function permitsEmitted(manifest: RunManifestV1): number {
  const count = manifest.coverage["permits_emitted"];
  if (count === undefined) {
    throw new Error(
      "Manifest has no coverage.permits_emitted; every count comes from the manifest (FR-009)",
    );
  }
  return count.count;
}

export function createPermitsLoader(overrides: Partial<PermitsLoaderDeps> = {}): PermitsLoader {
  return async (report, signal) => {
    const deps: PermitsLoaderDeps = {
      loadRunsIndex: overrides.loadRunsIndex ?? defaultLoadRunsIndex,
      latestRun: overrides.latestRun ?? defaultLatestRun,
      loadManifest: overrides.loadManifest ?? defaultLoadManifest,
      fallbackLabel: overrides.fallbackLabel ?? defaultFallbackLabel,
      urls: overrides.urls ?? readPathUrlsFromEnv(),
      engine: overrides.engine ?? (() => import("./duckdb-wasm")),
    };
    report(STAGE_TEXTS.engine);
    const engineModule = await deps.engine();
    const engine = await engineModule.openEngine();
    try {
      signal.throwIfAborted();
      report(STAGE_TEXTS.manifest);
      const index = await deps.loadRunsIndex({ signal });
      const entry = deps.latestRun(index);
      const loaded = await deps.loadManifest(entry.manifestCid, { urls: deps.urls, signal });
      signal.throwIfAborted();
      report(STAGE_TEXTS.bind);
      await engineModule.bindRun(engine, loaded.read.bytes, loaded.read.partUrl);
      signal.throwIfAborted();
      report(STAGE_TEXTS.query);
      const rows = await engineModule.listPermits(engine);
      return {
        runId: loaded.manifest.runId,
        manifestCid: loaded.manifestCid,
        permitsEmitted: permitsEmitted(loaded.manifest),
        rows,
        fallbackLabel: deps.fallbackLabel(loaded.read.source),
      };
    } finally {
      // A-03 lists once; the worker is released so the page holds no idle engine.
      await engine.close().catch(() => undefined);
    }
  };
}
