import { afterEach, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/config";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function setup(settings = defaultSettings(), uiLanguage = "zh-CN") {
  let listener!: (msg: any, sender: any, respond: (value: any) => void) => boolean;
  const event = { addListener: vi.fn() };
  const session: Record<string, unknown> = {};
  const getFrame = vi.fn(async () => ({ documentId: "doc", url: "https://a.com/x" }));
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        setAccessLevel: vi.fn(async () => {}),
        get: vi.fn(async () => ({ settings })),
      },
      session: {
        setAccessLevel: vi.fn(async () => {}),
        get: vi.fn(async (key: string) => ({ [key]: session[key] })),
        set: vi.fn(async (value: Record<string, unknown>) => Object.assign(session, value)),
      },
      onChanged: event,
    },
    runtime: {
      id: "ext",
      onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
      onInstalled: event,
    },
    i18n: { getUILanguage: () => uiLanguage },
    webNavigation: { getFrame },
    contextMenus: { onClicked: event },
    commands: { onCommand: event },
  });
  const call = async (msg: unknown, sender: unknown) => {
    await import("../src/background");
    return new Promise<any>((resolve) => listener(msg, sender, resolve));
  };
  return { call, getFrame };
}
const page = (url: string) => ({
  id: "ext",
  url,
  tab: { id: 5, windowId: 2, title: "Page" },
  frameId: 0,
  documentId: "doc",
});
const extensionPage = { id: "ext", url: "chrome-extension://dynamic/floating.html", tab: { id: 5 } };

it("hides the selection toolbar on blocked sites and their subdomains only", async () => {
  const settings = defaultSettings();
  settings.blockedSites = ["example.com"];
  const { call } = setup(settings);
  const blocked = await call({ type: "CONTENT_PREFS" }, page("https://docs.example.com/a"));
  expect(blocked.data.enabled).toBe(false);
  const open = await call({ type: "CONTENT_PREFS" }, page("https://notexample.com/a"));
  expect(open.data.enabled).toBe(true);
  expect(open.data.actions[0]).toEqual({ id: "explain", name: "解释", icon: "help" });
  expect(open.data.locale).toBe("zh-CN");
});

it("gives the content script the resolved interface language", async () => {
  const { call } = setup(defaultSettings(), "en-US");
  const prefs = await call({ type: "CONTENT_PREFS" }, page("https://a.com/x"));
  expect(prefs.data.locale).toBe("en");
  expect(prefs.data.actions[0].name).toBe("Explain");
  const refused = await call({ type: "READ_PAGE" }, page("https://evil.example/"));
  expect(refused.error).toContain("only available to extension pages");
});

it("refuses extension-only operations from page content scripts", async () => {
  const { call } = setup();
  const result = await call({ type: "READ_PAGE" }, page("https://evil.example/"));
  expect(result.ok).toBe(false);
  expect(result.error).toContain("仅供扩展页面");
});

it("binds a selection float to its source document and allows a single claim", async () => {
  const { call, getFrame } = setup();
  const selection = {
    text: "定义",
    paragraph: "段落",
    url: "https://a.com/x",
    documentToken: "t",
    capturedAt: 0,
  };
  const mismatched = await call(
    { type: "CREATE_FLOAT", action: "explain", selection: { ...selection, url: "https://b.com" } },
    page("https://a.com/x"),
  );
  expect(mismatched.ok).toBe(false);
  const created = await call(
    { type: "CREATE_FLOAT", action: "translate", selection },
    page("https://a.com/x"),
  );
  const claimed = await call({ type: "CLAIM_FLOAT", id: created.data.id }, extensionPage);
  expect(claimed.data.action.id).toBe("translate");
  expect(claimed.data.selection.text).toBe("定义");
  const again = await call({ type: "CLAIM_FLOAT", id: created.data.id }, extensionPage);
  expect(again.ok).toBe(false);

  getFrame.mockResolvedValueOnce({ documentId: "other", url: "https://a.com/x" });
  const second = await call({ type: "CREATE_FLOAT", action: "explain", selection }, page("https://a.com/x"));
  const navigated = await call({ type: "CLAIM_FLOAT", id: second.data.id }, extensionPage);
  expect(navigated.error).toContain("跳转");
});
