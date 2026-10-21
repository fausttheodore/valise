import { capabilities, redact, searchKeys, searchReady } from "./config";
import {
  attachContext,
  chunkText,
  contextBudget,
  contextText,
  estimateTokens,
  messageTokens,
  pageLabel,
  retrieve,
  trimHistory,
  type Reference,
} from "./context";
import { t } from "./i18n";
import { generate } from "./providers";
import { RequestScope } from "./request";
import { search } from "./search";
import { saveConversation, saveSnapshot } from "./storage";
import {
  uid,
  type Attachment,
  type Conversation,
  type Message,
  type MessageDisplay,
  type ModelResult,
  type PageIdentity,
  type PageSnapshot,
  type Profile,
  type RequestEvent,
  type Settings,
  type Source,
  type TabRef,
  type TaskMode,
} from "./types";

export interface TurnOptions {
  requestId: string;
  conversation: Conversation;
  profile: Profile;
  settings: Settings;
  question: string;
  task: TaskMode;
  searchQuery: string;
  scope: RequestScope;
  attachments?: Attachment[];
  display?: MessageDisplay;
  getPage: () => Promise<PageSnapshot | undefined>;
  /** Tabs referenced with @ and the reader for them (side panel only). */
  tabs?: TabRef[];
  readTab?: (tab: TabRef) => Promise<PageSnapshot>;
  onEvent: (e: RequestEvent) => void;
  onMessages: () => void;
}
const identity = (s: PageSnapshot): PageIdentity => ({
  tabId: s.tabId,
  frameId: s.frameId,
  documentId: s.documentId,
  url: s.url,
  title: s.title,
  version: s.version,
  capturedAt: s.capturedAt,
});
export async function runTurn(o: TurnOptions) {
  const { conversation: c, profile: p, scope } = o;
  const notify = (stage: RequestEvent["stage"], detail?: string) =>
    o.onEvent({ requestId: o.requestId, conversationId: c.id, stage, detail });
  let current: Message | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let write = Promise.resolve();
  const persist = () => {
    const copy = structuredClone(c);
    write = write.then(() => saveConversation(copy));
    return write;
  };
  const changed = () => {
    c.updatedAt = Date.now();
    o.onMessages();
    if (!saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        void persist().catch((error) => scope.abort(error));
      }, 2000);
  };
  const newAssistant = () => {
    current = {
      id: uid(),
      role: "assistant",
      parts: [{ type: "text", text: "" }],
      createdAt: Date.now(),
      profileId: p.id,
      provider: p.provider,
      model: p.model,
      status: "connecting",
    };
    c.messages.push(current);
    changed();
    return current;
  };
  let page: PageSnapshot | undefined;
  const system = c.systemPrompt ?? o.settings.systemPrompt;
  let calls = 0,
    searchRounds = 0;
  const call = async (
    messages: Message[],
    opts: { searchTool?: boolean; nativeSearch?: boolean } = {},
  ): Promise<ModelResult> => {
    scope.check();
    if (
      estimateTokens(system) +
        messages.reduce((n, m) => n + messageTokens(m), 0) +
        p.maxOutputTokens >
      p.contextTokens
    )
      throw new Error(t("runner.overBudget"));
    if (++calls > o.settings.maxCalls)
      throw new Error(t("runner.callLimit", { max: o.settings.maxCalls }));
    const m = current!;
    notify("connecting", calls > 1 ? t("runner.callN", { n: calls }) : undefined);
    m.status = "connecting";
    const result = await generate({
      profile: p,
      system,
      messages,
      scope,
      ...opts,
      onDelta: (text, thought) => {
        scope.check();
        m.status = "streaming";
        const part = m.parts.find((x) => x.type === "text")!;
        if (part.type === "text") part.text += text;
        if (thought) {
          let part = m.parts.find((x) => x.type === "thought");
          if (!part) {
            part = { type: "thought", text: "" };
            m.parts.push(part);
          }
          if (part.type === "thought") part.text += thought;
        }
        notify("streaming");
        changed();
      },
    });
    m.raw = result.raw;
    m.sources = result.sources;
    m.groundingHtml = result.groundingHtml;
    m.groundingMetadata = result.groundingMetadata;
    m.usage = result.usage;
    m.status = "complete";
    m.parts.push(
      ...result.calls.map((call) => ({ type: "tool-call" as const, call })),
    );
    if (["length", "MAX_TOKENS"].includes(result.finishReason || ""))
      m.coverage = t("runner.outputLimit");
    changed();
    return result;
  };
  try {
    notify("preparing", t("runner.checkingPage"));
    page = await scope.wait(o.getPage());
    scope.check();
    const reference = contextText(page, c.contextMode);
    const others = (o.tabs || []).filter((x) => x.tabId !== page?.tabId);
    if (others.length) notify("preparing", t("runner.readingTabs", { count: others.length }));
    const tabs = await scope.wait(
      Promise.all(
        others.map((tab) =>
          o.readTab!(tab)
            .then((snapshot) => {
              if (snapshot.status !== "loaded") throw new Error(t("runner.noText"));
              return snapshot;
            })
            .catch((error) => {
              throw new Error(
                t("runner.tabFailed", {
                  title: tab.title || tab.url,
                  error: error instanceof Error ? error.message : String(error),
                }),
              );
            }),
        ),
      ),
    );
    scope.check();
    const sections: Reference[] = [
      ...(reference ? [{ text: reference, page }] : []),
      ...tabs.map((tab) => ({ text: tab.content, page: tab })),
    ];
    const user: Message = {
      id: uid(),
      role: "user",
      parts: [
        { type: "text", text: o.question },
        ...(o.attachments || []).map((attachment) => ({
          type: "attachment" as const,
          attachment,
        })),
      ],
      display: o.display,
      createdAt: Date.now(),
      source: page ? identity(page) : undefined,
      snapshotId: page?.id,
      refs: tabs.length
        ? tabs.map((tab) => ({ source: identity(tab), snapshotId: tab.id }))
        : undefined,
    };
    for (const snapshot of page ? [page, ...tabs] : tabs)
      await scope.wait(saveSnapshot(snapshot));
    c.messages.push(user);
    if (c.messages.filter((x) => x.role === "user").length === 1)
      c.title = (
        o.display?.quote
          ? t("common.labelValue", { label: o.display.action, value: o.display.quote })
          : o.display
            ? o.display.action
            : o.question
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40);
    changed();
    await persist();
    const searchReserve =
      c.searchMode === "off"
        ? 0
        : Math.min(4000, Math.floor(p.contextTokens / 4));
    const messages = trimHistory(
      c.messages,
      p.contextTokens -
        p.maxOutputTokens -
        Math.ceil(system.length * 2) -
        searchReserve -
        1024 -
        Math.min(sections.length ? 3000 : 0, Math.floor(p.contextTokens / 4)),
    );
    const budget = contextBudget(p, system, messages, searchReserve);
    if (budget < 64) throw new Error(t("runner.noRoom"));
    if (messages.length < c.messages.length)
      notify(
        "preparing",
        t("runner.trimmed", {
          count: messages.filter((x) => x.role === "user").length,
        }),
      );
    let sources: Source[] = [];
    if (c.searchMode === "required") {
      notify("searching", t("runner.searching"));
      sources = await scope.wait(
        search(o.searchQuery || o.question, o.settings.search, scope),
      );
      searchRounds++;
    }
    const caps = capabilities(p);
    // "auto" prefers the model's own search; otherwise the model calls the configured search API.
    const native = c.searchMode === "auto" && caps.nativeSearch;
    if (c.searchMode === "auto" && !native) {
      if (!caps.tools) throw new Error(t("runner.noSearchCapability"));
      if (!searchReady(o.settings.search))
        throw new Error(t("runner.noSearchService"));
    }
    const sourceJSON = (found: Source[]) => {
      const copy = structuredClone(found);
      const limit = Math.floor(
        searchReserve / Math.max(1, o.settings.search.rounds),
      );
      while (copy.length && estimateTokens(JSON.stringify(copy)) > limit) {
        const last = copy.at(-1)!;
        if (last.snippet.length > 128)
          last.snippet =
            last.snippet.slice(0, Math.floor(last.snippet.length / 2)) + "…";
        else copy.pop();
      }
      return JSON.stringify(copy);
    };
    const answer = async (initial: Message[], coverage: string) => {
      const history =
        c.searchMode === "required"
          ? attachContext(initial, [{ text: sourceJSON(sources) }])
          : initial;
      while (true) {
        const m = newAssistant();
        m.coverage = coverage;
        const result = await call(history, {
          nativeSearch: native,
          searchTool:
            c.searchMode === "auto" &&
            !native &&
            searchRounds < o.settings.search.rounds,
        });
        m.sources = [...sources, ...result.sources];
        if (!result.calls.length) {
          if (c.searchMode === "auto" && !m.sources.length)
            m.coverage += t(native ? "runner.noNativeSources" : "runner.noSearchRun");
          changed();
          return result;
        }
        history.push(m);
        for (const tool of result.calls) {
          if (tool.name !== "web_search")
            throw new Error(t("runner.unknownTool", { name: tool.name }));
          if (++searchRounds > o.settings.search.rounds)
            throw new Error(t("runner.searchLimit"));
          let args: { query: string };
          try {
            args = JSON.parse(tool.arguments);
          } catch {
            throw new Error(t("runner.badSearchArgs"));
          }
          if (
            typeof args.query !== "string" ||
            Object.keys(args).some((k) => k !== "query")
          )
            throw new Error(t("runner.badSearchQuery"));
          notify("searching", args.query);
          const found = await scope.wait(
            search(args.query, o.settings.search, scope),
          );
          sources.push(...found);
          const tm: Message = {
            id: uid(),
            role: "tool",
            parts: [
              {
                type: "tool-result",
                id: tool.id,
                providerId: tool.providerId,
                name: tool.name,
                text: sourceJSON(found),
              },
            ],
            createdAt: Date.now(),
            provider: p.provider,
            profileId: p.id,
            model: p.model,
          };
          c.messages.push(tm);
          history.push(tm);
          changed();
        }
      }
    };
    if (o.task !== "question" && sections.length) {
      // Several pages are chunked as one text; each keeps its own source label inline.
      const single = sections.length === 1 ? sections[0].page : undefined;
      const whole = single
        ? sections[0].text
        : sections.map((s) => pageLabel(s.page!) + s.text).join("\n\n");
      const chunks = chunkText(whole, budget - 256);
      const outputs: string[] = [];
      let incomplete = 0;
      const task = t(o.task === "translate" ? "runner.taskTranslate" : "runner.taskSummarize");
      const total = chunks.length;
      const allDone = () =>
        t("runner.allProcessed", { total }) +
        (incomplete ? t("runner.someIncomplete", { count: incomplete }) : "");
      for (let index = 0; index < chunks.length; index++) {
        const progress = t("runner.progress", {
          task,
          index: index + 1,
          total,
          rest: total - index - 1,
        });
        if (calls >= o.settings.maxCalls) {
          const m = newAssistant();
          m.coverage = t("runner.partial", { done: index, total, rest: total - index });
          throw new Error(t("runner.chunkLimit"));
        }
        const query: Message = {
          ...user,
          parts: [
            {
              type: "text",
              text: `${o.question}\n这是全文第 ${index + 1}/${chunks.length} 段。${o.task === "translate" ? "完整翻译本段，保留结构，不省略正文。" : "总结本段，保留关键事实、定义及论证。"}`,
            },
          ],
        };
        const result = await answer(
          attachContext([query], [{ text: chunks[index], page: single }]),
          progress,
        );
        outputs.push(result.text);
        if (["length", "MAX_TOKENS"].includes(result.finishReason || "")) {
          incomplete++;
          current!.coverage = progress + t("runner.partTruncated");
        } else current!.coverage = t("runner.processed", { task, done: index + 1, total });
      }
      if (o.task === "summarize" && outputs.length > 1) {
        const combined = outputs
          .map((x, i) => `第 ${i + 1} 段：\n${x}`)
          .join("\n\n");
        if (
          calls < o.settings.maxCalls &&
          contextBudget(p, system, [user], searchReserve) >
            estimateTokens(combined) + 256
        ) {
          const result = await answer(
            attachContext(
              [
                {
                  ...user,
                  parts: [
                    {
                      type: "text",
                      text: "依据以下分段摘要，给出综合总结。保留关键结论与限制。",
                    },
                  ],
                },
              ],
              [{ text: combined, page: single }],
            ),
            allDone(),
          );
          if (["length", "MAX_TOKENS"].includes(result.finishReason || ""))
            incomplete++;
        } else {
          const m = newAssistant();
          m.parts = [{ type: "text", text: t("runner.noCombined") }];
          m.status = "complete";
          m.coverage = allDone();
        }
      }
      notify(
        "complete",
        t("runner.done", { total }) +
          (incomplete ? t("runner.doneIncomplete", { count: incomplete }) : ""),
      );
      return;
    }
    // Pages that don't fit share the budget in proportion to their size; each overflowing
    // page is narrowed to its most relevant fragments on its own.
    const total = sections.reduce((n, s) => n + estimateTokens(s.text), 0);
    const notes: string[] = [];
    const fitted = sections.map((s) => {
      const share =
        sections.length === 1
          ? budget
          : Math.max(256, Math.floor((budget * estimateTokens(s.text)) / total));
      if (chunkText(s.text, share).length <= 1) return s;
      const selected = retrieve(
        s.text,
        o.question + " " + (page?.selection?.text || ""),
        share,
      );
      notes.push(
        sections.length === 1
          ? selected.coverage
          : t("runner.pageCoverage", { title: s.page?.title || "", coverage: selected.coverage }),
      );
      return { ...s, text: selected.content };
    });
    const separator = t("common.separator");
    const coverage = !sections.length
      ? t("runner.noPage")
      : sections.length === 1
        ? notes[0] || t("runner.fullPage")
        : t("runner.pages", { count: sections.length }) +
          (notes.length ? separator + notes.join(separator) : t("runner.allFull"));
    await answer(attachContext(messages, fitted), coverage);
    notify("complete");
  } catch (error) {
    const reason = scope.signal.aborted ? scope.signal.reason : error;
    const stage =
      reason?.name === "TimeoutError"
        ? "timeout"
        : reason?.name === "AbortError"
          ? "cancelled"
          : "failed";
    const detail = redact(
      reason instanceof Error ? reason.message : String(reason),
      [p.apiKey, ...searchKeys(o.settings.search)],
    );
    if (current) {
      current.status = stage;
      current.error = detail;
      changed();
    }
    notify(stage, detail);
  } finally {
    scope.dispose();
    clearTimeout(saveTimer);
    await write;
    await saveConversation(c);
    o.onMessages();
  }
}
