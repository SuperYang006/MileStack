import { describe, expect, it } from "vitest";

import { isSemverVersion } from "../../ui/src/runtime-version.js";

describe("runtime version identity", () => {
  it("accepts SemVer 2.0.0 versions including prerelease and build metadata", () => {
    for (const version of [
      "0.1.0",
      "0.0.0",
      "10.20.30",
      "1.2.3-beta",
      "1.2.3-beta.1",
      "1.2.3-rc.1+build.7",
      "1.2.3+20130313144700",
      "1.0.0-alpha.1+exp.sha.5114f85",
    ]) {
      expect(isSemverVersion(version), version).toBe(true);
    }
  });

  it("rejects values that are not valid SemVer 2.0.0 versions", () => {
    for (const version of [
      "",
      " ",
      "1.2",
      "1.2.3.4",
      "01.2.3",
      "1.02.3",
      "1.2.03",
      "1.2.3-",
      "1.2.3+",
      "1.2.3-01",
      "v1.2.3",
      "1.2.3-beta..1",
      "unknown",
      null,
      undefined,
      3,
      "1.2.3 ",
    ]) {
      expect(isSemverVersion(version), String(version)).toBe(false);
    }
  });
});