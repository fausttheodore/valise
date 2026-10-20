import "./style.css";
import {
  attachmentFromFile,
  attachmentFromUrl,
  captureTab,
  MAX_ATTACHMENTS,
} from "./attachments";
import {
  activeTab,
  AppError,
  faviconUrl,
  hostOf,
  isPdfUrl,
  openOptions,
  readPage,
  send,
} from "./browser";
import { createComposer } from "./composer";
import {
  capabilities,
  loadSettings,
  normalizeSettings,
  searchMeta,
  searchReady,
} from "./config";
import { estimateTokens, inferTask, messageTokens } from "./context";
import { append, compactNumber, h } from "./dom";
import { actionIcon, quoteText } from "./render";
import { exportFile, openHistory } from "./history";
import { icon, type IconName } from "./icons";
import { RequestScope } from "./request";
import { runTurn } from "./runner";
import {
  deleteConversation,
  getConversation,
  getSnapshot,
  saveConversation,
} from "./storage";
import { applyAppearance } from "./theme";
import { createThread } from "./thread";
import {
  messageAttachments,
  messageText,
  uid,
  type Attachment,
  type ContextMode,
  type Conversation,
  type FloatSession,
  type MessageDisplay,
  type PageIdentity,
  type PageSnapshot,
  type RequestEvent,
  type SearchMode,
  type Settings,
  type Stage,
  type TabRef,
  type TaskMode,
} from "./types";
import {
  askText,
  button,
  confirmAction,
  iconButton,
  openMenu,
  showDialog,
  spinner,
  toast,
  type MenuEntry,
} from "./ui";

const floating = location.pathname.endsWith("floating.html");
const sessionId = new URLSearchParams(location.search).get("session");
document.documentElement.dataset.mode = floating ? "float" : "panel";

let settings: Settings;
let conversation: Conversation;
let page: PageSnapshot | undefined;
let tab: { id?: number; title: string; url: string } | undefined;
let windowId: number | undefined;
let bound: FloatSession | undefined;
let panelVisible = false;
let attachments: Attachment[] = [];
let mentions: TabRef[] = [];
let quotes: string[] = [];
let fix: { code?: string; data?: string } | undefined;
let active:
  | {
      id: string;
      conversationId: string;
      scope: RequestScope;
      done: Promise<void>;
    }
  | undefined;

// ---------------------------------------------------------------- layout
const app = document.querySelector<HTMLDivElement>("#app")!;
const titleText = h("span", { class: "title-text" }, "新对话");
const header = floating
  ? h(
      "header",
      { class: "topbar float-bar" },
      h("span", { class: "float-badge" }),
      h("span", { class: "grow" }),
      iconButton("sidebar", "在侧栏继续", () => void transfer()),
      iconButton("x", "关闭 (Esc)", () => void closeFloat()),
    )
  : h(
      "header",
      { class: "topbar" },
      h(
        "button",
        {
          type: "button",
          class: "title-btn",
          title: "历史会话",
          onclick: () => showHistory(),
        },
        icon("history", 16),
        titleText,
        icon("chevronDown", 14),
      ),
      iconButton("newChat", "新对话", () => void newChat()),
      iconButton("more", "更多", (event) =>
        moreMenu(event.currentTarget as HTMLElement),
      ),
    );
const thread = createThread({
  rail: !floating,
  empty: emptyView,
  hooks: {
    canRegenerate: (m) =>
      !active &&
      !floating &&
      m.id === lastAssistant()?.id &&
      !["preparing", "searching", "connecting", "streaming"].includes(
        m.status || "",
      ),
    onRegenerate: () => void regenerate(),
    onSource: (source, snapshotId) => void showSource(source, snapshotId),
  },
});
const fileInput = h("input", {
  type: "file",
  multiple: true,
  hidden: true,
  accept:
    "image/*,application/pdf,text/*,.md,.json,.csv,.tsv,.yaml,.yml,.xml,.tex,.bib,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.go,.rs,.sh,.sql,.toml,.log",
});
fileInput.onchange = () => {
  void addFiles([...(fileInput.files || [])]);
  fileInput.value = "";
};
const composer = createComposer({
  floating,
  onSubmit: () => void submit(),
  onStop: () => active?.scope.abort(),
  onFiles: (files) => void addFiles(files),
  listTabs: floating ? undefined : listTabs,
  onMention: (t) => setMentions([...mentions, t]),
  onAttachMenu: floating ? undefined : attachMenu,
  onContextMenu: contextMenu,
  onSearchMenu: searchMenu,
  onModelMenu: modelMenu,
  onUsageMenu: usageMenu,
  onPreview: () => void preview(),
  onRefresh: () => void refreshPage(),
});
app.append(header, thread.element, composer.element, fileInput);

// ---------------------------------------------------------------- helpers
const BUSY: Stage[] = ["preparing", "searching", "connecting", "streaming"];
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const currentProfile = () =>
  settings.profiles.find(
    (p) => p.id === (conversation.profileId || settings.activeProfileId),
  ) || settings.profiles[0];
const lastAssistant = () =>
  conversation?.messages.findLast((m) => m.role === "assistant");
