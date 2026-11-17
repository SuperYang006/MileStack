import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    // The main Vite build cleans dist/ui first; this build only adds the
    // standalone bookmark script, so it must not remove the SPA output.
    outDir: "dist/ui",
    emptyOutDir: false,
    copyPublicDir: false,
    target: "es2022",
    minify: false,
    lib: {
      entry: path.resolve(import.meta.dirname, "ui/src/page-comments/index.ts"),
      name: "MileStackPageComments",
      formats: ["iife"],
      fileName: () => "page-comments.js",
    },
  },
});
