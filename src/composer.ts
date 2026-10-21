import { faviconUrl, hostOf } from "./browser";
import { append, compactNumber, h } from "./dom";
import { t, type MessageKey } from "./i18n";
import { icon, type IconName } from "./icons";
import { attachmentChip } from "./render";
import { iconButton, spinner } from "./ui";
import type { Attachment, ContextMode, SearchMode, TabRef } from "./types";

export interface ComposerOptions {
  floating: boolean;
  onSubmit: () => void;
  onStop: () => void;
  onFiles: (files: File[]) => void;
  /** Typing "@" lists these tabs; picking one calls onMention. Side panel only. */
  listTabs?: () => Promise<(TabRef & { hint?: string })[]>;
  onMention?: (tab: TabRef) => void;
  onAttachMenu?: (anchor: HTMLElement) => void;
  onContextMenu: (anchor: HTMLElement) => void;
  onSearchMenu: (anchor: HTMLElement) => void;
  onModelMenu: (anchor: HTMLElement) => void;
  onUsageMenu: (anchor: HTMLElement) => void;
  onPreview: () => void;
  onRefresh: () => void;
}
export interface ContextState {
  mode: ContextMode;
  title?: string;
  url?: string;
  tokens?: number;
}
const CONTEXT_LABEL: Record<ContextMode, [MessageKey, IconName]> = {
  none: ["composer.ctx.none", "page"],
  page: ["composer.ctx.page", "page"],
  selection: ["composer.ctx.selection", "cursor"],
  "selection-page": ["composer.ctx.selectionPage", "layers"],
};
const SVG = "http://www.w3.org/2000/svg";
function ring(ratio: number) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const length = 2 * Math.PI * 7.5;
  for (const [cls, dash] of [
    ["ring-track", ""],
    ["ring-bar", `${Math.min(1, ratio) * length} ${length}`],
  ]) {
    const c = document.createElementNS(SVG, "circle");
    c.setAttribute("cx", "10");
    c.setAttribute("cy", "10");
    c.setAttribute("r", "7.5");
    c.setAttribute("class", cls);
    if (dash) {
      c.setAttribute("stroke-dasharray", dash);
      c.setAttribute("transform", "rotate(-90 10 10)");
    }
    svg.append(c);
  }
  return svg;
}
const SEARCH_LABEL: Record<SearchMode, MessageKey> = {
  off: "composer.search.off",
  auto: "composer.search.auto",
  required: "composer.search.required",
};

