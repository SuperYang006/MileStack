declare const __MILESTACK_VERSION__: string | undefined;

// Source-based execution (for example `tsx src/cli/index.ts`) has no build
// step, so the version stays unknown instead of reporting a stale number.
export const runtimeVersion: string =
  typeof __MILESTACK_VERSION__ === "string" ? __MILESTACK_VERSION__ : "unknown";