const persistIfStarted = () => {
  if (conversation.messages.length) void saveConversation(conversation);
};
function fresh(): Conversation {
  return {
    id: uid(),
    title: "新对话",
    messages: [],
    updatedAt: Date.now(),
    profileId: settings.activeProfileId || undefined,
    contextMode: floating ? "selection-page" : "page",
    searchMode: "off",
  };
}
function updateTitle() {
  titleText.textContent = conversation.messages.length
    ? conversation.title
    : "新对话";
}
function renderModel() {
  const p = currentProfile();
  composer.setModel(
    p ? p.name : "未配置模型",
    p ? `${p.name} · ${p.model}` : "点击添加模型配置",
  );
  renderUsage();
}
/**
 * Context occupancy: the last call's reported input + output is what the conversation
 * weighs now; before any provider report, fall back to the local estimate.
 */
function contextUsage() {
  const p = currentProfile();
  if (!p) return undefined;
  const reported = lastAssistant()?.usage;
  const used = reported
    ? reported.input + reported.output
    : estimateTokens(conversation.systemPrompt ?? settings.systemPrompt) +
      conversation.messages.reduce((n, m) => n + messageTokens(m), 0);
  return { used, limit: p.contextTokens, reported: !!reported };
}
function renderUsage() {
  const u = contextUsage();
  composer.setUsage(
    u && {
      ratio: u.used / u.limit,
      title: `上下文 ${u.reported ? "" : "≈"}${compactNumber(u.used)} / ${compactNumber(u.limit)} token（点击查看用量）`,
    },
  );
}
function usageMenu(anchor: HTMLElement) {
  const u = contextUsage();
  if (!u) return;
  const total = { input: 0, output: 0, cached: 0, reasoning: 0 };
  let calls = 0;
  for (const m of conversation.messages)
    if (m.usage) {
      calls++;
      total.input += m.usage.input;
      total.output += m.usage.output;
      total.cached += m.usage.cached || 0;
      total.reasoning += m.usage.reasoning || 0;
    }
  const percent = Math.min(100, Math.round((u.used / u.limit) * 100));
  const row = (label: string, value: string) =>
    h("div", { class: "usage-row" }, h("span", null, label), h("strong", null, value));
  openMenu(
    anchor,
    [
      h(
        "div",
        { class: "usage-panel" },
        h(
          "div",
          { class: "usage-head" },
          h("span", null, "上下文"),
          h(
            "strong",
            null,
            `${u.reported ? "" : "≈"}${u.used.toLocaleString()} / ${u.limit.toLocaleString()}`,
          ),
        ),
        h(
          "div",
          { class: "usage-bar" + (percent >= 90 ? " is-full" : percent >= 70 ? " is-high" : "") },
          h("span", { style: `width:${percent}%` }),
        ),
        h(
          "p",
          { class: "usage-note" },
          u.reported
            ? "按最近一次请求的实际输入与输出计算；下次提问还会加上新读取的网页和搜索结果。上限为模型配置中的上下文预算。"
            : "服务商尚未返回用量，这里按字符数估算。上限为模型配置中的上下文预算。",
        ),
        h("div", { class: "usage-title" }, "本会话累计"),
        calls
          ? [
              row("输入", total.input.toLocaleString()),
              total.cached ? row("其中缓存命中", total.cached.toLocaleString()) : null,
              row("输出", total.output.toLocaleString()),
              total.reasoning ? row("其中思考", total.reasoning.toLocaleString()) : null,
              row("模型调用", `${calls} 次`),
            ]
          : h("p", { class: "usage-note" }, "还没有服务商返回的用量记录。"),
      ),
    ],
    { placement: "top", align: "end" },
  );
}
function renderContext() {
  const mode = conversation.contextMode;
  if (floating)
    composer.setContext({
      mode,
      url: bound?.url,
      title: bound?.title,
      tokens: page ? estimateTokens(page.content) : undefined,
    });
  else {
    const read = page && tab && page.url === tab.url ? page : undefined;
    composer.setContext({
      mode,
      url: tab?.url,
      title: tab?.title,
      tokens: read ? estimateTokens(read.content) : undefined,
    });
  }
}
function setStatus(
  text: string,
  kind: "busy" | "error" | "info" = "info",
  action?: { label: string; run: () => void },
) {
  composer.setStatus(text, kind, action);
}
function setConversation(c: Conversation) {
  for (const m of c.messages)
    if (BUSY.includes(m.status as Stage)) {
      m.status = "interrupted";
      m.error = "上次请求已中断，可以继续提问或重新生成。";
    }
  conversation = c;
  page = undefined;
  // Quotes point into the previous conversation's answers.
  setQuotes([]);
  thread.setConversation(c);
  composer.setSearch(c.searchMode);
  renderContext();
  renderModel();
  updateTitle();
  setStatus("");
}

