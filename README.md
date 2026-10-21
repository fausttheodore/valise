English | [简体中文](README.zh-CN.md)

# Valise

Valise is a browser extension for reading with an LLM. Ask about the page you are on, a passage you selected, or several open tabs at once. It runs on your own API key and sends requests directly from the browser to the provider you choose. There is no backend and no account.

Works in Chromium-based browsers that support the Manifest V3 side panel (Chrome 120+, Edge, Brave, Vivaldi).

> [!NOTE]
> The interface and default prompts are currently Chinese only. To get answers in English, change the global prompt under Settings → Prompts (提示词). An English UI is planned.

<!-- TODO: add a screenshot or short GIF of the side panel and the selection popup here. -->

## Features

- **Page context.** Extracts the main content of the current tab as Markdown (via Defuddle). You can send the full page, only the selection, both, or nothing, and preview exactly what will be sent.
- **Multiple tabs.** Type `@` in the input box to add other open tabs. Each page is labeled with its title, URL and extraction time, so the model can compare or cross-check them.
- **Long pages.** When a page doesn't fit the context budget, Valise retrieves the passages relevant to your question and marks the answer as based on excerpts. "Summarize page" and "Translate page" process the whole page chunk by chunk.
- **Ask about a selection.** Select text on any page to get a small toolbar (explain, translate, summarize, or your own actions). The answer appears in a floating window next to the selection, which you can move, resize, follow up in, or move to the side panel.
- **Quote and follow up.** Select part of an answer and click Quote (引用) to ask about that passage specifically.
- **Math rendering.** KaTeX with `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, bare `\begin{align}` and ` ```math ` blocks. Common commands from physics, siunitx, upgreek and mhchem are supported. Math is extracted before Markdown parsing, so `|` in tables and `_` or `*` inside formulas don't break. Formulas KaTeX can't render are shown as source with the error on hover.
- **Web search.** Uses the model's built-in search when it has one (Gemini, OpenRouter, Perplexity, Qwen, GLM and others). Otherwise the model can call a search API you configure: Tavily, Exa, Brave, Jina, Bocha or SearXNG. You can also have it search first and then answer, which works with any model.
- **Reasoning models.** Sends the correct thinking parameter for each model (`reasoning_effort`, `thinkingLevel` or `thinkingBudget`) and shows the reasoning summary when the provider returns one.
- **Attachments.** Images, PDFs, text and code files, a screenshot of the visible area, or the PDF open in the current tab.
- **Token usage.** Input and output tokens per answer, and a ring next to the input box showing how much of the context budget the conversation uses.
- **Local history.** Conversations are stored in the browser. You can search, rename and export them as Markdown.

## Installation

### From a release

1. Download `valise-<version>.zip` from [Releases](../../releases) and unzip it to a folder you will keep.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`, `vivaldi://extensions`) and turn on Developer mode.
3. Click **Load unpacked** and select the unzipped folder.
4. Click the toolbar icon or press `Ctrl+Shift+Y` (`⌘⇧Y` on macOS) to open the side panel, then add a model.

To update, unzip the new version into the same folder and click **Reload** on the extensions page. Your settings and history are kept.

### From source

Requires Node.js 22.12 or later.

```sh
npm ci
npm run build    # type-check and build into dist/
```

Then load the `dist/` folder as above.

## Getting started

1. **Add a model.** Open Settings → Models (模型) and pick a preset: OpenAI, Gemini, DeepSeek, OpenRouter, SiliconFlow, Ollama, or any other OpenAI-compatible service. Enter the base URL, API key and model name. **Fetch list** (获取列表) shows the models the endpoint offers; **Test connection** (测试连接) checks the setup.
2. **Ask about a page.** Open any web page and type a question in the side panel, or use one of the suggested actions on an empty conversation.
3. **Add other tabs.** Type `@`, pick a tab with the arrow keys, and press Enter. Referenced tabs are read when you send the message.
4. **Ask about a selection.** Select text on a page and click an action in the toolbar. You can also use the context menu (Valise → action) or `Alt+Shift+L`.

