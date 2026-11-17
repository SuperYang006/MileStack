export const DEFAULT_PAGE_COMMENTS_PORTS: readonly number[] = Array.from(
  { length: 20 },
  (_, index) => 7331 + index,
);

export const PAGE_COMMENTS_LOAD_TIMEOUT_MS = 2000;

function candidateOrigins(
  origin: string,
  ports: readonly number[],
): string[] {
  const candidates: string[] = [origin];
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return [...new Set(candidates)];
  }
  for (const port of ports) {
    const candidate = new URL(parsed.origin);
    candidate.port = String(port);
    candidates.push(candidate.origin);
  }
  return [...new Set(candidates)];
}

/**
 * Compact loader used by both the bookmark and the console fallback. It loads
 * `/page-comments.js` with a normal script tag: classic scripts are not
 * subject to CORS, so it never calls fetch/XHR on the MileStack API. The
 * service origin that generated the link is tried first, then every default
 * port so the bookmark keeps working after `serve` falls back to another one.
 */
export function createPageCommentsLoaderSnippet(
  origin: string,
  ports: readonly number[] = DEFAULT_PAGE_COMMENTS_PORTS,
  timeoutMs: number = PAGE_COMMENTS_LOAD_TIMEOUT_MS,
): string {
  const origins = JSON.stringify(candidateOrigins(origin, ports));
  return `(()=>{const o=${origins},w=${timeoutMs};if(window.__msPageCommentsLoading)return;window.__msPageCommentsLoading=!0;let i=0;const end=()=>{window.__msPageCommentsLoading=!1};const next=()=>{if(i>=o.length){end();alert("未找到运行中的 MileStack 服务，请先运行 milestack serve");return}const s=document.createElement("script");s.src=o[i++]+"/page-comments.js";let done=!1;const fail=()=>{if(done)return;done=!0;clearTimeout(timer);s.remove();next()};const timer=setTimeout(fail,w);s.onerror=fail;s.onload=()=>{if(done)return;done=!0;clearTimeout(timer);s.remove();if(window.__msPageComments){end()}else{next()}};document.documentElement.appendChild(s)};next()})()`;
}

export function createPageCommentsBookmarklet(origin: string): string {
  return `javascript:${createPageCommentsLoaderSnippet(origin)}`;
}

export function createPageCommentsConsoleSnippet(origin: string): string {
  return createPageCommentsLoaderSnippet(origin);
}
