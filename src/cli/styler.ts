export function shouldEnableColor(): boolean {
  if (process.env.NO_COLOR && process.env.NO_COLOR !== "") {
    return false;
  }
  return true;
}

export function createStyler(enableColor: boolean) {
  const wrap = (code: string) => (text: string) => (enableColor ? `\x1b[${code}m${text}\x1b[0m` : text);
  return {
    bold: wrap("1"),
    cyan: wrap("36"),
    green: wrap("32"),
    yellow: wrap("33"),
    red: wrap("31"),
    dim: wrap("90"),
    boldGreen: wrap("1;32"),
    boldYellow: wrap("1;33"),
    boldCyan: wrap("1;36"),
    boldRed: wrap("1;31"),
  };
}
