import { openDB, type DBSchema } from "idb";
import type { Conversation, PageSnapshot } from "./types";
interface Schema extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { updatedAt: number };
  };
  snapshots: {
    key: string;
    value: PageSnapshot;
    indexes: { capturedAt: number };
  };
}
let database: ReturnType<typeof openDB<Schema>> | undefined;
const db = () =>
  (database ??= openDB<Schema>("valise", 1, {
    upgrade(db) {
      db.createObjectStore("conversations", { keyPath: "id" }).createIndex(
        "updatedAt",
        "updatedAt",
      );
      db.createObjectStore("snapshots", { keyPath: "id" }).createIndex(
        "capturedAt",
        "capturedAt",
      );
    },
  }));
export async function saveConversation(c: Conversation) {
  await (await db()).put("conversations", structuredClone(c));
}
export async function getConversation(id: string) {
  return (await db()).get("conversations", id);
}
export async function listConversations(query = "", limit = 50, skip = 0) {
  const found: Pick<Conversation, "id" | "title" | "updatedAt">[] = [];
  const needle = query.toLowerCase();
  let matched = 0;
  let cursor = await (await db())
    .transaction("conversations")
    .store.index("updatedAt")
    .openCursor(null, "prev");
  while (cursor && found.length < limit) {
    const c = cursor.value;
    if (
      !needle ||
      (
        c.title +
        " " +
        c.messages
          .flatMap((m) => m.parts.flatMap((p) => ("text" in p ? [p.text] : [])))
          .join(" ")
      )
        .toLowerCase()
        .includes(needle)
    ) {
      if (matched++ >= skip)
        found.push({ id: c.id, title: c.title, updatedAt: c.updatedAt });
    }
    cursor = await cursor.continue();
  }
  return found;
}
export async function deleteConversation(id: string) {
  await (await db()).delete("conversations", id);
}
export async function saveSnapshot(s: PageSnapshot) {
  const database = await db();
  const tx = database.transaction("snapshots", "readwrite");
  await tx.store.put(s);
  const all = await tx.store.index("capturedAt").getAll();
  let size = all.reduce((n, x) => n + x.content.length * 2, 0);
  while (all.length > 20 || size > 10 * 1024 * 1024) {
    const old = all.shift()!;
    size -= old.content.length * 2;
    await tx.store.delete(old.id);
  }
  await tx.done;
}
export async function getSnapshot(id: string) {
  return (await db()).get("snapshots", id);
}
export async function clearSnapshots() {
  await (await db()).clear("snapshots");
}
export async function clearConversations() {
  await (await db()).clear("conversations");
}
export async function countConversations() {
  return (await db()).count("conversations");
}
