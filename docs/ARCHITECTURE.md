# Valise architecture

For maintainers: what the extension does, what it is made of, how data flows, and which constraints apply. For usage, see the [README](../README.md); for version changes, see the [CHANGELOG](../CHANGELOG.md).

## 1. Scope

A reading assistant in the browser side panel: read the current page, ask about a selection, and chat with models the user connects.

- **Bring your own key.** The browser calls the endpoints the user configures (OpenAI-compatible or Gemini native). There is no relay server.
- **Small.** MV3, TypeScript, Vite and plain DOM, no UI framework. No embeddings, local models, MCP or cloud sync.
- **Honest output.** When context was trimmed, only retrieved passages were used, a search did not run, or output hit its limit, the answer says so below the text.

## 2. Features

| Feature | Description | Main code |
| --- | --- | --- |
| Page context | Don't read / current page / selection only / selection + page. Defuddle extracts Markdown. Preview and re-read are available. | `extract.ts` `context.ts` `background.ts` |
| `@` tab mentions | Typing `@` opens a tab picker (this window first, most recently used first). Referenced tabs are read in parallel when the message is sent and are added as material next to the current page, each with its own source label. | `composer.ts` `app.ts` `runner.ts` |
| Quoting answers | Select text in an answer → Quote → it is placed before the question as a Markdown blockquote. Formulas are turned back into LaTeX. | `app.ts` `render.ts quoteText()` |
| Long pages | When a page exceeds the budget, keyword retrieval picks passages and the answer is marked "not the full text". Several pages share the budget in proportion to their size and are retrieved separately. Page summaries and translations call the model once per part and report progress. | `context.ts` `runner.ts` |
| Model profiles | Several endpoints, keys and models, switchable in the side panel. Thinking parameters, sampling parameters and image / PDF / tool / built-in search support are detected from the model name and can be declared by hand. | `config.ts` `settings.ts` |
| Streaming | Real SSE streaming. First-response, idle and total timeouts. Stopping aborts the network request and keeps the text received so far. | `providers.ts` `request.ts` |
| Thinking | OpenAI `reasoning_effort`, Gemini `thinkingLevel` / `thinkingBudget`. Thought summaries are shown collapsed. | `config.ts` `providers.ts` `render.ts` |
| Web search | Three modes: off, search when needed, search first. See §5. | `runner.ts` `search.ts` `providers.ts` |
| Token usage | Input and output tokens per answer. A ring next to the input shows context occupancy; clicking it shows totals for the conversation. | `providers.ts` `app.ts` `composer.ts` |
| Selection actions | Selecting text shows a toolbar. A floating window answers next to the selection and can be dragged, resized from any edge, followed up in, or moved to the side panel. | `content.ts` `app.ts` (float mode) |
| Attachments | Images, PDFs, text and code files; visible-area screenshots; the PDF open in the current tab. | `attachments.ts` |
| Rendering | Markdown, KaTeX (copyable LaTeX, see §6), code highlighting, source cards, Gemini search suggestions. | `render.ts` `math.ts` |
| History | Conversations and page snapshots in IndexedDB. History drawer, rename, Markdown export. Long conversations render in a window, with a question navigator. | `storage.ts` `history.ts` `thread.ts` |
| Settings | Saved automatically. Models, search, prompts, selection actions, appearance (including interface language), sites, data. Import and export omit keys by default. | `settings.ts` |
| Interface language | English and Simplified Chinese, see §8. | `i18n/` |

## 3. Runtime contexts

```
┌──────────────────── web page (untrusted) ────────────────────┐
│ content.js: selection toolbar + float frame (closed shadow DOM) │
│   └─ <iframe floating.html>  ← extension page, trusted         │
└───────────────────────────────┬──────────────────────────────┘
                                │ runtime messages (CONTENT_PREFS / CREATE_FLOAT / FLOAT_WIDTH only)
┌───────────────────────────────▼──────────────────────────────┐
│ background.js (service worker): message routing, page reads,  │
│ permissions, context menu                                     │
└───────────────────────────────▲──────────────────────────────┘
                                │ runtime messages
┌───────────────────────────────┴──────────────────────────────┐
│ panel.html / floating.html (app.ts): conversations, requests, │──→ model APIs / search APIs
│ rendering                                                     │
│ settings.html (settings.ts)                                   │
└───────────────────────────────────────────────────────────────┘
```

