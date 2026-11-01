# Checklist for testing on a real TV

Tested so far (version 1.0.0): LG OLED65M59LA (webOS 25) and Tanix TX9 (Android TV, Lampa Android app) — see README → Tested devices.
Reports from other devices are very welcome, especially Samsung Tizen and older webOS versions, and reports on 1.1.0-beta.1 from
Android TV. These steps make a report useful. Please remove IP addresses and logins from screenshots and logs.

Labels are given in English (1.1.0-beta.1 and later with Lampa in English) and in Russian (1.0.0, or Lampa in Russian).

1. **Version:** Settings → Skip Intro → Diagnostics → **Plugin version** («Настройки → Пропуск заставок → Диагностика → Версия плагина»)
   shows the installed version.
2. **Sources:** **Check now** («Проверить сейчас») — note the status of TheIntroDB, IntroDB, IntroHater, Aniskip, ARM, AniList and
   **MKV chapters (TorrServer)** («Главы MKV (TorrServer)»).
3. **Episode:** *Game of Thrones* S01E01 — at the time of writing IntroDB has the intro at 7:17–8:51; **Skip intro** («Пропустить заставку»)
   should appear, **OK** skips it.
4. **Next episode:** near the end credits **Next episode** («Следующая серия») should appear; **OK** switches to S01E02.
5. **Movie:** *Iron Man* (2008) — **Skip credits** («Пропустить титры») near the end credits; no **Skip intro** at the end of the movie.
6. **Remote:** **OK** and **Back** still work normally when no button is shown.
7. **Timeline marks:** while the player panel is visible, are the segments drawn on the progress bar (light blue)? Note whether
   **Pass timestamps to Lampa (experimental)** («Отдавать таймкоды в Lampa (эксперимент)») is on. From 1.1.0-beta.1 on the plugin also
   tells the state: assign **Keys → Skip menu key** («Клавиши → Кнопка меню пропуска»), press that key during playback and read the end
   of the **Sources** («Источники») line — “Timeline marks: 2”, “none — the video length is unknown”, “none — the player timeline was not
   found” or “Lampa draws the timeline marks” (in Russian: «Отметки на шкале: …»).
8. **Language (1.1.0-beta.1 and later):** with Settings → Interface → Interface language set to English, the plugin's settings, button and
   player menu are in English; with Russian, in Russian.
9. **Report:** open an issue with your device model, OS version (webOS / Tizen / Android TV), Lampa version and client app, what worked
   and what did not. Console lines starting with `[SkipIntro]` help if you can get them; on Android: `adb logcat | grep -F "[SkipIntro]"`.
