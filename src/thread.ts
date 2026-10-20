import { h } from "./dom";
import { icon } from "./icons";
import { messageView, type MessageView, type ViewHooks } from "./render";
import { messageText, type Conversation, type Message } from "./types";

const PAGE = 60;
// Quoted passages lead the text as "> …" lines; the question after them is the better label.
export const questionPreview = (m: Message) =>
  (m.display
    ? m.display.action + (m.display.quote ? "：" + m.display.quote : "")
    : messageText(m).replace(/^(?:>.*(?:\n|$))+\s*(?=\S)/, "")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

export function createThread(opts: {
  hooks: ViewHooks;
  empty: () => HTMLElement;
  rail: boolean;
}) {
  const list = h("div", { class: "messages" });
  const emptyBox = h("div", { class: "empty-host" });
  const older = h(
    "button",
    {
      type: "button",
      class: "load-older",
      onclick: () => loadOlder(),
    },
    icon("arrowUp", 14),
    "显示更早的消息",
  );
  const inner = h("div", { class: "thread-inner" }, older, emptyBox, list);
  const scroller = h("main", { class: "thread" }, inner);
  const jump = h(
    "button",
    {
      type: "button",
      class: "jump-latest",
      title: "回到最新",
      "aria-label": "回到最新消息",
      onclick: () => toBottom(true),
    },
    icon("arrowDown", 16),
  );
  jump.hidden = true;
  const rail = h("nav", { class: "rail", "aria-label": "提问导航" });
  rail.hidden = true;
  const element = h(
    "div",
    { class: "thread-wrap" },
    scroller,
    jump,
    opts.rail ? rail : null,
  );
  const views = new Map<string, MessageView>();
  let conversation: Conversation | undefined;
  // Messages from `start` to the end are rendered. The window only grows
  // backwards, so every message between the oldest loaded one and the
  // latest stays reachable by scrolling.
  let start = 0,
    follow = true,
    jumping = false,
    railKey = "",
    railFrame = 0;

  function setConversation(c: Conversation) {
    for (const view of views.values()) view.dispose();
    views.clear();
    list.replaceChildren();
    emptyBox.replaceChildren();
    railKey = "";
    conversation = c;
    start = Math.max(0, c.messages.length - PAGE);
    follow = true;
    render();
  }
  /** Prepend an earlier page while keeping the visible content in place. */
  function loadOlder() {
    if (!start) return;
    const fromBottom = scroller.scrollHeight - scroller.scrollTop;
    start = Math.max(0, start - PAGE);
    render();
    scroller.scrollTop = scroller.scrollHeight - fromBottom;
  }
  function refreshEmpty() {
    emptyBox.replaceChildren();
    render();
  }
  function render() {
    const c = conversation;
    if (!c) return;
    start = Math.min(start, Math.max(0, c.messages.length - PAGE));
    older.hidden = start === 0;
    const visible = c.messages.slice(start).filter((m) => m.role !== "tool");
    const ids = new Set(visible.map((m) => m.id));
    for (const [id, view] of views)
      if (!ids.has(id)) {
        view.dispose();
        view.element.remove();
        views.delete(id);
      }
    emptyBox.hidden = c.messages.length > 0;
    if (!c.messages.length && !emptyBox.firstChild)
      emptyBox.append(opts.empty());
    let previous: Element | null = null;
    for (const m of visible) {
      let view = views.get(m.id);
      if (!view) {
        view = messageView(m, opts.hooks);
        views.set(m.id, view);
      } else view.update();
      const expected: Element | null = previous
        ? previous.nextElementSibling
        : list.firstElementChild;
      if (expected !== view.element) list.insertBefore(view.element, expected);
      previous = view.element;
    }
    updateRail();
    jump.hidden = follow;
    if (follow)
      requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
      });
  }
  function toBottom(smooth = false) {
    if (!conversation) return;
    follow = true;
    render();
    requestAnimationFrame(() =>
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      }),
    );
  }
  function jumpTo(id: string) {
    if (!conversation) return;
    const index = conversation.messages.findIndex((m) => m.id === id);
    if (index < 0) return;
    if (index < start) {
      // Render everything from the target onward; keep what is on screen.
      const fromBottom = scroller.scrollHeight - scroller.scrollTop;
      start = Math.max(0, index - 2);
      render();
      scroller.scrollTop = scroller.scrollHeight - fromBottom;
    }
    follow = false;
    const target = views.get(id)?.element;
    if (!target) return;
    // The smooth scroll passes the top; don't auto-load older pages meanwhile.
    jumping = true;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    target.classList.remove("flash");
    void target.offsetWidth;
    target.classList.add("flash");
  }
  function updateRail() {
    if (!opts.rail || !conversation) return;
    const users = conversation.messages.filter((m) => m.role === "user");
    rail.hidden = users.length < 2;
    const key = users.map((m) => m.id).join();
    if (key === railKey) return;
    railKey = key;
    rail.replaceChildren(
      h("div", { class: "rail-title" }, "提问导航"),
      ...users.map((m, n) =>
        h(
          "button",
          {
            type: "button",
            class: "rail-item",
            dataset: { id: m.id },
            onclick: () => jumpTo(m.id),
          },
          h("span", { class: "rail-tick" }),
          h("span", { class: "rail-label" }, `${n + 1}. ${questionPreview(m)}`),
        ),
      ),
    );
    markActive();
  }
  function markActive() {
    railFrame = 0;
    if (rail.hidden) return;
    let active = "";
    for (const article of list.querySelectorAll<HTMLElement>(".msg-user"))
      if (article.offsetTop <= scroller.scrollTop + 80)
        active = article.dataset.id || "";
    if (!active)
      active = list.querySelector<HTMLElement>(".msg-user")?.dataset.id || "";
    for (const item of rail.querySelectorAll<HTMLElement>(".rail-item")) {
      const on = item.dataset.id === active;
      item.classList.toggle("active", on);
      // Long rails scroll; keep the current question inside the visible part.
      if (on && !rail.matches(":hover")) {
        const top = item.offsetTop - rail.clientHeight / 2;
        rail.scrollTop = Math.max(0, top);
      }
    }
  }
  scroller.addEventListener(
    "scroll",
    () => {
      if (!conversation) return;
      follow =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
      jump.hidden = follow;
      if (!jumping && start && scroller.scrollTop < 240) loadOlder();
      if (!railFrame) railFrame = requestAnimationFrame(markActive);
    },
    { passive: true },
  );
  scroller.addEventListener("scrollend", () => (jumping = false));
  return {
    element,
    inner,
    setConversation,
    render,
    refreshEmpty,
    toBottom,
    jumpTo,
  };
}
export type Thread = ReturnType<typeof createThread>;