- **Long requests run only in a visible extension page** (the side panel or the float). The worker handles short tasks and is not kept alive by polling.
- **Keys stay in trusted contexts.** `chrome.storage` is set to `TRUSTED_CONTEXTS`, so content scripts can't read it. The content script receives only action names, icons, the float width and the resolved interface language.
- **Pages can trigger three messages only:** read selection preferences, create a float session, save the float width (clamped to 320–960 px). Every other message requires the sender to be an extension page.
- The float iframe and its frame talk through `postMessage`. The iframe reports moves and its preferred height; the frame positions it, keeps it inside the viewport and handles edge resizing. Once the user resizes it by hand, it stops growing with the answer.

## 4. Data flow of a question

1. `app.ts submit()` checks attachment capabilities and creates a `RequestScope` (timeouts and abort).
2. `runner.ts runTurn()`:
   1. Reads the current page (`background.ts readPage` → `content.ts READ_DOM` → `extract.ts`) and, in parallel, the tabs referenced with `@`. A referenced tab that is the current page is skipped. If any read fails, the turn stops before calling the model. All snapshots are saved.
   2. Writes the user message (`source` is the current page, `refs` are the referenced tabs) and drops the oldest turns with `trimHistory` to fit the budget.
   3. In "search first" mode, calls `search()` and attaches the results to the question as reference material.
   4. Page text: attached in full when it fits, otherwise narrowed with `retrieve()` (several pages share the budget by size). Whole-page tasks go through `chunkText()` part by part.
   5. `answer()` calls `generate()` in a loop. When the model calls the `web_search` tool, the search runs and the result is added as a tool message, until the model answers or the round limit is reached.
3. `providers.ts generate()` builds the request, parses SSE, reports deltas, and collects thoughts, tool calls, sources, grounding and usage.
4. Deltas are rendered with throttling (`thread.ts`, `render.ts`). The conversation is written to IndexedDB with a 2-second debounce and saved once more at the end.

Page text and search results are always attached to the **user message** (one `<网页参考资料>` block per page, with title, URL and extraction time) and marked as material, not instructions. They never go into the system prompt.

Quoting needs no extra data structure: the quoted passage is written as a `> ` blockquote before the question, so the model and the history see the same Markdown.

## 5. Web search

| Mode | Model has built-in search | No built-in search, but tool calling | Neither |
| --- | --- | --- | --- |
| Search when needed | The model searches on its own | A `web_search` function is declared and the model decides when to call the search service | Error suggesting "Search first" |
| Search first | The search service runs first, then the model answers (works with any model) | Same | Same |

**Built-in model search** (`capabilities().nativeSearch`):

- Gemini native protocol: `gemini-2.0` and later models and the `-latest` aliases. Requests carry `tools: [{google_search: {}}]`; `groundingMetadata` and search suggestions are parsed.
- OpenAI-compatible: the profile's `searchParams` (the "Built-in search" card, with presets for OpenRouter, OpenAI search models, Qwen and Zhipu) are merged into the request body only in "search when needed" mode. Detected automatically: OpenAI `*search*` models, `api.perplexity.ai`, OpenRouter `:online` models.
- Sources are read from `delta.annotations[].url_citation` (OpenAI / OpenRouter), `citations` / `search_results` (Perplexity), `search_info.search_results` (Qwen) and `web_search` (Zhipu).

**Search services** (`search.ts`, a table of adapters; a new service is one more entry): Tavily, Exa, Brave, Jina, Bocha, SearXNG. Each service's URL and key are stored in `settings.search.services`, so switching services keeps every key. `settings.search.provider` is the selected service.

## 6. Markdown and math rendering

`render.ts renderMarkdown()` works in three steps:

