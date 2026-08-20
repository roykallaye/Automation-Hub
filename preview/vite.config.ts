import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/*
  Build config for the visual preview harness.

  Emits to preview-dist/ with relative asset URLs so the pages can be opened
  straight from file:// by a headless browser — no dev server, no port to
  bind. It never touches the app's own build.
*/
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../preview-dist", import.meta.url)),
    emptyOutDir: true,
  },
});
