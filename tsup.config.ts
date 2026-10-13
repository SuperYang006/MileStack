import { defineConfig } from "tsup";
import { cpSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

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
  define: {
    __MILESTACK_VERSION__: JSON.stringify(version),
  },
  onSuccess: async () => {
    cpSync("src/db/migrations", "dist/migrations", { recursive: true });
  },
});