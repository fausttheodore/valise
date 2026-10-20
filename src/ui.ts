import { clamp, h, type Child } from "./dom";
import { icon, type IconName } from "./icons";

export function iconButton(
  name: IconName,
  label: string,
  onclick: (event: MouseEvent) => void,
  className = "",
) {
  return h(
    "button",
    {
      type: "button",
      class: "icon-btn " + className,
      title: label,
      "aria-label": label,
      onclick,
    },
    icon(name, 17),
  );
}
export function button(
  label: Child,
  onclick: (event: MouseEvent) => void,
  className = "",
  iconName?: IconName,
) {
  return h(
    "button",
    { type: "button", class: "btn " + className, onclick },
    iconName ? icon(iconName, 15) : null,
    label,
  );
}
export function spinner() {
  return h("span", { class: "spinner", "aria-hidden": "true" });
}
export function download(
  name: string,
  text: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  h("a", { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastHost: HTMLElement | undefined;
export function toast(text: string, kind: "info" | "success" | "error" = "info") {
  if (!toastHost?.isConnected)
    toastHost = document.body.appendChild(
      h("div", { class: "toasts", "aria-live": "polite" }),
    );
  const el = h(
    "div",
    { class: "toast toast-" + kind },
    kind === "error"
      ? icon("alert", 15)
      : kind === "success"
        ? icon("check", 15)
        : null,
    h("span", null, text),
  );
  toastHost.append(el);
  setTimeout(
    () => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 220);
    },
    kind === "error" ? 4200 : 1800,
  );
}
export async function copyText(text: string, feedback?: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    if (feedback) {
      feedback.classList.add("copied");
      setTimeout(() => feedback.classList.remove("copied"), 1200);
    }
    toast("已复制", "success");
  } catch {
    toast("复制失败：浏览器拒绝了剪贴板访问", "error");
  }
}

export function showDialog(
  title: string,
  body: Child,
  opts: { footer?: Child[]; wide?: boolean; className?: string } = {},
) {
  const dialog = h("dialog", {
    class:
      "dialog" + (opts.wide ? " dialog-wide" : "") + " " + (opts.className || ""),
  });
  const close = () => dialog.close();
  dialog.append(
    h(
      "div",
      { class: "dialog-card" },
      h(
        "header",
        { class: "dialog-head" },
        h("h2", null, title),
        iconButton("x", "关闭", close),
      ),
      h("div", { class: "dialog-body" }, body),
      opts.footer?.length
        ? h("footer", { class: "dialog-foot" }, opts.footer)
        : null,
    ),
  );
  // The card fills the dialog, so a click whose target is the dialog itself hit the backdrop.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  return dialog;
}

// Native prompt/confirm are suppressed in some browser side panels.
export function askText(
  title: string,
  label: string,
  value: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = h("input", {
      class: "input",
      value,
      required: true,
      "aria-label": label,
    });
    let result: string | undefined;
    const form = h(
      "form",
      { class: "stack" },
      h("label", { class: "field" }, h("span", { class: "field-label" }, label), input),
      h(
        "div",
        { class: "row-end" },
        button("取消", () => dialog.close(), "btn-ghost"),
        h("button", { type: "submit", class: "btn btn-primary" }, "保存"),
      ),
    );
    const dialog = showDialog(title, form, { className: "dialog-small" });
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      result = input.value.trim();
      dialog.close();
    };
    dialog.addEventListener("close", () => resolve(result), { once: true });
    input.focus();
    input.select();
  });
}
export function confirmAction(
  title: string,
  description: string,
  confirmLabel = "删除",
): Promise<boolean> {
  return new Promise((resolve) => {
    let accepted = false;
    const dialog: HTMLDialogElement = showDialog(
      title,
      h(
        "div",
        { class: "stack" },
        h("p", { class: "dialog-text" }, description),
        h(
          "div",
          { class: "row-end" },
          button("取消", () => dialog.close(), "btn-ghost"),
          button(
            confirmLabel,
            () => {
              accepted = true;
              dialog.close();
            },
            "btn-danger",
          ),
        ),
      ),
      { className: "dialog-small" },
    );
    dialog.addEventListener("close", () => resolve(accepted), { once: true });
  });
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}
/** A Node entry is shown as-is, for read-only panels such as token usage. */
export type MenuEntry = MenuItem | "separator" | { heading: string } | Node;
let current: { anchor: HTMLElement; close: () => void } | undefined;
/** Anchored menu; clicking the same anchor again toggles it closed. */
export function openMenu(
  anchor: HTMLElement,
  entries: MenuEntry[],
  opts: { align?: "start" | "end"; placement?: "top" | "bottom" } = {},
) {
  if (current?.anchor === anchor) {
    current.close();
    return;
  }
  current?.close();
  const menu = h("div", { class: "menu", role: "menu" });
  for (const entry of entries) {
    if (entry === "separator") menu.append(h("div", { class: "menu-sep" }));
    else if (entry instanceof Node) menu.append(entry);
    else if ("heading" in entry)
      menu.append(h("div", { class: "menu-heading" }, entry.heading));
    else
      menu.append(
        h(
          "button",
          {
            type: "button",
            role: "menuitem",
            class:
              "menu-item" +
              (entry.danger ? " danger" : "") +
              (entry.checked ? " checked" : ""),
            disabled: entry.disabled,
            onclick: () => {
              close();
              entry.action();
            },
          },
          entry.icon ? icon(entry.icon, 16) : h("span", { class: "menu-pad" }),
          h(
            "span",
            { class: "menu-text" },
            h("span", { class: "menu-label" }, entry.label),
            entry.hint ? h("span", { class: "menu-hint" }, entry.hint) : null,
          ),
          entry.checked ? icon("check", 15) : null,
        ),
      );
  }
  document.body.append(menu);
  const a = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const below = a.bottom + 6;
  const above = a.top - m.height - 6;
  const top =
    opts.placement === "top" ||
    (opts.placement !== "bottom" && below + m.height > innerHeight - 8 && above > 8)
      ? above
      : below;
  const left = opts.align === "end" ? a.right - m.width : a.left;
  menu.style.top = clamp(top, 8, innerHeight - m.height - 8) + "px";
  menu.style.left = clamp(left, 8, innerWidth - m.width - 8) + "px";
  anchor.classList.add("is-open");
  anchor.setAttribute("aria-expanded", "true");
  const items = () =>
    [...menu.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)")];
  const onDown = (event: PointerEvent) => {
    const target = event.target as Node;
    if (!menu.contains(target) && !anchor.contains(target)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      anchor.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const list = items();
      const index = list.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "ArrowDown"
          ? (index + 1) % list.length
          : (index - 1 + list.length) % list.length;
      list[next]?.focus();
    }
  };
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  addEventListener("blur", close);
  addEventListener("resize", close);
  function close() {
    menu.remove();
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("blur", close);
    removeEventListener("resize", close);
    anchor.classList.remove("is-open");
    anchor.removeAttribute("aria-expanded");
    if (current?.close === close) current = undefined;
  }
  current = { anchor, close };
  (menu.querySelector(".menu-item.checked") as HTMLElement | null)?.focus({
    preventScroll: true,
  });
}
