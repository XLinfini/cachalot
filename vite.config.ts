import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
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
