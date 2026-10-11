export const helpText = `Usage: milestack [options]

Options:
  -h, --help  Show this help message
`;

export type CliOutput = {
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
};

const defaultOutput: CliOutput = {
  writeStdout: (message) => process.stdout.write(message),
  writeStderr: (message) => process.stderr.write(message),
};

export function runCli(
  args: readonly string[],
  output: CliOutput = defaultOutput,
): number {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    output.writeStdout(helpText);
    return 0;
  }

  output.writeStderr(`Unknown option: ${args[0]}\n\n${helpText}`);
  return 1;
}
