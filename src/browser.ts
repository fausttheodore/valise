import { uid, type PageSnapshot, type SelectionSnapshot } from "./types";

/** Background errors keep a machine-readable code so the UI can offer a precise fix. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly data?: string,
  ) {
    super(message);
  }
}
export async function send<T = any>(data: unknown): Promise<T> {
  const result = await chrome.runtime.sendMessage(data);
  if (!result?.ok)
    throw new AppError(
      result?.error || "扩展后台连接已中断，请重新打开侧栏。",
      result?.code,
      result?.data,
    );
  return result.data;
}
export interface PageTarget {
  windowId?: number;
  tabId?: number;
  frameId?: number;
  documentId?: string;
  selection?: SelectionSnapshot;
}
export async function readPage(target: PageTarget = {}): Promise<PageSnapshot> {
  const raw = await send({
    type: "READ_PAGE",
    windowId: target.windowId,
    tabId: target.tabId,
    frameId: target.frameId,
    documentId: target.documentId,
  });
  const identity = {
    id: uid(),
    tabId: raw.tabId,
    frameId: raw.frameId,
    documentId: raw.documentId,
    url: raw.url,
    title: raw.title,
    version: Date.now(),
    capturedAt: Date.now(),
  };
  let selection = target.selection || raw.selection;
  if (
    selection &&
    (selection.url !== raw.url || selection.documentToken !== raw.documentToken)
  )
    selection = undefined;
  const { extractHtml } = await import("./extract");
  const parsed = extractHtml(raw.html, raw.url);
  return {
    ...identity,
    ...parsed,
    selection,
    status: parsed.content ? "loaded" : "empty",
  };
}
export async function activeTab(windowId?: number) {
  const [tab] = await chrome.tabs.query(
    windowId === undefined
      ? { active: true, lastFocusedWindow: true }
      : { active: true, windowId },
  );
  return tab;
}
export function faviconUrl(pageUrl: string, size = 32) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(size));
  return url.toString();
}
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
export const isPdfUrl = (url = "") => /^https?:.*\.pdf(?:$|[?#])/i.test(url);
export const openOptions = () => void chrome.runtime.openOptionsPage();