// ---------------------------------------------------------------- empty state
function greeting() {
  const hour = new Date().getHours();
  return hour < 5
    ? "夜深了"
    : hour < 11
      ? "早上好"
      : hour < 13
        ? "中午好"
        : hour < 18
          ? "下午好"
          : "晚上好";
}
function suggestion(name: IconName, title: string, hint: string, run: () => void) {
  return h(
    "button",
    { type: "button", class: "suggestion", onclick: run },
    h("span", { class: "suggestion-icon" }, icon(name, 16)),
    h(
      "span",
      { class: "suggestion-text" },
      h("span", { class: "suggestion-title" }, title),
      h("span", { class: "suggestion-hint" }, hint),
    ),
  );
}
function emptyView(): HTMLElement {
  if (floating) return h("div");
  const wrap = h("div", { class: "empty" });
  wrap.append(
    h("div", { class: "brand-mark" }, icon("sparkles", 22)),
    h("h2", { class: "empty-title" }, `${greeting()}，今天读点什么？`),
  );
  if (!settings.profiles.length) {
    wrap.append(
      h("p", { class: "empty-sub" }, "先添加一个模型配置，就可以开始阅读、提问和划词了。"),
      button("添加模型配置", openOptions, "btn-primary", "plus"),
    );
    return wrap;
  }
  const readable = tab && /^https?:/.test(tab.url);
  wrap.append(
    h(
      "p",
      { class: "empty-sub" },
      readable
        ? "我会读取当前标签页的正文来回答，也可以直接闲聊。"
        : "当前标签页不是普通网页，可以直接聊天。",
    ),
  );
  if (readable && tab) {
    wrap.append(
      h(
        "div",
        { class: "page-card" },
        h("img", { class: "favicon", src: faviconUrl(tab.url), alt: "" }),
        h(
          "div",
          { class: "page-card-text" },
          h("span", { class: "page-card-title" }, tab.title || hostOf(tab.url)),
          h("span", { class: "page-card-host" }, hostOf(tab.url)),
        ),
      ),
      h(
        "div",
        { class: "suggestions" },
        isPdfUrl(tab.url)
          ? suggestion("file", "阅读这个 PDF", "作为附件发送给模型", () =>
              void attachPdf(tab!.url),
            )
          : [
              suggestion("sparkles", "总结全文", "逐段覆盖整页，不只看片段", () =>
                quick("summarize"),
              ),
              suggestion("languages", "翻译全文", "按段落翻译成中文", () =>
                quick("translate"),
              ),
              suggestion("bulb", "梳理关键概念", "提炼观点、术语与结构", () =>
                quick("question"),
              ),
            ],
      ),
    );
  }
  return wrap;
}
function quick(task: TaskMode) {
  if (conversation.contextMode === "none") setContextMode("page");
  const presets: Record<TaskMode, [string, MessageDisplay]> = {
    summarize: ["请总结当前页面全文。", { action: "总结全文", icon: "sparkles" }],
    translate: [
      "请将当前页面全文翻译成中文。",
      { action: "翻译全文", icon: "languages" },
    ],
    question: [
      "梳理这一页的核心观点、关键概念与术语，并说明它们之间的关系。",
      { action: "梳理关键概念", icon: "bulb" },
    ],
  };
  const [text, display] = presets[task];
  void submit({ text, task, display });
}

// ---------------------------------------------------------------- menus
function contextMenu(anchor: HTMLElement) {
  const modes: [ContextMode, string, string, IconName][] = floating
    ? [
        ["selection-page", "选区 + 正文", "结合整页理解选中的文字", "layers"],
        ["selection", "仅选区", "只发送选中的文字", "cursor"],
      ]
    : [
        ["none", "不读取网页", "普通聊天", "message"],
        ["page", "当前页正文", "读取标签页中已加载的正文", "page"],
        ["selection", "仅选区", "只发送页面上选中的文字", "cursor"],
        ["selection-page", "选区 + 正文", "选中的文字，附带全文作参考", "layers"],
      ];
  const entries: MenuEntry[] = [
    { heading: "网页上下文" },
    ...modes.map(([value, label, hint, name]) => ({
      label,
      hint,
      icon: name,
      checked: conversation.contextMode === value,
      action: () => setContextMode(value),
    })),
    "separator",
    {
      label: "预览提取内容",
      icon: "eye",
      disabled: conversation.contextMode === "none",
      action: () => void preview(),
    },
  ];
  openMenu(anchor, entries, { placement: "top" });
}
function searchMenu(anchor: HTMLElement) {
  const p = currentProfile();
  const caps = p ? capabilities(p) : undefined;
  const ready = searchReady(settings.search);
  const service = searchMeta(settings.search.provider).name;
  const autoHint = !caps
    ? "需要先配置模型"
    : caps.nativeSearch
      ? p!.provider === "gemini"
        ? "由 Gemini 自行决定是否用 Google 搜索"
        : "使用模型自带的联网搜索"
      : caps.tools
        ? ready
          ? `模型按需调用 ${service} 搜索`
          : "模型可调用搜索工具（需先配置搜索服务）"
        : "当前模型没有自带联网，也未启用工具调用";
  const modes: [SearchMode, string, string, IconName][] = [
    ["off", "关闭", "只用网页内容和模型自身知识", "x"],
    ["auto", "按需搜索", autoHint, "sparkles"],
    [
      "required",
      "先搜索再回答",
      ready ? `每次提问先用 ${service} 搜索` : "需在设置中配置搜索服务",
      "search",
    ],
  ];
  openMenu(
    anchor,
    [
      { heading: "联网搜索" },
      ...modes.map(([value, label, hint, name]) => ({
        label,
        hint,
        icon: name,
        checked: conversation.searchMode === value,
        action: () => {
          conversation.searchMode = value;
          composer.setSearch(value);
          persistIfStarted();
        },
      })),
    ],
    { placement: "top" },
  );
}
function modelMenu(anchor: HTMLElement) {
  const current = currentProfile();
  const entries: MenuEntry[] = settings.profiles.length
    ? [
        { heading: "模型配置" },
        ...settings.profiles.map((p) => ({
          label: p.name,
          hint: p.model + " · " + hostOf(p.baseUrl),
          icon: (p.provider === "gemini" ? "sparkles" : "cpu") as IconName,
          checked: p.id === current?.id,
          action: () => {
            conversation.profileId = p.id;
            renderModel();
            persistIfStarted();
          },
        })),
        "separator",
      ]
    : [];
  entries.push({ label: "管理模型配置…", icon: "settings", action: openOptions });
  openMenu(anchor, entries, { placement: "top", align: "end" });
}
function attachMenu(anchor: HTMLElement) {
  const entries: MenuEntry[] = [
    {
      label: "上传图片或文件",
      hint: "图片、PDF、文本与代码；也可粘贴或拖入",
      icon: "paperclip",
      action: () => fileInput.click(),
    },
    {
      label: "截取当前页面",
      hint: "标签页的可见区域",
      icon: "scan",
      action: () => void screenshot(),
    },
    {
      label: "引用其他标签页",
      hint: "一起读取多个网页；也可直接输入 @",
      icon: "at",
      action: () => composer.startMention(),
    },
  ];
  if (tab && isPdfUrl(tab.url))
    entries.push({
      label: "附加当前 PDF",
      hint: tab.title || hostOf(tab.url),
      icon: "file",
      action: () => void attachPdf(tab!.url),
    });
  openMenu(anchor, entries, { placement: "top" });
}
function moreMenu(anchor: HTMLElement) {
  const started = conversation.messages.length > 0;
  openMenu(
    anchor,
    [
      {
        label: "重命名",
        icon: "edit",
        disabled: !started,
        action: () => void rename(),
      },
      {
        label: "会话提示词",
        hint: conversation.systemPrompt ? "已覆盖全局提示词" : "使用全局提示词",
        icon: "pen",
        action: sessionPrompt,
      },
      { label: "生效配置", icon: "info", action: effectiveConfig },
      {
        label: "导出 Markdown",
        icon: "download",
        disabled: !started,
        action: () => exportFile(conversation),
      },
      "separator",
      {
        label: "删除会话",
        icon: "trash",
        danger: true,
        disabled: !started,
        action: () => void removeCurrent(),
      },
      "separator",
      { label: "设置", icon: "settings", action: openOptions },
    ],
    { align: "end" },
  );
}
function setContextMode(mode: ContextMode) {
  conversation.contextMode = mode;
  if (mode === "none") page = undefined;
  renderContext();
  persistIfStarted();
}

