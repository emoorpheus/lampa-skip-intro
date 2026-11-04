
    // ---------- Меню: «⋯» в карточке и горячая клавиша в плеере ----------

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
            return v ? tr('dur_s', { s: (v > 0 ? '+' : '\u2212') + Math.abs(v) }) : tr('shift_none');
        },

        initCard: function () {
            var self = this;
            try {
                Lampa.Listener.follow('full', function (e) {
                    if (!e || e.type !== 'options' || !Array.isArray(e.options)) return;
                    var card = e.link && e.link.card;
                    if (!Logic.seriesId(card)) return;
                    e.options.push({
                        title: tr('plugin_title'),
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
                title: tr('menu_mode', { mode: tr(SERIES_MODES[s.mode]).toLowerCase() }),
                subtitle: tr(movie ? 'menu_only_movie' : 'menu_only_series'),
                action: function () { self.openMode(card, back); return true; }
            });
            items.push({
                title: tr('menu_shift', { shift: this._shiftText(s.shift) }),
                subtitle: tr('menu_shift_d'),
                action: function () { self.openShift(card, back); return true; }
            });
            items.push({
                title: tr('menu_clear'),
                subtitle: tr('menu_clear_d'),
                action: function () {
                    var n = Store.clearSeries(tmdb);
                    noty(tr('noty_cache_cleared') + (n ? ' (' + n + ')' : ''));
                    if (self._isCurrent(tmdb)) Controller.reload();
                }
            });
            items.push({
                title: tr('menu_forget'),
                subtitle: tr('menu_forget_d'),
                action: function () {
                    Smart.forgetSeries(tmdb);
                    noty(tr('noty_forgotten'));
                }
            });
            if (marks) {
                items.push({
                    title: tr('menu_del_marks', { n: marks }),
                    action: function () {
                        UserMarks.clearSeries(tmdb);
                        noty(tr('noty_marks_deleted'));
                        if (self._isCurrent(tmdb)) Controller.reload();
                    }
                });
            }
            return items;
        },

        openSeries: function (card, back) {
            this._show(tr('plugin_title'), this.seriesItems(card, back), back);
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
                        title: tr(SERIES_MODES[mode]),
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
            this._show(tr('menu_mode_title'), items, back);
        },

        openShift: function (card, back) {
            var self = this, id = Logic.seriesId(card), cur = Series.get(id).shift, values = [-10, -5, -2, -1, 0, 1, 2, 5, 10], items = [];
            if (values.indexOf(cur) === -1) { values.push(cur); values.sort(function (a, b) { return a - b; }); }
            values.forEach(function (v) {
                items.push({
                    title: v ? self._shiftText(v) : tr('shift_zero'),
                    selected: v === cur,
                    action: function () {
                        Series.set(id, { shift: v });
                        if (self._isCurrent(id)) Controller.refresh();
                        self._reopen(card, back);
                        return true;
                    }
                });
            });
            this._show(tr('menu_shift_title'), items, back);
        },

        openPlayer: function () {
            var self = this, c = Controller, ctx = c._ctx;
            if (!ctx) return;
            var t = videoTime(), dur = videoDuration() || c._duration, id = UserMarks.id(ctx), items = [];
            var pending = this._pending && this._pending.id === id ? this._pending : null;
            items.push({ title: tr('menu_episode'), separator: true });
            if (pending) {
                items.push({
                    title: tr('menu_mark_end', { type: typeName(pending.type).toLowerCase() }),
                    subtitle: fmtTime(pending.start) + ' \u2014 ' + fmtTime(t),
                    // время — момент открытия меню (его же показывает подпись), а не выбора пункта:
                    // пока пользователь листает меню, видео продолжает идти
                    action: function () { self._finishMark(ctx, pending, t, dur); }
                });
                items.push({ title: tr('menu_mark_cancel'), action: function () { self._pending = null; } });
            } else {
                ['intro', 'credits', 'recap', 'preview'].forEach(function (type) {
                    items.push({
                        title: tr('menu_mark', { type: typeName(type).toLowerCase() }),
                        subtitle: tr('menu_mark_d', { time: fmtTime(t) }),
                        action: function () {
                            self._pending = { id: id, type: type, start: t };
                            noty(tr('noty_mark_started', { time: fmtTime(self._pending.start) }));
                        }
                    });
                });
            }
            var mine = UserMarks.get(ctx);
            if (mine.length) {
                items.push({
                    title: tr('menu_del_ep_marks', { n: mine.length }),
                    action: function () { UserMarks.remove(ctx); Controller.reload(); noty(tr('noty_ep_marks_deleted')); }
                });
            }
            var ani = c.aniskipTarget();
            if (ani && Settings.submitEnabled()) {
                var seg = c.aniskipSegmentNear(t);
                if (seg && seg.id) {
                    items.push({
                        title: tr('menu_vote'),
                        subtitle: tr('menu_vote_d', { seg: typeName(seg.type) + ' ' + fmtTime(seg.start) + ' \u2014 ' + fmtTime(seg.end) }),
                        action: function () {
                            Anime.vote(seg.id, 'downvote').then(function () { noty(tr('noty_vote_ok')); },
                                function (e) { noty(tr('noty_vote_fail', { err: e && (e.status || e.kind) })); });
                        }
                    });
                }
                var send = mine.filter(function (m) { return m.type !== 'preview'; });
                if (send.length && dur) {
                    items.push({
                        title: tr('menu_submit'),
                        subtitle: tr('menu_submit_d', { mal: ani.mal, ep: ani.ep }),
                        action: function () { self._submit(ani, send, dur); }
                    });
                }
            }
            var info = c.describe();
            if (info) items.push({ title: tr('sources'), subtitle: info, action: function () {} });
            if (ctx.card && Logic.seriesId(ctx.card)) {
                items.push({ title: tr(ctx.movie ? 'menu_movie' : 'menu_series'), separator: true });
                items = items.concat(this.seriesItems(ctx.card, 'player'));
            }
            this._show(tr('plugin_title'), items, 'player');
        },

        _finishMark: function (ctx, pending, t, dur) {
            this._pending = null;
            var a = Math.min(pending.start, t), b = Math.max(pending.start, t);
            if (b - a < 3) return noty(tr('noty_mark_short'));
            UserMarks.add(ctx, { type: pending.type, start: a, end: b }, dur);
            noty(tr('marked_' + pending.type) + ': ' + fmtTime(a) + ' \u2014 ' + fmtTime(b));
            Controller.reload();
        },

        _submit: function (ani, marks, dur) {
            var ok = 0, fail = 0;
            Promise.all(marks.map(function (m) {
                return Anime.submit(ani.mal, ani.ep, m, dur).then(function () { ok++; }, function () { fail++; });
            })).then(function () {
                noty(fail ? tr('noty_submit_part', { ok: ok, fail: fail }) : tr('noty_submit_ok', { ok: ok }));
            });
        }
    };

    // ---------- Диагностика в настройках ----------
    // Состояние источника: строки st_<код> в 05_i18n.js; неизвестный код показывается как есть
    function statusText(st, fallback) {
        if (I18n.has('st_' + st)) return tr('st_' + st);
        return fallback !== undefined ? fallback : String(st);
    }
    var DIAG_BRANDS = { theintrodb: 'TheIntroDB', introdb: 'IntroDB', introhater: 'IntroHater', aniskip: 'Aniskip', anilist: 'AniList' };
    function diagName(src) {
        if (src === 'arm') return tr('diag_arm');
        if (src === 'chapters') return tr('set_chapters');
        return DIAG_BRANDS.hasOwnProperty(src) ? DIAG_BRANDS[src] : String(src);
    }

    var DIAG_MARKS = { lampa: 'diag_marks_lampa', noduration: 'diag_marks_noduration', nohost: 'diag_marks_nohost', short: 'diag_marks_short' };
    var DIAG_MARKS_MODE = { lampa: 'diag_marks_mode_lampa', native: 'diag_marks_mode_native', source: 'diag_marks_mode_source' };

    var Diag = {
        _items: {},
        _stats: null,
        _marksItem: null,

        _ago: function (t) {
            var d = Math.max(0, now() - t);
            if (d < MIN) return tr('ago_now');
            if (d < HOUR) return tr('ago_min', { n: Math.round(d / MIN) });
            if (d < DAY) return tr('ago_h', { n: Math.round(d / HOUR) });
            return tr('ago_d', { n: Math.round(d / DAY) });
        },

        text: function (src) {
            var h = Health.get(src), out;
            if (!h) out = tr('diag_never');
            else {
                out = statusText(h.st) + (h.code && h.st !== 'ok' && h.st !== 'empty' ? ' (HTTP ' + h.code + ')' : '') +
                    (h.ms ? ', ' + tr('diag_ms', { n: h.ms }) : '') + ', ' + this._ago(h.t);
            }
            if (src === 'introdb') {
                var how = Sources.introdb.transport();
                out += ' \u00b7 ' + tr(how === 'android' ? 'via_android' : (how === 'proxy' ? 'via_proxy' : 'via_direct'));
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
            if (this._marksItem) this._paintItem(this._marksItem, this.marksText());
        },

        // «Отметки на шкале (последний просмотр)»: «Нарисовал плагин: 1 · таймкоды от источника видео, длина видео 23:40, 5 мин назад»
        marksText: function () {
            var m = LastMarks.get(), st;
            if (!m) st = tr('diag_marks_never');
            else st = this._marksState(m);
            return st.charAt(0).toUpperCase() + st.slice(1);
        },

        _marksState: function (m) {
            var st = m.st === 'drawn' ? tr('diag_marks_drawn', { n: m.n }) : (DIAG_MARKS.hasOwnProperty(m.st) ? tr(DIAG_MARKS[m.st]) : String(m.st));
            if (DIAG_MARKS_MODE.hasOwnProperty(m.mode)) st += ' \u00b7 ' + tr(DIAG_MARKS_MODE[m.mode]);
            if (m.dur > 0) st += ', ' + tr('diag_marks_len', { t: fmtTime(m.dur) });
            return st + ', ' + this._ago(toNum(m.t) || 0);
        },

        addSettings: function (add, title) {
            var self = this;
            title('skip_intro_t_diag', tr('diag_title'));
            // версия на экране: плагин по IP-адресу Lampa подключает без параметра reset (кэш ТВ может отдать старый файл)
            add({ name: 'skip_intro_diag_version', type: 'static' }, { name: tr('diag_version'), description: 'Skip Intro ' + VERSION });
            add({ name: 'skip_intro_diag_report', type: 'button' },
                { name: tr('diag_report'), description: tr('diag_report_d') },
                { onChange: function () { Report.open(); } });
            add({ name: 'skip_intro_diag_marks', type: 'static' }, { name: tr('diag_marks'), description: self.marksText() }, {
                onRender: function (item) { self._marksItem = item; self._paintItem(item, self.marksText()); }
            });
            DIAG_SOURCES.forEach(function (src) {
                add({ name: 'skip_intro_diag_' + src, type: 'static' }, { name: diagName(src), description: self.text(src) }, {
                    onRender: function (item) { self._items[src] = item; self._paintItem(item, self.text(src)); }
                });
            });
            add({ name: 'skip_intro_diag_check', type: 'button' },
                { name: tr('diag_check'), description: tr('diag_check_d') },
                { onChange: function () { self.check(); } });
            add({ name: 'skip_intro_diag_clear', type: 'button' },
                { name: tr('diag_clear'), description: tr('diag_clear_d') },
                { onChange: function () { var n = Store.clearAll(); noty(tr('noty_cache_cleared_n', { n: n })); } });
            add({ name: 'skip_intro_diag_stats', type: 'static' }, { name: tr('diag_stats'), description: Stats.text() }, {
                onRender: function (item) { self._stats = item; self._paintItem(item, Stats.text()); }
            });
            add({ name: 'skip_intro_diag_stats_reset', type: 'button' }, { name: tr('diag_stats_reset') },
                { onChange: function () { Stats.reset(); self.paint(); noty(tr('noty_stats_reset')); } });
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
            noty(tr('noty_checking'));
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
                    return diagName(src).replace(/ \(.*$/, '') + ': ' + (h ? statusText(h.st) : '?');
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
