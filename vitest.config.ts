import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  // Mirrors the tsup build define so tests observe the same version value the
  // bundled CLI reports at runtime.
  define: {
    __MILESTACK_VERSION__: JSON.stringify(version),
  },
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
  },
});