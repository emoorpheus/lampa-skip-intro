
    // ---------- Меню: «⋯» в карточке и горячая клавиша в плеере ----------
    var MARKED_TEXT = { intro: 'Заставка отмечена', recap: 'Рекап отмечен', credits: 'Титры отмечены', preview: 'Превью отмечено' };

    var Menu = {
        _pending: null,     // начатая ручная отметка { id, type, start }

        _toggle: function (back) {
            try { Lampa.Controller.toggle(back || 'content'); } catch (e) {}
        },

        _show: function (title, items, back) {
            var self = this;
            try {
                Lampa.Select.show({
                    title: title,
                    items: items,
                    onSelect: function (a) {
                        var opened = a && typeof a.action === 'function' ? a.action() : false;
                        if (!opened) self._toggle(back);
                    },
                    onBack: function () { self._toggle(back); }
                });
            } catch (e) {
                log('Select error', e && e.message);
            }
        },

        _shiftText: function (v) {
            v = toNum(v) || 0;
            return v ? (v > 0 ? '+' : '\u2212') + Math.abs(v) + ' с' : 'нет';
        },

        initCard: function () {
            var self = this;
            try {
                Lampa.Listener.follow('full', function (e) {
                    if (!e || e.type !== 'options' || !Array.isArray(e.options)) return;
                    var card = e.link && e.link.card;
                    if (!Logic.seriesId(card)) return;
                    e.options.push({
                        title: 'Пропуск заставок',
                        onSelect: function () { self.openSeries(card, 'content'); }
                    });
                });
            } catch (e) {}
        },

        _isCurrent: function (tmdb) {
            return !!(Controller._ctx && String(Controller._ctx.tmdb) === String(tmdb));
        },

        seriesItems: function (card, back) {
            var self = this, tmdb = Logic.seriesId(card), s = Series.get(tmdb), items = [], marks = UserMarks.seriesIds(tmdb).length;
            var movie = !!(card.title && !card.name);
            items.push({
                title: 'Режим: ' + SERIES_MODES[s.mode].toLowerCase(),
                subtitle: movie ? 'Только для этого фильма' : 'Только для этого сериала',
                action: function () { self.openMode(card, back); return true; }
            });
            items.push({
                title: 'Сдвиг таймкодов: ' + this._shiftText(s.shift),
                subtitle: 'Для данных из баз: «+» — позже, «\u2212» — раньше',
                action: function () { self.openShift(card, back); return true; }
            });
            items.push({
                title: 'Сбросить кэш таймкодов',
                subtitle: 'Данные будут заново запрошены из баз',
                action: function () {
                    var n = Store.clearSeries(tmdb);
                    noty('Кэш очищен' + (n ? ' (' + n + ')' : ''));
                    if (self._isCurrent(tmdb)) Controller.reload();
                }
            });
            items.push({
                title: 'Забыть пропуски (умный режим)',
                subtitle: 'Снова кнопка вместо обратного отсчёта',
                action: function () {
                    Smart.forgetSeries(tmdb);
                    noty('Пропуски забыты');
                }
            });
            if (marks) {
                items.push({
                    title: 'Удалить мои отметки (' + marks + ')',
                    action: function () {
                        UserMarks.clearSeries(tmdb);
                        noty('Отметки удалены');
                        if (self._isCurrent(tmdb)) Controller.reload();
                    }
                });
            }
            return items;
        },

        openSeries: function (card, back) {
            this._show('Пропуск заставок', this.seriesItems(card, back), back);
        },

        _reopen: function (card, back) {
            if (back === 'player') this.openPlayer();
            else this.openSeries(card, back);
        },

        openMode: function (card, back) {
            var self = this, id = Logic.seriesId(card), cur = Series.get(id).mode, items = [];
            for (var k in SERIES_MODES) {
                if (!SERIES_MODES.hasOwnProperty(k)) continue;
                (function (mode) {
                    items.push({
                        title: SERIES_MODES[mode],
                        selected: mode === cur,
                        action: function () {
                            Series.set(id, { mode: mode });
                            if (self._isCurrent(id)) Controller.refresh();
                            self._reopen(card, back);
                            return true;
                        }
                    });
                })(k);
            }
            this._show('Режим пропуска', items, back);
        },

        openShift: function (card, back) {
            var self = this, id = Logic.seriesId(card), cur = Series.get(id).shift, values = [-10, -5, -2, -1, 0, 1, 2, 5, 10], items = [];
            if (values.indexOf(cur) === -1) { values.push(cur); values.sort(function (a, b) { return a - b; }); }
            values.forEach(function (v) {
                items.push({
                    title: v ? self._shiftText(v) : 'Без сдвига',
                    selected: v === cur,
                    action: function () {
                        Series.set(id, { shift: v });
                        if (self._isCurrent(id)) Controller.refresh();
                        self._reopen(card, back);
                        return true;
                    }
                });
            });
            this._show('Сдвиг таймкодов', items, back);
        },

        openPlayer: function () {
            var self = this, c = Controller, ctx = c._ctx;
            if (!ctx) return;
            var t = videoTime(), dur = videoDuration() || c._duration, id = UserMarks.id(ctx), items = [];
            var pending = this._pending && this._pending.id === id ? this._pending : null;
            items.push({ title: 'Эта серия', separator: true });
            if (pending) {
                items.push({
                    title: 'Конец отметки: ' + TYPE_NAMES[pending.type].toLowerCase(),
                    subtitle: fmtTime(pending.start) + ' \u2014 ' + fmtTime(t),
                    // время — момент открытия меню (его же показывает подпись), а не выбора пункта:
                    // пока пользователь листает меню, видео продолжает идти
                    action: function () { self._finishMark(ctx, pending, t, dur); }
                });
                items.push({ title: 'Отменить отметку', action: function () { self._pending = null; } });
            } else {
                ['intro', 'credits', 'recap', 'preview'].forEach(function (type) {
                    items.push({
                        title: 'Отметить: ' + TYPE_NAMES[type].toLowerCase(),
                        subtitle: 'Начало — сейчас (' + fmtTime(t) + '). Конец — через это же меню',
                        action: function () {
                            self._pending = { id: id, type: type, start: t };
                            noty('Начало отмечено: ' + fmtTime(self._pending.start) + '. В конце откройте меню и выберите «Конец отметки»');
                        }
                    });
                });
            }
            var mine = UserMarks.get(ctx);
            if (mine.length) {
                items.push({
                    title: 'Удалить мои отметки серии (' + mine.length + ')',
                    action: function () { UserMarks.remove(ctx); Controller.reload(); noty('Отметки серии удалены'); }
                });
            }
            var ani = c.aniskipTarget();
            if (ani && Settings.submitEnabled()) {
                var seg = c.aniskipSegmentNear(t);
                if (seg && seg.id) {
                    items.push({
                        title: 'Aniskip: таймкод неверный',
                        subtitle: TYPE_NAMES[seg.type] + ' ' + fmtTime(seg.start) + ' \u2014 ' + fmtTime(seg.end) + ' (голос «против»)',
                        action: function () {
                            Anime.vote(seg.id, 'downvote').then(function () { noty('Голос отправлен в Aniskip'); },
                                function (e) { noty('Aniskip: не удалось отправить (' + (e && (e.status || e.kind)) + ')'); });
                        }
                    });
                }
                var send = mine.filter(function (m) { return m.type !== 'preview'; });
                if (send.length && dur) {
                    items.push({
                        title: 'Aniskip: отправить мои отметки',
                        subtitle: 'MAL ' + ani.mal + ', серия ' + ani.ep,
                        action: function () { self._submit(ani, send, dur); }
                    });
                }
            }
            var info = c.describe();
            if (info) items.push({ title: 'Источники', subtitle: info, action: function () {} });
            if (ctx.card && Logic.seriesId(ctx.card)) {
                items.push({ title: ctx.movie ? 'Фильм' : 'Сериал', separator: true });
                items = items.concat(this.seriesItems(ctx.card, 'player'));
            }
            this._show('Пропуск заставок', items, 'player');
        },

        _finishMark: function (ctx, pending, t, dur) {
            this._pending = null;
            var a = Math.min(pending.start, t), b = Math.max(pending.start, t);
            if (b - a < 3) return noty('Слишком короткий отрезок — отметка не сохранена');
            UserMarks.add(ctx, { type: pending.type, start: a, end: b }, dur);
            noty(MARKED_TEXT[pending.type] + ': ' + fmtTime(a) + ' \u2014 ' + fmtTime(b));
            Controller.reload();
        },

        _submit: function (ani, marks, dur) {
            var ok = 0, fail = 0;
            Promise.all(marks.map(function (m) {
                return Anime.submit(ani.mal, ani.ep, m, dur).then(function () { ok++; }, function () { fail++; });
            })).then(function () {
                noty(fail ? 'Aniskip: отправлено ' + ok + ', ошибок ' + fail : 'Отправлено в Aniskip: ' + ok);
            });
        }
    };

    // ---------- Диагностика в настройках ----------
    var STATUS_TEXT = {
        ok: 'работает',
        empty: 'работает (для серии пусто)',
        network: 'нет ответа (возможно, CORS или нет сети)',
        timeout: 'таймаут',
        http: 'ошибка сервера',
        limit: 'лимит запросов',
        auth: 'доступ запрещён',
        format: 'непонятный ответ',
        unavailable: 'недоступно (нет ffprobe или старая версия TorrServer)'
    };
    var DIAG_NAMES = {
        theintrodb: 'TheIntroDB', introdb: 'IntroDB', introhater: 'IntroHater', aniskip: 'Aniskip',
        arm: 'ARM (аниме → MyAnimeList)', anilist: 'AniList', chapters: 'Главы MKV (TorrServer)'
    };

    var Diag = {
        _items: {},
        _stats: null,

        _ago: function (t) {
            var d = Math.max(0, now() - t);
            if (d < MIN) return 'только что';
            if (d < HOUR) return Math.round(d / MIN) + ' мин назад';
            if (d < DAY) return Math.round(d / HOUR) + ' ч назад';
            return Math.round(d / DAY) + ' дн назад';
        },

        text: function (src) {
            var h = Health.get(src), out;
            if (!h) out = 'ещё не запрашивался';
            else {
                out = (STATUS_TEXT[h.st] || h.st) + (h.code && h.st !== 'ok' && h.st !== 'empty' ? ' (HTTP ' + h.code + ')' : '') +
                    (h.ms ? ', ' + h.ms + ' мс' : '') + ', ' + this._ago(h.t);
            }
            if (src === 'introdb') {
                var how = Sources.introdb.transport();
                out += how === 'android' ? ' · через приложение Android' : (how === 'proxy' ? ' · через прокси' : ' · напрямую');
            }
            return out.charAt(0).toUpperCase() + out.slice(1);
        },

        _paintItem: function (item, text) {
            try {
                if (item && typeof item.find === 'function') item.find('.settings-param__descr').text(text);
            } catch (e) {}
        },

        paint: function () {
            for (var k in this._items) if (this._items.hasOwnProperty(k)) this._paintItem(this._items[k], this.text(k));
            if (this._stats) this._paintItem(this._stats, Stats.text());
        },

        addSettings: function (add, title) {
            var self = this;
            title('skip_intro_t_diag', 'Диагностика');
            // версия на экране: плагин по IP-адресу Lampa подключает без параметра reset (кэш ТВ может отдать старый файл)
            add({ name: 'skip_intro_diag_version', type: 'static' }, { name: 'Версия плагина', description: 'Skip Intro ' + VERSION });
            ['theintrodb', 'introdb', 'introhater', 'aniskip', 'arm', 'anilist', 'chapters'].forEach(function (src) {
                add({ name: 'skip_intro_diag_' + src, type: 'static' }, { name: DIAG_NAMES[src], description: self.text(src) }, {
                    onRender: function (item) { self._items[src] = item; self._paintItem(item, self.text(src)); }
                });
            });
            add({ name: 'skip_intro_diag_check', type: 'button' },
                { name: 'Проверить сейчас', description: 'Тестовые запросы: Game of Thrones S1E1, Attack on Titan, TorrServer' },
                { onChange: function () { self.check(); } });
            add({ name: 'skip_intro_diag_clear', type: 'button' },
                { name: 'Очистить кэш', description: 'Таймкоды и сопоставления аниме. Настройки, статистика и ваши отметки остаются' },
                { onChange: function () { var n = Store.clearAll(); noty('Кэш очищен: ' + n); } });
            add({ name: 'skip_intro_diag_stats', type: 'static' }, { name: 'Статистика', description: Stats.text() }, {
                onRender: function (item) { self._stats = item; self._paintItem(item, Stats.text()); }
            });
            add({ name: 'skip_intro_diag_stats_reset', type: 'button' }, { name: 'Сбросить статистику' },
                { onChange: function () { Stats.reset(); self.paint(); noty('Статистика сброшена'); } });
        },

        _run: function (src, promise) {
            var t0 = now(), self = this;
            return promise.then(function (st) {
                Health.set(src, st, now() - t0, 200);
            }, function (err) {
                Health.set(src, Health.fromError(err), now() - t0, err && err.status);
            }).then(function () { self.paint(); return src; });
        },

        check: function () {
            var self = this, got = { tmdb: '1399', imdb: 'tt0944947', season: 1, episode: 1, movie: false };
            noty('Проверка источников…');
            function st(res) { return res && res.st ? res.st : 'ok'; }
            var jobs = [
                this._run('theintrodb', Sources.theintrodb.fetch(got, 0).then(st)),
                this._run('introdb', Sources.introdb.fetch(got).then(st)),
                this._run('introhater', Sources.introhater.fetch(got).then(st)),
                this._run('aniskip', Anime._get(40028, 1, 0).then(function (r) { return r.s.length ? 'ok' : 'empty'; })),
                this._run('arm', Net.get(Anime.ARM + '1429').then(function (r) {
                    if (r.status !== 200) throw httpFail(r.status);
                    return Array.isArray(r.json) && r.json.length ? 'ok' : 'empty';
                })),
                this._run('anilist', Net.post('https://graphql.anilist.co', { query: Anime.GQL_IDS, variables: { ids: [40028] } }).then(function (r) {
                    if (r.status !== 200) throw httpFail(r.status);
                    return 'ok';
                }))
            ];
            var ts = '';
            try { ts = String(Lampa.Storage.get('torrserver_url', '') || ''); } catch (e) {}
            if (ts) {
                if (!/^https?:\/\//i.test(ts)) ts = 'http://' + ts;
                ts = ts.replace(/\/+$/, '');
                var auth = Torr.auth(ts);
                jobs.push(this._run('chapters', Net.get(ts + '/ffp/status', auth ? { headers: { Authorization: auth } } : {}).then(function (r) {
                    if (r.status === 404) throw netError('unavailable', 404);
                    if (r.status !== 200) throw httpFail(r.status);
                    if (r.json && r.json.available === false) throw netError('unavailable', 200);
                    return 'ok';
                })));
            }
            Promise.all(jobs).then(function (list) {
                var parts = list.map(function (src) {
                    var h = Health.get(src);
                    return (DIAG_NAMES[src] || src).replace(/ \(.*$/, '') + ': ' + (h ? STATUS_TEXT[h.st] || h.st : '?');
                });
                noty(parts.join('; '));
                self.paint();
            });
        }
    };

    // ---------- Переименование своей записи в списке плагинов ----------
    function renamePluginEntry() {
        if (!SCRIPT_SRC) return;
        try {
            var own = Logic.normalizeUrl(SCRIPT_SRC);
            var list = Lampa.Storage.get('plugins', '[]');
            if (typeof list === 'string') list = JSON.parse(list);
            if (!Array.isArray(list)) return;
            var changed = false;
            for (var i = 0; i < list.length; i++) {
                var p = list[i];
                if (!p || typeof p.url !== 'string' || Logic.normalizeUrl(p.url) !== own) continue;
                if (p.name !== PLUGIN_NAME) { p.name = PLUGIN_NAME; changed = true; }
                if (PLUGIN_AUTHOR && p.author !== PLUGIN_AUTHOR) { p.author = PLUGIN_AUTHOR; changed = true; }
            }
            if (changed) Lampa.Storage.set('plugins', list);        // Lampa хранит массив (core/plugins.js)
        } catch (e) {}
    }
