// Kept dependency-free apart from the inline icon builder: no extraction, network, or rendering code.
// Its two strings live here so the UI dictionaries are not injected into every page.
import type { Locale } from "./i18n";
import { icon, isIcon } from "./icons";

const TEXT: Record<Locale, { reload: string; frame: string }> = {
  en: {
    reload: "Valise was updated or reloaded. Refresh the page.",
    frame: "Valise selection popup",
  },
  "zh-CN": {
    reload: "扩展已更新或重新加载，请刷新页面。",
    frame: "Valise 划词问答",
  },
};

(() => {
  const global = window as Window & { __valise?: { dispose: () => void } };
  if (global.__valise) return;
  const life = new AbortController();
  const documentToken = crypto.randomUUID();
  type Selected = {
    text: string;
    paragraph: string;
    url: string;
    documentToken: string;
    capturedAt: number;
  };
  type Prefs = {
    enabled: boolean;
    width: number;
    actions: { id: string; name: string; icon?: string }[];
    locale: Locale;
  };
  let selected: Selected | undefined;
  let prefs: Prefs | undefined;
  let prefsAt = 0;
  let host: HTMLDivElement | undefined,
    shadow: ShadowRoot | undefined,
    toolbar: HTMLDivElement | undefined,
    box: HTMLDivElement | undefined,
    frame: HTMLIFrameElement | undefined,
    floatId = "",
    // Once the user sizes the float by hand, it stops following the answer's height.
    manual = false;

  const clean = () => {
    life.abort();
    host?.remove();
    chrome.runtime.onMessage.removeListener(onMessage);
    delete global.__valise;
  };
  global.__valise = { dispose: clean };
  const message = async (data: unknown) => {
    const r = await chrome.runtime.sendMessage(data);
    if (!r?.ok) throw new Error(r?.error || TEXT[prefs?.locale ?? "en"].reload);
    return r.data;
  };
  // Fetched on first use, so ordinary page loads never wake the service worker.
  async function loadPrefs() {
    if (prefs && Date.now() - prefsAt < 30000) return prefs;
    try {
      prefs = (await message({ type: "CONTENT_PREFS" })) as Prefs;
    } catch {
      prefs = { enabled: false, width: 460, actions: [], locale: prefs?.locale ?? "en" };
    }
    prefsAt = Date.now();
    return prefs;
  }

  const STYLE = `
:host{all:initial}
.toolbar{position:fixed;display:flex;align-items:center;gap:2px;padding:4px;border-radius:12px;
  background:rgba(28,28,32,.96);color:#f4f4f6;box-shadow:0 10px 30px rgba(0,0,0,.28),0 0 0 1px rgba(255,255,255,.08) inset;
  pointer-events:auto;font:500 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  backdrop-filter:blur(8px);animation:in .14s ease-out;white-space:nowrap}
.toolbar button{all:unset;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:8px;cursor:pointer;color:inherit}
.toolbar button:hover{background:rgba(255,255,255,.12)}
.toolbar button:focus-visible{outline:2px solid #8b8bf0;outline-offset:1px}
.toolbar .icon{opacity:.86;flex:none}
.toolbar .error{padding:6px 10px;max-width:320px;white-space:normal;line-height:1.5;color:#ffd1d1}
.float{position:fixed;pointer-events:auto;border-radius:14px;
  box-shadow:0 18px 50px rgba(0,0,0,.22),0 2px 10px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.08);
  transition:height .18s ease;animation:in .16s ease-out}
.float iframe{display:block;width:100%;height:100%;border:0;border-radius:14px;background:transparent;color-scheme:normal}
.float.resizing{transition:none}
.float.resizing iframe{pointer-events:none}
.grip{position:absolute;z-index:1;touch-action:none}
.n,.s{left:14px;right:14px;height:8px;cursor:ns-resize}
.e,.w{top:14px;bottom:14px;width:8px;cursor:ew-resize}
.n{top:-4px}.s{bottom:-4px}.e{right:-4px}.w{left:-4px}
.ne,.nw,.se,.sw{width:16px;height:16px}
.ne{top:-4px;right:-4px;cursor:nesw-resize}.sw{bottom:-4px;left:-4px;cursor:nesw-resize}
.nw{top:-4px;left:-4px;cursor:nwse-resize}.se{bottom:-4px;right:-4px;cursor:nwse-resize}
.se::after{content:"";position:absolute;right:7px;bottom:7px;width:7px;height:7px;border:solid rgba(128,128,128,.6);
  border-width:0 2px 2px 0;border-bottom-right-radius:4px;opacity:0;transition:opacity .15s}
.float:hover .se::after,.float.resizing .se::after{opacity:1}
@keyframes in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.toolbar,.float{animation:none;transition:none}}`;
  const MIN_W = 300,
    MIN_H = 160;

  function mount() {
    if (host) return;
    host = document.createElement("div");
    host.dataset.valiseRoot = "";
    host.style.cssText =
      "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646";
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.style.display = "none";
    shadow.append(style, toolbar);
    document.documentElement.append(host);
  }
  const hideToolbar = () => {
    if (toolbar) toolbar.style.display = "none";
  };
  function remember() {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!selection || !text || !selection.rangeCount) return undefined;
    const anchor =
      selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
    if (anchor?.closest('input,textarea,[contenteditable=""],[contenteditable="true"]'))
      return undefined;
    selected = {
      text,
      paragraph: (
        anchor?.closest("p,li,blockquote,td,pre,dd,figcaption")?.textContent || text
      ).trim(),
      url: location.href,
      documentToken,
      capturedAt: Date.now(),
    };
    return selection.getRangeAt(0).getBoundingClientRect();
  }
  function place(rect: DOMRect, el: HTMLElement, w: number, h: number, prefer: "above" | "below") {
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8));
    const above = rect.top - h - 10;
    const below = rect.bottom + 10;
    const top =
      prefer === "above"
        ? above >= 8
          ? above
          : Math.min(below, innerHeight - h - 8)
        : below + h <= innerHeight - 8
          ? below
          : Math.max(8, above);
    el.style.left = left + "px";
    el.style.top = Math.max(8, top) + "px";
  }
  async function open(action?: string) {
    if (!selected || selected.url !== location.href) return;
    const rect = window.getSelection()?.rangeCount
      ? window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      : new DOMRect(innerWidth / 2, 80, 0, 0);
    mount();
    hideToolbar();
    closeFloat();
    try {
      const { width, locale } = await loadPrefs();
      const result = await message({ type: "CREATE_FLOAT", action, selection: selected });
      floatId = result.id;
      frame = document.createElement("iframe");
      frame.title = TEXT[locale].frame;
      frame.allow = "clipboard-write";
      frame.src =
        chrome.runtime.getURL("floating.html") + "?session=" + encodeURIComponent(floatId);
      box = document.createElement("div");
      box.className = "float";
      box.append(frame);
      for (const dir of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
        const grip = document.createElement("div");
        grip.className = "grip " + dir;
        grip.addEventListener("pointerdown", (e) => startResize(e, grip, dir));
        box.append(grip);
      }
      const w = Math.min(width, innerWidth - 16);
      const h = Math.min(260, innerHeight - 16);
      box.style.width = w + "px";
      box.style.height = h + "px";
      shadow!.append(box);
      place(rect, box, w, Math.min(520, innerHeight * 0.7), "below");
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }
  function closeFloat() {
    box?.remove();
    box = frame = undefined;
    manual = false;
  }
  /** Edge and corner grips; the iframe ignores the pointer while dragging so moves keep reaching us. */
  function startResize(e: PointerEvent, grip: HTMLElement, dir: string) {
    if (!box || !e.isTrusted || e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const el = box;
    const start = el.getBoundingClientRect();
    const x = e.clientX,
      y = e.clientY;
    manual = true;
    el.classList.add("resizing");
    const move = (ev: PointerEvent) => {
      const width = Math.max(
        MIN_W,
        Math.min(
          innerWidth - 16,
          start.width + (dir.includes("e") ? ev.clientX - x : dir.includes("w") ? x - ev.clientX : 0),
        ),
      );
      const height = Math.max(
        MIN_H,
        Math.min(
          innerHeight - 16,
          start.height + (dir.includes("s") ? ev.clientY - y : dir.includes("n") ? y - ev.clientY : 0),
        ),
      );
      el.style.width = width + "px";
      el.style.height = height + "px";
      if (dir.includes("w")) el.style.left = start.right - width + "px";
      if (dir.includes("n")) el.style.top = start.bottom - height + "px";
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      el.classList.remove("resizing");
      reposition();
      const width = Math.round(el.offsetWidth);
      if (prefs) prefs.width = width;
      void message({ type: "FLOAT_WIDTH", width }).catch(() => {});
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }
  function showError(text: string) {
    mount();
    const box = document.createElement("div");
    box.className = "error";
    box.textContent = text;
    toolbar!.replaceChildren(box);
    toolbar!.style.display = "flex";
    place(new DOMRect(innerWidth / 2, 24, 0, 0), toolbar!, 320, 40, "below");
    setTimeout(hideToolbar, 4000);
  }
  async function show() {
    if (frame) return;
    const rect = remember();
    if (!rect || (!rect.width && !rect.height)) return hideToolbar();
    const p = await loadPrefs();
    if (!p.enabled || !p.actions.length || !window.getSelection()?.toString().trim())
      return hideToolbar();
    mount();
    toolbar!.replaceChildren(
      ...p.actions.map((a) => {
        const b = document.createElement("button");
        b.append(icon(isIcon(a.icon) ? a.icon : "sparkles", 15), a.name);
        b.title = a.name;
        b.onpointerdown = (e) => e.preventDefault();
        b.onclick = (e) => {
          if (e.isTrusted) void open(a.id);
        };
        return b;
      }),
    );
    toolbar!.style.display = "flex";
    place(rect, toolbar!, toolbar!.offsetWidth, toolbar!.offsetHeight, "above");
  }

  const on = <K extends keyof DocumentEventMap>(
    type: K,
    fn: (e: DocumentEventMap[K]) => void,
    options: AddEventListenerOptions = {},
  ) => document.addEventListener(type, fn, { ...options, signal: life.signal });
  on("pointerup", (e) => {
    if (!e.isTrusted || (host && e.composedPath().includes(host))) return;
    setTimeout(() => void show(), 0);
  });
  on("keyup", (e) => {
    if (!e.isTrusted) return;
    if (e.key === "Escape") hideToolbar();
    else if (e.key === "Shift" || e.key.startsWith("Arrow")) void show();
  });
  on("pointerdown", (e) => {
    if (!host || !e.composedPath().includes(host)) hideToolbar();
  });
  function reposition() {
    hideToolbar();
    if (!box) return;
    const left = Math.min(parseFloat(box.style.left), innerWidth - box.offsetWidth - 8);
    const top = Math.min(parseFloat(box.style.top), innerHeight - box.offsetHeight - 8);
    box.style.left = Math.max(8, left) + "px";
    box.style.top = Math.max(8, top) + "px";
  }
  addEventListener("scroll", hideToolbar, { passive: true, signal: life.signal });
  addEventListener("resize", reposition, { passive: true, signal: life.signal });
  addEventListener("pagehide", clean, { once: true, signal: life.signal });
  // The float (an extension page) asks its host to move or resize it.
  addEventListener(
    "message",
    (e) => {
      if (!box || !frame || e.source !== frame.contentWindow || e.origin !== new URL(frame.src).origin)
        return;
      const d = e.data as { type?: string; dx?: number; dy?: number; height?: number };
      if (d?.type === "valise:move" && Number.isFinite(d.dx) && Number.isFinite(d.dy)) {
        box.style.left = parseFloat(box.style.left) + d.dx! + "px";
        box.style.top = parseFloat(box.style.top) + d.dy! + "px";
        reposition();
      } else if (d?.type === "valise:resize" && Number.isFinite(d.height) && !manual) {
        const max = Math.min(640, innerHeight * 0.8);
        box.style.height = Math.round(Math.max(180, Math.min(d.height!, max))) + "px";
        reposition();
      }
    },
    { signal: life.signal },
  );

  function onMessage(
    msg: any,
    _sender: chrome.runtime.MessageSender,
    respond: (x: any) => void,
  ) {
    if (msg.type === "READ_DOM") {
      if (document.contentType === "application/pdf") {
        respond({ pdf: true, url: location.href, title: document.title });
        return;
      }
      // The live selection is the truth: a stale one must not pair with fresh page text.
      const live = remember();
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll(
          'script:not([type^="math/tex"]),style,link,noscript,[data-valise-root],img,video,audio,svg,canvas',
        )
        .forEach((x) => x.remove());
      respond({
        html: clone.outerHTML,
        title: document.title,
        url: location.href,
        documentToken,
        selection: live && selected?.url === location.href ? selected : undefined,
      });
    } else if (msg.type === "SELECTION_ACTION") {
      remember();
      void open(msg.action);
      respond({ ok: true });
    } else if (msg.type === "CLOSE_FLOAT" && msg.id === floatId) {
      closeFloat();
      respond({ ok: true });
    } else if (msg.type === "DISPOSE") {
      clean();
      respond({ ok: true });
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);
})();
