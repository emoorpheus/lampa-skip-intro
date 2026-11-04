# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-11-04

A **Report for the developer** screen: everything needed to look into a problem, on one screen of large text that can be
photographed with a phone, and a fix for the first episode of a series: a recap from the databases is no longer skipped there.
Tested on a Tanix TX9 (Android TV); checked by the maintainer on an LG OLED TV.

### Added

- Settings → Skip Intro → Diagnostics → **Report for the developer** (right after “Plugin version”). The window (Lampa's own
  `Lampa.Modal`, text 1.35 times larger than the settings) shows:
  - the plugin version, the Lampa version, the platform, the Android or Tizen version, the browser engine and the screen size;
  - the settings changed from the defaults (settings with an address, such as the IntroDB proxy, show only “set”);
  - the state and response time of every source, the timeline marks of the last playback and the statistics;
  - the last 30 lines of the plugin's log.
  Up and Down scroll the window, Back closes it and returns to the settings. Nothing is sent anywhere: the user takes a photo and
  attaches it to an issue. Before a line is shown or stored, addresses (`<url>`), IPv4/IPv6 addresses (`<ip>`), local host names
  (`<host>`), e-mail addresses (`<email>`), video and subtitle file names (`<file>`), paths (`<path>`), keys, tokens and passwords
  (`<hidden>`) and long hashes or IDs (`<hash>`, `<id>`) are replaced; a line is cut at 300 characters. Lampa builds without
  `Lampa.Modal` show the notice “The report window is not available in this Lampa version”.
- The plugin's log is kept between Lampa restarts: the last 40 lines (already cleaned) are stored in `localStorage`
  (`skip_intro_journal`, written at most every 3 s).
- Log lines `Source <name>: <state> <count> (cache)` for every source answer and
  `Segments: intro 7:17–8:51 theintrodb, credits 1:00:32–1:01:40 theintrodb | length 3700 s` whenever the segments of the current
  video change.

### Fixed

- The first episode of the first season (S01E01, not movies): segments marked as a **recap** in TheIntroDB, IntroDB, IntroHater
  or Aniskip are ignored. The first episode has nothing to recap, and such a mark cuts out the start of the story. Found on
  *Naruto* S01E01: right after the intro (0:01–1:42) Aniskip has a recap at 1:42–2:40 and IntroDB at 1:44–3:03, and 1.1.0 skipped
  it. The intro and the credits of that episode, your own marks, the chapters of the file and all other episodes are not changed.
  The log shows `First episode: recap from the databases ignored — aniskip 1:42–2:40, introdb 1:44–3:03` (once per segment).

### Tested

- Unit tests on Node.js 24 (134 tests: 44 + 60 + 16 + 4 + 10; new: two for the report, two for the first episode) and end-to-end tests in the Lampa 3.4.4
  web build in Chromium (132 checks; new: the report opens from the settings, its text is larger than the settings, Down scrolls,
  Back returns to the settings).
- **Tanix TX9** (Android 11, Lampa 3.4.4, WebView Chrome 156): the 1.1.1 file loaded in place of the installed one through the
  WebView developer tools (the server copy was not changed). The report opened from the settings and was readable on a 1080p screen
  capture; Down (sent with `adb`) scrolled it; Back (sent with `adb`) closed it and returned to the settings. The source states and
  the timeline marks of a playback before the restart were shown; the log showed `Plugin v1.1.1 initialized …` and no addresses.
  The first-episode fix: a 5-minute test video was played as *Naruto* S01E01 (the TMDB card, season 1, episode 1, real answers of
  the databases). The log showed `First episode: recap from the databases ignored — introdb 1:44–3:03` and `… — aniskip 1:42–2:40`
  and the segments `intro 0:01–1:42 aniskip`; after the intro skip (to 1:32) the video played on past 3:03 without a jump.
- **LG OLED TV** (webOS 25): checked by the maintainer, no problems found.
- Not tested on Samsung Tizen.

## [1.1.0] - 2026-11-03

An English interface, timestamps from the video source skipped with the plugin's settings, timeline marks on Android TV and
fixes found on a Tanix TX9. Tested on the maintainer's LG OLED65M59LA (webOS 25) and Tanix TX9 (Android TV), see “Tested”.