// ---------------------------------------------------------------- attachments
function setAttachments(next: Attachment[]) {
  attachments = next;
  composer.setAttachments(attachments, (id) =>
    setAttachments(attachments.filter((a) => a.id !== id)),
  );
}
function setMentions(next: TabRef[]) {
  mentions = next;
  composer.setMentions(mentions, (id) =>
    setMentions(mentions.filter((t) => t.tabId !== id)),
  );
}
function setQuotes(next: string[]) {
  quotes = next;
  composer.setQuotes(quotes, (index) =>
    setQuotes(quotes.filter((_, i) => i !== index)),
  );
}
/** Open web tabs for the @ picker: this window first, most recently used first. */
async function listTabs() {
  const taken = new Set(mentions.map((t) => t.tabId));
  return (await chrome.tabs.query({}))
    .filter((t) => t.id !== undefined && /^https?:/.test(t.url || "") && !taken.has(t.id))
    .sort(
      (a, b) =>
        Number(b.windowId === windowId) - Number(a.windowId === windowId) ||
        b.lastAccessed - a.lastAccessed,
    )
    .map((t) => ({
      tabId: t.id!,
      title: t.title || "",
      url: t.url || "",
      hint:
        t.id === tab?.id
          ? conversation.contextMode === "none"
            ? "当前标签页"
            : "当前标签页 · 已按「网页」设置读取"
          : t.discarded
            ? hostOf(t.url || "") + " · 已休眠，引用前请先打开"
            : undefined,
    }));
}
/** "引用" button over a selection inside an answer; adds the passage to the composer. */
function setupQuoting() {
  const quote = h("button", { type: "button", class: "quote-btn" }, icon("quote", 13), "引用");
  quote.hidden = true;
  document.body.append(quote);
  let range: Range | undefined;
  const hide = () => {
    quote.hidden = true;
    range = undefined;
  };
  const place = () => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hide();
    const r = sel.getRangeAt(0);
    const node = r.commonAncestorContainer;
    const host = (node instanceof Element ? node : node.parentElement)?.closest(
      ".msg-assistant .markdown",
    );
    if (!host || !sel.toString().trim()) return hide();
    range = r;
    const rects = r.getClientRects();
    const last = rects[rects.length - 1] || r.getBoundingClientRect();
    quote.hidden = false;
    const width = quote.offsetWidth;
    quote.style.left = Math.max(8, Math.min(innerWidth - width - 8, last.right - width / 2)) + "px";
    quote.style.top = Math.min(innerHeight - 40, last.bottom + 6) + "px";
  };
  thread.element.addEventListener("pointerup", () => setTimeout(place));
  thread.element.addEventListener("keyup", (event) => {
    if (event.shiftKey) place();
  });
  thread.element.addEventListener("scroll", hide, { capture: true, passive: true });
  document.addEventListener("selectionchange", () => {
    if (getSelection()?.isCollapsed) hide();
  });
  quote.addEventListener("pointerdown", (event) => event.preventDefault());
  quote.addEventListener("click", () => {
    if (!range) return;
    const text = quoteText(range);
    getSelection()?.removeAllRanges();
    hide();
    if (!text) return;
    setQuotes([...quotes, text]);
    composer.focus();
  });
}
async function addFiles(files: File[]) {
  for (const file of files) {
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast(`最多添加 ${MAX_ATTACHMENTS} 个附件`, "error");
      break;
    }
    try {
      setAttachments([...attachments, await attachmentFromFile(file)]);
    } catch (error) {
      toast(errorText(error), "error");
    }
  }
  composer.focus();
}
async function screenshot() {
  if (attachments.length >= MAX_ATTACHMENTS)
    return toast(`最多添加 ${MAX_ATTACHMENTS} 个附件`, "error");
  try {
    setAttachments([...attachments, await captureTab(windowId)]);
    composer.focus();
  } catch (error) {
    toast("截图失败：" + errorText(error), "error");
  }
}
async function attachPdf(url: string) {
  setStatus("正在下载 PDF…", "busy");
  try {
    setAttachments([...attachments, await attachmentFromUrl(url)]);
    if (conversation.contextMode !== "none") setContextMode("none");
    setStatus("");
    toast("已附加 PDF，可以直接提问", "success");
    composer.focus();
  } catch (error) {
    setStatus(errorText(error), "error");
  }
}

