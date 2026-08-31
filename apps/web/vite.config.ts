import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const applicationVersion = String(JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version);

export default defineConfig({
  base: "./",
  define: {
    __FLUXIO_VERSION__: JSON.stringify(applicationVersion),
  },
  plugins: [react()],
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4310",
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4310",
    },
  },
});
