import { defineConfig } from "vite";
// Demo is a separate artifact. A URL, browser flag or stored role cannot enable it.
export default defineConfig(({ mode }) => ({
  define: { __QUBITE_DEMO__: JSON.stringify(mode === "demo") },
  build: { sourcemap: false },
}));