## Supported APIs

| Protocol          | Example base URL                                   | Request                                                           |
| ----------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| OpenAI-compatible | `https://api.openai.com/v1`                        | `POST /chat/completions`, Bearer token, streaming                 |
| Gemini            | `https://generativelanguage.googleapis.com/v1beta` | `/models/<model>:streamGenerateContent?alt=sse`, `x-goog-api-key` |

The OpenAI-compatible protocol covers DeepSeek, OpenRouter, SiliconFlow, Qwen, GLM, Moonshot, Ollama, vLLM, LM Studio and similar services. For custom endpoints you can declare capabilities by hand (images, PDF, tool calling, built-in search, thinking parameters) and add extra request fields as JSON. Extra fields cannot override authentication, messages or streaming.

### Web search

There are two search modes:

- **Search when needed** (按需搜索). If the model has built-in search, it searches on its own. If it doesn't but supports tool calling, it can call the search API you configured. If it supports neither, Valise suggests switching to the other mode.
- **Search first** (先搜索再回答). Valise queries your search API, then gives the results to the model. Works with any model.

Built-in search is detected automatically for Gemini 2.0 and later, OpenAI `*search*` models, Perplexity and OpenRouter `:online` models. For other OpenAI-compatible providers, enable it under Models → Built-in search (自带联网); presets are included for OpenRouter, OpenAI search models, Qwen and GLM.

## Privacy

- Model and search requests go directly from your browser to the services you configure.
- API keys are stored in extension storage that web pages and content scripts cannot read. Exported settings leave keys out unless you choose to include them, in which case the file name contains `WITH-SECRETS`.
- Pages are read only when you send a question, open the preview, or click a selection action. Tabs referenced with `@` are read when you send.
- Page content and search results are sent as reference material inside your message, marked as not being instructions. They never go into the system prompt.
- Conversations, attachments and page snapshots are stored locally in IndexedDB. Snapshots are capped at 20 entries or about 10 MiB, oldest removed first.

Valise requests access to all sites so it can read tabs, take screenshots and show the selection toolbar. If you set site access to "On click", the side panel shows a button to grant access when needed.

## Troubleshooting

- **The page can't be read.** Browser pages (`chrome://…`) and extension stores are protected; the panel offers to continue as a plain chat (改为普通聊天). For PDF tabs, send the PDF as an attachment. For lazy-loaded or collapsed content, expand it on the page, then click ↻ to read again.
- **A referenced tab fails to load.** The browser may have suspended it. Switch to the tab once so it loads, then try again.
- **A formula shows as gray source code.** KaTeX doesn't support one of its commands. Hover to see which. The source can still be copied.
- **401 / 429 / 5xx errors.** Check the key, model name, base URL and quota. Text received before the error is kept, and failed requests are not retried automatically.
- **The provider rejects a parameter.** Set thinking and sampling back to Default, or turn off the unsupported capability for that model.
- **Errors on pages opened before an update.** Reload the page.

## Development

```sh
npm ci
npm test           # vitest
npm run typecheck
npm run build      # type-check and build into dist/
npm run dev        # rebuild on change
npm run package    # build and zip dist/ into artifacts/valise-<version>.zip
npm run mock       # local mock API server at http://127.0.0.1:18473/fixture
```

Built with TypeScript, Vite and plain DOM (no UI framework), plus markdown-it, KaTeX, DOMPurify, highlight.js, Defuddle and idb. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organized and [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Credits

Valise started as a fork of [Lumio](https://github.com/Iceeeeeeey/lumio) (MIT), which also provided the icons. The page extraction pipeline is adapted from [Page Assist](https://github.com/n4ze3m/page-assist) (MIT). Licenses for bundled dependencies are in [`public/licenses/`](public/licenses/).

The name is French for "suitcase".

## License

[MIT](LICENSE)
