# AGENTS.md

Instructions for AI coding assistants (Claude Code, Codex, Gemini CLI and others) working on this repository.
Humans: the same rules are in [CONTRIBUTING.md](CONTRIBUTING.md). Keep both files in sync.

## Project

**Skip Intro for Lampa** — a plugin for [Lampa](https://github.com/yumata/lampa) (a media app for Smart TVs, Android TV and browsers).
It looks up intro, recap, credits and preview timestamps in community databases (TheIntroDB, IntroDB, IntroHater, Aniskip),
MKV chapters via TorrServer and the user's own marks, and shows a skip button or skips automatically.
The result is one file, `dist/autoskip.js`, that runs inside Lampa on old TV browser engines.

| Path | What it is |
|---|---|
| `src/NN_*.js` | Sources. `build.js` concatenates them in name order into `dist/autoskip.js` and writes `dist/SHA256SUMS`. |
| `src/05_i18n.js` | All user-visible strings (`ru` and `en`) and the language choice. |
| `src/10_core.js`, `src/20_logic.js` | Pure logic (parsers, merging, confidence, offsets, cache), tested in Node. |
| `src/40_net.js` … `src/90_boot.js` | Network, loader, subtitle heuristic, player UI, menus, playback controller, boot. |
| `tests/` | Unit tests (Node.js 18+, no dependencies); `t_proxy.js` also needs Python 3.7+. |
| `e2e/` | Playwright scenarios in the real Lampa web build (`ref/`, git-ignored, created by `e2e/setup.sh`). |
| `proxy/` | Optional IntroDB proxy (Python standard library) and its systemd unit. |
| `tools/check-publish.js` | Scan for private data before publishing; `tools/vendor/acorn.js` is used by the build for the ES5 check. |
| `docs/` | English docs; `*.ru.md` are the Russian versions. |

## Commands

```sh
node build.js                 # build dist/ (version from package.json), fails on non-ES5 syntax
npm test                      # build + unit tests (node tests/run_all.js)
npm run check -- --strict     # private data scan + unreplaced placeholders
npm install && npm run e2e:setup && CHROMIUM_PATH=/path/to/chromium npm run e2e   # end-to-end, ~5 min
```

Run `npm test` after every change. Run the end-to-end tests for changes in the player, menus, settings or Lampa integration.

## Rules

- **ES5 only** in `src/` (no `let`/`const`, arrow functions, classes, template strings, …) and no built-in APIs newer than ES5
  except `Promise` (Lampa provides it). `build.js` and `tests/t_compat.js` enforce this — old webOS and Tizen engines must run the file.
- **No runtime dependencies** and no new external services without an issue first.
- **Strings:** every user-visible string goes through `tr()` / `trn()` and the table in `src/05_i18n.js`, in every language, with the
  same placeholders. Cyrillic string literals only in that table (`tests/t_i18n.js` checks it). Log messages (`[SkipIntro] …`) are in English.
- **Conventions:** code comments and test names are in Russian; README, docs and CHANGELOG are in English, with Russian versions in
  `README.ru.md` and `docs/*.ru.md` — update both. Release notes (`docs/releases/vX.Y.Z.md`) have an English and a Russian part.
- **Do not rename storage keys** (`skip_intro_*`): users keep their settings, statistics and cache across updates.
- **Commit `dist/` together with `src/`.** CI rebuilds it and fails if it differs.
- **Never send test data to Aniskip or any other community database.** Tests mock the whole network; `e2e/live_diag.js` and
  `LIVE=1 node e2e/e2e_proxy.js` only read — do not run them in loops.
- **No private data** in committed files: IP addresses (except `127.0.0.1` and RFC 5737 examples), e-mails, tokens, home paths, host
  names, server paths. Use placeholders such as `<YOUR_SERVER_IP>` and `<PORT>`. `npm run check` scans for them; personal words go
  into `.publish-denylist` (git-ignored).

## Evidence

- State only what is verified. Back claims about Lampa's behaviour with links to `app.min.js` of the pinned Lampa 3.4.4 web build:
  `https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L…` (the same commit `e2e/setup.sh` uses).
- Back claims about devices with a log line, a test or the maintainer's report. If a change is checked only by automated tests,
  write “not tested on a TV”. Do not list a device as tested without a report.

## Release

See [CONTRIBUTING.md → Release](CONTRIBUTING.md#release-maintainers): version in `package.json`, `CHANGELOG.md`,
`docs/releases/vX.Y.Z.md`, `npm test && npm run check -- --strict`, push (stable to `main`, pre-releases to `next`), tag,
GitHub release with `dist/autoskip.js` and `dist/SHA256SUMS`. Do not push, tag or publish without the maintainer's confirmation.

The plugin was developed with the help of AI models: Opus 5.5 and Gemini 3.8 Flash.
