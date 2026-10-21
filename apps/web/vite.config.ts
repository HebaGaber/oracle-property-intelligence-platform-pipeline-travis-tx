// Vite build of the hosted UI (A-03 T007; A-13 T015). Env: VITE_CID_COPY_HOST,
// VITE_FILEBASE_GATEWAY_HOST and VITE_PINATA_GATEWAY_HOST come from the Amplify app environment
// (infra web-stack); nothing is read here. DuckDB-WASM is a dynamic import (only `?mode=sql`)
// so it stays outside the 300 KB gzipped JS budget; its chunk file name keeps "duckdb" (the
// adapter module is engine/duckdb-wasm.ts) so scripts/bundle-size.ts can exclude it.
// `build.manifest` writes dist/.vite/manifest.json, which scripts/bundle-size.ts reads to
// measure the Hub's initial graph (key `src/routes/Hub.tsx`).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    manifest: true,
  },
});
