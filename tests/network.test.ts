// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from "vitest";
// @ts-expect-error This fixture is also a directly executable Node server.
import { createMockServer } from "./mock-server.mjs";
import { defaultProfile, defaultSettings } from "../src/config";
import { generate } from "../src/providers";
import { search } from "../src/search";
import { RequestScope } from "../src/request";
let mock: any;
beforeAll(async () => {
  mock = await createMockServer();
});
afterAll(async () => {
  await mock.close();
});
async function run(
  model: string,
  provider: "openai" | "gemini" = "openai",
  configure?: (s: RequestScope) => void,
) {
  const p = {
    ...defaultProfile(),
    provider,
    model,
    apiKey: "mock-one",
    baseUrl: mock.baseUrl + (provider === "gemini" ? "/v1beta" : "/v1"),
    timeouts: { first: 1, idle: 0.1, total: 10 },
  };
  const scope = new RequestScope(p.timeouts);
  p.timeouts.idle = 1;
  const deltas: string[] = [];
  configure?.(scope);
  try {
    return await generate({
      profile: p,
      system: "test",
      messages: [
        {
          id: "user",
          role: "user",
          parts: [{ type: "text", text: "test" }],
          createdAt: Date.now(),
        },
      ],
      scope,
      onDelta: (t) => deltas.push(t),
    });
  } finally {
    scope.dispose();
  }
}
describe("real HTTP mock streaming", () => {
  it("decodes bytewise UTF-8 and emits deltas without duplicate completion", async () => {
    const p = {
      ...defaultProfile(),
      model: "mock-bytewise",
      apiKey: "mock-a",
      baseUrl: mock.baseUrl + "/v1",
    };
    const scope = new RequestScope({ first: 2, idle: 2, total: 20 });
    let count = 0;
    try {
      const result = await generate({
        profile: p,
        system: "test",
        messages: [],
        scope,
        onDelta: () => count++,
      });
      expect(result.text).toContain("紫杉系数");
      expect(result.text).not.toContain("�");
      expect(count).toBeGreaterThan(5);
    } finally {
      scope.dispose();
    }
  }, 20000);
  it("uses a second independent credential", async () => {
    await run("mock-normal");
    expect(mock.records.at(-1).auth).toBe("Bearer mock-one");
  });
  it("preserves Gemini public thought parts and signatures", async () => {
    const result = await run("mock-normal", "gemini");
    expect(result.thought).toContain("公开");
    expect(JSON.stringify(result.raw)).toContain("mock-signature");
  });
  it("collects streamed tool arguments structurally", async () => {
    const result = await run("mock-tools");
    expect(result.calls[0]).toEqual({
      id: "call_mock",
      name: "web_search",
      arguments: '{"query":"紫杉系数"}',
    });
  });
  it.each([
    "mock-401",
    "mock-429",
    "mock-500",
    "mock-bad-json",
    "mock-error-frame",
    "mock-disconnect",
  ])("reports %s without automatic replay", async (model) => {
    const before = mock.records.length;
    await expect(run(model)).rejects.toThrow();
    expect(mock.records.length - before).toBe(1);
  });
  it("aborts the real client connection well within one second", async () => {
    const before = mock.aborted,
      start = Date.now();
    await expect(
      run("mock-slow", "openai", (s) => setTimeout(() => s.abort(), 40)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - start).toBeLessThan(1000);
    await new Promise((r) => setTimeout(r, 40));
    expect(mock.aborted).toBeGreaterThan(before);
  });
  it("times out a stream that never finishes", async () => {
    await expect(run("mock-idle")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  }, 5000);
  it("performs an independent search and labels snippets", async () => {
    const scope = new RequestScope({ first: 1, idle: 1, total: 3 });
    try {
      const r = await search(
        "紫杉系数",
        {
          ...defaultSettings().search,
          services: {
            ...defaultSettings().search.services,
            tavily: { baseUrl: mock.baseUrl, apiKey: "mock-search" },
          },
        },
        scope,
      );
      expect(r[0].kind).toBe("snippet");
      expect(mock.records.at(-1).body.query).toBe("紫杉系数");
      expect(mock.records.at(-1).body.include_raw_content).toBe(false);
    } finally {
      scope.dispose();
    }
  });
});