### Added

- **English interface.** The plugin follows the Lampa language (Settings → Interface → Interface language): Russian for Russian,
  English for every other language. All interface strings are in one table, `src/05_i18n.js` (plural forms included).
- Player menu → “Sources” tells the state of the timeline marks: “Timeline marks: 2”, “none — the video length is unknown”,
  “none — the player timeline was not found” or, in the hand-over mode, “Lampa draws the timeline marks”. It also shows how many
  times the plugin skipped instead of Lampa. The log gets a `[SkipIntro] Timeline marks: …` line whenever the state changes.
- Settings → Skip Intro → Diagnostics → “Timeline marks (last playback)”: who drew the marks and how many, where the timestamps came
  from (for example “timestamps from the video source, by plugin settings”) and the video length. It works without the player menu,
  so no color keys are needed.
- Log lines: `Source segments: …` (what the video source passed), `Video source segments are skipped by the plugin settings (Lampa got none): …`,
  `Lampa's built-in skip cannot work while the video length is unknown (…) — plugin skips to …`, then `Plugin skip worked, position …`
  or `Plugin skip did not work after 3 attempts, …`.

### Changed

- **Timestamps from the video source are skipped by the plugin, with the plugin's settings.** When the source of a video (for example
  an online balancer) passes its own timestamps (`data.segments`), Lampa used to skip them with Lampa's settings and the plugin stayed idle.
  Now the plugin takes them: button or auto-skip, the segment types, the per-series mode and the countdown work as for timestamps from
  the databases. For the built-in player Lampa gets empty segments while the player `start` event is sent (Lampa 3.4.4 reads
  `data.segments` there: [L21269-21315](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L21269-L21315)), so Lampa's own skip button, its “Segment skipped” notice and its marks
  do not appear for such videos; the plugin draws its own marks (ads in yellow, `.skip-intro-mark--ad`). Afterwards `data.segments`
  is restored. External players (Android, Apple TV) are started before this event and get `data.segments` unchanged ([L36148-36254](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L36148-L36254)).
