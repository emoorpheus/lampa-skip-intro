
    // ===================== Плагин =====================

    var SCRIPT_SRC = '';
    try { SCRIPT_SRC = (document.currentScript && document.currentScript.src) || ''; } catch (e) {}

    var PLUGIN_NAME = 'Skip Intro/Outro + Aniskip';
    var PLUGIN_AUTHOR = '@PLUGIN_AUTHOR@';    // package.json config.pluginAuthor (пусто — не показывается)
    var NET_TIMEOUT = 5e3;
    var FFP_TIMEOUT = 3e4;          // TorrServer запускает ffprobe по торренту: бывает долго
    var DETECT_WINDOW = 360;
    var COUNTDOWN_MS = 4e3;
    var LONGPRESS_MS = 800;
    var WARN_LEAD = 5;              // с: предупреждение до начала сегмента (как preview в Lampa)
    var LABELS = {
        intro: 'Пропустить заставку',
        recap: 'Пропустить рекап',
        credits: 'Пропустить титры',
        preview: 'Пропустить превью'
    };
    var TYPE_NAMES = { intro: 'Заставка', recap: 'Рекап', credits: 'Титры', preview: 'Превью' };
    var SOURCE_NAMES = {
        theintrodb: 'TheIntroDB', introdb: 'IntroDB', introhater: 'IntroHater', aniskip: 'Aniskip',
        chapters: 'главы файла', user: 'ваша отметка', subs: 'по субтитрам', ass: 'по субтитрам ASS', audio: 'по звуку'
    };
    // Коды клавиш как в Lampa (interaction/keypad.js); 4 убран — на Samsung Orsay это «влево»
    var KEY_MAP = {
        enter: [13, 29443, 117, 65385],
        space: [32],
        back: [8, 27, 461, 10009, 88],
        red: [403],
        green: [404],
        yellow: [405],
        blue: [406]
    };
    var ENTER_CODES = KEY_MAP.enter;
    var KEY_TITLES = {
        enter: 'OK',
        space: 'Пробел',
        back: 'Назад',
        red: 'красную кнопку',
        green: 'зелёную кнопку',
        yellow: 'жёлтую кнопку',
        blue: 'синюю кнопку'
    };
    var COLOR_KEYS = { red: 'Красная кнопка (403)', green: 'Зелёная кнопка (404)', yellow: 'Жёлтая кнопка (405)', blue: 'Синяя кнопка (406)' };
    var WEBOS_KEYS_NOTE = 'На LG webOS цветные кнопки также управляют встроенными субтитрами Lampa';

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[SkipIntro]');
            console.log.apply(console, args);
        } catch (e) {}
    }

    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function now() {
        return Date.now();
    }

    function storageGet(name, def) {
        try {
            var v = Lampa.Storage.get(name, def);
            if (typeof v === 'string' && /^[\[{]/.test(v)) v = JSON.parse(v);
            return v;
        } catch (e) { return def; }
    }

    function storageObject(name) {
        var v = storageGet(name, '{}');
        return isObj(v) ? copyObject(v) : {};
    }

    function storageSet(name, value) {
        try { Lampa.Storage.set(name, value); } catch (e) { log('Storage.set failed', name, e && e.message); }
    }

    function uuid() {
        var b = [], i;
        try {
            var c = window.crypto || window.msCrypto, arr = new Uint8Array(16);
            c.getRandomValues(arr);
            for (i = 0; i < 16; i++) b.push(arr[i]);
        } catch (e) {
            for (i = 0; i < 16; i++) b.push(Math.floor(Math.random() * 256));
        }
        b[6] = (b[6] & 15) | 64;
        b[8] = (b[8] & 63) | 128;
        var h = b.map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    }

    // ---------- Настройки ----------
    var Settings = {
        init: function () {
            var api = Lampa.SettingsApi;
            api.addComponent({
                component: 'skip_intro',
                name: 'Пропуск заставок',
                icon: '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>'
            });
            function add(param, field, extra) {
                var data = { component: 'skip_intro', param: param, field: field };
                if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) data[k] = extra[k];
                api.addParam(data);
            }
            function title(name, text) { add({ name: name, type: 'title' }, { name: text }); }
            function keyValues(base) {
                var v = copyObject(base);
                for (var k in COLOR_KEYS) if (COLOR_KEYS.hasOwnProperty(k)) v[k] = COLOR_KEYS[k];
                return v;
            }

            title('skip_intro_t_main', 'Основное');
            add({ name: 'skip_intro_enabled', type: 'trigger', default: true },
                { name: 'Включить плагин', description: 'Показывать кнопку пропуска заставок и титров' });
            add({ name: 'skip_intro_auto', type: 'trigger', default: false },
                { name: 'Всегда автопропуск', description: 'Перематывать без кнопки по данным из баз (с учётом порога доверия). Найденное по субтитрам или звуку — только кнопкой' });
            add({ name: 'skip_intro_confidence', type: 'select', default: 'low',
                values: { off: 'Не проверять', low: 'Низкий — отсеивать сомнительные', mid: 'Средний — от 2 подтверждений', high: 'Высокий — от 3 подтверждений' } },
                { name: 'Порог доверия для автопропуска', description: 'Если у таймкода в базе мало подтверждений, вместо автопропуска показывается кнопка. Aniskip, главы файла и ваши отметки проходят всегда' });
            add({ name: 'skip_intro_type_intro', type: 'trigger', default: true }, { name: 'Пропускать заставку (intro)' });
            add({ name: 'skip_intro_type_recap', type: 'trigger', default: true }, { name: 'Пропускать рекап (recap)' });
            add({ name: 'skip_intro_type_credits', type: 'trigger', default: true }, { name: 'Пропускать титры (credits)' });
            add({ name: 'skip_intro_type_preview', type: 'trigger', default: false }, { name: 'Пропускать превью (preview)' });
            add({ name: 'skip_intro_movies', type: 'trigger', default: true },
                { name: 'Фильмы: пропуск титров', description: 'Титры фильмов из IntroDB и TheIntroDB. Если после титров есть сцена, плагин перемотает к ней' });
            add({ name: 'skip_intro_button_timeout', type: 'select', default: '10',
                values: { '5': '5 секунд', '10': '10 секунд', '15': '15 секунд', '30': '30 секунд', '0': 'Не скрывать' } },
                { name: 'Скрывать кнопку через', description: 'Пока кнопка на экране, OK (или выбранная кнопка) пропускает сегмент, а не управляет плеером' });

            title('skip_intro_t_src', 'Источники');
            add({ name: 'skip_intro_aniskip', type: 'trigger', default: true },
                { name: 'Aniskip (аниме)', description: 'Опенинги и эндинги аниме. Сопоставление с MyAnimeList через ARM, запасной путь — поиск AniList' });
            add({ name: 'skip_intro_chapters', type: 'trigger', default: true },
                { name: 'Главы MKV (TorrServer)', description: 'Если в файле есть главы Opening, Ending, Preview и т. п. — точные таймкоды без баз. Нужен ffprobe на TorrServer' });
            add({ name: 'skip_intro_introdb_proxy', type: 'input', values: '', default: '', placeholder: 'https://proxy.example/{url}' },
                { name: 'IntroDB: прокси', description: 'IntroDB отвечает браузеру только для своего сайта (CORS). На Android запрос идёт через приложение. Иначе можно указать свой прокси: адрес с {url} или {encoded}, либо префикс' });
            add({ name: 'skip_intro_detect', type: 'trigger', default: true },
                { name: 'Умное обнаружение', description: 'Если в базах нет заставки — искать её по субтитрам (паузы в SRT/VTT, песни в ASS). Результат показывается только кнопкой' });
            add({ name: 'skip_intro_detect_audio', type: 'trigger', default: false },
                { name: 'Обнаружение по звуку (эксперимент)', description: 'Если не помогли субтитры — анализ громкости первых 6 минут через Web Audio. Если браузер не разрешает его запуск, анализ не включается' });

            title('skip_intro_t_keys', 'Клавиши');
            add({ name: 'skip_intro_key_skip', type: 'select', default: 'enter',
                values: keyValues({ enter: 'Enter / OK', space: 'Пробел' }) },
                { name: 'Кнопка «Пропустить»', description: 'Работает, пока видна кнопка пропуска. ' + WEBOS_KEYS_NOTE });
            add({ name: 'skip_intro_key_cancel', type: 'select', default: 'back',
                values: keyValues({ back: 'Назад (Back)' }) },
                { name: 'Кнопка «Отменить»', description: 'Отменяет автопропуск с обратным отсчётом. ' + WEBOS_KEYS_NOTE });
            add({ name: 'skip_intro_key_menu', type: 'select', default: 'none',
                values: keyValues({ none: 'Нет' }) },
                { name: 'Кнопка меню пропуска', description: 'Во время просмотра открывает меню: режим сериала, сдвиг, ручные отметки. ' + WEBOS_KEYS_NOTE });

            title('skip_intro_t_more', 'Дополнительно');
            add({ name: 'skip_intro_autoshift', type: 'trigger', default: true },
                { name: 'Подгонять титры под длину файла', description: 'Если файл длиннее или короче, чем в базе, титры у конца файла сдвигаются вместе с концом. Заставки не сдвигаются' });
            add({ name: 'skip_intro_hdr_dim', type: 'trigger', default: true },
                { name: 'Приглушать кнопку в HDR', description: 'Работает вместе с плагином «Адаптивные субтитры»' });
            add({ name: 'skip_intro_aniskip_submit', type: 'trigger', default: false },
                { name: 'Помогать Aniskip', description: 'Разрешить отправку ваших отметок и голосов «таймкод неверный» в Aniskip. Только аниме и только по команде из меню' });
            add({ name: 'skip_intro_sync', type: 'trigger', default: false },
                { name: 'Синхронизация', description: 'Настройки сериалов и ваши отметки на всех устройствах через аккаунт CUB. Lampa синхронизирует только с CUB Premium' },
                { onChange: function () { Sync.init(); } });
            add({ name: 'skip_intro_native', type: 'trigger', default: false },
                { name: 'Отдавать таймкоды в Lampa (эксперимент)', description: 'Если таймкоды серии уже в кэше, передать их встроенному пропуску Lampa (штатная кнопка, отметки, настройки сегментов). Обычно со следующей серии после предзагрузки' });

            if (typeof Diag !== 'undefined') Diag.addSettings(add, title);
        },

        _field: function (name) {
            try { return Lampa.Storage.field(name); } catch (e) { return undefined; }
        },
        _flag: function (name, def) {
            var v = this._field(name);
            if (v === true || v === 'true') return true;
            if (v === false || v === 'false') return false;
            return def;
        },
        _select: function (name, def) {
            var v = this._field(name);
            return (v === undefined || v === null || v === '') ? def : String(v);
        },

        isEnabled: function () { return this._flag('skip_intro_enabled', true); },
        isAutoSkip: function () { return this._flag('skip_intro_auto', false); },
        isDetectEnabled: function () { return this._flag('skip_intro_detect', true); },
        isAudioDetectEnabled: function () { return this._flag('skip_intro_detect_audio', false); },
        isAniskipEnabled: function () { return this._flag('skip_intro_aniskip', true); },
        isTypeEnabled: function (type) { return this._flag('skip_intro_type_' + type, type !== 'preview'); },
        chaptersEnabled: function () { return this._flag('skip_intro_chapters', true); },
        moviesEnabled: function () { return this._flag('skip_intro_movies', true); },
        autoShift: function () { return this._flag('skip_intro_autoshift', true); },
        hdrDim: function () { return this._flag('skip_intro_hdr_dim', true); },
        submitEnabled: function () { return this._flag('skip_intro_aniskip_submit', false); },
        syncEnabled: function () { return this._flag('skip_intro_sync', false); },
        nativeEnabled: function () { return this._flag('skip_intro_native', false); },
        confidence: function () {
            var v = this._select('skip_intro_confidence', 'low');
            return TRUST_LEVELS.hasOwnProperty(v) ? v : 'low';
        },
        introdbProxy: function () {
            var v = this._select('skip_intro_introdb_proxy', '');
            return /^https?:\/\//i.test(v) ? v.trim() : '';
        },

        skipKeyName: function () {
            var k = this._select('skip_intro_key_skip', 'enter');
            return KEY_MAP[k] && k !== 'back' ? k : 'enter';
        },
        cancelKeyName: function () {
            var k = this._select('skip_intro_key_cancel', 'back');
            return KEY_MAP[k] && k !== 'enter' && k !== 'space' ? k : 'back';
        },
        menuKeyName: function () {
            var k = this._select('skip_intro_key_menu', 'none');
            return COLOR_KEYS[k] ? k : 'none';
        },
        getSkipKeys: function () { return KEY_MAP[this.skipKeyName()]; },
        getCancelKeys: function () { return KEY_MAP[this.cancelKeyName()]; },
        getMenuKeys: function () { var k = this.menuKeyName(); return k === 'none' ? [] : KEY_MAP[k]; },

        buttonTimeout: function () {
            var v = parseInt(this._select('skip_intro_button_timeout', '10'), 10);
            return isNaN(v) || v < 0 ? 10 : v;
        }
    };

    // ---------- Кэш в localStorage ----------
    var Store = {
        read: function (key) {
            try {
                var raw = localStorage.getItem(key);
                if (!raw) return null;
                var obj = JSON.parse(raw);
                return isObj(obj) ? obj : null;
            } catch (e) { return null; }
        },

        write: function (key, obj) {
            var text = JSON.stringify(obj);
            try {
                localStorage.setItem(key, text);
                return true;
            } catch (e) {
                // переполнение: чистим вдвое строже и пробуем ещё раз
                this.cleanup(Math.floor(CACHE_LIMIT / 2));
                try { localStorage.setItem(key, text); return true; } catch (e2) { return false; }
            }
        },

        remove: function (key) {
            try { localStorage.removeItem(key); } catch (e) {}
        },

        keys: function () {
            var out = [];
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k) out.push(k);
                }
            } catch (e) {}
            return out;
        },

        getRecord: function (ctx, src, variant) {
            var key = Logic.episodeKey(ctx);
            return key ? Logic.pickRecord(this.read(key), src, variant, now()) : null;
        },

        putRecord: function (ctx, src, variant, result) {
            var key = Logic.episodeKey(ctx);
            if (!key || !result) return;
            var entry = this.read(key);
            if (!entry || !isObj(entry.r)) entry = { v: 3, t: 0, r: {} };
            var rec = { t: now(), st: result.st, s: result.s || [] };
            if (result.x && Object.keys(result.x).length) rec.x = result.x;
            entry.r[src + '|' + (variant || '')] = rec;
            entry.t = rec.t;
            this.write(key, entry);
        },

        dropRecords: function (ctx, src) {
            var key = Logic.episodeKey(ctx), entry = key ? this.read(key) : null;
            if (!entry || !isObj(entry.r)) return;
            for (var k in entry.r) if (entry.r.hasOwnProperty(k) && k.split('|')[0] === src) delete entry.r[k];
            this.write(key, entry);
        },

        getAux: function (key) {
            var obj = this.read(key);
            if (!obj || typeof obj.t !== 'number') return null;
            var ttl = Logic.auxTtl(key, obj);
            if (ttl < 0 || now() - obj.t > ttl || obj.t > now() + DAY) { this.remove(key); return null; }
            return obj;
        },

        setAux: function (key, obj) {
            obj.t = now();
            this.write(key, obj);
        },

        // Удалить всё, что относится к сериалу (или фильму) — для «Сбросить кэш сериала»
        clearSeries: function (tmdb) {
            var keys = this.keys(), n = 0, id = String(tmdb);
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (k.indexOf(CACHE_PREFIX + id + '_s') === 0 || k === CACHE_PREFIX + 'm' + id ||
                    k === CACHE_PREFIX + 'arm_' + id || k.indexOf(CACHE_PREFIX + 'map_' + id + '_s') === 0) {
                    this.remove(k);
                    n++;
                }
            }
            return n;
        },

        clearAll: function () {
            var keys = this.keys(), n = 0;
            for (var i = 0; i < keys.length; i++) {
                if (Logic.isOwnKey(keys[i]) || Logic.isOldKey(keys[i])) { this.remove(keys[i]); n++; }
            }
            return n;
        },

        count: function () {
            var keys = this.keys(), n = 0;
            for (var i = 0; i < keys.length; i++) if (Logic.isOwnKey(keys[i])) n++;
            return n;
        },

        cleanup: function (limit) {
            try {
                var keys = this.keys(), entries = [], i;
                for (i = 0; i < keys.length; i++) {
                    if (Logic.isOwnKey(keys[i]) || Logic.isOldKey(keys[i])) entries.push({ key: keys[i], value: localStorage.getItem(keys[i]) });
                }
                var plan = Logic.cleanupPlan(entries, now(), limit || CACHE_LIMIT);
                for (i = 0; i < plan.drop.length; i++) this.remove(plan.drop[i]);
                for (var k in plan.rewrite) if (plan.rewrite.hasOwnProperty(k)) {
                    try { localStorage.setItem(k, plan.rewrite[k]); } catch (e) {}
                }
                if (plan.drop.length) log('Cache cleanup: removed', plan.drop.length, 'of', entries.length);
                return plan.drop.length;
            } catch (e) { return 0; }
        }
    };

    // ---------- Состояние источников (для диагностики) ----------
    var Health = {
        _key: 'skip3_health',
        _data: null,
        _timer: null,
        _load: function () {
            if (!this._data) this._data = Store.read(this._key) || {};
            return this._data;
        },
        // st: ok | empty | network | timeout | http | limit | auth | format | unavailable
        set: function (src, st, ms, status) {
            var d = this._load(), self = this;
            d[src] = { st: st, ms: ms || 0, t: now(), code: status || 0 };
            if (!this._timer) {
                this._timer = setTimeout(function () {
                    self._timer = null;
                    Store.write(self._key, self._data);
                }, 2000);
            }
        },
        get: function (src) {
            return this._load()[src] || null;
        },
        fromError: function (err) {
            return (err && err.kind) || 'network';
        }
    };

    // ---------- Настройки сериала: режим и сдвиг ----------
    var SERIES_MODES = { 'default': 'Как в настройках', auto: 'Всегда автопропуск', button: 'Только кнопка', off: 'Выключен' };
    var Series = {
        _key: 'skip_intro_series',
        get: function (tmdb) {
            var all = storageObject(this._key), v = tmdb ? all[tmdb] : null;
            return {
                mode: v && SERIES_MODES[v.mode] ? v.mode : 'default',
                shift: v ? toNum(v.shift) || 0 : 0
            };
        },
        set: function (tmdb, patch) {
            if (!tmdb) return;
            var all = storageObject(this._key), cur = this.get(tmdb), id = String(tmdb);
            if (patch.mode !== undefined) cur.mode = SERIES_MODES[patch.mode] ? patch.mode : 'default';
            if (patch.shift !== undefined) cur.shift = clamp(Math.round((toNum(patch.shift) || 0) * 10) / 10, -120, 120);
            if (cur.mode === 'default' && !cur.shift) {
                delete all[id];
                if (Sync.active) { try { Lampa.Storage.remove(this._key, id); } catch (e) {} }
            } else {
                all[id] = { mode: cur.mode, shift: cur.shift, t: now() };
            }
            storageSet(this._key, all);
        }
    };

    // ---------- Ручные отметки ----------
    var UserMarks = {
        _key: 'skip_intro_user',
        id: function (ctx) {
            if (!ctx || !ctx.tmdb) return null;
            return ctx.movie ? 'm' + ctx.tmdb : ctx.tmdb + '_s' + ctx.season + '_e' + ctx.episode;
        },
        get: function (ctx) {
            var id = this.id(ctx), v = id ? storageObject(this._key)[id] : null;
            if (!v || !Array.isArray(v.s)) return [];
            return v.s.filter(function (s) {
                return s && contains(SEGMENT_TYPES, s.type) && typeof s.start === 'number' && s.end > s.start;
            }).map(function (s) {
                return { type: s.type, start: s.start, end: s.end, src: 'user' };
            });
        },
        add: function (ctx, seg, duration) {
            var id = this.id(ctx);
            if (!id || !seg || !(seg.end > seg.start)) return false;
            var all = storageObject(this._key), cur = all[id] && Array.isArray(all[id].s) ? all[id].s : [];
            cur = cur.filter(function (s) { return s && s.type !== seg.type; });
            cur.push({ type: seg.type, start: round3(seg.start), end: round3(seg.end), d: duration ? Math.round(duration) : 0 });
            all[id] = { s: cur, t: now() };
            storageSet(this._key, all);
            return true;
        },
        remove: function (ctx, type) {
            var id = this.id(ctx);
            if (!id) return;
            var all = storageObject(this._key);
            if (!all[id]) return;
            var left = type && Array.isArray(all[id].s) ? all[id].s.filter(function (s) { return s && s.type !== type; }) : [];
            if (left.length) all[id] = { s: left, t: now() };
            else {
                delete all[id];
                if (Sync.active) { try { Lampa.Storage.remove(this._key, id); } catch (e) {} }
            }
            storageSet(this._key, all);
        },
        seriesIds: function (tmdb) {
            var all = storageObject(this._key), out = [], p1 = tmdb + '_s', p2 = 'm' + tmdb;
            for (var k in all) if (all.hasOwnProperty(k) && (k.indexOf(p1) === 0 || k === p2)) out.push(k);
            return out;
        },
        clearSeries: function (tmdb) {
            var ids = this.seriesIds(tmdb);
            if (!ids.length) return 0;
            var all = storageObject(this._key);
            ids.forEach(function (id) {
                delete all[id];
                if (Sync.active) { try { Lampa.Storage.remove(UserMarks._key, id); } catch (e) {} }
            });
            storageSet(this._key, all);
            return ids.length;
        }
    };

    // ---------- «Умный» автопропуск: сериал, где пользователь уже пропускал сегмент ----------
    var Smart = {
        _key: 'skip_intro_smart',
        _all: function () { return storageObject(this._key); },
        _save: function (all) { storageSet(this._key, JSON.stringify(all)); },
        hasSkipped: function (tmdb, type) {
            return this._all()[tmdb + '_' + type] === true;
        },
        rememberSkip: function (tmdb, type) {
            var all = this._all();
            if (all[tmdb + '_' + type] === true) return;
            all[tmdb + '_' + type] = true;
            this._save(all);
            log('Smart skip remembered for', tmdb, type);
        },
        forgetSkip: function (tmdb, type) {
            var all = this._all();
            if (!all.hasOwnProperty(tmdb + '_' + type)) return;
            delete all[tmdb + '_' + type];
            this._save(all);
            log('Smart skip forgotten for', tmdb, type);
        },
        forgetSeries: function (tmdb) {
            var all = this._all(), n = 0;
            SEGMENT_TYPES.forEach(function (t) {
                if (all.hasOwnProperty(tmdb + '_' + t)) { delete all[tmdb + '_' + t]; n++; }
            });
            if (n) this._save(all);
            return n;
        }
    };

    // ---------- Статистика «сэкономлено» ----------
    var Stats = {
        _key: 'skip_intro_stats',
        get: function () {
            var v = storageObject(this._key);
            return { sec: toNum(v.sec) || 0, count: toInt(v.count) || 0, by: isObj(v.by) ? v.by : {}, since: toNum(v.since) || 0 };
        },
        add: function (type, sec) {
            if (!(sec > 0) || sec > 3 * 3600) return;
            var v = this.get();
            v.sec = Math.round(v.sec + sec);
            v.count++;
            v.by = copyObject(v.by);
            v.by[type] = Math.round((toNum(v.by[type]) || 0) + sec);
            if (!v.since) v.since = now();
            storageSet(this._key, v);
        },
        reset: function () {
            storageSet(this._key, { sec: 0, count: 0, by: {}, since: now() });
        },
        text: function () {
            var v = this.get();
            if (!v.count) return 'Пока ничего не пропущено';
            return 'Сэкономлено ' + Logic.formatSaved(v.sec) + ' (' + v.count + ' ' + plural(v.count, 'пропуск', 'пропуска', 'пропусков') + ')';
        }
    };

    // ---------- Синхронизация через CUB (Lampa.Storage.sync) ----------
    var Sync = {
        active: false,
        available: function () {
            try { return !!(Lampa.Account && Lampa.Account.Permit && Lampa.Account.Permit.sync && Lampa.Account.hasPremium()); }
            catch (e) { return false; }
        },
        init: function () {
            if (this.active || !Settings.syncEnabled()) return;
            if (!Lampa.Storage || typeof Lampa.Storage.sync !== 'function') return;
            try {
                Lampa.Storage.sync('skip_intro_series', 'object_object');
                Lampa.Storage.sync('skip_intro_user', 'object_object');
                this.active = true;
                log('Sync enabled' + (this.available() ? '' : ' (CUB Premium sync is not active — values stay local)'));
            } catch (e) { log('Sync init error', e && e.message); }
        }
    };

    function submitterId() {
        var id = storageGet('skip_intro_submitter', '');
        if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) {
            id = uuid();
            storageSet('skip_intro_submitter', id);
        }
        return id;
    }
