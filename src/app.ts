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
  applyLocale,
  capabilities,
  loadSettings,
  normalizeSettings,
  searchMeta,
  searchReady,
} from "./config";
import { estimateTokens, inferTask, messageTokens } from "./context";
import { append, compactNumber, h } from "./dom";
import { formatNumber, getLocale, t, type MessageKey } from "./i18n";
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

// Loaded before any label is built, so the whole page uses the configured language.
let settings: Settings = await loadSettings();
document.documentElement.lang = getLocale();
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
const titleText = h("span", { class: "title-text" }, t("app.newChat"));
const header = floating
  ? h(
      "header",
      { class: "topbar float-bar" },
      h("span", { class: "float-badge" }),
      h("span", { class: "grow" }),
      iconButton("sidebar", t("app.continueInPanel"), () => void transfer()),
      iconButton("x", t("app.closeEsc"), () => void closeFloat()),
    )
  : h(
      "header",
      { class: "topbar" },
      h(
        "button",
        {
          type: "button",
          class: "title-btn",
          title: t("history.title"),
          onclick: () => showHistory(),
        },
        icon("history", 16),
        titleText,
        icon("chevronDown", 14),
      ),
      iconButton("newChat", t("app.newChat"), () => void newChat()),
      iconButton("more", t("app.more"), (event) =>
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
  onMention: (x) => setMentions([...mentions, x]),
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
    title: t("app.newChat"),
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
    : t("app.newChat");
}
function renderModel() {
  const p = currentProfile();
  composer.setModel(
    p ? p.name : t("app.noModel"),
    p ? `${p.name} · ${p.model}` : t("app.addModelHint"),
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
      title: t("app.usage.title", {
        used: (u.reported ? "" : "≈") + compactNumber(u.used),
        limit: compactNumber(u.limit),
      }),
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
          h("span", null, t("app.usage.context")),
          h(
            "strong",
            null,
            `${u.reported ? "" : "≈"}${formatNumber(u.used)} / ${formatNumber(u.limit)}`,
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
          t(u.reported ? "app.usage.noteReported" : "app.usage.noteEstimated"),
        ),
        h("div", { class: "usage-title" }, t("app.usage.total")),
        calls
          ? [
              row(t("app.usage.input"), formatNumber(total.input)),
              total.cached ? row(t("app.usage.cached"), formatNumber(total.cached)) : null,
              row(t("app.usage.output"), formatNumber(total.output)),
              total.reasoning
                ? row(t("app.usage.reasoning"), formatNumber(total.reasoning))
                : null,
              row(t("app.usage.calls"), t("app.usage.callsValue", { count: calls })),
            ]
          : h("p", { class: "usage-note" }, t("app.usage.none")),
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
      m.error = t("app.interrupted");
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
  return t(
    hour < 5
      ? "app.greeting.night"
      : hour < 11
        ? "app.greeting.morning"
        : hour < 13
          ? "app.greeting.noon"
          : hour < 18
            ? "app.greeting.afternoon"
            : "app.greeting.evening",
  );
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
    h("h2", { class: "empty-title" }, t("app.emptyTitle", { greeting: greeting() })),
  );
  if (!settings.profiles.length) {
    wrap.append(
      h("p", { class: "empty-sub" }, t("app.emptyNoModel")),
      button(t("app.addModel"), openOptions, "btn-primary", "plus"),
    );
    return wrap;
  }
  const readable = tab && /^https?:/.test(tab.url);
  wrap.append(
    h(
      "p",
      { class: "empty-sub" },
      t(readable ? "app.emptyReadable" : "app.emptyUnreadable"),
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
          ? suggestion("file", t("app.suggest.pdf"), t("app.suggest.pdfHint"), () =>
              void attachPdf(tab!.url),
            )
          : [
              suggestion(
                "sparkles",
                t("app.suggest.summarize"),
                t("app.suggest.summarizeHint"),
                () => quick("summarize"),
              ),
              suggestion(
                "languages",
                t("app.suggest.translate"),
                t("app.suggest.translateHint"),
                () => quick("translate"),
              ),
              suggestion("bulb", t("app.suggest.concepts"), t("app.suggest.conceptsHint"), () =>
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
  const presets: Record<TaskMode, [MessageKey, MessageDisplay]> = {
    summarize: [
      "app.prompt.summarize",
      { action: t("app.suggest.summarize"), icon: "sparkles" },
    ],
    translate: [
      "app.prompt.translate",
      { action: t("app.suggest.translate"), icon: "languages" },
    ],
    question: ["app.prompt.concepts", { action: t("app.suggest.concepts"), icon: "bulb" }],
  };
  const [text, display] = presets[task];
  void submit({ text: t(text), task, display });
}

// ---------------------------------------------------------------- menus
const CONTEXT_NAME: Record<ContextMode, MessageKey> = {
  none: "mode.none",
  page: "mode.page",
  selection: "mode.selection",
  "selection-page": "mode.selectionPage",
};
const SEARCH_NAME: Record<SearchMode, MessageKey> = {
  off: "searchMode.off",
  auto: "searchMode.auto",
  required: "searchMode.required",
};
function contextMenu(anchor: HTMLElement) {
  const modes: [ContextMode, MessageKey, IconName][] = floating
    ? [
        ["selection-page", "app.ctx.selectionPageFloat", "layers"],
        ["selection", "app.ctx.selectionFloat", "cursor"],
      ]
    : [
        ["none", "app.ctx.none", "message"],
        ["page", "app.ctx.page", "page"],
        ["selection", "app.ctx.selection", "cursor"],
        ["selection-page", "app.ctx.selectionPage", "layers"],
      ];
  const entries: MenuEntry[] = [
    { heading: t("app.ctx.heading") },
    ...modes.map(([value, hint, name]) => ({
      label: t(CONTEXT_NAME[value]),
      hint: t(hint),
      icon: name,
      checked: conversation.contextMode === value,
      action: () => setContextMode(value),
    })),
    "separator",
    {
      label: t("app.ctx.preview"),
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
    ? t("app.search.needModel")
    : caps.nativeSearch
      ? p!.provider === "gemini"
        ? t("app.search.gemini")
        : t("app.search.native")
      : caps.tools
        ? ready
          ? t("app.search.tool", { service })
          : t("app.search.toolNotReady")
        : t("app.search.unsupported");
  const modes: [SearchMode, string, IconName][] = [
    ["off", t("app.search.offHint"), "x"],
    ["auto", autoHint, "sparkles"],
    [
      "required",
      ready ? t("app.search.requiredHint", { service }) : t("app.search.requiredNotReady"),
      "search",
    ],
  ];
  openMenu(
    anchor,
    [
      { heading: t("app.search.heading") },
      ...modes.map(([value, hint, name]) => ({
        label: t(SEARCH_NAME[value]),
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
        { heading: t("app.model.heading") },
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
  entries.push({ label: t("app.model.manage"), icon: "settings", action: openOptions });
  openMenu(anchor, entries, { placement: "top", align: "end" });
}
function attachMenu(anchor: HTMLElement) {
  const entries: MenuEntry[] = [
    {
      label: t("app.attach.upload"),
      hint: t("app.attach.uploadHint"),
      icon: "paperclip",
      action: () => fileInput.click(),
    },
    {
      label: t("app.attach.screenshot"),
      hint: t("app.attach.screenshotHint"),
      icon: "scan",
      action: () => void screenshot(),
    },
    {
      label: t("app.attach.mention"),
      hint: t("app.attach.mentionHint"),
      icon: "at",
      action: () => composer.startMention(),
    },
  ];
  if (tab && isPdfUrl(tab.url))
    entries.push({
      label: t("app.attach.pdf"),
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
        label: t("common.rename"),
        icon: "edit",
        disabled: !started,
        action: () => void rename(),
      },
      {
        label: t("app.sessionPrompt"),
        hint: t(
          conversation.systemPrompt ? "app.sessionPrompt.overridden" : "app.sessionPrompt.global",
        ),
        icon: "pen",
        action: sessionPrompt,
      },
      { label: t("app.effective"), icon: "info", action: effectiveConfig },
      {
        label: t("common.exportMarkdown"),
        icon: "download",
        disabled: !started,
        action: () => exportFile(conversation),
      },
      "separator",
      {
        label: t("common.deleteConversation"),
        icon: "trash",
        danger: true,
        disabled: !started,
        action: () => void removeCurrent(),
      },
      "separator",
      { label: t("app.settings"), icon: "settings", action: openOptions },
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
    setMentions(mentions.filter((x) => x.tabId !== id)),
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
  const taken = new Set(mentions.map((x) => x.tabId));
  return (await chrome.tabs.query({}))
    .filter((x) => x.id !== undefined && /^https?:/.test(x.url || "") && !taken.has(x.id))
    .sort(
      (a, b) =>
        Number(b.windowId === windowId) - Number(a.windowId === windowId) ||
        b.lastAccessed - a.lastAccessed,
    )
    .map((x) => ({
      tabId: x.id!,
      title: x.title || "",
      url: x.url || "",
      hint:
        x.id === tab?.id
          ? t(conversation.contextMode === "none" ? "app.tabs.current" : "app.tabs.currentRead")
          : x.discarded
            ? t("app.tabs.discarded", { host: hostOf(x.url || "") })
            : undefined,
    }));
}
/** "Quote" button over a selection inside an answer; adds the passage to the composer. */
function setupQuoting() {
  const quote = h(
    "button",
    { type: "button", class: "quote-btn" },
    icon("quote", 13),
    t("app.quote"),
  );
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
      toast(t("app.tooManyFiles", { max: MAX_ATTACHMENTS }), "error");
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
    return toast(t("app.tooManyFiles", { max: MAX_ATTACHMENTS }), "error");
  try {
    setAttachments([...attachments, await captureTab(windowId)]);
    composer.focus();
  } catch (error) {
    toast(t("app.screenshotFailed", { error: errorText(error) }), "error");
  }
}
async function attachPdf(url: string) {
  setStatus(t("app.downloadingPdf"), "busy");
  try {
    setAttachments([...attachments, await attachmentFromUrl(url)]);
    if (conversation.contextMode !== "none") setContextMode("none");
    setStatus("");
    toast(t("app.pdfAttached"), "success");
    composer.focus();
  } catch (error) {
    setStatus(errorText(error), "error");
  }
}

// ---------------------------------------------------------------- page context
async function refreshTab() {
  if (floating) return;
  const next = await activeTab(windowId).catch(() => undefined);
  const value = next ? { id: next.id, title: next.title || "", url: next.url || "" } : undefined;
  const changed = value?.url !== tab?.url || value?.id !== tab?.id;
  tab = value;
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
  setStatus(t("app.readingPage"), "busy");
  try {
    const result = await currentPage();
    setStatus(
      result
        ? t("app.pageRead", {
            chars: formatNumber(result.content.length),
            tokens: formatNumber(estimateTokens(result.content)),
          })
        : "",
    );
  } catch (error) {
    showError(errorText(error));
  }
}
async function preview() {
  const loading = () =>
    h("div", { class: "preview-loading" }, spinner(), t("app.readingPage"));
  const body = h("div", { class: "preview" }, loading());
  let text = "";
  const copyButton = button(t("app.copyText"), () => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast(t("common.copied"), "success"));
  }, "btn-ghost", "copy");
  const load = async () => {
    try {
      const r = await currentPage();
      if (!r) {
        body.replaceChildren(h("p", { class: "muted" }, t("app.preview.none")));
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
          h("span", { class: "stat" }, t("app.chars", { count: formatNumber(r.content.length) })),
          h(
            "span",
            { class: "stat" },
            t("app.tokensApprox", { count: formatNumber(estimateTokens(r.content)) }),
          ),
          h(
            "span",
            { class: "stat" },
            t(r.status === "loaded" ? "app.preview.loaded" : "app.preview.empty"),
          ),
        ),
        r.warnings.length
          ? h(
              "ul",
              { class: "warning-list" },
              r.warnings.map((w) => h("li", null, icon("info", 13), h("span", null, w))),
            )
          : null,
        r.selection
          ? h(
              "blockquote",
              { class: "preview-selection" },
              h("strong", null, t("app.preview.selection")),
              r.selection.text,
            )
          : null,
        h("pre", { class: "preview-text" }, r.content || t("common.empty")),
      ]);
    } catch (error) {
      body.replaceChildren(errorBox(errorText(error)));
    }
  };
  showDialog(t("app.ctx.heading"), body, {
    wide: true,
    footer: [
      button(t("app.reload"), () => {
        body.replaceChildren(loading());
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
      label: t("app.fix.grant"),
      run: () =>
        void chrome.permissions.request({ origins: [f.data!] }).then((ok) => {
          if (!ok) return toast(t("app.fix.denied"), "error");
          fix = undefined;
          toast(t("app.fix.granted"), "success");
          if (composer.input.value.trim()) void submit();
          else setStatus("");
        }),
    };
  if (f.code === "PDF" && f.data)
    return { label: t("app.fix.pdf"), run: () => void attachPdf(f.data!) };
  if (f.code === "RESTRICTED" && !floating)
    return {
      label: t("app.fix.plainChat"),
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
const STAGE_TEXT: Record<Stage, MessageKey> = {
  preparing: "stage.preparing",
  searching: "stage.searching",
  connecting: "stage.connecting",
  streaming: "stage.streaming",
  complete: "stage.complete",
  cancelled: "stage.cancelled",
  timeout: "stage.timeout",
  failed: "stage.failed",
  interrupted: "stage.interrupted",
};
function onStage(e: RequestEvent) {
  if (e.stage === "complete") return setStatus(e.detail || "");
  if (e.stage === "cancelled") return setStatus("");
  if (e.stage === "failed" || e.stage === "timeout")
    return showError(
      t("common.labelValue", {
        label: t(STAGE_TEXT[e.stage]),
        value: e.detail || t("common.unknownError"),
      }),
    );
  setStatus(
    t(STAGE_TEXT[e.stage]) + (e.detail && e.stage !== "streaming" ? " · " + e.detail : "…"),
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
      (typedText || t("app.prompt.explainQuote"))
    : typedText;
  const p = currentProfile();
  if (!p)
    return setStatus(t("app.noProfile"), "error", {
      label: t("app.goAdd"),
      run: openOptions,
    });
  const caps = capabilities(p);
  if (files.some((a) => a.kind === "image") && !caps.vision)
    return showError(t("app.noVision", { name: p.name }));
  if (files.some((a) => a.kind === "pdf") && !caps.documents)
    return showError(t("app.noPdf", { name: p.name }));
  const question = text || t("app.prompt.readAttachment");
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
  setStatus(t("app.preparing"), "busy");
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
      readTab: (x) => readPage({ tabId: x.tabId }),
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
  if (!c) return toast(t("app.missingConversation"), "error");
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
  const name = await askText(
    t("common.renameConversation"),
    t("common.conversationName"),
    conversation.title,
  );
  if (!name) return;
  conversation.title = name;
  persistIfStarted();
  updateTitle();
}
async function removeCurrent() {
  if (
    !(await confirmAction(
      t("common.deleteConversation"),
      t("common.deleteConfirm", { title: conversation.title }),
    ))
  )
    return;
  await settle();
  await deleteConversation(conversation.id);
  await newChat();
  toast(t("common.deleted"));
}
async function showSource(source: PageIdentity, snapshotId?: string) {
  const snapshot = snapshotId ? await getSnapshot(snapshotId) : undefined;
  showDialog(
    t("app.source.title"),
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
        h("span", { class: "stat" }, new Date(source.capturedAt).toLocaleString(getLocale())),
        snapshot
          ? h(
              "span",
              { class: "stat" },
              t("app.chars", { count: formatNumber(snapshot.content.length) }),
            )
          : null,
      ),
      snapshot
        ? h("pre", { class: "preview-text" }, snapshot.content)
        : h("p", { class: "muted" }, t("app.source.evicted")),
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
    "aria-label": t("app.sessionPrompt"),
  });
  const dialog: HTMLDialogElement = showDialog(
    t("app.sessionPrompt"),
    h(
      "div",
      { class: "stack" },
      h("p", { class: "dialog-text" }, t("app.sessionPrompt.desc")),
      area,
    ),
    {
      footer: [
        button(t("app.sessionPrompt.reset"), () => {
          conversation.systemPrompt = undefined;
          persistIfStarted();
          dialog.close();
          toast(t("app.sessionPrompt.resetDone"));
        }, "btn-ghost"),
        button(t("common.save"), () => {
          conversation.systemPrompt = area.value.trim() || undefined;
          persistIfStarted();
          dialog.close();
          toast(t("app.sessionPrompt.saved"), "success");
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
    h(
      "div",
      { class: "kv" },
      h("span", { class: "kv-key" }, label),
      h(
        "span",
        { class: "kv-value" },
        value === undefined || value === "" ? t("common.default") : String(value),
      ),
    );
  showDialog(
    t("app.effective"),
    h(
      "div",
      { class: "kv-list" },
      h("h3", { class: "kv-section" }, t("app.cfg.model")),
      p
        ? [
            row(t("app.cfg.profile"), p.name),
            row(t("app.cfg.protocol"), t(p.provider === "gemini" ? "protocol.gemini" : "protocol.openai")),
            row(t("app.cfg.model"), p.model),
            row(t("app.cfg.endpoint"), p.baseUrl),
            row("API key", t(p.apiKey ? "app.cfg.set" : "app.cfg.unset")),
            row(
              t("app.cfg.budget"),
              t("app.cfg.budgetValue", { context: p.contextTokens, output: p.maxOutputTokens }),
            ),
            row("temperature", p.temperature),
            row("top_p", p.topP),
            row(t("app.cfg.reasoning"), p.reasoning),
            row(t("app.cfg.timeouts"), t("app.cfg.timeoutsValue", p.timeouts)),
            row(
              t("app.cfg.capabilities"),
              [
                c?.vision && t("cap.vision"),
                c?.documents && "PDF",
                c?.tools && t("cap.tools"),
                c?.nativeSearch && t("cap.nativeSearch"),
                c && c.reasoning !== "none" && t("cap.reasoning"),
              ]
                .filter(Boolean)
                .join(" · ") || t("cap.textOnly"),
            ),
          ]
        : h("p", { class: "muted" }, t("app.cfg.noModel")),
      h("h3", { class: "kv-section" }, t("app.cfg.conversation")),
      row(t("app.ctx.heading"), t(CONTEXT_NAME[conversation.contextMode])),
      row(t("app.search.heading"), t(SEARCH_NAME[conversation.searchMode])),
      row(t("app.cfg.searchService"), searchMeta(settings.search.provider).name),
      row(
        t("app.cfg.promptSource"),
        t(conversation.systemPrompt ? "app.cfg.promptConversation" : "app.cfg.promptGlobal"),
      ),
      h("pre", { class: "prompt-preview" }, conversation.systemPrompt ?? settings.systemPrompt),
      h("h3", { class: "kv-section" }, t("app.cfg.variables")),
      row("{{selection}}", t("var.selection")),
      row("{{paragraph}}", t("var.paragraph")),
      row("{{title}}", t("var.title")),
      row("{{url}}", t("var.url")),
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
    toast(t("app.transferFailed", { error: errorText(error) }), "error");
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
/** Labels are built once per page, so a language change reloads the panel and reopens the conversation. */
async function reopen() {
  await active?.done;
  if (conversation.messages.length)
    await chrome.storage.session.set({ pendingConversation: conversation.id });
  location.reload();
}
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
    const locale = getLocale();
    // The float keeps its language until it closes.
    if (!floating) applyLocale(changes.settings.newValue);
    if (getLocale() !== locale) return void reopen();
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
  chrome.tabs.onUpdated.addListener((_id, change, x) => {
    if (x.active && x.windowId === windowId && (change.url || change.title || change.status === "complete"))
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
  applyAppearance(settings);
  if (!floating) {
    windowId ??= (await chrome.windows.getCurrent()).id;
    const current = await activeTab(windowId).catch(() => undefined);
    tab = current ? { id: current.id, title: current.title || "", url: current.url || "" } : undefined;
  }
  setConversation(fresh());
  setupQuoting();
  if (floating) {
    setupFloatChrome();
    if (!sessionId) throw new Error(t("app.noSession"));
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
