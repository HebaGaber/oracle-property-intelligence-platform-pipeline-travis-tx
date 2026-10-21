// Vite build of the hosted UI (A-03 T007). Env: VITE_CID_COPY_HOST and VITE_FILEBASE_GATEWAY_HOST
// come from the Amplify app environment (infra web-stack, T043); nothing is read here.
// DuckDB-WASM (T054) is a dynamic import so it stays outside the 300 KB gzipped JS budget (T021).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
  },
});
