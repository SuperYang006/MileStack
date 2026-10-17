export type CliOutput = {
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
};

export const defaultOutput: CliOutput = {
  writeStdout: (message) => process.stdout.write(message),
  writeStderr: (message) => process.stderr.write(message),
};
