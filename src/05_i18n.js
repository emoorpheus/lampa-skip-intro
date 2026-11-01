
    // ---------- Язык интерфейса: как в Lampa ----------
    // Lampa хранит выбранный язык в Storage 'language' (ru, en, uk, ...) и при смене языка перезагружает страницу,
    // поэтому строки, собранные при запуске (раздел настроек), всегда на текущем языке.
    // Русский — для 'ru', английский — для всех остальных языков. Новый язык: код в I18N_LANGS и колонка в строках.
    // Строка: { ru: '...', en: '...' }; подстановки {name}; число со словом — массив форм (ru: 1, 2, 5; en: 1, many).
    var I18N_LANGS = ['ru', 'en'];
    var I18N_FALLBACK = 'en';
    var I18N = {
        // Общее
        plugin_title: { ru: 'Пропуск заставок', en: 'Skip Intro' },
        skip: { ru: 'Пропустить', en: 'Skip' },
        sources: { ru: 'Источники', en: 'Sources' },
        next_episode: { ru: 'Следующая серия', en: 'Next episode' },
        episode_n: { ru: 'Серия {n}', en: 'Episode {n}' },
        dur_hm: { ru: '{h} ч {m} мин', en: '{h} h {m} min' },
        dur_m: { ru: '{m} мин', en: '{m} min' },
        dur_s: { ru: '{s} с', en: '{s} s' },
        n_skips: { ru: ['{n} пропуск', '{n} пропуска', '{n} пропусков'], en: ['{n} skip', '{n} skips'] },
        n_seconds: { ru: ['{n} секунда', '{n} секунды', '{n} секунд'], en: ['{n} second', '{n} seconds'] },

        // Сегменты: кнопка, название, «будет пропущен(а)», «отмечен(а)»
        label_intro: { ru: 'Пропустить заставку', en: 'Skip intro' },
        label_recap: { ru: 'Пропустить рекап', en: 'Skip recap' },
        label_credits: { ru: 'Пропустить титры', en: 'Skip credits' },
        label_preview: { ru: 'Пропустить превью', en: 'Skip preview' },
        type_intro: { ru: 'Заставка', en: 'Intro' },
        type_recap: { ru: 'Рекап', en: 'Recap' },
        type_credits: { ru: 'Титры', en: 'Credits' },
        type_preview: { ru: 'Превью', en: 'Preview' },
        will_intro: { ru: 'будет пропущена', en: 'will be skipped' },
        will_recap: { ru: 'будет пропущен', en: 'will be skipped' },
        will_credits: { ru: 'будут пропущены', en: 'will be skipped' },
        will_preview: { ru: 'будет пропущено', en: 'will be skipped' },
        marked_intro: { ru: 'Заставка отмечена', en: 'Intro marked' },
        marked_recap: { ru: 'Рекап отмечен', en: 'Recap marked' },
        marked_credits: { ru: 'Титры отмечены', en: 'Credits marked' },
        marked_preview: { ru: 'Превью отмечено', en: 'Preview marked' },

        // Откуда таймкоды (TheIntroDB, IntroDB, IntroHater, Aniskip — названия, не переводятся)
        src_chapters: { ru: 'главы файла', en: 'file chapters' },
        src_user: { ru: 'ваша отметка', en: 'your mark' },
        src_subs: { ru: 'по субтитрам', en: 'from subtitles' },
        src_ass: { ru: 'по субтитрам ASS', en: 'from ASS subtitles' },
        src_audio: { ru: 'по звуку', en: 'from audio' },

        // Кнопка на экране и предупреждение перед сегментом
        badge_subs: { ru: '(по субтитрам)', en: '(from subtitles)' },
        badge_ass: { ru: '(по субтитрам ASS)', en: '(from ASS subtitles)' },
        badge_audio: { ru: '(по звуку)', en: '(from audio)' },
        badge_post: { ru: '(после титров есть сцена)', en: '(scene after the credits)' },
        hint_press: { ru: 'нажмите {key}', en: 'press {key}' },
        hint_cancel: { ru: 'нажмите {key} для отмены', en: 'press {key} to cancel' },
        warn_next_in: { ru: 'Следующая серия через {n} с', en: 'Next episode in {n} s' },
        warn_type_in: { ru: '{type} через {n} с', en: '{type} in {n} s' },
        warn_then: { ru: 'далее {next}', en: 'then {next}' },

        // Клавиши: в подсказке на кнопке («нажмите …») и в списках настроек
        key_space: { ru: 'Пробел', en: 'Space' },
        key_back: { ru: 'Назад', en: 'Back' },
        key_red: { ru: 'красную кнопку', en: 'the red button' },
        key_green: { ru: 'зелёную кнопку', en: 'the green button' },
        key_yellow: { ru: 'жёлтую кнопку', en: 'the yellow button' },
        key_blue: { ru: 'синюю кнопку', en: 'the blue button' },
        keyopt_red: { ru: 'Красная кнопка (403)', en: 'Red button (403)' },
        keyopt_green: { ru: 'Зелёная кнопка (404)', en: 'Green button (404)' },
        keyopt_yellow: { ru: 'Жёлтая кнопка (405)', en: 'Yellow button (405)' },
        keyopt_blue: { ru: 'Синяя кнопка (406)', en: 'Blue button (406)' },
        keyopt_back: { ru: 'Назад (Back)', en: 'Back' },
        keyopt_none: { ru: 'Нет', en: 'None' },
        webos_keys_note: { ru: 'На LG webOS цветные кнопки также управляют встроенными субтитрами Lampa', en: 'On LG webOS the colour buttons also control Lampa’s built-in subtitles' },

        // Настройки: Основное
        set_main: { ru: 'Основное', en: 'General' },
        set_enabled: { ru: 'Включить плагин', en: 'Enable plugin' },
        set_enabled_d: { ru: 'Показывать кнопку пропуска заставок и титров', en: 'Show the skip button for intros and credits' },
        set_auto: { ru: 'Всегда автопропуск', en: 'Always auto-skip' },
        set_auto_d: { ru: 'Перематывать без кнопки по данным из баз (с учётом порога доверия). Найденное по субтитрам или звуку — только кнопкой', en: 'Skip without the button when the timestamps come from a database (subject to the confidence threshold). Segments found from subtitles or audio are only offered as a button' },
        set_conf: { ru: 'Порог доверия для автопропуска', en: 'Auto-skip confidence threshold' },
        set_conf_d: { ru: 'Если у таймкода в базе мало подтверждений, вместо автопропуска показывается кнопка. Aniskip, главы файла и ваши отметки проходят всегда', en: 'If a database timestamp has few confirmations, the button is shown instead of auto-skipping. Aniskip, file chapters and your own marks always pass' },
        conf_off: { ru: 'Не проверять', en: 'Do not check' },
        conf_low: { ru: 'Низкий — отсеивать сомнительные', en: 'Low — filter out doubtful ones' },
        conf_mid: { ru: 'Средний — от 2 подтверждений', en: 'Medium — 2+ confirmations' },
        conf_high: { ru: 'Высокий — от 3 подтверждений', en: 'High — 3+ confirmations' },
        set_type_intro: { ru: 'Пропускать заставку (intro)', en: 'Skip intros' },
        set_type_recap: { ru: 'Пропускать рекап (recap)', en: 'Skip recaps' },
        set_type_credits: { ru: 'Пропускать титры (credits)', en: 'Skip credits' },
        set_type_preview: { ru: 'Пропускать превью (preview)', en: 'Skip previews' },
        set_movies: { ru: 'Фильмы: пропуск титров', en: 'Movies: skip credits' },
        set_movies_d: { ru: 'Титры фильмов из IntroDB и TheIntroDB. Если после титров есть сцена, плагин перемотает к ней', en: 'Movie credits from IntroDB and TheIntroDB. If there is a scene after the credits, the plugin jumps to it' },
        set_timeout: { ru: 'Скрывать кнопку через', en: 'Hide the button after' },
        set_timeout_d: { ru: 'Пока кнопка на экране, OK (или выбранная кнопка) пропускает сегмент, а не управляет плеером', en: 'While the button is on screen, OK (or the chosen key) skips the segment instead of controlling the player' },
        timeout_never: { ru: 'Не скрывать', en: 'Never hide' },

        // Настройки: Источники
        set_aniskip: { ru: 'Aniskip (аниме)', en: 'Aniskip (anime)' },
        set_aniskip_d: { ru: 'Опенинги и эндинги аниме. Сопоставление с MyAnimeList через ARM, запасной путь — поиск AniList', en: 'Anime openings and endings. Matched to MyAnimeList via ARM, with AniList search as a fallback' },
        set_chapters: { ru: 'Главы MKV (TorrServer)', en: 'MKV chapters (TorrServer)' },
        set_chapters_d: { ru: 'Если в файле есть главы Opening, Ending, Preview и т. п. — точные таймкоды без баз. Нужен ffprobe на TorrServer', en: 'If the file has chapters such as Opening, Ending or Preview, they give exact timestamps without any database. Requires ffprobe on TorrServer' },
        set_proxy: { ru: 'IntroDB: прокси', en: 'IntroDB: proxy' },
        set_proxy_d: { ru: 'IntroDB отвечает браузеру только для своего сайта (CORS). На Android запрос идёт через приложение. Иначе можно указать свой прокси: адрес с {url} или {encoded}, либо префикс', en: 'IntroDB answers browsers only for its own website (CORS). On Android the request goes through the app. Otherwise set your own proxy: an address with {url} or {encoded}, or a prefix' },
        set_detect: { ru: 'Умное обнаружение', en: 'Smart detection' },
        set_detect_d: { ru: 'Если в базах нет заставки — искать её по субтитрам (паузы в SRT/VTT, песни в ASS). Результат показывается только кнопкой', en: 'If no database knows the intro, look for it in the subtitles (gaps in SRT/VTT, songs in ASS). The result is only offered as a button' },
        set_audio: { ru: 'Обнаружение по звуку (эксперимент)', en: 'Audio detection (experimental)' },
        set_audio_d: { ru: 'Если не помогли субтитры — анализ громкости первых 6 минут через Web Audio. Если браузер не разрешает его запуск, анализ не включается', en: 'If subtitles did not help, analyse the loudness of the first 6 minutes with Web Audio. If the browser does not allow it to start, the analysis stays off' },

        // Настройки: Клавиши
        set_keys: { ru: 'Клавиши', en: 'Keys' },
        set_key_skip: { ru: 'Кнопка «Пропустить»', en: '“Skip” key' },
        set_key_skip_d: { ru: 'Работает, пока видна кнопка пропуска.', en: 'Works while the skip button is visible.' },
        set_key_cancel: { ru: 'Кнопка «Отменить»', en: '“Cancel” key' },
        set_key_cancel_d: { ru: 'Отменяет автопропуск с обратным отсчётом.', en: 'Cancels an auto-skip countdown.' },
        set_key_menu: { ru: 'Кнопка меню пропуска', en: 'Skip menu key' },
        set_key_menu_d: { ru: 'Во время просмотра открывает меню: режим сериала, сдвиг, ручные отметки.', en: 'Opens the menu during playback: series mode, offset, manual marks.' },

        // Настройки: Дополнительно
        set_more: { ru: 'Дополнительно', en: 'Advanced' },
        set_autoshift: { ru: 'Подгонять титры под длину файла', en: 'Fit credits to the file length' },
        set_autoshift_d: { ru: 'Если файл длиннее или короче, чем в базе, титры у конца файла сдвигаются вместе с концом. Заставки не сдвигаются', en: 'If the file is longer or shorter than in the database, credits near the end move with the end of the file. Intros are not moved' },
        set_hdr_dim: { ru: 'Приглушать кнопку в HDR', en: 'Dim the button in HDR' },
        set_hdr_dim_d: { ru: 'Работает вместе с плагином «Адаптивные субтитры»', en: 'Works together with the Adaptive Subtitles plugin' },
        set_submit: { ru: 'Помогать Aniskip', en: 'Contribute to Aniskip' },
        set_submit_d: { ru: 'Разрешить отправку ваших отметок и голосов «таймкод неверный» в Aniskip. Только аниме и только по команде из меню', en: 'Allow sending your marks and “wrong timestamp” votes to Aniskip. Anime only, and only when you choose it in the menu' },
        set_sync: { ru: 'Синхронизация', en: 'Sync' },
        set_sync_d: { ru: 'Настройки сериалов и ваши отметки на всех устройствах через аккаунт CUB. Lampa синхронизирует только с CUB Premium', en: 'Series settings and your marks on all devices via your CUB account. Lampa syncs only with CUB Premium' },
        set_native: { ru: 'Отдавать таймкоды в Lampa (эксперимент)', en: 'Pass timestamps to Lampa (experimental)' },
        set_native_d: { ru: 'Если таймкоды серии уже в кэше, передать их встроенному пропуску Lampa (штатная кнопка, отметки, настройки сегментов). Обычно со следующей серии после предзагрузки', en: 'If the episode’s timestamps are already cached, hand them to Lampa’s built-in skip (its own button, timeline marks and segment settings). Usually from the next episode on, after prefetching' },

        // Режим сериала
        mode_default: { ru: 'Как в настройках', en: 'As in settings' },
        mode_auto: { ru: 'Всегда автопропуск', en: 'Always auto-skip' },
        mode_button: { ru: 'Только кнопка', en: 'Button only' },
        mode_off: { ru: 'Выключен', en: 'Off' },

        // Статистика
        stats_none: { ru: 'Пока ничего не пропущено', en: 'Nothing skipped yet' },
        stats_saved: { ru: 'Сэкономлено {time} ({count})', en: 'Saved {time} ({count})' },

        // Меню: «⋯» в карточке и клавиша в плеере
        menu_mode: { ru: 'Режим: {mode}', en: 'Mode: {mode}' },
        menu_mode_title: { ru: 'Режим пропуска', en: 'Skip mode' },
        menu_only_movie: { ru: 'Только для этого фильма', en: 'Only for this movie' },
        menu_only_series: { ru: 'Только для этого сериала', en: 'Only for this series' },
        menu_shift: { ru: 'Сдвиг таймкодов: {shift}', en: 'Timestamp offset: {shift}' },
        menu_shift_d: { ru: 'Для данных из баз: «+» — позже, «\u2212» — раньше', en: 'For database timestamps: “+” later, “\u2212” earlier' },
        menu_shift_title: { ru: 'Сдвиг таймкодов', en: 'Timestamp offset' },
        shift_none: { ru: 'нет', en: 'none' },
        shift_zero: { ru: 'Без сдвига', en: 'No offset' },
        menu_clear: { ru: 'Сбросить кэш таймкодов', en: 'Clear cached timestamps' },
        menu_clear_d: { ru: 'Данные будут заново запрошены из баз', en: 'Timestamps will be requested from the databases again' },
        noty_cache_cleared: { ru: 'Кэш очищен', en: 'Cache cleared' },
        menu_forget: { ru: 'Забыть пропуски (умный режим)', en: 'Forget skips (smart mode)' },
        menu_forget_d: { ru: 'Снова кнопка вместо обратного отсчёта', en: 'Show the button again instead of the countdown' },
        noty_forgotten: { ru: 'Пропуски забыты', en: 'Skips forgotten' },
        menu_del_marks: { ru: 'Удалить мои отметки ({n})', en: 'Delete my marks ({n})' },
        noty_marks_deleted: { ru: 'Отметки удалены', en: 'Marks deleted' },
        menu_episode: { ru: 'Эта серия', en: 'This episode' },
        menu_mark: { ru: 'Отметить: {type}', en: 'Mark: {type}' },
        menu_mark_d: { ru: 'Начало — сейчас ({time}). Конец — через это же меню', en: 'Start: now ({time}). Set the end from this menu' },
        noty_mark_started: { ru: 'Начало отмечено: {time}. В конце откройте меню и выберите «Конец отметки»', en: 'Start marked: {time}. At the end, open the menu and choose “Finish mark”' },
        menu_mark_end: { ru: 'Конец отметки: {type}', en: 'Finish mark: {type}' },
        menu_mark_cancel: { ru: 'Отменить отметку', en: 'Cancel mark' },
        noty_mark_short: { ru: 'Слишком короткий отрезок — отметка не сохранена', en: 'Segment too short — mark not saved' },
        menu_del_ep_marks: { ru: 'Удалить мои отметки серии ({n})', en: 'Delete my marks for this episode ({n})' },
        noty_ep_marks_deleted: { ru: 'Отметки серии удалены', en: 'Episode marks deleted' },
        menu_vote: { ru: 'Aniskip: таймкод неверный', en: 'Aniskip: wrong timestamp' },
        menu_vote_d: { ru: '{seg} (голос «против»)', en: '{seg} (downvote)' },
        noty_vote_ok: { ru: 'Голос отправлен в Aniskip', en: 'Vote sent to Aniskip' },
        noty_vote_fail: { ru: 'Aniskip: не удалось отправить ({err})', en: 'Aniskip: could not send ({err})' },
        menu_submit: { ru: 'Aniskip: отправить мои отметки', en: 'Aniskip: submit my marks' },
        menu_submit_d: { ru: 'MAL {mal}, серия {ep}', en: 'MAL {mal}, episode {ep}' },
        noty_submit_ok: { ru: 'Отправлено в Aniskip: {ok}', en: 'Sent to Aniskip: {ok}' },
        noty_submit_part: { ru: 'Aniskip: отправлено {ok}, ошибок {fail}', en: 'Aniskip: sent {ok}, failed {fail}' },
        menu_movie: { ru: 'Фильм', en: 'Movie' },
        menu_series: { ru: 'Сериал', en: 'Series' },

        // «Источники» в меню плеера
        desc_lampa: { ru: 'Таймкоды передал источник видео — работает встроенный пропуск Lampa', en: 'The video source provided timestamps — Lampa’s built-in skip is active' },
        desc_off_movie: { ru: 'Для этого фильма пропуск выключен', en: 'Skipping is off for this movie' },
        desc_off_series: { ru: 'Для этого сериала пропуск выключен', en: 'Skipping is off for this series' },
        desc_short: { ru: 'Слишком короткое видео — плагин не вмешивается', en: 'Video too short — the plugin stays out' },
        desc_end: { ru: 'конец', en: 'end' },
        desc_shift: { ru: 'сдвиг {v}', en: 'offset {v}' },
        desc_none: { ru: 'Таймкодов не найдено', en: 'No timestamps found' },
        desc_loading: { ru: 'Загрузка…', en: 'Loading…' },
        desc_waiting: { ru: 'ждём ответ', en: 'waiting' },
        desc_found: { ru: 'есть', en: 'found' },
        desc_empty: { ru: 'пусто', en: 'empty' },
        desc_cached: { ru: 'кэш', en: 'cache' },
        desc_native: { ru: 'переданы в Lampa', en: 'passed to Lampa' },
        marks_drawn: { ru: 'Отметки на шкале: {n}', en: 'Timeline marks: {n}' },
        marks_lampa: { ru: 'Отметки на шкале рисует Lampa', en: 'Lampa draws the timeline marks' },
        marks_noduration: { ru: 'Отметки на шкале: нет — длина видео неизвестна', en: 'Timeline marks: none — the video length is unknown' },
        marks_nohost: { ru: 'Отметки на шкале: нет — шкала плеера не найдена', en: 'Timeline marks: none — the player timeline was not found' },

        // Диагностика в настройках
        diag_title: { ru: 'Диагностика', en: 'Diagnostics' },
        diag_version: { ru: 'Версия плагина', en: 'Plugin version' },
        diag_check: { ru: 'Проверить сейчас', en: 'Check now' },
        diag_check_d: { ru: 'Тестовые запросы: Game of Thrones S1E1, Attack on Titan, TorrServer', en: 'Test requests: Game of Thrones S1E1, Attack on Titan, TorrServer' },
        diag_clear: { ru: 'Очистить кэш', en: 'Clear cache' },
        diag_clear_d: { ru: 'Таймкоды и сопоставления аниме. Настройки, статистика и ваши отметки остаются', en: 'Timestamps and anime mappings. Settings, statistics and your marks are kept' },
        noty_cache_cleared_n: { ru: 'Кэш очищен: {n}', en: 'Cache cleared: {n}' },
        diag_stats: { ru: 'Статистика', en: 'Statistics' },
        diag_stats_reset: { ru: 'Сбросить статистику', en: 'Reset statistics' },
        noty_stats_reset: { ru: 'Статистика сброшена', en: 'Statistics reset' },
        noty_checking: { ru: 'Проверка источников…', en: 'Checking sources…' },
        diag_arm: { ru: 'ARM (аниме → MyAnimeList)', en: 'ARM (anime → MyAnimeList)' },
        diag_never: { ru: 'ещё не запрашивался', en: 'not requested yet' },
        diag_ms: { ru: '{n} мс', en: '{n} ms' },
        via_android: { ru: 'через приложение Android', en: 'via the Android app' },
        via_proxy: { ru: 'через прокси', en: 'via proxy' },
        via_direct: { ru: 'напрямую', en: 'direct' },
        ago_now: { ru: 'только что', en: 'just now' },
        ago_min: { ru: '{n} мин назад', en: '{n} min ago' },
        ago_h: { ru: '{n} ч назад', en: '{n} h ago' },
        ago_d: { ru: '{n} дн назад', en: '{n} d ago' },
        st_ok: { ru: 'работает', en: 'working' },
        st_empty: { ru: 'работает (для серии пусто)', en: 'working (nothing for this episode)' },
        st_network: { ru: 'нет ответа (возможно, CORS или нет сети)', en: 'no response (CORS or no network?)' },
        st_timeout: { ru: 'таймаут', en: 'timeout' },
        st_http: { ru: 'ошибка сервера', en: 'server error' },
        st_limit: { ru: 'лимит запросов', en: 'rate limited' },
        st_auth: { ru: 'доступ запрещён', en: 'access denied' },
        st_format: { ru: 'непонятный ответ', en: 'unexpected response' },
        st_unavailable: { ru: 'недоступно (нет ffprobe или старая версия TorrServer)', en: 'unavailable (no ffprobe or an old TorrServer version)' },
        st_error: { ru: 'ошибка', en: 'error' }
    };

    var I18n = {
        // Код языка Lampa; без выбранного языка Lampa работает на русском (core/lang.js: lang_default = 'ru')
        code: function () {
            var c = '';
            try { c = String(Lampa.Storage.get('language', '') || ''); } catch (e) {}
            if (!c) {
                try { c = String(window.localStorage.getItem('language') || ''); } catch (e) {}
            }
            return c || 'ru';
        },
        lang: function () {
            var c = this.code();
            return contains(I18N_LANGS, c) ? c : I18N_FALLBACK;
        },
        has: function (key) {
            return Object.prototype.hasOwnProperty.call(I18N, key);
        },
        // Строка или массив форм на нужном языке; нет перевода — английский, затем русский
        raw: function (key, lang) {
            if (!this.has(key)) return null;
            var row = I18N[key];
            lang = lang || this.lang();
            if (row[lang] !== undefined) return row[lang];
            return row[I18N_FALLBACK] !== undefined ? row[I18N_FALLBACK] : row.ru;
        },
        // Подставляет только переданные значения: {url} в описании прокси остаётся как есть
        format: function (text, vars) {
            text = String(text);
            if (!vars) return text;
            return text.replace(/\{([a-z0-9_]+)\}/gi, function (m, k) {
                return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
            });
        },
        form: function (lang, n) {
            if (lang === 'ru') return plural(n, 0, 1, 2);
            return Math.abs(n) === 1 ? 0 : 1;
        }
    };

    // Строка интерфейса на языке Lampa: tr('skip'), tr('hint_press', { key: 'OK' })
    function tr(key, vars) {
        var text = I18n.raw(key);
        if (text === null) return key;
        if (Array.isArray(text)) text = text[text.length - 1];
        return I18n.format(text, vars);
    }

    // Число со словом: trn('n_skips', 5) -> «5 пропусков» / «5 skips»
    function trn(key, n, vars) {
        var lang = I18n.lang(), forms = I18n.raw(key, lang);
        if (forms === null) return String(n);
        if (!Array.isArray(forms)) forms = [forms];
        var v = vars ? copyObject(vars) : {};
        v.n = n;
        return I18n.format(forms[Math.min(I18n.form(lang, n), forms.length - 1)], v);
    }
