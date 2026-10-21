import {
  applyLocale,
  FLOAT_WIDTH_MAX,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from "./config";
import { getLocale, t } from "./i18n";
import { uid, type FloatSession, type Settings } from "./types";

// Loading settings once also sets the interface language for messages thrown before any handler reads them.
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
])
  .catch(() => {})
  .then(loadSettings);
// The float iframe may load through a dynamic web-accessible URL, so match the scheme, not the ID.
const trusted = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id && !!sender.url?.startsWith("chrome-extension://");

class Coded extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly data?: string,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------ setup
const SCRIPT_ID = "valise-selection";
const setupKey = (s: Settings) =>
  JSON.stringify([
    s.selectionEnabled,
    s.blockedSites,
    s.uiLanguage,
    s.actions.map((a) => [a.id, a.name]),
  ]);
async function setup() {
  const s = await loadSettings();
  await chrome.scripting
    .unregisterContentScripts({ ids: [SCRIPT_ID] })
    .catch(() => {});
  if (s.selectionEnabled) {
    const excludeMatches = s.blockedSites
      .filter((host) => /^[a-z0-9.-]+$/i.test(host))
      .flatMap((host) => [`*://${host}/*`, `*://*.${host}/*`]);
    await chrome.scripting
      .registerContentScripts([
        {
          id: SCRIPT_ID,
          matches: ["http://*/*", "https://*/*"],
          excludeMatches,
          js: ["content.js"],
          runAt: "document_idle",
        },
      ])
      .catch((error) => console.warn("Valise: could not register the selection script", error));
  }
  await chrome.contextMenus.removeAll();
  const menu = (options: chrome.contextMenus.CreateProperties) =>
    chrome.contextMenus.create(options, () => void chrome.runtime.lastError);
  menu({ id: "valise", title: "Valise", contexts: ["selection"] });
  for (const a of s.actions)
    menu({
      id: "action:" + a.id,
      parentId: "valise",
      title: a.name,
      contexts: ["selection"],
    });
  menu({ id: "panel", title: t("bg.openPanel"), contexts: ["page"] });
}
let chain: Promise<void> = Promise.resolve();
const sync = () => (chain = chain.catch(() => {}).then(setup));

chrome.runtime.onInstalled.addListener(() => {
  void ready.then(async () => {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await sync();
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes.settings;
  if (area !== "local" || !change) return;
  applyLocale(change.newValue);
  if (
    setupKey(normalizeSettings(change.oldValue)) !==
    setupKey(normalizeSettings(change.newValue))
  )
    void sync();
});

// ------------------------------------------------------------ entry points
async function selectionAction(
  tab: chrome.tabs.Tab | undefined,
  action: string | undefined,
  frameId = 0,
) {
  if (tab?.id === undefined) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      files: ["content.js"],
    });
    await chrome.tabs.sendMessage(
      tab.id,
      { type: "SELECTION_ACTION", action },
      { frameId },
    );
  } catch (error) {
    console.warn("Valise: could not run the selection action on this page", error);
  }
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === "panel") {
    if (tab?.id !== undefined) void chrome.sidePanel.open({ tabId: tab.id });
  } else if (id.startsWith("action:"))
    void selectionAction(tab, id.slice(7), info.frameId || 0);
});
chrome.commands.onCommand.addListener((name, tab) => {
  if (name === "ask-selection") void selectionAction(tab, undefined);
  else if (tab?.id !== undefined) void chrome.sidePanel.open({ tabId: tab.id });
});

// ------------------------------------------------------------ messages
type Floats = Record<string, FloatSession>;
const getFloats = async () =>
  ((await chrome.storage.session.get("floats")).floats as Floats) || {};