// ---------------------------------------------------------------- page context
async function refreshTab() {
  if (floating) return;
  const t = await activeTab(windowId).catch(() => undefined);
  const next = t ? { id: t.id, title: t.title || "", url: t.url || "" } : undefined;
  const changed = next?.url !== tab?.url || next?.id !== tab?.id;
  tab = next;
  if (page && (page.tabId !== tab?.id || page.url !== tab?.url)) page = undefined;
  renderContext();
  if (changed && !conversation.messages.length) thread.refreshEmpty();
}
async function currentPage(): Promise<PageSnapshot | undefined> {
  if (conversation.contextMode === "none") return undefined;
  fix = undefined;
  try {
    page = await readPage(
      floating && bound
        ? {
            tabId: bound.tabId,
            frameId: bound.frameId,
            documentId: bound.documentId,
            selection: bound.selection,
          }
        : { windowId },
    );
  } catch (error) {
    if (error instanceof AppError) fix = { code: error.code, data: error.data };
    page = undefined;
    throw error;
  } finally {
    renderContext();
  }
  return page;
}
async function refreshPage() {
  page = undefined;
  setStatus("正在读取网页…", "busy");
  try {
    const result = await currentPage();
    setStatus(
      result
        ? `已读取 ${result.content.length.toLocaleString()} 字 · ≈${estimateTokens(result.content).toLocaleString()} token`
        : "",
    );
  } catch (error) {
    showError(errorText(error));
  }
}
async function preview() {
  const body = h("div", { class: "preview" }, h("div", { class: "preview-loading" }, spinner(), "正在读取网页…"));
  let text = "";
  const copyButton = button("复制正文", () => {
    void navigator.clipboard.writeText(text).then(() => toast("已复制", "success"));
  }, "btn-ghost", "copy");
  const load = async () => {
    try {
      const r = await currentPage();
      if (!r) {
        body.replaceChildren(h("p", { class: "muted" }, "当前为普通聊天，不读取网页。"));
        return;
      }
      text = r.content;
      body.replaceChildren();
      append(body, [
        h(
          "div",
          { class: "preview-head" },
          h("img", { class: "favicon", src: faviconUrl(r.url), alt: "" }),
          h(
            "div",
            { class: "preview-titles" },
            h("strong", null, r.title || hostOf(r.url)),
            h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.url),
          ),
        ),
        h(
          "div",
          { class: "stat-row" },
          h("span", { class: "stat" }, `${r.content.length.toLocaleString()} 字符`),
          h("span", { class: "stat" }, `≈ ${estimateTokens(r.content).toLocaleString()} token`),
          h("span", { class: "stat" }, r.status === "loaded" ? "已提取" : "未提取到正文"),
        ),
        r.warnings.length
          ? h(
              "ul",
              { class: "warning-list" },
              r.warnings.map((w) => h("li", null, icon("info", 13), h("span", null, w))),
            )
          : null,
        r.selection
          ? h("blockquote", { class: "preview-selection" }, h("strong", null, "选区"), r.selection.text)
          : null,
        h("pre", { class: "preview-text" }, r.content || "（空）"),
      ]);
    } catch (error) {
      body.replaceChildren(errorBox(errorText(error)));
    }
  };
  showDialog("网页上下文", body, {
    wide: true,
    footer: [
      button("重新读取", () => {
        body.replaceChildren(h("div", { class: "preview-loading" }, spinner(), "正在读取网页…"));
        void load();
      }, "btn-ghost", "refresh"),
      copyButton,
    ],
  });
  await load();
}
function errorBox(text: string) {
  const box = h("div", { class: "error-box" }, icon("alert", 16), h("span", null, text));
  const action = fixAction();
  if (action) box.append(button(action.label, action.run, "btn-small"));
  return box;
}
/** Turns a coded background error into a one-click remedy. */
function fixAction(): { label: string; run: () => void } | undefined {
  const f = fix;
  if (!f) return undefined;
  if (f.code === "NO_ACCESS" && f.data)
    return {
      label: "授权访问此网站",
      run: () =>
        void chrome.permissions.request({ origins: [f.data!] }).then((ok) => {
          if (!ok) return toast("未获得授权；可改为不读取网页", "error");
          fix = undefined;
          toast("已授权", "success");
          if (composer.input.value.trim()) void submit();
          else setStatus("");
        }),
    };
  if (f.code === "PDF" && f.data)
    return { label: "作为附件发送 PDF", run: () => void attachPdf(f.data!) };
  if (f.code === "RESTRICTED" && !floating)
    return {
      label: "改为普通聊天",
      run: () => {
        setContextMode("none");
        setStatus("");
        if (composer.input.value.trim()) void submit();
      },
    };
  return undefined;
}
function showError(text: string) {
  setStatus(text, "error", fixAction());
}