1. **Extract formulas first** (`math.ts extractMath()`). Code blocks and inline code are skipped. `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, bare `\begin{equation|align|gather|…}` and ` ```math ` blocks are replaced with private-use placeholders (`U+E000 n U+E001`) before markdown-it runs, so `_`, `*` and `\\` in formulas and `|` in tables are not parsed as Markdown. A few harmless tags such as `<br>`, `<sup>` and `<sub>` are kept the same way (markdown-it still runs with `html: false`).
2. **Render with markdown-it.** Linkify is on and recognizes only `http(s)://` and `www.`. A block formula alone in a paragraph replaces the `<p>`; other placeholders are replaced in place with KaTeX output.
3. **Sanitize** the whole HTML with DOMPurify.

Rules: `$` counts as a delimiter only when it touches non-space characters on the inside; a `$` before a digit or right after one is currency (`$5 and $10`); `\$` is an escaped dollar sign; `\[1\]` with only digits is an escaped citation number; `$$` or `\[` on its own line is a block formula, and inside a sentence it is rendered inline in display style.

KaTeX runs with `throwOnError: true`. A formula that fails is shown as gray LaTeX source, with the reason on hover. `MACROS` in `math.ts` adds commands models often write that KaTeX lacks: physics (`\abs` `\norm` `\dv` `\pdv` `\vb` `\expval` `\comm` …), siunitx (`\SI` `\si` `\qty` `\unit` with common units and prefixes), upgreek (`\upsigma` …), unicode-math (`\symbf` …) and operators such as `\argmax`. Chemistry (`\ce` `\pu`) comes from KaTeX's mhchem extension. A new command is one more entry in `MACROS`.

Each formula's wrapper carries `data-tex`; the copy buttons and quoting read the LaTeX source from it.

## 7. Token usage and context occupancy

