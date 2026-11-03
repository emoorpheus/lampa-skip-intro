# Contributing

Thank you for helping! The most valuable contribution right now is a **report from a device that has not been tested yet** —
Samsung Tizen, older LG webOS versions, other Android TV boxes. So far the plugin has been tested on LG webOS 25 and one Android TV box
(README → Tested devices). See [docs/tv-checklist.md](docs/tv-checklist.md) (in Russian: [docs/tv-checklist.ru.md](docs/tv-checklist.ru.md)).

## Rules

- The plugin code must stay **ES5** (old TV browsers). `node build.js` rejects newer syntax, `tests/t_compat.js` rejects newer
  built-in APIs (except `Promise`, which Lampa provides) and CSS that old engines do not support.
- The user interface is in Russian and English and follows the Lampa language: every user-visible string goes through `tr()` / `trn()`
  and the table in `src/05_i18n.js` ([Translations](#translations)). Code comments and test names are in Russian; English issues and
  pull requests are welcome.
- No runtime dependencies and no new external services without a discussion in an issue first.
- **Never send test data to Aniskip or any other community database.** Tests mock the whole network; `e2e/live_diag.js` only reads.
- **AI coding assistants** (Claude Code, Codex, Gemini CLI, …): the project rules for them are in [AGENTS.md](AGENTS.md);
  [CLAUDE.md](CLAUDE.md) only imports it. Keep these files in sync with this guide when the rules change.
- Do not commit private data. Run `npm run check` before pushing (IP addresses, e-mails, tokens, personal paths). Put your own
  nickname, host names and server paths into `.publish-denylist` (one per line, git-ignored) to have them checked as well.

## Development

```sh
git clone https://github.com/emoorpheus/lampa-skip-intro.git
cd lampa-skip-intro
npm test        # build src/ -> dist/autoskip.js + unit tests (Node.js 18+, no npm install; proxy tests need Python 3.7+)
```

- Sources: `src/NN_*.js` are concatenated in order by `build.js` into `dist/autoskip.js`; the version comes from `package.json`.
- Commit `dist/` together with `src/` — CI rebuilds it and fails if it differs.
- Optional: `config.pluginAuthor` in `package.json` sets the author shown in Lampa's extension list (empty = not shown).

### End-to-end tests (Linux or macOS)

```sh
npm install                 # Playwright
npm run e2e:setup           # clones the Lampa web build into ref/ (~30 MB) and generates test videos (needs git and ffmpeg)
CHROMIUM_PATH=/path/to/chromium npm run e2e   # or first: npx playwright install chromium
```

The scenarios run the real Lampa web build on `127.0.0.1:8123` and mock every external request. `LIVE=1 node e2e/e2e_proxy.js`
and `node e2e/live_diag.js` send a few real read-only requests — do not run them in loops.

## Translations

The plugin reads the Lampa language (`Lampa.Storage` key `language`): Russian for `ru`, English for every other language.
All interface strings are in one table in `src/05_i18n.js`:

```js
set_enabled: { ru: 'Включить плагин', en: 'Enable plugin' },
warn_type_in: { ru: '{type} через {n} с', en: '{type} in {n} s' },
n_skips: { ru: ['{n} пропуск', '{n} пропуска', '{n} пропусков'], en: ['{n} skip', '{n} skips'] },
```

- In code: `tr('set_enabled')`, `tr('warn_type_in', { type: tr('type_intro'), n: 5 })`, `trn('n_skips', 5)` → «5 пропусков» / “5 skips”.
- Placeholders (`{n}`, `{type}`, …) must be the same in every language. A missing translation falls back to English, then Russian.
- **A new language:** add its code to `I18N_LANGS`, a translation to every string and, if the language needs other plural forms,
  a rule to `I18n.form` (number of forms = number of entries in the arrays).
- Lampa's own `Lampa.Lang` is not used for the plugin strings: for a missing key it falls back to Russian, not English.
- Log messages (`[SkipIntro] …`) stay in English and are not translated.
- `tests/t_i18n.js` checks that every string has every language with the same placeholders and the right number of plural forms,
  that every `tr()` key exists, that no string in the table is unused, and that Cyrillic string literals appear only in the table.

## Release (maintainers)

1. Set the new `version` in `package.json` (SemVer; pre-releases like `1.1.0-beta.1`), update `CHANGELOG.md` and write the
   release notes `docs/releases/vX.Y.Z.md`.
2. `npm test && npm run check -- --strict` (and `npm run e2e`, if you can).
3. **Stable versions:** commit and push to `main` — the Pages workflow publishes `dist/autoskip.js` (it refuses pre-release versions).
   **Pre-releases:** push to a separate branch (for example `next`); testers use the jsDelivr URL with the tag.
4. Tag the release: `git tag vX.Y.Z && git push origin vX.Y.Z` (the jsDelivr URL with `@vX.Y.Z` then works).
5. Create the GitHub release from the tag with the notes and both files:

   ```sh
   gh release create vX.Y.Z --verify-tag -t "Skip Intro X.Y.Z" -F docs/releases/vX.Y.Z.md dist/autoskip.js dist/SHA256SUMS
   ```

   Add `--prerelease` for `-beta` versions ([GitHub CLI manual](https://cli.github.com/manual/gh_release_create)); the web UI works as well.
