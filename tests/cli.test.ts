import { describe, expect, it } from "vitest";

import { helpText, runCli } from "../src/cli/command.js";

describe("CLI entry point", () => {
  it("prints help and exits successfully", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runCli(["--help"], {
      writeStdout: (message) => stdout.push(message),
      writeStderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("")).toBe(helpText);
    expect(stderr).toHaveLength(0);
  });
});
