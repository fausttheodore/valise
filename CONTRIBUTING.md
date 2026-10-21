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
- **Interface text.** Add new strings to both `src/i18n/zh-CN.ts` and `src/i18n/en.ts` and use them through `t()`. `npm run typecheck` fails if a key is missing from either file.
- **Tests.** When you change protocol handling or capability detection, add a mapping test to `tests/core.test.ts`. When you change math extraction rules, add a rendering test.
- **Secrets.** Never commit or package `*.pem` files. Use `redact()` for keys in logs and error messages. Settings export must keep clearing every API key by default. Extra request parameters must not be able to override authentication, messages or streaming fields.
- **Changelog.** Add user-visible changes to the `[Unreleased]` section of [CHANGELOG.md](CHANGELOG.md).
- **Documentation.** `README.md` is the source of truth. If you change it, update `README.zh-CN.md` in the same pull request, or open an issue noting that the translation is behind.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organized.

## Releasing

1. Set the new version in `package.json` and `public/manifest.json`. They must match; CI checks this.
2. In `CHANGELOG.md`, rename `[Unreleased]` to the version and date, for example `## [0.3.0] - 2026-11-30`, add a new empty `[Unreleased]` section above it, and update the compare links at the bottom.
3. Commit and push to `main`.
4. Tag and push the tag:

   ```sh
   git tag v0.3.0
   git push --tags
   ```

The tag starts the release job in `.github/workflows/ci.yml`. It runs the checks, fails if the tag doesn't match `package.json`, builds `valise-<version>.zip`, and publishes it as a GitHub release with that version's changelog section as the notes.
