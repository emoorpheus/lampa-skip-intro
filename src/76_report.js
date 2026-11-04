
    // ---------- Отчёт для разработчика: всё для разбора проблемы на одном экране ----------
    // Пользователь фотографирует экран и присылает снимок: плагин ничего не отправляет. Адреса серверов, имена файлов
    // и ключи в отчёт не попадают: журнал проходит Logic.scrub, у настроек-адресов показывается только «задано»
    var REPORT_LOG = 30;
    var DIAG_SOURCES = ['theintrodb', 'introdb', 'introhater', 'aniskip', 'arm', 'anilist', 'chapters'];

    var Report = {
        stamp: function (t, withDate) {
            var d = new Date(t);
            var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
            return withDate ? pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ' ' + hm : hm;
        },

        // «Lampa 3.4.4 · android · app 1.12.4 · Android 11 · Chrome 84 · 1920×1080»
        device: function () {
            var ua = '', parts = [], m, app = '';
            try { ua = String(navigator.userAgent || ''); } catch (e) {}
            try { app = Lampa.Platform.version('app'); } catch (e) {}
            if (!app) try { app = Lampa.Manifest.app_version; } catch (e) {}
            parts.push('Lampa ' + (app || '?'));
            try { var pl = Lampa.Platform.get(); if (pl) parts.push(String(pl)); } catch (e) {}
            try { if (typeof AndroidJS !== 'undefined' && AndroidJS.appVersion) parts.push('app ' + AndroidJS.appVersion()); } catch (e) {}
            if ((m = ua.match(/Android [\d.]+/))) parts.push(m[0]);
            else if ((m = ua.match(/Tizen [\d.]+/))) parts.push(m[0]);
            else if (/Web0S|webOS/i.test(ua)) parts.push('webOS');
            else if ((m = ua.match(/Windows NT [\d.]+|Mac OS X [\d_]+|CrOS|Linux/))) parts.push(m[0].replace(/_/g, '.'));
            if ((m = ua.match(/(?:Chrome|Chromium)\/(\d+)/))) parts.push('Chrome ' + m[1]);
            else if ((m = ua.match(/Firefox\/(\d+)/))) parts.push('Firefox ' + m[1]);
            else if ((m = ua.match(/AppleWebKit\/([\d.]+)/))) parts.push('WebKit ' + m[1]);
            try {
                var dpr = window.devicePixelRatio;
                if (window.innerWidth > 0) parts.push(window.innerWidth + '\u00d7' + window.innerHeight + (dpr && dpr !== 1 ? ' @' + Math.round(dpr * 100) / 100 + 'x' : ''));
            } catch (e) {}
            return Logic.scrub(parts.join(' \u00b7 '));
        },

        // Только отличающиеся от значения по умолчанию: «auto: true · confidence: mid · introdb_proxy: задано»
        settings: function () {
            var out = [], list = Settings._params || [];
            for (var i = 0; i < list.length; i++) {
                var p = list[i], def = p.def === undefined || p.def === null ? '' : p.def, v;
                // как плагин сам читает настройки: Lampa.Storage.get(name, false) вернул бы '' (core/storage.js)
                v = p.type === 'trigger' ? Settings._flag(p.name, def === true || def === 'true') : Settings._select(p.name, String(def));
                if (String(v) === String(def)) continue;
                out.push(p.name.replace(/^skip_intro_/, '') + ': ' + (p.type === 'input' ? (v ? tr('report_set') : '\u2014') : Logic.scrub(String(v))));
            }
            return out;
        },

        // [{ c: 'hint' | 'h' | 'l' | 'log', t: текст }]
        lines: function () {
            var out = [], today = new Date(now()).toDateString(), self = this;
            function add(c, t) { out.push({ c: c, t: String(t) }); }
            add('hint', tr('report_hint'));
            add('h', tr('report_device'));
            add('l', 'Skip Intro ' + VERSION + ' \u00b7 ' + this.device() + ' \u00b7 ' + this.stamp(now(), true));
            add('h', tr('report_settings'));
            add('l', this.settings().join(' \u00b7 ') || tr('report_defaults'));
            add('h', tr('sources'));
            DIAG_SOURCES.forEach(function (src) { add('l', diagName(src) + ' \u2014 ' + Diag.text(src)); });
            add('h', tr('diag_marks'));
            add('l', Diag.marksText());
            add('h', tr('diag_stats'));
            add('l', Stats.text());
            var log = Journal.last(REPORT_LOG);
            add('h', tr('report_log', { n: log.length }));
            if (!log.length) add('l', tr('report_log_empty'));
            log.forEach(function (x) { add('log', self.stamp(x.t, new Date(x.t).toDateString() !== today) + ' ' + x.m); });
            return out;
        },

        open: function () {
            var jq = window.jQuery || window.$;
            if (!jq || !Lampa.Modal || typeof Lampa.Modal.open !== 'function') return noty(tr('report_na'));
            injectCSS();
            var root = document.createElement('div'), list = this.lines(), prev = 'settings_component';
            root.className = 'skip-intro-report';
            for (var i = 0; i < list.length; i++) {
                var el = document.createElement('div');
                el.className = 'skip-intro-report__' + list[i].c;
                el.textContent = list[i].t;
                root.appendChild(el);
            }
            try {
                var en = Lampa.Controller.enabled();
                if (en && typeof en.name === 'string' && en.name) prev = en.name;
            } catch (e) {}
            Lampa.Modal.open({
                title: tr('report_title'),
                html: jq(root),
                size: 'large',
                onBack: function () {
                    try { Lampa.Modal.close(); } catch (e) {}
                    try { Lampa.Controller.toggle(prev); } catch (e) {}
                }
            });
        }
    };
