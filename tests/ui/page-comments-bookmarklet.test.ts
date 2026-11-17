import { describe, expect, it } from "vitest";
import {
  createPageCommentsBookmarklet,
  createPageCommentsConsoleSnippet,
  DEFAULT_PAGE_COMMENTS_PORTS,
} from "../../ui/src/utils/pageCommentsBookmarklet.js";

const origin = "http://127.0.0.1:7342";

describe("page comments bookmarklet", () => {
  it("is a short javascript: loader rather than an embedded script", () => {
    const bookmarklet = createPageCommentsBookmarklet(origin);

    expect(bookmarklet.startsWith("javascript:")).toBe(true);
    expect(bookmarklet).not.toContain("\n");
    expect(bookmarklet.length).toBeLessThan(2500);
    expect(bookmarklet).toContain("/page-comments.js");
  });

  it("loads the script with a classic script tag instead of fetch or XHR", () => {
    const bookmarklet = createPageCommentsBookmarklet(origin);

    expect(bookmarklet).toContain('document.createElement("script")');
    expect(bookmarklet).not.toContain("fetch(");
    expect(bookmarklet).not.toContain("XMLHttpRequest");
  });

  it("tries the generating service origin first and then the default port range", () => {
    const bookmarklet = createPageCommentsBookmarklet(origin);

    expect(bookmarklet).toContain(origin);
    expect(bookmarklet).toContain(`http://127.0.0.1:${DEFAULT_PAGE_COMMENTS_PORTS[0]}`);
    expect(bookmarklet).toContain(`http://127.0.0.1:${DEFAULT_PAGE_COMMENTS_PORTS.at(-1)}`);
    expect(bookmarklet.indexOf(origin)).toBeLessThan(
      bookmarklet.indexOf(`http://127.0.0.1:${DEFAULT_PAGE_COMMENTS_PORTS[0]}`),
    );
    expect(bookmarklet.match(/http:\/\/127\.0\.0\.1:7342/g)).toHaveLength(1);
  });

  it("keeps an explicit --port origin outside the default range", () => {
    const bookmarklet = createPageCommentsBookmarklet("http://127.0.0.1:8080");

    expect(bookmarklet).toContain("http://127.0.0.1:8080");
    expect(bookmarklet.indexOf("http://127.0.0.1:8080")).toBeLessThan(
      bookmarklet.indexOf("http://127.0.0.1:7331"),
    );
  });

  it("preserves the hostname used to open the dashboard", () => {
    const bookmarklet = createPageCommentsBookmarklet("http://localhost:7331");

    expect(bookmarklet).toContain("http://localhost:7331");
    expect(bookmarklet).not.toContain("127.0.0.1");
  });

  it("shows a clear error when every port is unavailable", () => {
    const bookmarklet = createPageCommentsBookmarklet(origin);

    expect(bookmarklet).toContain(
      "未找到运行中的 MileStack 服务，请先运行 milestack serve",
    );
    expect(bookmarklet).toContain("alert(");
  });

  it("uses the same loader for the console fallback without the javascript: prefix", () => {
    const bookmarklet = createPageCommentsBookmarklet(origin);
    const snippet = createPageCommentsConsoleSnippet(origin);

    expect(bookmarklet).toBe(`javascript:${snippet}`);
    expect(snippet.startsWith("javascript:")).toBe(false);
    expect(snippet).toContain("/page-comments.js");
  });
});