- OpenAI-compatible requests send `stream_options: {include_usage: true}` and read `usage` from the last chunk, including cache hits (`prompt_tokens_details.cached_tokens`, or DeepSeek's `prompt_cache_hit_tokens`) and reasoning tokens. Gemini reads `usageMetadata`; thinking tokens count as output.
- Each model call's usage is stored in the `usage` field of its assistant message and persists with the conversation.
- Occupancy is the last call's actual input + output divided by the profile's context budget. Before the provider reports usage, it is estimated from the character count (`estimateTokens`, shown with ≈). Above 70% the ring turns amber, above 90% red.

## 8. Interface language

- `src/i18n/zh-CN.ts` is the reference dictionary. `src/i18n/en.ts` is typed against its keys, so a missing or extra key fails `npm run typecheck`. Keys are flat strings grouped by module, such as `settings.models` or `composer.send`.
- `src/i18n/index.ts` exports `t(key, params)` (placeholders are written `{name}`), `setLocale()`, `getLocale()`, `resolveLocale()`, `formatNumber()` and `translations()`.
- The language comes from `settings.uiLanguage` (`"auto" | "en" | "zh-CN"`, default `"auto"`). `auto` uses `chrome.i18n.getUILanguage()`: any `zh*` locale maps to `zh-CN`, everything else to `en`. `loadSettings()` sets the locale before `normalizeSettings()` runs, so every entry point (panel, float, settings, worker) uses it from the first label it builds. The panel and settings page load settings with top-level `await` before building the UI; the HTML `lang` attribute is set at runtime.
- When the language changes, the settings page redraws, the side panel reloads and reopens the current conversation, and the worker re-registers its context menu. An open float keeps its language until it closes.
- The content script receives the resolved language through `CONTENT_PREFS`; storage access is not widened. Its two strings live in `content.ts` so the dictionaries are not injected into web pages.
- The default system prompt and default selection actions come from the dictionary. In `normalizeSettings()`, a saved prompt or action name/template that equals the default in any language is treated as unedited and replaced with the current language's default; edited text is kept.
- Text that is part of the prompt structure sent to the model stays in Chinese for now: the `<网页参考资料>` wrapper and its note in `context.ts`, the per-part instructions in `runner.ts`, and the attachment wrappers and `web_search` tool description in `providers.ts`.
- Dates and numbers are formatted with the current locale. The extension name, description and shortcut descriptions in the manifest use Chrome's `_locales/` and follow the browser language.

## 9. Storage

| Location | Contents |
| --- | --- |
| `chrome.storage.local.settings` | Settings, including keys; readable only from trusted contexts |
| `chrome.storage.session` | Float sessions, side panel visibility, a conversation waiting to open in the side panel |
| IndexedDB `conversations` | Conversations and messages (attachments, sources, referenced tabs, usage) |
| IndexedDB `snapshots` | Page text snapshots (one per current page and per `@` tab), at most 20 or about 10 MiB, oldest removed first |

Settings migration lives in `normalizeSettings()`: it only fills in fields and never invents profiles. For example, an early single `search.apiKey` moves to `search.services.tavily`.

## 10. Layout

```
valise/
├─ src/
│  ├─ app.ts          side panel and float: conversations, menus, submit, @ mentions, quoting, usage
│  ├─ thread.ts       message list: windowed rendering, loading older messages, question navigator
│  ├─ composer.ts     input area: page source row, @ picker and chips, quotes, attachment tray, context ring, model / send
│  ├─ render.ts       Markdown / code / message views / sources / selection to text
│  ├─ math.ts         formula extraction, KaTeX rendering and extra macros
│  ├─ history.ts      history drawer
│  ├─ settings.ts     settings page
│  ├─ runner.ts       one turn: context, search, chunking, tool loop
│  ├─ providers.ts    request building, SSE parsing, usage and sources
│  ├─ search.ts       search service adapters
│  ├─ config.ts       defaults, migration, capability detection, validation, export
│  ├─ context.ts      token estimate, trimming, chunking, retrieval
│  ├─ request.ts      request lifecycle (timeouts / abort)
│  ├─ extract.ts      Defuddle → Markdown
│  ├─ attachments.ts  attachments and screenshots
│  ├─ storage.ts      IndexedDB
│  ├─ browser.ts      tab / page read / permission helpers
│  ├─ background.ts   service worker routing
│  ├─ content.ts      selection toolbar and float frame
│  ├─ i18n/           interface dictionaries and t()
│  ├─ ui.ts dom.ts icons.ts theme.ts   components, DOM helpers, icons, appearance
│  ├─ types.ts        data types
│  └─ style.css settings.css
├─ tests/             vitest tests + mock-server.mjs (local protocol mock)
├─ scripts/           licenses.mjs (collects dependency licenses), package.mjs (zips dist)
├─ public/            manifest, _locales, icons, licenses
├─ .github/workflows/ci.yml   checks on every push and pull request; releases on v* tags
├─ docs/ARCHITECTURE.md
├─ CHANGELOG.md       version changes
├─ CONTRIBUTING.md
├─ README.md          English
└─ README.zh-CN.md    Chinese
```

Build output (`dist/`, `artifacts/`) and `node_modules/` are not tracked (see `.gitignore`). Signing keys (`*.pem`) must never be in the repository or a package.

## 11. Conventions

Code style, tests, secret handling, the changelog and releasing are described in [CONTRIBUTING.md](../CONTRIBUTING.md).

## 12. Sources and references

| Source | Used for |
| --- | --- |
| [Lumio](https://github.com/Iceeeeeeey/lumio) | Starting point; the icons in `public/icons/` and early layout ideas, MIT (copyright notice kept in `LICENSE`) |
| [Page Assist](https://github.com/n4ze3m/page-assist/tree/c54bc6f41644e83b8130532814f7b62e01a47300) | The Defuddle → Markdown pipeline in `extract.ts`, MIT; the `@` tab mention interaction only |
| Cerebr | Interaction ideas only; no GPL-3.0 code was copied |

Protocol documentation: [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) · [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning) · [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search) · [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking) · [Gemini Google Search](https://ai.google.dev/gemini-api/docs/google-search) · [OpenRouter web search](https://openrouter.ai/docs/guides/features/web-search) · [Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search) · [Exa](https://exa.ai/docs/reference/search) · [Brave](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started) · [Jina](https://jina.ai/reader/)

Dependency licenses are collected into `public/licenses/` by `scripts/licenses.mjs`.
