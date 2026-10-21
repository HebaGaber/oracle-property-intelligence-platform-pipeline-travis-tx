// Engine failures of the browser read path (A-03 T054). Kept apart from duckdb-wasm.ts so the
// route can recognise them without importing the engine chunk statically (the chunk is
// lazy-loaded; plan § Constitution Check, the 300 KB gate).
import { PERMITS_TEXTS } from "@countylens/shared";

/** DuckDB-WASM could not be loaded, instantiated or opened: the page shows the fixed text. */
export class EngineStartError extends Error {
  override readonly name = "EngineStartError";

  constructor(cause: unknown) {
    super(PERMITS_TEXTS.engineFailure, { cause });
  }
}
