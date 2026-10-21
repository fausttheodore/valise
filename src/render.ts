import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";
import { faviconUrl, hostOf } from "./browser";
import { compactNumber, h } from "./dom";
import { formatNumber, t, type MessageKey } from "./i18n";
import { icon, isIcon, type IconName } from "./icons";
import { BLOCK_SLOT, extractMath, renderTex, SLOT, type Formula } from "./math";
import { copyText, iconButton, showDialog } from "./ui";
import {
  messageAttachments,
  messageText,
  type Attachment,
  type Message,
  type PageIdentity,
  type Source,
  type Usage,
} from "./types";

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
type RenderEnv = { copies: string[] };
const escape = md.utils.escapeHtml;
md.renderer.rules.image = (tokens, index) =>
  `<span class="md-image">${escape(t("render.image", { alt: tokens[index].content }))}</span>`;
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return self.renderToken(tokens, index, options);
};
const fence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const copy = (env as RenderEnv).copies.push(token.content) - 1;
  const lang = token.info.trim().split(/\s+/)[0] || "text";
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${escape(lang)}</span><button type="button" class="code-copy" data-copy="${copy}">${escape(t("common.copy"))}</button></div>${fence(tokens, index, options, env, self)}</div>`;
};
function formulaHtml(f: Formula, env: RenderEnv) {
  const copy = env.copies.push(f.tex) - 1;
  const rendered = renderTex(f.tex, f.display);
  const tex = escape(f.tex);
  if (f.block)
    return `<div class="formula" data-tex="${tex}">${rendered}<div class="formula-actions"><button type="button" data-copy="${copy}" title="${escape(t("render.copyTex"))}">TeX</button><button type="button" data-copy="${copy}" data-delimiters="true" title="${escape(t("render.copyTexDelimited"))}">$$</button></div></div>`;
  return `<span class="inline-formula${f.display ? " is-display" : ""}" data-copy="${copy}" data-tex="${tex}" title="${escape(t("render.clickCopyTex"))}">${rendered}</span>`;
}
export function renderMarkdown(source: string) {
  const env: RenderEnv = { copies: [] };
  const { text, slots } = extractMath(source);
  const html = md
    .render(text, env)
    // A block formula alone in its paragraph replaces the paragraph.
    .replace(BLOCK_SLOT, (all, i) => {
      const slot = slots[Number(i)];
      return "math" in slot && slot.math.block ? formulaHtml(slot.math, env) : all;
    })
    .replace(SLOT, (_, i) => {
      const slot = slots[Number(i)];
      return "tag" in slot ? slot.tag : formulaHtml(slot.math, env);
    });
  return {
    html: DOMPurify.sanitize(html, {
      ADD_ATTR: ["target"],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input"],
      FORBID_ATTR: ["srcdoc"],
    }),
    copies: env.copies,
  };
}

/** Plain text of a selection inside rendered Markdown, with formulas turned back into LaTeX. */
export function quoteText(range: Range) {
  const start = range.commonAncestorContainer;
  const inside = (start instanceof Element ? start : start.parentElement)?.closest<HTMLElement>(
    "[data-tex]",
  );
  if (inside) return inside.classList.contains("formula") ? `$$${inside.dataset.tex}$$` : `$${inside.dataset.tex}$`;
  const probe = h("div", { class: "quote-probe" });
  probe.append(range.cloneContents());
  for (const el of probe.querySelectorAll(".code-head, .formula-actions")) el.remove();
  for (const el of probe.querySelectorAll<HTMLElement>("[data-tex]"))
    el.replaceWith(
      el.classList.contains("formula") ? `\n$$${el.dataset.tex}$$\n` : `$${el.dataset.tex}$`,
    );
  // innerText needs layout to turn blocks into line breaks.
  document.body.append(probe);
  const text = probe.innerText;
  probe.remove();
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

const loaders: Record<string, () => Promise<any>> = {
  javascript: () => import("highlight.js/lib/languages/javascript"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  python: () => import("highlight.js/lib/languages/python"),
  json: () => import("highlight.js/lib/languages/json"),
  bash: () => import("highlight.js/lib/languages/bash"),
  css: () => import("highlight.js/lib/languages/css"),
  xml: () => import("highlight.js/lib/languages/xml"),
  latex: () => import("highlight.js/lib/languages/latex"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  java: () => import("highlight.js/lib/languages/java"),
  go: () => import("highlight.js/lib/languages/go"),
  rust: () => import("highlight.js/lib/languages/rust"),
  sql: () => import("highlight.js/lib/languages/sql"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  diff: () => import("highlight.js/lib/languages/diff"),
};
const languageAliases: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  html: "xml",
  svg: "xml",
  vue: "xml",
  tex: "latex",
  "c++": "cpp",
  cc: "cpp",
  h: "c",
  rs: "rust",
  yml: "yaml",
  md: "markdown",
  patch: "diff",
};
async function highlight(container: HTMLElement) {
  const blocks = [
    ...container.querySelectorAll<HTMLElement>("pre code"),
  ].filter((e) => e.textContent!.length < 20000);
  for (const code of blocks) {
    const raw = code.className.match(/language-([\w+-]+)/)?.[1]?.toLowerCase();
    const lang = raw && (languageAliases[raw] || raw);
    if (!lang || !loaders[lang]) continue;
    const value = code.textContent || "";
    const [hl, module] = await Promise.all([
      import("highlight.js/lib/core"),
      loaders[lang](),
    ]);
    if (!code.isConnected || code.textContent !== value) continue;
    if (!hl.default.getLanguage(lang))
      hl.default.registerLanguage(lang, module.default);
    code.innerHTML = hl.default.highlight(value, { language: lang }).value;
  }
}

export const actionIcon = (name?: string): IconName =>
  isIcon(name) ? name : "sparkles";
export const formatSize = (bytes: number) =>
  bytes < 1024
    ? bytes + " B"
    : bytes < 1024 * 1024
      ? (bytes / 1024).toFixed(0) + " KB"
      : (bytes / 1024 / 1024).toFixed(1) + " MB";
const BUSY = new Set(["preparing", "searching", "connecting", "streaming"]);

function markdownBody() {
  const body = h("div", { class: "markdown" });
  let copies: string[] = [];
  body.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-copy]");
    if (!target || !body.contains(target)) return;
    const text = copies[Number(target.dataset.copy)];
    if (text === undefined) return;
    void copyText(
      target.dataset.delimiters ? `$$\n${text}\n$$` : text,
      target,
    );
  });
  const set = (source: string) => {
    const rendered = renderMarkdown(source);
    body.innerHTML = rendered.html;
    copies = rendered.copies;
    for (const b of body.querySelectorAll(".code-copy"))
      b.prepend(icon("copy", 13));
  };
  return { body, set };
}

export function attachmentChip(a: Attachment, onRemove?: () => void) {
  const chip = h("div", {
    class: "attachment" + (a.kind === "image" ? " is-image" : ""),
    title: `${a.name} · ${formatSize(a.size)}`,
  });
  if (a.kind === "image") {
    const src = `data:${a.mime};base64,${a.data}`;
    chip.append(
      h("img", {
        src,
        alt: a.name,
        onclick: () =>
          showDialog(a.name, h("img", { class: "image-full", src, alt: a.name }), {
            wide: true,
          }),
      }),
    );
  } else
    chip.append(
      h("span", { class: "attachment-icon" }, icon(a.kind === "pdf" ? "file" : "page", 16)),
      h(
        "span",
        { class: "attachment-meta" },
        h("span", { class: "attachment-name" }, a.name),
        h(
          "span",
          { class: "attachment-size" },
          (a.kind === "pdf" ? "PDF" : t("render.text")) + " · " + formatSize(a.size),
        ),
      ),
    );
  if (onRemove)
    chip.append(
      h(
        "button",
        {
          type: "button",
          class: "attachment-remove",
          title: t("common.remove"),
          "aria-label": t("render.removeAttachment", { name: a.name }),
          onclick: onRemove,
        },
        icon("x", 12),
      ),
    );
  return chip;
}

export interface ViewHooks {
  canRegenerate: (m: Message) => boolean;
  onRegenerate: () => void;
  onSource: (source: PageIdentity, snapshotId?: string) => void;
}
export interface MessageView {
  element: HTMLElement;
  update: (immediate?: boolean) => void;
  dispose: () => void;
}
export function messageView(message: Message, hooks: ViewHooks): MessageView {
  return message.role === "user"
    ? userView(message, hooks)
    : assistantView(message, hooks);
}

function userView(m: Message, hooks: ViewHooks): MessageView {
  const md = markdownBody();
  const bubble = h("div", { class: "bubble" });
  const files = messageAttachments(m);
  let showPrompt = false;
  const draw = () => {
    bubble.replaceChildren();
    if (m.display && !showPrompt) {
      bubble.classList.add("is-action");
      bubble.append(
        h(
          "div",
          { class: "bubble-action" },
          icon(actionIcon(m.display.icon), 14),
          m.display.action,
        ),
      );
      if (m.display.quote)
        bubble.append(h("blockquote", { class: "bubble-quote" }, m.display.quote));
    } else {
      bubble.classList.remove("is-action");
      md.set(messageText(m));
      bubble.append(md.body);
    }
    if (files.length)
      bubble.append(
        h("div", { class: "attachments" }, files.map((a) => attachmentChip(a))),
      );
  };
  draw();
  const foot = h("div", { class: "msg-foot" });
  const pages = [
    ...(m.source ? [{ source: m.source, snapshotId: m.snapshotId }] : []),
    ...(m.refs || []),
  ];
  for (const { source, snapshotId } of pages)
    foot.append(
      h(
        "button",
        {
          type: "button",
          class: "source-pill",
          title: t("render.viewSource") + "\n" + source.url,
          onclick: () => hooks.onSource(source, snapshotId),
        },
        h("img", { class: "favicon", src: faviconUrl(source.url), alt: "" }),
        h("span", null, source.title || hostOf(source.url)),
      ),
    );
  if (m.display) {
    const toggle: HTMLButtonElement = iconButton("code", t("render.showPrompt"), () => {
      showPrompt = !showPrompt;
      toggle.classList.toggle("active", showPrompt);
      draw();
    });
    foot.append(toggle);
  }
  foot.append(
    iconButton("copy", t("common.copy"), (event) =>
      void copyText(messageText(m), event.currentTarget as HTMLElement),
    ),
  );
  const element = h(
    "article",
    { class: "msg msg-user", dataset: { id: m.id } },
    bubble,
    foot,
  );
  return { element, update: () => {}, dispose: () => {} };
}

function toolSteps(m: Message) {
  const calls = m.parts.flatMap((p) => (p.type === "tool-call" ? [p.call] : []));
  return calls.map((call) => {
    let query = "";
    try {
      query = String(JSON.parse(call.arguments).query || "");
    } catch {
      query = call.arguments;
    }
    return h(
      "div",
      { class: "tool-step" },
      icon("search", 14),
      h("span", null, t("render.search")),
      h("span", { class: "tool-query" }, query),
    );
  });
}

const SOURCE_KIND: Record<Source["kind"], MessageKey> = {
  snippet: "render.kind.snippet",
  grounding: "render.kind.grounding",
  citation: "render.kind.citation",
};
export function usageTitle(u: Usage) {
  return [
    t("render.usage.input", { count: formatNumber(u.input) }) +
      (u.cached ? t("render.usage.cached", { count: formatNumber(u.cached) }) : ""),
    t("render.usage.output", { count: formatNumber(u.output) }) +
      (u.reasoning ? t("render.usage.reasoning", { count: formatNumber(u.reasoning) }) : ""),
  ].join("\n");
}
function sourceList(m: Message) {
  const list = (m.sources || []).filter((s) => /^https?:\/\//.test(s.url));
  if (!list.length) return null;
  const faces = [...new Set(list.map((s) => hostOf(s.url)))].slice(0, 4);
  return h(
    "details",
    { class: "sources" },
    h(
      "summary",
      null,
      h(
        "span",
        { class: "favicon-stack" },
        faces.map((host) =>
          h("img", { class: "favicon", src: faviconUrl("https://" + host), alt: "" }),
        ),
      ),
      h("span", null, t("render.sources", { count: list.length })),
      icon("chevronDown", 14),
    ),
    h(
      "div",
      { class: "source-list" },
      list.map((s, i) =>
        h(
          "a",
          {
            class: "source-card",
            href: s.url,
            target: "_blank",
            rel: "noopener noreferrer",
            title: s.snippet || s.url,
          },
          h("span", { class: "source-index" }, String(i + 1)),
          h(
            "span",
            { class: "source-text" },
            h("span", { class: "source-title" }, s.title),
            h(
              "span",
              { class: "source-host" },
              hostOf(s.url) + " · " + t(SOURCE_KIND[s.kind]),
            ),
          ),
        ),
      ),
    ),
  );
}

function groundingWidget(html: string) {
  const widget = h("iframe", {
    class: "grounding",
    title: t("render.groundingTitle"),
  });
  widget.sandbox.add("allow-popups", "allow-popups-to-escape-sandbox");
  widget.srcdoc =
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src https: data:\">" +
    DOMPurify.sanitize(html, {
      ADD_ATTR: ["target"],
      FORBID_TAGS: ["script", "iframe", "form"],
    });
  return widget;
}

function assistantView(m: Message, hooks: ViewHooks): MessageView {
  const md = markdownBody();
  const thinkingLabel = h("span", null, t("render.thinking"));
  const thinkingBody = h("div", { class: "thinking-body" });
  const summary = h(
    "summary",
    null,
    icon("bulb", 14),
    thinkingLabel,
    icon("chevronDown", 14),
  );
  const thinking = h("details", { class: "thinking" }, summary, thinkingBody);
  let touched = false;
  summary.addEventListener("click", () => (touched = true));
  const steps = h("div", { class: "tool-steps" });
  const typing = h("div", { class: "typing" }, h("i"), h("i"), h("i"));
  const extras = h("div", { class: "msg-extras" });
  const note = h("div", { class: "msg-note" });
  const foot = h("div", { class: "msg-foot" });
  const element = h(
    "article",
    { class: "msg msg-assistant", dataset: { id: m.id } },
    thinking,
    steps,
    typing,
    md.body,
    extras,
    note,
    foot,
  );
  let lastText: string | undefined,
    lastThought = "",
    lastCalls = "",
    lastExtras = "",
    lastNote = "",
    lastFoot = "",
    lastStatus = "",
    timer: ReturnType<typeof setTimeout> | undefined;
  const draw = () => {
    timer = undefined;
    const text = messageText(m);
    const busy = BUSY.has(m.status || "");
    element.classList.toggle("is-busy", busy);
    if (text !== lastText) {
      lastText = text;
      md.set(text);
    }
    md.body.hidden = !text;
    if (m.status === "complete" && lastStatus !== "complete")
      void highlight(md.body);
    lastStatus = m.status || "";

    const thoughts = m.parts
      .flatMap((p) => (p.type === "thought" ? [p.text] : []))
      .join("");
    thinking.hidden = !thoughts;
    if (thoughts !== lastThought) {
      lastThought = thoughts;
      thinkingBody.textContent = thoughts;
    }
    thinkingLabel.textContent = t(busy && !text ? "render.thinkingBusy" : "render.thinking");
    if (!touched) thinking.open = busy && !text && !!thoughts;

    const callKey = m.parts
      .flatMap((p) => (p.type === "tool-call" ? ["c" + p.call.arguments] : []))
      .join("\u0000");
    if (callKey !== lastCalls) {
      lastCalls = callKey;
      steps.replaceChildren(...toolSteps(m));
    }
    steps.hidden = !callKey;
    typing.hidden = !(busy && !text && !thoughts && !callKey);

    const extrasKey = JSON.stringify([m.sources, m.groundingHtml]);
    if (extrasKey !== lastExtras) {
      lastExtras = extrasKey;
      extras.replaceChildren();
      const list = sourceList(m);
      if (list) extras.append(list);
      if (m.groundingHtml) extras.append(groundingWidget(m.groundingHtml));
    }
    extras.hidden = !extras.childElementCount;

    const failed = ["failed", "timeout", "interrupted"].includes(m.status || "");
    const noteKey = [m.status, m.coverage, m.error, hooks.canRegenerate(m)].join("|");
    if (noteKey !== lastNote) {
      lastNote = noteKey;
      note.replaceChildren();
      if (m.status === "cancelled")
        note.append(
          h("div", { class: "note-line" }, icon("stop", 13), h("span", null, t("render.stopped"))),
        );
      else if (failed && m.error)
        note.append(
          h(
            "div",
            { class: "note-line is-error" },
            icon("alert", 14),
            h("span", null, m.error),
            hooks.canRegenerate(m)
              ? h(
                  "button",
                  { type: "button", class: "note-action", onclick: () => hooks.onRegenerate() },
                  icon("refresh", 13),
                  t("render.retry"),
                )
              : null,
          ),
        );
      if (m.coverage)
        note.append(
          h("div", { class: "note-line" }, icon("info", 13), h("span", null, m.coverage)),
        );
    }
    note.hidden = !note.childElementCount;

    const regenerate = hooks.canRegenerate(m);
    const footKey = [busy, regenerate, !!text, m.model, JSON.stringify(m.usage)].join("|");
    if (footKey !== lastFoot) {
      lastFoot = footKey;
      foot.replaceChildren();
      if (text)
        foot.append(
          iconButton("copy", t("render.copyMarkdown"), (event) =>
            void copyText(messageText(m), event.currentTarget as HTMLElement),
          ),
        );
      if (regenerate)
        foot.append(iconButton("refresh", t("render.regenerate"), () => hooks.onRegenerate()));
      if (m.model) foot.append(h("span", { class: "msg-model" }, m.model));
      if (m.usage)
        foot.append(
          h(
            "span",
            { class: "msg-usage", title: usageTitle(m.usage) },
            h("span", null, "↑" + compactNumber(m.usage.input)),
            h("span", null, "↓" + compactNumber(m.usage.output)),
          ),
        );
    }
    foot.hidden = busy || !foot.childElementCount || (!text && !regenerate);
  };
  const update = (immediate = false) => {
    if (immediate || m.status !== "streaming") {
      clearTimeout(timer);
      draw();
    } else if (!timer) timer = setTimeout(draw, 80);
  };
  update(true);
  return { element, update, dispose: () => clearTimeout(timer) };
}
