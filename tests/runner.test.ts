import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { defaultProfile, defaultSettings } from "../src/config";
import { runTurn } from "../src/runner";
import { RequestScope } from "../src/request";
import {
  messageText,
  type Conversation,
  type PageSnapshot,
  type Profile,
} from "../src/types";
import { buildRequest } from "../src/providers";
const mock = vi.hoisted(() => ({
  generate: vi.fn(),
  search: vi.fn(),
  save: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("../src/providers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generate: mock.generate,
}));
vi.mock("../src/search", () => ({ search: mock.search }));
vi.mock("../src/storage", () => ({
  saveConversation: mock.save,
  saveSnapshot: mock.snapshot,
}));
const active: RequestScope[] = [];
const profile = (): Profile => ({
  ...defaultProfile(),
  model: "mock",
  baseUrl: "http://127.0.0.1/v1",
  contextTokens: 8192,
  maxOutputTokens: 1024,
  capabilities: { tools: true },
});
const result = (text = "回答", calls: any[] = []) => ({
  text,
  thought: "",
  calls,
  raw: { role: "assistant", content: text },
  sources: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  mock.save.mockResolvedValue(undefined);
  mock.snapshot.mockResolvedValue(undefined);
  mock.search.mockResolvedValue([
    {
      title: "source",
      url: "https://example.com",
      snippet: "search evidence",
      kind: "snippet",
    },
  ]);
  mock.generate.mockImplementation(async (input) => {
    input.onDelta("回答", "");
    return result();
  });
});
afterEach(() => active.splice(0).forEach((s) => s.dispose()));
function setup() {
  const p = profile(),
    settings = defaultSettings();
  settings.profiles = [p];
  settings.search.services.tavily = { apiKey: "mock", baseUrl: "http://127.0.0.1" };
  const c: Conversation = {
    id: crypto.randomUUID(),
    title: "new",
    messages: [],
    updatedAt: 0,
    contextMode: "none",
    searchMode: "off",
  };
  const scope = new RequestScope(p.timeouts);
  active.push(scope);
  const events: any[] = [];
  return {
    requestId: crypto.randomUUID(),
    conversation: c,
    profile: p,
    settings,
    question: "测试",
    task: "question" as const,
    searchQuery: "检索词",
    scope,
    getPage: async () => undefined as PageSnapshot | undefined,
    onEvent: (e: any) => events.push(e),
    onMessages: () => {},
    events,
  };
}
describe("turn lifecycle, budget and search", () => {
  it("saves output only into its captured conversation", async () => {
    const o = setup(),
      other = setup();
    await runTurn(o);
    expect(other.conversation.messages).toHaveLength(0);
    expect(o.conversation.messages.map(messageText)).toEqual(["测试", "回答"]);
    expect(
      mock.save.mock.calls.every(([c]) => c.id === o.conversation.id),
    ).toBe(true);
  });
  it("executes independent search before paid generation, including full-page jobs", async () => {
    const o = setup();
    o.conversation.contextMode = "page";
    o.conversation.searchMode = "required";
    o.getPage = async () => ({
      id: "page",
      tabId: 1,
      frameId: 0,
      documentId: "d",
      url: "https://example.com",
      title: "page",
      capturedAt: 0,
      version: 1,
      content: "完整的文内定义。".repeat(100),
      status: "loaded",
      warnings: [],
    });
    await runTurn({ ...o, task: "translate" });
    expect(mock.search).toHaveBeenCalledTimes(1);
    expect(mock.search.mock.invocationCallOrder[0]).toBeLessThan(
      mock.generate.mock.invocationCallOrder[0],
    );
    expect(JSON.stringify(mock.generate.mock.calls[0][0].messages)).toContain(
      "search evidence",
    );
  });
  it("preserves well-formed tool result JSON and limits searches", async () => {
    const o = setup();
    o.conversation.searchMode = "auto";
    mock.generate.mockImplementationOnce(async () =>
      result("", [
        { id: "call1", name: "web_search", arguments: '{"query":"test"}' },
      ]),
    );
    mock.search.mockResolvedValue([
      {
        title: "source",
        url: "https://example.com",
        snippet: "长结果".repeat(4000),
        kind: "snippet",
      },
    ]);
    await runTurn(o);
    expect(mock.generate).toHaveBeenCalledTimes(2);
    const tool = o.conversation.messages.find((m) => m.role === "tool")!;
    const part = tool.parts[0];
    expect(part.type).toBe("tool-result");
    if (part.type === "tool-result")
      expect(() => JSON.parse(part.text)).not.toThrow();
    expect(o.events.at(-1).stage).toBe("complete");
  });
  it("rejects undefined tools instead of executing arbitrary requests", async () => {
    const o = setup();
    o.conversation.searchMode = "auto";
    mock.generate.mockResolvedValueOnce(
      result("", [{ id: "x", name: "fetch_any_url", arguments: "{}" }]),
    );
    await runTurn(o);
    expect(mock.search).not.toHaveBeenCalled();
    expect(o.events.at(-1).detail).toContain("不支持的工具");
  });
  it("reports remaining chunks when the configured call limit is reached", async () => {
    const o = setup();
    o.settings.maxCalls = 2;
    o.conversation.contextMode = "page";
    o.getPage = async () => ({
      id: "page",
      tabId: 1,
      frameId: 0,
      documentId: "d",
      url: "https://example.com",
      title: "page",
      capturedAt: 0,
      version: 1,
      content: Array.from(
        { length: 20 },
        (_, i) => `第 ${i} 段：` + "阅读正文".repeat(500),
      ).join("\n\n"),
      status: "loaded",
      warnings: [],
    });
    await runTurn({ ...o, task: "translate" });
    expect(mock.generate).toHaveBeenCalledTimes(2);
    expect(o.conversation.messages.at(-1)?.coverage).toContain("未处理");
    expect(o.events.at(-1).stage).toBe("failed");
  });
  it("retains partial content on cancellation and prevents a late token from being written", async () => {
    const o = setup();
    let emit: ((t: string, s: string) => void) | undefined;
    mock.generate.mockImplementationOnce(async (input) => {
      emit = input.onDelta;
      input.onDelta("部分", "");
      o.scope.abort();
      return input.scope.wait(new Promise(() => {}));
    });
    await runTurn(o);
    expect(messageText(o.conversation.messages.at(-1)!)).toBe("部分");
    expect(o.conversation.messages.at(-1)?.status).toBe("cancelled");
    expect(() => emit!("迟到", "")).toThrow();
    expect(messageText(o.conversation.messages.at(-1)!)).toBe("部分");
  });
  it("does not call providers when extraction fails", async () => {
    const o = setup();
    o.getPage = async () => {
      throw new Error("页面已导航");
    };
    await runTurn(o);
    expect(mock.generate).not.toHaveBeenCalled();
    expect(o.events.at(-1).detail).toContain("导航");
  });
  it("reads @-referenced tabs alongside the current page and labels each source", async () => {
    const o = setup();
    o.conversation.contextMode = "page";
    const snap = (tabId: number, title: string, content: string): PageSnapshot => ({
      id: "snap" + tabId,
      tabId,
      frameId: 0,
      documentId: "d" + tabId,
      url: `https://example.com/${tabId}`,
      title,
      capturedAt: 0,
      version: 1,
      content,
      status: "loaded",
      warnings: [],
    });
    o.getPage = async () => snap(1, "当前页", "CURRENT_BODY");
    const readTab = vi.fn(async (t: { tabId: number }) =>
      snap(t.tabId, "页面" + t.tabId, "BODY_" + t.tabId),
    );
    await runTurn({
      ...o,
      tabs: [
        { tabId: 1, title: "当前页", url: "https://example.com/1" },
        { tabId: 2, title: "页面2", url: "https://example.com/2" },
      ],
      readTab,
    });
    // The current page is not read twice.
    expect(readTab).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(mock.generate.mock.calls[0][0].messages);
    expect(sent).toContain("CURRENT_BODY");
    expect(sent).toContain("BODY_2");
    expect(sent).toContain("https://example.com/2");
    const user = o.conversation.messages.find((m) => m.role === "user")!;
    expect(user.refs?.map((r) => r.snapshotId)).toEqual(["snap2"]);
    expect(o.conversation.messages.at(-1)?.coverage).toContain("引用 2 个网页");
  });
  it("stops before generating when a referenced tab cannot be read", async () => {
    const o = setup();
    await runTurn({
      ...o,
      tabs: [{ tabId: 9, title: "休眠页", url: "https://example.com/9" }],
      readTab: async () => {
        throw new Error("已休眠");
      },
    });
    expect(mock.generate).not.toHaveBeenCalled();
    expect(o.events.at(-1).detail).toContain("休眠页");
  });
  it("retains output-limit caveats in full-document completion", async () => {
    const o = setup();
    o.conversation.contextMode = "page";
    o.getPage = async () => ({
      id: "page",
      tabId: 1,
      frameId: 0,
      documentId: "d",
      url: "https://example.com",
      title: "page",
      capturedAt: 0,
      version: 1,
      content: "正文",
      status: "loaded",
      warnings: [],
    });
    mock.generate.mockResolvedValueOnce({
      ...result(),
      finishReason: "length",
    });
    await runTurn({ ...o, task: "translate" });
    expect(o.conversation.messages.at(-1)?.coverage).toContain("未完整");
    expect(o.events.at(-1).detail).toContain("达到上限");
  });
});
describe("portable protocol history", () => {
  it("converts foreign tool data into ordinary user content without altering originals", () => {
    const o = setup();
    const old = {
      id: "tool",
      role: "tool" as const,
      parts: [
        {
          type: "tool-result" as const,
          id: "call",
          name: "web_search",
          text: '{"value":1}',
        },
      ],
      createdAt: 0,
      provider: "gemini" as const,
      model: "old",
      profileId: "old",
    };
    const before = structuredClone(old);
    const req = buildRequest({
      profile: o.profile,
      system: "s",
      messages: [old],
      scope: o.scope,
      onDelta: () => {},
    });
    expect((req.body.messages as any[])[1].role).toBe("user");
    const gemini = { ...o.profile, provider: "gemini" as const };
    const req2 = buildRequest({
      profile: gemini,
      system: "s",
      messages: [old],
      scope: o.scope,
      onDelta: () => {},
    });
    expect((req2.body.contents as any[])[0].parts[0]).toHaveProperty("text");
    expect(old).toEqual(before);
  });
});
