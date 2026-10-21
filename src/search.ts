import { redact, searchKeys, searchMeta } from "./config";
import { t } from "./i18n";
import { RequestScope } from "./request";
import type { SearchProviderId, Settings, Source } from "./types";

type Hit = { title?: unknown; url?: unknown; snippet?: unknown };
interface Adapter {
  request(
    base: string,
    query: string,
    count: number,
    key: string,
    chars: number,
  ): { url: string; init: RequestInit };
  hits(data: any): Hit[] | undefined;
}
const json = (body: unknown, headers: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const bearer = (key: string): Record<string, string> =>
  key ? { Authorization: `Bearer ${key}` } : {};

const ADAPTERS: Record<SearchProviderId, Adapter> = {
  tavily: {
    request: (base, query, count, key) => ({
      url: base + "/search",
      init: json(
        {
          query,
          search_depth: "basic",
          max_results: count,
          include_answer: false,
          include_raw_content: false,
        },
        bearer(key),
      ),
    }),
    hits: (d) =>
      d.results?.map((r: any) => ({ title: r.title, url: r.url, snippet: r.content })),
  },
  exa: {
    request: (base, query, count, key, chars) => ({
      url: base + "/search",
      init: json(
        {
          query,
          type: "auto",
          numResults: count,
          contents: { highlights: { maxCharacters: chars } },
        },
        { "x-api-key": key },
      ),
    }),
    hits: (d) =>
      d.results?.map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: (r.highlights || []).join(" … ") || r.summary || r.text,
      })),
  },
  brave: {
    request: (base, query, count, key) => ({
      url: `${base}/web/search?${new URLSearchParams({ q: query, count: String(Math.min(count, 20)) })}`,
      init: { headers: { Accept: "application/json", "X-Subscription-Token": key } },
    }),
    hits: (d) =>
      d.web?.results?.map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: [r.description, ...(r.extra_snippets || [])].join(" "),
      })) ?? [],
  },
  jina: {
    request: (base, query, _count, key) => ({
      url: `${base}/?${new URLSearchParams({ q: query })}`,
      init: {
        headers: {
          Accept: "application/json",
          "X-Respond-With": "no-content",
          ...bearer(key),
        },
      },
    }),
    hits: (d) =>
      d.data?.map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: r.description || r.content,
      })),
  },
  bocha: {
    request: (base, query, count, key) => ({
      url: base + "/web-search",
      init: json({ query, count, summary: true }, bearer(key)),
    }),
    hits: (d) =>
      d.data?.webPages?.value?.map((r: any) => ({
        title: r.name,
        url: r.url,
        snippet: r.summary || r.snippet,
      })) ?? (d.data ? [] : undefined),
  },
  searxng: {
    request: (base, query, _count, key) => ({
      url: `${base}/search?${new URLSearchParams({ q: query, format: "json" })}`,
      init: { headers: { Accept: "application/json", ...bearer(key) } },
    }),
    hits: (d) =>
      d.results?.map((r: any) => ({ title: r.title, url: r.url, snippet: r.content })),
  },
};
const plain = (value: unknown) =>
  String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

export async function search(
  query: string,
  settings: Settings["search"],
  scope: RequestScope,
): Promise<Source[]> {
  const meta = searchMeta(settings.provider);
  const { baseUrl, apiKey } = settings.services[settings.provider];
  if (!baseUrl) throw new Error(t("search.noUrl", { name: meta.name }));
  if (meta.keyRequired && !apiKey)
    throw new Error(t("search.noKey", { name: meta.name }));
  if (!query.trim() || query.length > 1500) throw new Error(t("search.badQuery"));
  const child = new AbortController();
  const timer = setTimeout(
    () => child.abort(new Error(t("search.timeout"))),
    settings.timeout * 1000,
  );
  const combined = AbortSignal.any([scope.signal, child.signal]);
  const adapter = ADAPTERS[settings.provider];
  const perResult = Math.max(200, Math.min(2000, Math.floor(settings.maxChars / settings.results)));
  const req = adapter.request(
    baseUrl.replace(/\/+$/, ""),
    query,
    settings.results,
    apiKey,
    perResult,
  );
  try {
    const response = await fetch(req.url, { ...req.init, signal: combined });
    if (!response.ok)
      throw new Error(
        redact(
          t("search.http", {
            name: meta.name,
            status: response.status,
            body: await response.text(),
          }),
          searchKeys(settings),
        ),
      );
    const data = await response.json();
    scope.check();
    const hits = adapter.hits(data);
    if (!Array.isArray(hits)) throw new Error(t("search.noResults", { name: meta.name }));
    let remaining = settings.maxChars;
    return hits
      .map((r) => ({ title: plain(r.title), url: String(r.url || ""), snippet: plain(r.snippet) }))
      .filter((r) => /^https?:\/\//.test(r.url))
      .slice(0, settings.results)
      .map((r) => {
        const snippet = r.snippet.slice(0, Math.max(0, remaining));
        remaining -= snippet.length;
        return { title: r.title || r.url, url: r.url, snippet, kind: "snippet" as const };
      });
  } catch (error) {
    if (scope.signal.aborted) throw scope.signal.reason;
    if (child.signal.aborted) throw child.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