// ---------------------------------------------------------------- requests
const STAGE_TEXT: Record<Stage, string> = {
  preparing: "正在准备上下文",
  searching: "正在搜索",
  connecting: "等待模型响应",
  streaming: "正在生成",
  complete: "",
  cancelled: "已停止",
  timeout: "已超时",
  failed: "请求失败",
  interrupted: "已中断",
};
function onStage(e: RequestEvent) {
  if (e.stage === "complete") return setStatus(e.detail || "");
  if (e.stage === "cancelled") return setStatus("");
  if (e.stage === "failed" || e.stage === "timeout")
    return showError(`${STAGE_TEXT[e.stage]}：${e.detail || "未知错误"}`);
  setStatus(
    STAGE_TEXT[e.stage] + (e.detail && e.stage !== "streaming" ? " · " + e.detail : "…"),
    "busy",
  );
}
async function submit(
  opts: {
    text?: string;
    task?: TaskMode;
    display?: MessageDisplay;
    files?: Attachment[];
    tabs?: TabRef[];
  } = {},
) {
  if (active) return;
  const typed = opts.text === undefined;
  const typedText = (opts.text ?? composer.input.value).trim();
  const files = opts.files ?? (typed ? attachments : []);
  const tabs = opts.tabs ?? (typed ? mentions : []);
  const quoted = typed ? quotes : [];
  if (!typedText && !files.length && !quoted.length) return;
  // Quoted passages travel as Markdown blockquotes ahead of the question.
  const text = quoted.length
    ? quoted.map((q) => q.replace(/^/gm, "> ")).join("\n\n") +
      "\n\n" +
      (typedText || "请解释引用的这段内容。")
    : typedText;
  const p = currentProfile();
  if (!p)
    return setStatus("还没有可用的模型配置。", "error", {
      label: "去添加",
      run: openOptions,
    });
  const caps = capabilities(p);
  if (files.some((a) => a.kind === "image") && !caps.vision)
    return showError(`「${p.name}」未启用图片输入；可在设置的模型能力中开启，或移除图片。`);
  if (files.some((a) => a.kind === "pdf") && !caps.documents)
    return showError(`「${p.name}」未启用 PDF 输入；可在设置的模型能力中开启，或移除 PDF。`);
  const question = text || "请阅读附件并回答。";
  const c = conversation;
  const before = c.messages.length;
  const scope = new RequestScope(p.timeouts);
  const id = uid();
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  active = { id, conversationId: c.id, scope, done };
  fix = undefined;
  if (typed) {
    composer.setText("");
    setAttachments([]);
    setMentions([]);
    setQuotes([]);
  }
  composer.setBusy(true);
  setStatus("正在准备…", "busy");
  thread.toBottom();
  try {
    await runTurn({
      requestId: id,
      conversation: c,
      profile: structuredClone(p),
      settings: structuredClone(settings),
      question,
      task: opts.task ?? inferTask(question),
      searchQuery: composer.queryInput.value,
      attachments: files,
      display: opts.display,
      scope,
      getPage: currentPage,
      tabs,
      readTab: (t) => readPage({ tabId: t.tabId }),
      onEvent: (e) => {
        if (active?.id === e.requestId && conversation.id === e.conversationId)
          onStage(e);
      },
      onMessages: () => {
        if (conversation.id !== c.id) return;
        thread.render();
        updateTitle();
      },
    });
  } catch (error) {
    showError(errorText(error));
  } finally {
    if (c.messages.length === before && typed && conversation.id === c.id) {
      composer.setText(typedText);
      setAttachments(files);
      setMentions(tabs);
      setQuotes(quoted);
    }
    if (active?.id === id) {
      active = undefined;
      composer.setBusy(false);
      if (conversation.id === c.id) {
        thread.render();
        renderUsage();
      }
    }
    finish();
  }
}
async function settle() {
  if (!active) return;
  active.scope.abort();
  await active.done;
}
async function regenerate() {
  if (active) return;
  const index = conversation.messages.findLastIndex((m) => m.role === "user");
  if (index < 0) return;
  const c = conversation;
  const user = c.messages[index];
  const removed = c.messages.splice(index);
  thread.render();
  await submit({
    text: messageText(user),
    display: user.display,
    files: messageAttachments(user),
    tabs: (user.refs || []).map(({ source }) => ({
      tabId: source.tabId,
      title: source.title,
      url: source.url,
    })),
  });
  // Nothing was sent (e.g. the page could not be read): put the old turn back.
  if (c.messages.length === index) {
    c.messages.push(...removed);
    await saveConversation(c);
    if (conversation.id === c.id) {
      thread.render();
      renderUsage();
    }
  }
}