- The plugin takes the same segments Lampa 3.4.4 would skip, including Lampa's adjustment to the real file length when the source gives
  a reference length (`duration_ms`) ([L21359-21563](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L21359-L21563), ported and compared with Lampa's module in the tests).
  Difference: Lampa adjusts once, at `loadeddata`; the plugin adjusts again when the length becomes known.
- How the segments are named: `ad` → “Ad” (button “Skip ad”); a `skip` segment that ends at the end of the file or starts after 70 %
  of its length → credits (the same rule Lampa uses for its “Next episode” button,
  [L22277-22290](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L22277-L22290)); a `skip` segment that starts within max(10 min, 40 % of the length) → intro; anything else → credits.
  While the length is unknown, the reference length is used, or only the 10-minute limit. Ads have no separate switch in the settings.
- Priority: your own marks → timestamps from the video source → MKV chapters → databases. The databases are still queried, for
  the segment types the source does not provide.
- With the per-series mode “Off” nothing skips these timestamps: Lampa gets empty segments and the plugin stays idle.
  A switched-off segment type (for example “Skip intros”) is not skipped either; the other types are.
- With the plugin switched off, with “Pass timestamps to Lampa” switched on, with “Movies: skip credits” switched off (for a movie),
  or for videos that are not an episode or a movie, Lampa skips these timestamps as before.
- **One confident database is enough for auto-skip.** For each segment type the plugin takes the first database by priority
  (TheIntroDB → IntroDB → IntroHater; Aniskip first for anime). When its timestamps did not pass the confidence threshold, the segment
  only got the button, even if another database was sure. On the Tanix TX9, Game of Thrones S01E03 and S01E05 got the button:
  TheIntroDB had the intro with `conf` 0.016 and 0.298, IntroDB had it with `conf` 1 and IntroHater marked it `verified`. Now, if the
  first database does not pass the threshold and another one does:
  - a segment of the first database that lies within the confident segment (± 10 s) stays and counts as confirmed; “Sources” shows
    “Intro 0:07–1:45 (TheIntroDB, confirmed by IntroDB)”. Its timestamps are kept because TheIntroDB gives the reference length
    the credits are fitted to;
  - otherwise the confident database's timestamps are used.
  If no database passes the threshold, the button stays, as before. Your marks, the video source's timestamps and MKV chapters always pass.
- **Credits are fitted to files up to 2 minutes longer or shorter than the database's reference** (was 90 s). When the file is longer
  and the database has credits or a preview that end at the end of the reference, all its credits and previews move by the
  difference, not only that last segment. On the TX9, Iron Man from an online source showed “Skip credits” while the film was still on:
  TheIntroDB has credits 7039–7512 s and 7546–7561 s with a reference of 7561.8 s, the file is 7656 s (94.2 s longer); the real credits
  start at 1:58:54 (checked by the maintainer), and 7039 + 94.2 = 7133.2 s = 1:58:53. When the file is shorter, only the segment at
  the end moves: what is missing may be after the credits (for example no next-episode preview), and moving the credits back would
  cut the end of the episode. Intros are not moved.
- Timeline marks have their own style (`.skip-intro-mark`, the same look as segments in Lampa 3.4.4), so they no longer depend on
  the timeline styles of a particular Lampa build. If the timeline has no `position`, the plugin sets `position: relative` on it.
- If the video reports no finite duration (`NaN` or `Infinity`), the marks use the end of `video.seekable`; skipping is not affected.
- Hand-over mode (“Pass timestamps to Lampa”): Lampa 3.4.4 draws its own marks once, with the duration known at `loadeddata`; if they
  have zero width or no segment styles (not `position: absolute`), the plugin draws the handed-over segments itself.
- Log messages are in English.
- CI also runs on the `next` branch.

### Fixed

- **No timeline marks on Android TV** (known issue of 1.0.0). In the Lampa Android app (Tanix TX9) the segments were not drawn on the
  progress bar; with the own mark style and the `video.seekable` fallback above they are shown there.
- **Timeline marks for timestamps from the video source.** Lampa 3.4.4 draws these marks itself, with `video.duration` known at
  `loadeddata`, and does not redraw them later ([L21638-21664](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L21638-L21664)). In the Android app the length was still unknown at that moment,
  so the marks had zero width. The plugin draws these segments itself.
- **Lampa's built-in skip while the video length is unknown** (with the plugin switched off for the video, or in the hand-over mode).
  Lampa 3.4.4 sets `video.currentTime = Math.min(video.duration, segment end)` ([L25002-25005](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L25002-L25005)). With `NaN` as the length this
  throws `Failed to set the 'currentTime' property … non-finite`, and Lampa does not retry: it has already marked the segment as viewed
  ([L21276-21283](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L21276-L21283)). Where Lampa would skip automatically (its “Intro and other” setting, for ads its ad setting), the plugin now
  jumps to the end of the segment itself, once per segment, shows Lampa's own “Segment skipped” notice and writes the jump to the log.
  If the position does not change, it tries twice more, a second apart.
- **The plugin's own skip while the video length is unknown.** `Lampa.PlayerVideo.to()` in Lampa 3.4.4 also uses
  `Math.min(seconds, video.duration)` and swallows the error, so the jump did not happen. In this case the plugin now sets the position directly.
- **Color keys on the Tanix TX9.** The WebView there reports the red, green, yellow and blue keys with `keyCode` 0 and `key`
  `ColorF0Red` … `ColorF3Blue`; Lampa passes on `keyCode` ([L4308-L4315](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L4308-L4315)), so a color key chosen for the skip menu (or for skip
  or cancel) did nothing. Now, when `keyCode` is 0, the plugin takes the key from its name (UI Events key values): 403 … 406.
- **Auto-skip at the very start of a stream is checked and repeated.** On the Tanix TX9 (HLS from an online source) the log showed
  `Skipped intro to 90 (auto)` before the player started playing, and the video then played from 0:00; the plugin did not check its
  seek and did not try again. Now auto-skip waits until the video has data (`readyState` 2 or more, at most 5 s), and after each of
  its own seeks the plugin checks the position: if the video goes on from where it was, the seek is repeated once a second, up to
  3 attempts; after that the segment gets the button. A position elsewhere (you rewound yourself) is left alone. Log lines:
  `Video not ready yet (readyState …) — auto-skip of … waits`, `Skip did not take effect (position …, readyState …) — retrying, attempt …`,
  `Skip worked, position … (attempt …)`, `Skip did not work after 3 attempts … — button only`.
- **A few seconds of an earlier start no longer make an episode “started”.** Lampa's history of a short earlier start (for example
  4 s, 0 %) switched intro and recap auto-skip to the button. Now Lampa's history has the same limits as the player's timecode: more
  than 15 s or more than 5 %. Lampa itself resumes playback only from more than 10 s ([L29823](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L29823)).
