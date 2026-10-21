import { h } from "./dom";
import { getLocale, t } from "./i18n";
import { icon } from "./icons";
import {
  deleteConversation,
  getConversation,
  listConversations,
  saveConversation,
} from "./storage";
import { messageText, type Conversation } from "./types";
import { confirmAction, download, iconButton, toast } from "./ui";

export function exportConversation(c: Conversation) {
  const line = (label: string, value: string) =>
    "\n\n" + t("common.labelValue", { label, value });
  return (
    `# ${c.title}\n\n` +
    c.messages
      .filter((m) => m.role !== "tool" && (m.role === "user" || messageText(m)))
      .map(
        (m) =>
          `## ${t(m.role === "user" ? "history.user" : "history.assistant")}\n\n${messageText(m)}${[m.source, ...(m.refs || []).map((r) => r.source)]
            .flatMap((s) =>
              s
                ? [
                    line(
                      t("history.source"),
                      `[${s.title}](${s.url}) · ${new Date(s.capturedAt).toISOString()}`,
                    ),
                  ]
                : [],
            )
            .join("")}${m.coverage ? "\n\n" + m.coverage : ""}${m.error ? line(t("history.status"), m.error) : ""}`,
      )
      .join("\n\n")
  );
}
export const exportFile = (c: Conversation) =>
  download(
    (c.title || t("history.untitledFile")).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 60) + ".md",
    exportConversation(c),
    "text/markdown",
  );

function dayLabel(time: number) {
  const day = 86400000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const now = start.getTime();
  if (time >= now) return t("history.today");
  if (time >= now - day) return t("history.yesterday");
  if (time >= now - 6 * day) return t("history.week");
  if (time >= now - 29 * day) return t("history.month");
  return new Date(time).toLocaleDateString(getLocale(), {
    year: "numeric",
    month: "long",
  });
}
function timeLabel(time: number) {
  const d = new Date(time);
  return Date.now() - time < 86400000 * 6
    ? d.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(getLocale(), { month: "numeric", day: "numeric" });
}

export function openHistory(opts: {
  currentId: string;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
  onRenamed: (id: string, title: string) => void;
}) {
  const query = h("input", {
    class: "input drawer-search-input",
    placeholder: t("history.searchPlaceholder"),
    "aria-label": t("history.searchLabel"),
  });
  const list = h("div", { class: "history-list" });
  const more = h("button", { type: "button", class: "load-more" }, t("history.more"));
  const scrim = h("div", { class: "scrim" });
  const drawer = h(
    "aside",
    { class: "drawer", role: "dialog", "aria-label": t("history.title") },
    h(
      "header",
      { class: "drawer-head" },
      h("h2", null, t("history.title")),
      iconButton("x", t("common.close"), () => close()),
    ),
    h("label", { class: "drawer-search" }, icon("search", 15), query),
    h("div", { class: "drawer-body" }, list, more),
  );
  document.body.append(scrim, drawer);
  requestAnimationFrame(() => {
    scrim.classList.add("open");
    drawer.classList.add("open");
  });
  let generation = 0,
    offset = 0,
    lastGroup = "",
    timer: ReturnType<typeof setTimeout> | undefined;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !document.querySelector("dialog[open]")) close();
  };
  document.addEventListener("keydown", onKey);
  scrim.onclick = () => close();
  function close() {
    generation++;
    clearTimeout(timer);
    document.removeEventListener("keydown", onKey);
    scrim.classList.remove("open");
    drawer.classList.remove("open");
    setTimeout(() => {
      scrim.remove();
      drawer.remove();
    }, 220);
  }

  function row(item: { id: string; title: string; updatedAt: number }) {
    const title = h("span", { class: "history-title" }, item.title || t("history.untitled"));
    const main = h(
      "button",
      {
        type: "button",
        class: "history-main",
        onclick: () => {
          close();
          opts.onOpen(item.id);
        },
      },
      title,
      h("span", { class: "history-time" }, timeLabel(item.updatedAt)),
    );
    const element = h(
      "div",
      { class: "history-row" + (item.id === opts.currentId ? " current" : "") },
      main,
    );
    const rename = () => {
      const input = h("input", {
        class: "input history-rename",
        value: item.title,
        "aria-label": t("common.conversationName"),
      });
      let done = false;
      const finish = async (save: boolean) => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (save && name && name !== item.title) {
          const c = await getConversation(item.id);
          if (c) {
            c.title = name;
            await saveConversation(c);
            item.title = name;
            opts.onRenamed(item.id, name);
          }
        }
        title.textContent = item.title;
        input.replaceWith(main);
        actions.hidden = false;
      };
      input.onkeydown = (event) => {
        if (event.key === "Enter") void finish(true);
        else if (event.key === "Escape") {
          event.stopPropagation();
          void finish(false);
        }
      };
      input.onblur = () => void finish(true);
      main.replaceWith(input);
      actions.hidden = true;
      input.focus();
      input.select();
    };
    const actions = h(
      "div",
      { class: "history-actions" },
      iconButton("edit", t("common.rename"), rename, "icon-btn-sm"),
      iconButton(
        "download",
        t("common.exportMarkdown"),
        () =>
          void getConversation(item.id).then((c) => {
            if (c) exportFile(c);
          }),
        "icon-btn-sm",
      ),
      iconButton(
        "trash",
        t("common.delete"),
        () =>
          void (async () => {
            if (
              !(await confirmAction(
                t("common.deleteConversation"),
                t("common.deleteConfirm", { title: item.title || t("history.untitled") }),
              ))
            )
              return;
            await deleteConversation(item.id);
            element.remove();
            opts.onDeleted(item.id);
            toast(t("common.deleted"));
          })(),
        "icon-btn-sm danger",
      ),
    );
    element.append(actions);
    return element;
  }

  async function draw(append = false) {
    const request = ++generation;
    if (!append) {
      offset = 0;
      lastGroup = "";
    }
    more.disabled = true;
    const found = await listConversations(query.value.trim(), 40, offset);
    if (request !== generation) return;
    if (!append) list.replaceChildren();
    offset += found.length;
    more.hidden = found.length < 40;
    more.disabled = false;
    for (const item of found) {
      const group = dayLabel(item.updatedAt);
      if (group !== lastGroup) {
        lastGroup = group;
        list.append(h("div", { class: "history-group" }, group));
      }
      list.append(row(item));
    }
    if (!offset)
      list.append(
        h(
          "div",
          { class: "history-empty" },
          icon(query.value ? "search" : "message", 22),
          h("p", null, t(query.value ? "history.noMatch" : "history.empty")),
        ),
      );
  }
  more.onclick = () => void draw(true);
  query.oninput = () => {
    generation++;
    clearTimeout(timer);
    timer = setTimeout(() => void draw(), 180);
  };
  void draw();
  query.focus();
}