// ---------------------------------------------------------------- conversations
async function newChat() {
  await settle();
  setConversation(fresh());
  await refreshTab();
  composer.focus();
}
async function openConversation(id: string) {
  await settle();
  const c = await getConversation(id);
  if (!c) return toast("会话不存在或已删除", "error");
  setConversation(c);
}
function showHistory() {
  openHistory({
    currentId: conversation.messages.length ? conversation.id : "",
    onOpen: (id) => void openConversation(id),
    onDeleted: (id) => {
      if (conversation.id === id) void newChat();
    },
    onRenamed: (id, title) => {
      if (conversation.id !== id) return;
      conversation.title = title;
      updateTitle();
    },
  });
}
async function rename() {
  const name = await askText("重命名会话", "会话名称", conversation.title);
  if (!name) return;
  conversation.title = name;
  persistIfStarted();
  updateTitle();
}
async function removeCurrent() {
  if (!(await confirmAction("删除会话", `删除「${conversation.title}」？此操作不可撤销。`)))
    return;
  await settle();
  await deleteConversation(conversation.id);
  await newChat();
  toast("已删除");
}
async function showSource(source: PageIdentity, snapshotId?: string) {
  const snapshot = snapshotId ? await getSnapshot(snapshotId) : undefined;
  showDialog(
    "当时读取的网页",
    h(
      "div",
      { class: "preview" },
      h(
        "div",
        { class: "preview-head" },
        h("img", { class: "favicon", src: faviconUrl(source.url), alt: "" }),
        h(
          "div",
          { class: "preview-titles" },
          h("strong", null, source.title || hostOf(source.url)),
          h("a", { href: source.url, target: "_blank", rel: "noopener noreferrer" }, source.url),
        ),
      ),
      h(
        "div",
        { class: "stat-row" },
        h("span", { class: "stat" }, new Date(source.capturedAt).toLocaleString("zh-CN")),
        snapshot ? h("span", { class: "stat" }, `${snapshot.content.length.toLocaleString()} 字符`) : null,
      ),
      snapshot
        ? h("pre", { class: "preview-text" }, snapshot.content)
        : h("p", { class: "muted" }, "正文快照已按容量上限淘汰；来源标识仍保留。"),
    ),
    { wide: true },
  );
}
function sessionPrompt() {
  const area = h("textarea", {
    class: "input textarea",
    rows: 8,
    placeholder: settings.systemPrompt,
    value: conversation.systemPrompt || "",
    "aria-label": "会话提示词",
  });
  const dialog: HTMLDialogElement = showDialog(
    "会话提示词",
    h(
      "div",
      { class: "stack" },
      h("p", { class: "dialog-text" }, "只对当前会话生效，会替换全局提示词。留空则使用全局提示词（占位文字）。"),
      area,
    ),
    {
      footer: [
        button("恢复全局", () => {
          conversation.systemPrompt = undefined;
          persistIfStarted();
          dialog.close();
          toast("已恢复全局提示词");
        }, "btn-ghost"),
        button("保存", () => {
          conversation.systemPrompt = area.value.trim() || undefined;
          persistIfStarted();
          dialog.close();
          toast("会话提示词已保存", "success");
        }, "btn-primary"),
      ],
    },
  );
  area.focus();
}
function effectiveConfig() {
  const p = currentProfile();
  const c = p ? capabilities(p) : undefined;
  const row = (label: string, value: unknown) =>
    h("div", { class: "kv" }, h("span", { class: "kv-key" }, label), h("span", { class: "kv-value" }, value === undefined || value === "" ? "默认" : String(value)));
  const contextName: Record<ContextMode, string> = {
    none: "不读取网页",
    page: "当前页正文",
    selection: "仅选区",
    "selection-page": "选区 + 正文",
  };
  const searchName: Record<SearchMode, string> = {
    off: "关闭",
    auto: "按需搜索",
    required: "先搜索再回答",
  };
  showDialog(
    "生效配置",
    h(
      "div",
      { class: "kv-list" },
      h("h3", { class: "kv-section" }, "模型"),
      p
        ? [
            row("配置", p.name),
            row("协议", p.provider === "gemini" ? "Gemini 原生" : "OpenAI 兼容"),
            row("模型", p.model),
            row("接口", p.baseUrl),
            row("API key", p.apiKey ? "已配置" : "未配置"),
            row("上下文 / 输出", `${p.contextTokens} / ${p.maxOutputTokens} token`),
            row("temperature", p.temperature),
            row("top_p", p.topP),
            row("思考", p.reasoning),
            row("超时", `首响应 ${p.timeouts.first}s · 空闲 ${p.timeouts.idle}s · 总 ${p.timeouts.total}s`),
            row(
              "能力",
              [
                c?.vision && "图片",
                c?.documents && "PDF",
                c?.tools && "工具调用",
                c?.nativeSearch && "自带联网",
                c && c.reasoning !== "none" && "思考控制",
              ]
                .filter(Boolean)
                .join(" · ") || "基础文本",
            ),
          ]
        : h("p", { class: "muted" }, "尚未配置模型。"),
      h("h3", { class: "kv-section" }, "会话"),
      row("网页上下文", contextName[conversation.contextMode]),
      row("联网搜索", searchName[conversation.searchMode]),
      row("搜索服务", searchMeta(settings.search.provider).name),
      row("提示词来源", conversation.systemPrompt ? "会话覆盖" : "全局"),
      h("pre", { class: "prompt-preview" }, conversation.systemPrompt ?? settings.systemPrompt),
      h("h3", { class: "kv-section" }, "划词模板变量"),
      row("{{selection}}", "选区原文"),
      row("{{paragraph}}", "选区所在段落"),
      row("{{title}}", "页面标题"),
      row("{{url}}", "页面地址"),
    ),
    { wide: true },
  );
}