async function readPage(msg: {
  windowId?: number;
  tabId?: number;
  frameId?: number;
  documentId?: string;
}) {
  const tab =
    msg.tabId !== undefined
      ? await chrome.tabs.get(msg.tabId)
      : (
          await chrome.tabs.query(
            msg.windowId !== undefined
              ? { active: true, windowId: msg.windowId }
              : { active: true, lastFocusedWindow: true },
          )
        )[0];
  if (tab?.id === undefined) throw new Coded(t("bg.noTab"), "RESTRICTED");
  if (tab.discarded) throw new Coded(t("bg.discarded"), "STALE");
  const tabId = tab.id;
  const frameId = msg.frameId || 0;
  const frame = await chrome.webNavigation
    .getFrame({ tabId, frameId })
    .catch(() => null);
  const url = frame?.url || tab.url || "";
  if (/^https?:\/\/(?:chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url) || !/^https?:\/\//.test(url))
    throw new Coded(t("bg.restricted"), "RESTRICTED");
  if (/\.pdf(?:$|[?#])/i.test(url)) throw new Coded(t("bg.pdf"), "PDF", url);
  if (msg.documentId && frame && msg.documentId !== frame.documentId)
    throw new Coded(t("bg.navigated"), "STALE");
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["content.js"],
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/cannot be scripted|extensions gallery/i.test(text))
      throw new Coded(t("bg.protected"), "RESTRICTED");
    throw new Coded(t("bg.noAccess"), "NO_ACCESS", new URL(url).origin + "/*");
  }
  const data = await chrome.tabs.sendMessage(
    tabId,
    { type: "READ_DOM" },
    frame?.documentId ? { documentId: frame.documentId } : { frameId },
  );
  if (!data) throw new Coded(t("bg.noResponse"), "STALE");
  if (data.pdf) throw new Coded(t("bg.pdf"), "PDF", url);
  const after = await chrome.webNavigation
    .getFrame({ tabId, frameId })
    .catch(() => null);
  if (frame && (after?.documentId !== frame.documentId || after?.url !== data.url))
    throw new Coded(t("bg.changed"), "STALE");
  return { ...data, tabId, frameId, documentId: frame?.documentId || "" };
}

const handlers: Record<
  string,
  (msg: any, sender: chrome.runtime.MessageSender) => Promise<unknown>
> = {
  // Content-script entry points: only these accept untrusted page contexts.
  async CONTENT_PREFS(_msg, sender) {
    const s = await loadSettings();
    let host = "";
    try {
      host = new URL(sender.url || "").hostname;
    } catch {
      host = "";
    }
    return {
      enabled:
        s.selectionEnabled &&
        !s.blockedSites.some((b) => host === b || host.endsWith("." + b)),
      actions: s.actions.map(({ id, name, icon }) => ({ id, name, icon })),
      width: s.floatWidth,
      locale: getLocale(),
    };
  },
  async CREATE_FLOAT(msg, sender) {
    if (sender.tab?.id === undefined || trusted(sender))
      throw new Error(t("bg.badSource"));
    if (!msg.selection?.text || msg.selection.url !== sender.url)
      throw new Error(t("bg.staleSelection"));
    const s = await loadSettings();
    const action =
      s.actions.find((a) => a.id === msg.action) || s.actions[0];
    if (!action) throw new Error(t("bg.noActions"));
    const id = uid();
    const floats = await getFloats();
    for (const [key, value] of Object.entries(floats))
      if (Date.now() - value.createdAt > 600000 || value.tabId === sender.tab.id)
        delete floats[key];
    floats[id] = {
      id,
      windowId: sender.tab.windowId,
      tabId: sender.tab.id,
      frameId: sender.frameId || 0,
      documentId: sender.documentId || "",
      url: sender.url || "",
      title: sender.tab.title || "",
      selection: msg.selection,
      action,
      createdAt: Date.now(),
    };
    await chrome.storage.session.set({ floats });
    return { id };
  },
  /** Remembers the width the user dragged the float to; nothing else is writable from a page. */
  async FLOAT_WIDTH(msg, sender) {
    if (sender.tab?.id === undefined || !Number.isFinite(msg.width))
      throw new Error(t("bg.badWidth"));
    const s = await loadSettings();
    const width = Math.round(Math.max(320, Math.min(FLOAT_WIDTH_MAX, msg.width)) / 10) * 10;
    if (width !== s.floatWidth) await saveSettings({ ...s, floatWidth: width });
    return { ok: true };
  },
  // Extension-page entry points.
  async CLAIM_FLOAT(msg, sender) {
    const floats = await getFloats();
    const entry = floats[msg.id];
    if (!entry || sender.tab?.id !== entry.tabId || entry.claimed)
      throw new Error(t("bg.floatExpired"));
    const parent = await chrome.webNavigation.getFrame({
      tabId: entry.tabId,
      frameId: entry.frameId,
    });
    if (
      !parent ||
      (entry.documentId && parent.documentId !== entry.documentId) ||
      parent.url !== entry.url
    )
      throw new Error(t("bg.navigated"));
    entry.claimed = true;
    await chrome.storage.session.set({ floats });
    return entry;
  },
  async CLOSE_FLOAT(msg, sender) {
    const floats = await getFloats();
    const entry = floats[msg.id];
    if (entry && entry.tabId === sender.tab?.id) {
      await chrome.tabs
        .sendMessage(
          entry.tabId,
          { type: "CLOSE_FLOAT", id: msg.id },
          entry.documentId ? { documentId: entry.documentId } : { frameId: entry.frameId },
        )
        .catch(() => {});
      delete floats[msg.id];
      await chrome.storage.session.set({ floats });
    }
    return { ok: true };
  },
  async READ_PAGE(msg) {
    return readPage(msg);
  },
  async TRANSFER(msg) {
    await chrome.storage.session.set({ pendingConversation: msg.conversationId });
    await chrome.runtime
      .sendMessage({ type: "OPEN_CONVERSATION", id: msg.conversationId })
      .catch(() => {});
    return { ok: true };
  },
};
const PAGE_ALLOWED = new Set(["CONTENT_PREFS", "CREATE_FLOAT", "FLOAT_WIDTH"]);

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id || typeof msg?.type !== "string") return false;
  const handler = handlers[msg.type];
  if (!handler) return false;
  ready
    .then(() => {
      if (!PAGE_ALLOWED.has(msg.type) && !trusted(sender))
        throw new Error(t("bg.extensionOnly"));
      return handler(msg, sender);
    })
    .then(
      (data) => respond({ ok: true, data }),
      (error) =>
        respond({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          code: error instanceof Coded ? error.code : undefined,
          data: error instanceof Coded ? error.data : undefined,
        }),
    );
  return true;
});
