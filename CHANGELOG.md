# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-01

First public release.

### Added

- Skip button and optional auto-skip for intros, recaps, credits and previews in TV shows; «Пропустить титры» in movies jumps to the end of the credits and keeps a post-credits scene.
- Timestamp sources: TheIntroDB v4, IntroDB, IntroHater, Aniskip (anime: ARM → MyAnimeList, AniList search as a fallback), MKV chapters via TorrServer, your own marks; all sources are queried in parallel and cached per episode.
- Subtitle heuristics (SRT/VTT pauses, OP/ED songs in ASS) and an experimental audio heuristic; their results are offered as a button only.
- Trust threshold for auto-skip, per-show modes and offset, «Следующая серия» at the credits via Lampa's playlist, prefetch of the next episode, timeline marks, a warning 5 s before a segment.
- Implausible timestamps from databases are discarded: an intro or recap starting after max(10 min, 40 % of the file) — for example, IntroDB data for *Iron Man* (tt0371746) contained an "intro" inside the end credits.
- IntroDB in the Lampa Android app through the app's native request (`Lampa.Reguest.native()` → `AndroidJS.httpReq`), so no proxy is needed there.
- Optional IntroDB proxy for TV browsers: `proxy/introdb_proxy.py` (Python 3.7+ standard library only) and a systemd unit.
- Diagnostics in the settings: status and response time of every source, a read-only «Проверить сейчас», plugin version, statistics (skips and time saved).
- Optional CUB sync, optional submissions to Aniskip (off by default, explicit action only), button dimming in HDR via the `adaptive_subs` event, experimental hand-over of timestamps to Lampa's built-in skip.
- Compatibility with old TV engines: ES5 + `Promise`, CSS with `-webkit-` prefixes and without flex `gap`.

### Tested

- Unit tests on Node.js 18 and 24; end-to-end tests in the Lampa 3.4.4 web build in Chromium.
- Manual tests by the maintainer on 2026-11-01 (internal build 3.0.1, same code as 1.0.0):
  - **LG OLED65M59LA, webOS 25** (Lampa web app served by Lampac), IntroDB through `proxy/introdb_proxy.py`: timestamps from IntroDB
    for *Breaking Bad* S01E01 and *House of the Dragon* S02E01, auto-skip, timeline marks, statistics. «Проверить сейчас»: IntroDB answered
    in 109 ms (a single check); TheIntroDB answered 404 and MKV chapters were unavailable (TorrServer without ffprobe) — playback was not affected.
  - **Tanix TX9, Android TV** (Lampa Android app, WebView): IntroDB through the app's native request without a proxy, IntroHater data,
    *Breaking Bad* S01E01; skipping works.

### Known issues

- Android TV (Lampa Android app): segment marks are not drawn on the progress bar, while skipping works. On LG webOS they are drawn.
- Samsung Tizen has not been tested on a real device.

### Notes

- Earlier non-public builds used internal version numbers 3.x (shown as «Skip Intro 3.0.1» in Diagnostics). The public version line
  starts at 1.0.0; settings, statistics and cached timestamps of those builds are kept (same storage keys).
- Self-hosted by IP address: Lampa does not add its cache-busting parameter to such URLs, so add `?v=1.0.0` to the plugin URL.

[Unreleased]: https://github.com/emoorpheus/lampa-skip-intro/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/emoorpheus/lampa-skip-intro/releases/tag/v1.0.0
