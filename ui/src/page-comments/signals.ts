import type { CommentTarget, ElementSignals } from "./model.js";

const STABLE_ID = /^[A-Za-z][\w-]*$/;
// Library style classes are noisy and change between builds, so they are not
// useful for re-locating a commented element.
const LIBRARY_CLASS = /^(ant-|css-|anticon|rc-|Mui|chakra-)/;

type ReactFiber = {
  type?: unknown;
  return?: ReactFiber | null;
};

type NamedFunction = {
  displayName?: string;
  name?: string;
  render?: NamedFunction;
  type?: NamedFunction;
};

export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function currentRoute(): string {
  return `${location.pathname}${location.search}`;
}

export function viewportLabel(): string {
  return `${window.innerWidth}×${window.innerHeight}`;
}

export function cssPath(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && node !== document.documentElement) {
    const current: Element = node;
    if (current.id && STABLE_ID.test(current.id)) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    let part = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (child) => child.tagName === current.tagName,
      );
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
      }
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}

function classListOf(element: Element): string[] {
  return cleanText(element.getAttribute("class")).split(" ").filter(Boolean);
}

export function readableClasses(element: Element): string[] {
  return classListOf(element)
    .filter((name) => !LIBRARY_CLASS.test(name))
    .slice(0, 4);
}

export function areaClasses(element: Element): string[] {
  const found: string[] = [];
  let node = element.parentElement;
  while (node && node !== document.body && found.length < 3) {
    for (const name of classListOf(node)) {
      if (/module__/.test(name) && !found.includes(name)) found.push(name);
    }
    node = node.parentElement;
  }
  return found.slice(0, 3);
}

function componentName(type: unknown): string | null {
  if (typeof type === "function") {
    const named = type as NamedFunction;
    return named.displayName || named.name || null;
  }
  if (type && typeof type === "object") {
    const named = type as NamedFunction;
    return (
      named.displayName ||
      named.render?.displayName ||
      named.render?.name ||
      named.type?.displayName ||
      named.type?.name ||
      null
    );
  }
  return null;
}

export function reactComponents(element: Element): string[] {
  const record = element as unknown as Record<string, unknown>;
  const key = Object.keys(record).find((candidate) => candidate.startsWith("__reactFiber$"));
  if (!key) return [];
  const names: string[] = [];
  let fiber = record[key] as ReactFiber | undefined;
  while (fiber && names.length < 6) {
    const name = componentName(fiber.type);
    if (name && /^[A-Z]/.test(name) && !names.includes(name)) names.push(name);
    fiber = fiber.return ?? undefined;
  }
  return names;
}

export function elementText(element: Element): string {
  const inner = element instanceof HTMLElement ? element.innerText : element.textContent;
  const value =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : "";
  const text =
    cleanText(inner) ||
    cleanText(value) ||
    cleanText(element.getAttribute("placeholder")) ||
    cleanText(element.getAttribute("aria-label")) ||
    cleanText(element.getAttribute("title"));
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function describeElement(element: Element): string {
  const text = elementText(element);
  return `<${element.tagName.toLowerCase()}>` + (text ? ` “${text.slice(0, 30)}”` : "");
}

export function formItemLabel(element: Element): string {
  const formItem = element.closest(".ant-form-item, [class*='form-item'], label");
  if (!formItem) return "";
  const label = formItem.tagName === "LABEL" ? formItem : formItem.querySelector("label");
  return cleanText(label?.textContent);
}

export function sectionTitle(element: Element): string {
  const container = element.closest(".ant-card, .ant-modal-content, section, [role='dialog']");
  if (!container) return "";
  const title = container.querySelector(".ant-card-head-title, .ant-modal-title, h1, h2, h3, h4");
  return cleanText(title?.textContent).slice(0, 40);
}

export function collectSignals(element: Element): ElementSignals {
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id && STABLE_ID.test(element.id) ? element.id : "",
    testId: element.closest("[data-testid]")?.getAttribute("data-testid") ?? "",
    text: elementText(element),
    classes: readableClasses(element),
    areaClasses: areaClasses(element),
    components: reactComponents(element),
    selector: cssPath(element),
  };
}

export function collectTarget(element: Element): CommentTarget {
  const rect = element.getBoundingClientRect();
  return {
    ...collectSignals(element),
    description: describeElement(element),
    anchor: {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: Math.max(rect.width, 0),
      height: Math.max(rect.height, 0),
    },
  };
}

export function findElement(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function addSameTagDescendants(pool: Set<Element>, container: Element, tag: string): void {
  for (const child of container.querySelectorAll(tag)) pool.add(child);
}

/**
 * Narrow candidate set for re-location. It only widens to every element with
 * the same tag when no id, test id, class, or previous selector exists.
 */
export function collectCandidates(target: ElementSignals): Element[] {
  const pool = new Set<Element>();

  if (target.id) {
    const byId = findElement(`#${CSS.escape(target.id)}`);
    if (byId) pool.add(byId);
  }

  if (target.testId) {
    for (const container of document.querySelectorAll("[data-testid]")) {
      if (container.getAttribute("data-testid") !== target.testId) continue;
      pool.add(container);
      if (target.tag) addSameTagDescendants(pool, container, target.tag);
    }
  }

  for (const name of target.classes) {
    for (const element of document.getElementsByClassName(name)) pool.add(element);
  }
  for (const name of target.areaClasses) {
    for (const element of document.getElementsByClassName(name)) pool.add(element);
  }

  const bySelector = findElement(target.selector);
  if (bySelector) pool.add(bySelector);

  if (pool.size === 0 && target.tag) {
    for (const element of document.querySelectorAll(target.tag)) pool.add(element);
  }

  return [...pool];
}