// ---------------------------------------------------------------- floating
async function transfer() {
  if (!bound) return;
  // sidePanel.open must run synchronously inside the click; Vivaldi toggles an open panel closed.
  const opening = panelVisible
    ? Promise.resolve()
    : chrome.sidePanel.open({ tabId: bound.tabId });
  try {
    await settle();
    await opening;
    await saveConversation(conversation);
    await send({ type: "TRANSFER", conversationId: conversation.id });
    await closeFloat();
  } catch (error) {
    toast("转入侧栏失败：" + errorText(error), "error");
  }
}
async function closeFloat() {
  await settle();
  await send({ type: "CLOSE_FLOAT", id: sessionId }).catch(() => {});
}
function setupFloatChrome() {
  // Drag by the header; the content script owns the iframe's position.
  header.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest("button") || event.button !== 0) return;
    header.setPointerCapture(event.pointerId);
    let x = event.screenX,
      y = event.screenY;
    const move = (e: PointerEvent) => {
      parent.postMessage({ type: "valise:move", dx: e.screenX - x, dy: e.screenY - y }, "*");
      x = e.screenX;
      y = e.screenY;
    };
    const up = () => {
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", up);
      header.removeEventListener("pointercancel", up);
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", up);
    header.addEventListener("pointercancel", up);
  });
  // Grow with the answer instead of opening at a fixed, mostly empty height.
  let frame = 0;
  const report = () => {
    frame = 0;
    const height =
      header.offsetHeight + thread.inner.offsetHeight + composer.element.offsetHeight + 2;
    parent.postMessage({ type: "valise:resize", height }, "*");
  };
  const observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(report);
  });
  observer.observe(thread.inner);
  observer.observe(composer.element);
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector("dialog[open], .menu"))
      void closeFloat();
  });
}

// ---------------------------------------------------------------- lifecycle
addEventListener("pagehide", () => active?.scope.abort(), { once: true });
chrome.runtime.onMessage.addListener((msg) => {
  if (!floating && msg?.type === "OPEN_CONVERSATION") {
    void chrome.storage.session.remove("pendingConversation");
    void openConversation(msg.id);
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && windowId !== undefined && changes["panel:" + windowId])
    panelVisible = !!changes["panel:" + windowId].newValue;
  if (area === "local" && changes.settings && conversation) {
    settings = normalizeSettings(changes.settings.newValue);
    applyAppearance(settings);
    renderModel();
    if (!conversation.messages.length) thread.refreshEmpty();
  }
});
if (!floating) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refreshTab(), 120);
  };
  chrome.tabs.onActivated.addListener((info) => {
    if (info.windowId === windowId) soon();
  });
  chrome.tabs.onUpdated.addListener((_id, change, t) => {
    if (t.active && t.windowId === windowId && (change.url || change.title || change.status === "complete"))
      soon();
  });
  const publish = () => {
    if (windowId !== undefined)
      void chrome.storage.session.set({ ["panel:" + windowId]: !document.hidden });
  };
  document.addEventListener("visibilitychange", publish);
  addEventListener("pagehide", () => {
    if (windowId !== undefined)
      void chrome.storage.session.set({ ["panel:" + windowId]: false });
  });
  void (async () => {
    windowId = (await chrome.windows.getCurrent()).id;
    publish();
  })();
}

async function init() {
  settings = await loadSettings();
  applyAppearance(settings);
  if (!floating) {
    windowId ??= (await chrome.windows.getCurrent()).id;
    const t = await activeTab(windowId).catch(() => undefined);
    tab = t ? { id: t.id, title: t.title || "", url: t.url || "" } : undefined;
  }
  setConversation(fresh());
  setupQuoting();
  if (floating) {
    setupFloatChrome();
    if (!sessionId) throw new Error("缺少选区会话标识，请重新划词。");
    bound = await send<FloatSession>({ type: "CLAIM_FLOAT", id: sessionId });
    windowId = bound.windowId;
    const key = "panel:" + bound.windowId;
    panelVisible = !!(await chrome.storage.session.get(key))[key];
    const badge = header.querySelector(".float-badge")!;
    badge.replaceChildren(icon(actionIcon(bound.action.icon), 15), bound.action.name);
    renderContext();
    const variables: Record<string, string> = {
      selection: bound.selection.text,
      paragraph: bound.selection.paragraph,
      title: bound.title || "",
      url: bound.url,
    };
    const question = bound.action.prompt.replace(
      /\{\{(selection|paragraph|title|url)\}\}/g,
      (_match: string, key: string) => variables[key],
    );
    await submit({
      text: question,
      display: {
        action: bound.action.name,
        icon: bound.action.icon,
        quote: bound.selection.text,
      },
    });
    composer.focus();
  } else {
    const { pendingConversation } = await chrome.storage.session.get("pendingConversation");
    if (typeof pendingConversation === "string") {
      await chrome.storage.session.remove("pendingConversation");
      await openConversation(pendingConversation);
    }
    composer.focus();
  }
}
void init().catch((error) => showError(errorText(error)));