export function createComposer(o: ComposerOptions) {
  let busy = false;
  let statusKey = "";
  const input = h("textarea", {
    class: "composer-input",
    rows: 1,
    placeholder: t(o.floating ? "composer.followUp" : "composer.placeholder"),
    "aria-label": t("composer.inputLabel"),
  });
  const queryInput = h("input", {
    class: "query-input",
    placeholder: t("composer.queryPlaceholder"),
    "aria-label": t("composer.queryLabel"),
  });
  const queryRow = h("label", { class: "composer-query" }, icon("search", 14), queryInput);
  queryRow.hidden = true;
  const sourceRow = h("div", { class: "composer-source" });
  sourceRow.hidden = true;
  const tray = h("div", { class: "attachments composer-tray" });
  tray.hidden = true;
  const mentionRow = h("div", { class: "composer-mentions" });
  mentionRow.hidden = true;
  const quoteRow = h("div", { class: "composer-quotes" });
  quoteRow.hidden = true;
  const picker = h("div", {
    class: "mention-pop",
    role: "listbox",
    "aria-label": t("composer.mentionTitle"),
  });
  picker.hidden = true;
  const chip = (onclick: (anchor: HTMLElement) => void) => {
    const b = h("button", { type: "button", class: "chip" });
    b.onclick = () => onclick(b);
    return b;
  };
  const contextChip = chip(o.onContextMenu);
  const searchChip = chip(o.onSearchMenu);
  const modelButton = h("button", { type: "button", class: "model-btn" });
  modelButton.onclick = () => o.onModelMenu(modelButton);
  const meter = h("button", { type: "button", class: "ctx-meter" });
  meter.onclick = () => o.onUsageMenu(meter);
  meter.hidden = true;
  const attachButton = o.onAttachMenu
    ? iconButton("plus", t("composer.attach"), (event) =>
        o.onAttachMenu!(event.currentTarget as HTMLElement),
      )
    : null;
  const sendButton = h("button", {
    type: "button",
    class: "send-btn",
    onclick: () => (busy ? o.onStop() : o.onSubmit()),
  });
  const card = h(
    "div",
    { class: "composer" },
    sourceRow,
    mentionRow,
    quoteRow,
    tray,
    queryRow,
    input,
    h(
      "div",
      { class: "composer-tools" },
      attachButton,
      contextChip,
      searchChip,
      h("span", { class: "spacer" }),
      meter,
      modelButton,
      sendButton,
    ),
  );
  const status = h("div", { class: "status-line", role: "status" });
  status.hidden = true;
  const element = h("footer", { class: "composer-wrap" }, picker, card, status);

  const resize = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, o.floating ? 120 : 220) + "px";
  };
  const refreshSend = () => {
    sendButton.replaceChildren(icon(busy ? "stop" : "arrowUp", busy ? 16 : 18));
    sendButton.classList.toggle("is-stop", busy);
    sendButton.title = t(busy ? "composer.stopEsc" : "composer.sendEnter");
    sendButton.setAttribute("aria-label", t(busy ? "composer.stop" : "composer.send"));
    sendButton.disabled =
      !busy && !input.value.trim() && !tray.childElementCount && !quoteRow.childElementCount;
  };

  // ---- @ mentions: "@query" right before the caret opens the tab picker.
  type Option = TabRef & { hint?: string };
  let mention: { start: number; items: Option[]; index: number } | undefined;
  let tabs: Option[] | undefined;
  const trigger = () => {
    const caret = input.selectionStart ?? input.value.length;
    const match = input.value.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,40})$/);
    return match ? { caret, query: match[1] } : undefined;
  };
  const closePicker = () => {
    mention = undefined;
    tabs = undefined;
    picker.hidden = true;
  };
  const pick = (tab: TabRef) => {
    if (!mention) return;
    const caret = input.selectionStart ?? input.value.length;
    const start = mention.start;
    input.value = input.value.slice(0, start) + input.value.slice(caret);
    input.setSelectionRange(start, start);
    closePicker();
    resize();
    refreshSend();
    o.onMention!(tab);
  };
  const drawPicker = () => {
    const m = mention!;
    picker.replaceChildren(
      h("div", { class: "menu-heading" }, t("composer.mentionTitle")),
      ...(m.items.length
        ? m.items.map((tab, i) =>
            h(
              "button",
              {
                type: "button",
                role: "option",
                class: "mention-item" + (i === m.index ? " active" : ""),
                // Keep focus (and the caret) in the textarea.
                onpointerdown: (event: PointerEvent) => {
                  event.preventDefault();
                  pick(tab);
                },
              },
              h("img", { class: "favicon", src: faviconUrl(tab.url), alt: "" }),
              h(
                "span",
                { class: "mention-text" },
                h("span", { class: "mention-title" }, tab.title || hostOf(tab.url)),
                h("span", { class: "mention-hint" }, tab.hint || hostOf(tab.url)),
              ),
            ),
          )
        : [h("div", { class: "mention-empty" }, t("composer.noTabs"))]),
    );
    picker.hidden = false;
    picker.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  };
  const updatePicker = async () => {
    if (!o.listTabs || !trigger()) return closePicker();
    tabs ??= await o.listTabs();
    const typed = trigger();
    if (!typed || !tabs) return closePicker();
    const query = typed.query.toLowerCase();
    mention = {
      start: typed.caret - typed.query.length - 1,
      items: tabs
        .filter((x) => (x.title + " " + x.url).toLowerCase().includes(query))
        .slice(0, 30),
      index: 0,
    };
    drawPicker();
  };
  input.addEventListener("input", () => {
    resize();
    refreshSend();
    void updatePicker();
  });
  input.addEventListener("click", () => void updatePicker());
  input.addEventListener("blur", closePicker);
  input.addEventListener("keydown", (event) => {
    if (mention && !event.isComposing) {
      const n = mention.items.length;
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && n) {
        event.preventDefault();
        mention.index = (mention.index + (event.key === "ArrowDown" ? 1 : n - 1)) % n;
        drawPicker();
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && n) {
        event.preventDefault();
        pick(mention.items[mention.index]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!busy) o.onSubmit();
    } else if (event.key === "Escape" && busy) {
      event.preventDefault();
      o.onStop();
    }
  });
  input.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length && !event.clipboardData?.getData("text/plain")) {
      event.preventDefault();
      o.onFiles(files);
    }
  });
  if (o.onAttachMenu) {
    card.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      card.classList.add("is-drop");
    });
    card.addEventListener("dragleave", (event) => {
      if (!card.contains(event.relatedTarget as Node | null))
        card.classList.remove("is-drop");
    });
    card.addEventListener("drop", (event) => {
      card.classList.remove("is-drop");
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      event.preventDefault();
      o.onFiles(files);
    });
  }
  refreshSend();

  return {
    element,
    input,
    queryInput,
    resize,
    focus: () => input.focus(),
    setText(text: string) {
      input.value = text;
      resize();
      refreshSend();
    },
    setBusy(value: boolean) {
      busy = value;
      card.classList.toggle("is-busy", value);
      for (const b of [contextChip, searchChip, modelButton])
        b.disabled = value;
      refreshSend();
    },
    setContext(state: ContextState) {
      const [key, name] = CONTEXT_LABEL[state.mode];
      const label = t(key);
      contextChip.replaceChildren(icon(name, 15), h("span", null, label));
      contextChip.classList.toggle("on", state.mode !== "none");
      contextChip.title =
        state.mode === "none"
          ? t("composer.ctx.offTitle")
          : t("composer.ctx.title", { label });
      // In the float the selection is already shown as the first message.
      sourceRow.hidden = o.floating || state.mode === "none" || !state.url;
      if (sourceRow.hidden) return;
      const main = h(
        "button",
        {
          type: "button",
          class: "source-main",
          title: t("composer.previewTitle"),
          onclick: o.onPreview,
        },
        h("img", { class: "favicon", src: faviconUrl(state.url || ""), alt: "" }),
        h("span", { class: "source-title" }, state.title || hostOf(state.url || "")),
        state.tokens !== undefined
          ? h("span", { class: "source-meta" }, "≈" + compactNumber(state.tokens) + " tok")
          : null,
      );
      sourceRow.replaceChildren(
        main,
        iconButton("refresh", t("composer.reread"), o.onRefresh, "icon-btn-sm"),
      );
    },
    setSearch(mode: SearchMode) {
      const label = t(SEARCH_LABEL[mode]);
      searchChip.replaceChildren(icon("globe", 15), h("span", null, label));
      searchChip.classList.toggle("on", mode !== "off");
      searchChip.title =
        mode === "off" ? t("composer.search.offTitle") : t("composer.search.title", { label });
      queryRow.hidden = mode !== "required";
    },
    /** Context ring: share of the model's context window the conversation occupies. */
    setUsage(state: { ratio: number; title: string } | undefined) {
      meter.hidden = !state;
      if (!state) return;
      const percent = Math.round(state.ratio * 100);
      meter.replaceChildren(ring(state.ratio), h("span", null, percent + "%"));
      meter.className =
        "ctx-meter" + (percent >= 90 ? " is-full" : percent >= 70 ? " is-high" : "");
      meter.title = state.title;
      meter.setAttribute("aria-label", state.title);
    },
    setModel(label: string, title: string) {
      modelButton.replaceChildren(
        h("span", { class: "model-name" }, label),
        icon("chevronDown", 14),
      );
      modelButton.title = title;
    },
    /** Inserts "@" at the caret so the tab picker opens, as if typed. */
    startMention() {
      const at = input.selectionStart ?? input.value.length;
      const gap = at && !/\s/.test(input.value[at - 1]) ? " @" : "@";
      input.focus();
      input.setRangeText(gap, at, input.selectionEnd ?? at, "end");
      input.dispatchEvent(new Event("input"));
    },
    setMentions(items: TabRef[], onRemove: (tabId: number) => void) {
      mentionRow.replaceChildren(
        ...items.map((tab) => {
          const title = tab.title || hostOf(tab.url);
          return h(
            "span",
            { class: "mention-chip", title: tab.url },
            h("img", { class: "favicon", src: faviconUrl(tab.url), alt: "" }),
            h("span", { class: "mention-chip-title" }, title),
            h(
              "button",
              {
                type: "button",
                class: "mention-remove",
                title: t("common.remove"),
                "aria-label": t("composer.removeMention", { title }),
                onclick: () => onRemove(tab.tabId),
              },
              icon("x", 11),
            ),
          );
        }),
      );
      mentionRow.hidden = !items.length;
    },
    setQuotes(items: string[], onRemove: (index: number) => void) {
      quoteRow.replaceChildren(
        ...items.map((text, i) =>
          h(
            "div",
            { class: "quote-chip", title: text },
            icon("quote", 13),
            h("span", { class: "quote-text" }, text),
            h(
              "button",
              {
                type: "button",
                class: "mention-remove",
                title: t("composer.removeQuote"),
                "aria-label": t("composer.removeQuote"),
                onclick: () => onRemove(i),
              },
              icon("x", 11),
            ),
          ),
        ),
      );
      quoteRow.hidden = !items.length;
      refreshSend();
    },
    setAttachments(items: Attachment[], onRemove: (id: string) => void) {
      tray.replaceChildren(
        ...items.map((a) => attachmentChip(a, () => onRemove(a.id))),
      );
      tray.hidden = !items.length;
      refreshSend();
    },
    setStatus(
      text: string,
      kind: "busy" | "error" | "info" = "info",
      action?: { label: string; run: () => void },
    ) {
      // Streaming reports a stage per chunk; skip identical repaints.
      const key = action ? "" : kind + "\u0000" + text;
      if (key && key === statusKey) return;
      statusKey = key;
      status.hidden = !text;
      status.className = "status-line status-" + kind;
      status.replaceChildren();
      append(status, [
        kind === "busy" ? spinner() : kind === "error" ? icon("alert", 14) : null,
        h("span", { class: "status-text" }, text),
        action
          ? h(
              "button",
              { type: "button", class: "status-action", onclick: action.run },
              action.label,
            )
          : null,
      ]);
    },
  };
}
export type Composer = ReturnType<typeof createComposer>;
