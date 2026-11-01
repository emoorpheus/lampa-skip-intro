# Checklist for testing on a real TV

Tested so far: LG OLED65M59LA (webOS 25) and Tanix TX9 (Android TV, Lampa Android app) — see README → Tested devices.
Reports from other devices are very welcome, especially Samsung Tizen and older webOS versions. These steps make a report useful.
Please remove IP addresses and logins from screenshots and logs.

1. **Version:** Настройки → Пропуск заставок → Диагностика → «Версия плагина» shows the installed version.
2. **Sources:** «Проверить сейчас» — note the status of TheIntroDB, IntroDB, IntroHater, Aniskip, ARM, AniList and «Главы MKV (TorrServer)».
3. **Episode:** *Game of Thrones* S01E01 — at the time of writing IntroDB has the intro at 7:17–8:51; «Пропустить заставку» should appear, **OK** skips it.
4. **Next episode:** near the end credits «Следующая серия» should appear; **OK** switches to S01E02.
5. **Movie:** *Iron Man* (2008) — «Пропустить титры» near the end credits; no «Пропустить заставку» at the end of the movie.
6. **Remote:** **OK** and **Back** still work normally when no button is shown.
7. **Timeline marks:** while the player panel is visible, are the segments drawn on the progress bar (light blue)? On Android TV they
   are currently missing — note whether «Отдавать таймкоды в Lampa (эксперимент)» is on.
8. **Report:** open an issue with your device model, OS version (webOS / Tizen / Android TV), Lampa version and client app, what worked
   and what did not. Console lines starting with `[SkipIntro]` help if you can get them; on Android: `adb logcat | grep -F "[SkipIntro]"`.
