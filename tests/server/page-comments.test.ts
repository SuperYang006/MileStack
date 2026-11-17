import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createHttpServer } from "../../src/server/server.js";

describe("page comments static asset", () => {
  let tempDir: string;
  let serverInstance: Awaited<ReturnType<typeof createHttpServer>>;

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "milestack-page-comments-"));
    const staticDir = path.join(tempDir, "dist", "ui");
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(path.join(staticDir, "index.html"), "<h1>MileStack test UI</h1>\n");
    writeFileSync(
      path.join(staticDir, "page-comments.js"),
      "window.__milestackPageCommentsFixture = true;\n",
    );
    serverInstance = await createHttpServer({ projectRoot: tempDir, staticDir });
  });

  afterEach(async () => {
    serverInstance.context.database.close();
    await serverInstance.app.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("serves /page-comments.js as JavaScript instead of the SPA entry", async () => {
    const res = await serverInstance.app.inject({
      method: "GET",
      url: "/page-comments.js",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
    expect(res.payload).toContain("__milestackPageCommentsFixture");
  });
});
