export type PortRange = { first: number; last: number };

// The default `milestack serve` range: 7331 first, then up to 19 successors.
export const defaultServePortRange: PortRange = { first: 7331, last: 7350 };

const loopbackHost = "127.0.0.1";
const probeTimeoutMs = 500;

export class PortRangeExhaustedError extends Error {
  constructor(readonly range: PortRange) {
    super(
      `${range.first}–${range.last} 端口均已被占用，无法自动选择；请用 --port 指定一个可用端口。`,
    );
    this.name = "PortRangeExhaustedError";
  }
}

export class ServeAlreadyRunningError extends Error {
  constructor(readonly url: string) {
    super(`本项目的 serve 已在 ${url} 运行。`);
    this.name = "ServeAlreadyRunningError";
  }
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
}

// The project id of the MileStack service listening on the port, or null for
// anything else: no answer within the timeout, a non-MileStack response, or a
// connection failure. Only the loopback address is ever contacted.
async function probeProjectId(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://${loopbackHost}:${port}/api/project`, {
      signal: AbortSignal.timeout(probeTimeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "id" in body && typeof body.id === "string") {
      return body.id;
    }
    return null;
  } catch {
    return null;
  }
}

// Tries the ports in order and stops at the first one that listens. An
// occupied port is first checked for this project's own serve; any other
// occupant just moves on to the next port. Errors other than "address in use"
// are not retried.
export async function listenInRange(
  range: PortRange,
  projectId: string,
  listen: (port: number) => Promise<unknown>,
): Promise<{ port: number; skippedPorts: number[] }> {
  const skippedPorts: number[] = [];
  for (let port = range.first; port <= range.last; port += 1) {
    try {
      await listen(port);
      return { port, skippedPorts };
    } catch (error) {
      if (!isAddressInUse(error)) {
        throw error;
      }
    }
    if ((await probeProjectId(port)) === projectId) {
      throw new ServeAlreadyRunningError(`http://${loopbackHost}:${port}`);
    }
    skippedPorts.push(port);
  }
  throw new PortRangeExhaustedError(range);
}
