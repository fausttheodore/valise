# Changelog

All notable changes to Valise are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-21

### Added

- English interface. Valise follows the browser language by default (Chinese for any Chinese locale, English otherwise); change it under Settings → Appearance → Interface language.
- The default system prompt and selection actions follow the interface language. Prompts and actions you edited are kept as they are. "Translate page" translates into the interface language.
- Extension name, description and shortcut descriptions are localized in English and Chinese.
- CI checks every push and pull request, and pushing a `v*` tag publishes the release zip automatically.

### Changed

- README is now in English, with a Chinese translation in `README.zh-CN.md`.
- Documented tested platforms and browsers.
- Dates and numbers are formatted for the interface language.

## [0.1.0] - 2026-10-19

First public release. Valise began as a fork of [Lumio](https://github.com/Iceeeeeeey/lumio) and was developed privately as "Lumio Lite" before being renamed; version numbers restart at 0.1.0.

### Added

- Page context: extract the current tab as Markdown with Defuddle; send the full page, the selection, both, or nothing; preview before sending.
- Long pages: retrieve relevant passages when the page exceeds the context budget; summarize or translate the whole page chunk by chunk.
- `@` mentions: reference other open tabs; each page is labeled with title, URL and extraction time, and the budget is split by page size.
- Quote and follow up on part of an answer, in both the side panel and the selection popup.
- Selection toolbar with customizable actions and a movable, resizable floating window.
- OpenAI-compatible and Gemini protocols with streaming, timeouts and cancellation; per-model thinking parameters.
- Web search: built-in search for supported providers, or Tavily, Exa, Brave, Jina, Bocha and SearXNG via tool calling or search-first mode.
- KaTeX rendering with physics, siunitx, upgreek, unicode-math and mhchem commands; formulas are extracted before Markdown parsing.
- Token usage per answer and a context-usage indicator.
- Attachments: images, PDFs, text and code files, visible-area screenshots.
- Local conversation history in IndexedDB with search, rename and Markdown export.
- Settings with provider presets, model list, capability overrides and import/export that omits keys by default.

[Unreleased]: https://github.com/fausttheodore/valise/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/fausttheodore/valise/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fausttheodore/valise/releases/tag/v0.1.0
