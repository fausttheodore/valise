import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import {
  saveConversation,
  listConversations,
  getConversation,
  saveSnapshot,
  getSnapshot,
  countConversations,
} from "../src/storage";
it("paginates metadata and loads full history only on demand", async () => {
  for (let i = 0; i < 4; i++)
    await saveConversation({
      id: "history" + i,
      title: "conversation" + i,
      updatedAt: i,
      contextMode: "none",
      searchMode: "off",
      messages: [
        {
          id: "m",
          role: "user",
          parts: [{ type: "text", text: "message" + i }],
          createdAt: i,
        },
      ],
    });
  const first = await listConversations("", 2);
  expect(first.map((c) => c.id)).toEqual(["history3", "history2"]);
  expect(first[0]).not.toHaveProperty("messages");
  expect((await listConversations("message1"))[0].id).toBe("history1");
  expect((await getConversation("history1"))?.messages).toHaveLength(1);
  expect((await listConversations("", 2, 2)).map((c) => c.id)).toEqual([
    "history1",
    "history0",
  ]);
  expect(await countConversations()).toBe(4);
});
it("evicts oldest snapshots without deleting conversation histories", async () => {
  for (let i = 0; i < 22; i++)
    await saveSnapshot({
      id: "s" + i,
      content: "body",
      tabId: 1,
      frameId: 0,
      documentId: "d",
      url: "https://example.com",
      title: "page",
      capturedAt: i,
      version: 1,
      status: "loaded",
      warnings: [],
    });
  expect(await getSnapshot("s0")).toBeUndefined();
  expect(await getSnapshot("s21")).toBeTruthy();
  expect(await getConversation("history1")).toBeTruthy();
});
