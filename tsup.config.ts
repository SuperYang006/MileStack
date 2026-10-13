import { defineConfig } from "tsup";
import { cpSync } from "node:fs";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  // The published tarball ships this bundle without a source map so the
  // package never embeds a copy of the bundled TypeScript sources.
  sourcemap: false,
  dts: false,
  onSuccess: async () => {
    cpSync("src/db/migrations", "dist/migrations", { recursive: true });
  },
});
