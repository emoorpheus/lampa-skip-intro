# Checklist for testing on a real TV

Tested so far: LG OLED65M59LA (webOS 25) and Tanix TX9 (Android TV, Lampa Android app) — see README → Tested devices.
Reports from other devices are very welcome, especially Samsung Tizen, older webOS versions and other Android TV boxes.
These steps make a report useful. Please remove IP addresses and logins from screenshots and logs.

The labels below are those of the English interface (Settings → Interface → Interface language → English).
With Lampa in Russian, use the [Russian version](tv-checklist.ru.md) of this checklist.

1. **Version:** Settings → Skip Intro → Diagnostics → **Plugin version** shows the installed version.
2. **Sources:** **Check now** — note the status of TheIntroDB, IntroDB, IntroHater, Aniskip, ARM, AniList and
   **MKV chapters (TorrServer)**.
3. **Episode:** *Game of Thrones* S01E01 — at the time of writing IntroDB has the intro at 7:17–8:51; **Skip intro** should appear,
   **OK** skips it.
4. **Next episode:** near the end credits **Next episode** should appear; **OK** switches to S01E02.
5. **Movie:** *Iron Man* (2008) — **Skip credits** near the end credits; no **Skip intro** at the end of the movie.
6. **Remote:** **OK** and **Back** still work normally when no button is shown. With **Always auto-skip** on, **Back** during the
   countdown cancels it and the player stays open. If you set **Keys → Skip menu key** to a color key, that key opens the skip menu.
7. **Timeline marks:** while the player panel is visible, are the segments drawn on the progress bar (light blue, ads in yellow)?
   Settings → Skip Intro → Diagnostics → **Timeline marks (last playback)** shows who drew them and how many. The end of the
   **Sources** line in the skip menu shows the state: “Timeline marks: 2”, “Timeline marks: none — the video length is unknown”,
   “Timeline marks: none — the player timeline was not found” or “Lampa draws the timeline marks”. Note whether
   **Pass timestamps to Lampa (experimental)** is on.
8. **Online source with its own timestamps:** play an episode from an online source that passes its own timestamps. With auto-skip
   off, **Skip intro** should appear from 0:00 and **OK** should jump past the intro; with auto-skip on, the intro should be skipped
   without a button; near the end credits **Next episode** should appear. Lampa's own skip button and its “Segment skipped” notice
   should not appear for such episodes.
9. **Language:** with Settings → Interface → Interface language set to English, the plugin's settings, button and skip menu are
   in English; with Russian, in Russian.
10. **Report:** open an issue with your device model, OS version (webOS / Tizen / Android TV), Lampa version and client app, what worked
    and what did not. Console lines starting with `[SkipIntro]` help if you can get them; on Android: `adb logcat | grep -F "[SkipIntro]"`.
