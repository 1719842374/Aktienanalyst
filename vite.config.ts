import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Suppress chunk size warnings — recharts/d3 are large but tree-shaken at runtime
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        // Circular dependency warnings from recharts, d3, react-dom internals
        // are false-positives and do not affect runtime correctness.
        // Vite 7 started surfacing these as build errors — suppress them.
        if (warning.code === 'CIRCULAR_DEPENDENCY') return;
        // Suppress "Use of eval" from certain chart libs
        if (warning.code === 'EVAL') return;
        defaultHandler(warning);
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
