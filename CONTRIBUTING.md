# Contributing

Issues and pull requests are welcome, in English or Chinese.

## Before you submit

```sh
npm run typecheck
npm test
```

If you changed the UI, reload the extension in the browser and check it by hand.

## Conventions

- **Code style.** Plain DOM through the `h()` helper; no UI framework. Run `npm run format` before committing.
- **Where differences live.** Model capability detection goes in `capabilities()` in `src/config.ts`; protocol differences go in `src/providers.ts`.
- **Tests.** When you change protocol handling or capability detection, add a mapping test to `tests/core.test.ts`. When you change math extraction rules, add a rendering test.
- **Secrets.** Never commit or package `*.pem` files. Use `redact()` for keys in logs and error messages. Settings export must keep clearing every API key by default. Extra request parameters must not be able to override authentication, messages or streaming fields.
- **Changelog.** Add user-visible changes to the `[Unreleased]` section of [CHANGELOG.md](CHANGELOG.md).
- **Documentation.** `README.md` is the source of truth. If you change it, update `README.zh-CN.md` in the same pull request, or open an issue noting that the translation is behind.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organized.