- **Back during the auto-skip countdown no longer closes the player in the Lampa Android app.** The app does not pass the Back key
  to the page; it calls `window.history.back` ([MainActivity.kt L541-548](https://github.com/lampa-app/LAMPA/blob/28d7616f52d969abd6a93d8692b15a8525b36efc/app/src/main/java/top/rootu/lampa/MainActivity.kt#L541-L548)). Lampa then runs the function set by
  `Activity.call`, normally `Controller.back`, and the player closes ([L52070-52081](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L52070-L52081),
  [L53456-53458](https://github.com/yumata/lampa/blob/4294a571aad8883116e57d975ad05519f84be13e/app.min.js#L53456-L53458)). On the Tanix TX9 Back closed the player instead of cancelling the countdown. Now, while the
  countdown is shown, Back cancels it (log line `Auto-skip cancelled by user`); after that Back works as before.

### Tested

- **Tanix TX9** (Android 11, Lampa Android app 1.12.4, Lampa 3.4.4, WebView 84), 2026-11-03: a test plan run over `adb` (remote key
  events) and the WebView console. Auto-skip, button, countdown and Back, “Next episode”, movie credits, per-series modes and offset,
  own marks, cache reset, switched-off segment types, the hand-over mode, the English interface and switching episodes passed; the color
  keys and the Iron Man credits did not and were fixed (above). With the fixes: the blue key arrives as `keyCode 0 ColorF3Blue` and opens
  the skip menu; Iron Man: the credits warning from 7129 s, auto-skip `Skipped credits to 7606.523 (auto)` and
  `Skip worked, position 2:06:47 (attempt 1)`; “Sources” listed the credits 1:58:54–2:06:47 from TheIntroDB, offset +94.523 s,
  confirmed by IntroDB;
  Game of Thrones S01E07 (TheIntroDB `conf` 0.097, IntroDB `conf` 1): `Skipped intro to 110.25 (auto)`; S01E06: credits from IntroDB
  (TheIntroDB's credits to the end of the file have `conf` 0.247 and are not confirmed), `Skip credits at the end of the episode -> to_end (auto)`.
  The color keys were sent with `adb` (`KEYCODE_PROG_BLUE`), not pressed on the remote.
- **LG OLED65M59LA, webOS 25** (Lampa web app served by Lampac): checked by the maintainer on 2026-11-03; no problems found.
- The TX9 build had the same code under a pre-release version number; the 1.1.0 file differs from it only in the version string.
- Unit tests (130; CI runs them on Node.js 18, 22 and 24). End-to-end tests in the Lampa 3.4.4 web build in Chromium (130 checks): timestamps from
  the video source with a known and an unknown video length, per-series mode “Off”, switched-off segment types, an `ad` segment,
  movies with credits switched off, the hand-over mode, a lost seek at the start of a stream (`e2e/e2e_seek.js`), Back in the Android
  app modelled with a `popstate` event (`e2e/e2e_back.js`), the English interface in a real Lampa set to English. The ported segment
  selection matches Lampa's own module in all compared cases, with and without a known length.

### Known issues

- Samsung Tizen has not been tested on a real device.
- Files that differ from the database's reference file (for example with an ad inserted at the start): intros are not moved, only
  the credits near the end are fitted (up to 2 min). Use the per-series offset or your own marks.

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

[Unreleased]: https://github.com/emoorpheus/lampa-skip-intro/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/emoorpheus/lampa-skip-intro/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/emoorpheus/lampa-skip-intro/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/emoorpheus/lampa-skip-intro/releases/tag/v1.0.0
