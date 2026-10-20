import { h } from "./dom";
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
  return (
    `# ${c.title}\n\n` +
    c.messages
      .filter((m) => m.role !== "tool" && (m.role === "user" || messageText(m)))
      .map(
        (m) =>
          `## ${m.role === "user" ? "用户" : "助手"}\n\n${messageText(m)}${[m.source, ...(m.refs || []).map((r) => r.source)]
            .flatMap((s) =>
              s ? [`\n\n来源：[${s.title}](${s.url}) · ${new Date(s.capturedAt).toISOString()}`] : [],
            )
            .join("")}${m.coverage ? "\n\n" + m.coverage : ""}${m.error ? "\n\n状态：" + m.error : ""}`,
      )
      .join("\n\n")
  );
}
export const exportFile = (c: Conversation) =>
  download(
    (c.title || "对话").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 60) + ".md",
    exportConversation(c),
    "text/markdown",
  );

function dayLabel(time: number) {
  const day = 86400000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t = start.getTime();
  if (time >= t) return "今天";
  if (time >= t - day) return "昨天";
  if (time >= t - 6 * day) return "过去 7 天";
  if (time >= t - 29 * day) return "过去 30 天";
  return new Date(time).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
  });
}
function timeLabel(time: number) {
  const d = new Date(time);
  return Date.now() - time < 86400000 * 6
    ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function openHistory(opts: {
  currentId: string;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
  onRenamed: (id: string, title: string) => void;
}) {
  const query = h("input", {
    class: "input drawer-search-input",
    placeholder: "搜索标题或内容",
    "aria-label": "搜索会话",
  });
  const list = h("div", { class: "history-list" });
  const more = h("button", { type: "button", class: "load-more" }, "加载更多");
  const scrim = h("div", { class: "scrim" });
  const drawer = h(
    "aside",
    { class: "drawer", role: "dialog", "aria-label": "历史会话" },
    h(
      "header",
      { class: "drawer-head" },
      h("h2", null, "历史会话"),
      iconButton("x", "关闭", () => close()),
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
    const title = h("span", { class: "history-title" }, item.title || "未命名对话");
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
        "aria-label": "会话名称",
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
      iconButton("edit", "重命名", rename, "icon-btn-sm"),
      iconButton(
        "download",
        "导出 Markdown",
        () =>
          void getConversation(item.id).then((c) => {
            if (c) exportFile(c);
          }),
        "icon-btn-sm",
      ),
      iconButton(
        "trash",
        "删除",
        () =>
          void (async () => {
            if (
              !(await confirmAction(
                "删除会话",
                `删除「${item.title || "未命名对话"}」？此操作不可撤销。`,
              ))
            )
              return;
            await deleteConversation(item.id);
            element.remove();
            opts.onDeleted(item.id);
            toast("已删除");
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
          h("p", null, query.value ? "没有匹配的会话" : "还没有会话记录"),
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
