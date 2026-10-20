export type Child = Node | string | number | false | null | undefined | Child[];
export type Props = Record<string, unknown>;

// Attributes whose DOM property is read-only or named differently.
const ATTRIBUTES = new Set(["list", "form", "for", "role", "inputmode"]);

/** Minimal hyperscript: h("button", { class: "x", onclick }, "label"). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props)
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") el.className = String(value);
      else if (key === "style") el.style.cssText = String(value);
      else if (key === "dataset")
        Object.assign(el.dataset, value as Record<string, string>);
      else if (key.startsWith("on") && typeof value === "function")
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      else if (!ATTRIBUTES.has(key) && !key.includes("-") && key in el)
        (el as unknown as Record<string, unknown>)[key] = value;
      else el.setAttribute(key, value === true ? "" : String(value));
    }
  append(el, children);
  return el;
}
export function append(parent: Node, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else
      parent.appendChild(
        typeof child === "object" ? child : document.createTextNode(String(child)),
      );
  }
}
export const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), Math.max(min, max));
export const compactNumber = (n: number) =>
  n >= 10000 ? (n / 1000).toFixed(0) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
