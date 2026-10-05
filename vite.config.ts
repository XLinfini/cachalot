import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  cacheDir: process.env.CACHALOT_VITE_CACHE || "node_modules/.vite",
  // Worker and lazy-module dependencies must be ready before the first PDF is
  // opened, so dependency discovery cannot reload the reader during a task.
  optimizeDeps: { include: ["onnxruntime-web/wasm", "@embedpdf/pdfium", "fflate", "semver"] },
  worker: { format: "es" },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Playwright exports HTML in its traces; watching those files would reload
    // the application while a browser test is still using it.
    watch: { ignored: ["**/test-results/**", "**/.test-cache/**"] },
  },
});
