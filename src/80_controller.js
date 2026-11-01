
    // ---------- Контроллер: одна сессия воспроизведения ----------
    var PREFETCH_DELAY = 1e4;       // мс после старта серии: предзагрузка таймкодов следующей серии
    var IMDB_WAIT = 3e3;            // мс: сколько ждать imdb_id из TMDB (через Lampa) до запуска загрузки
    var MIN_MOVIE = 1200;           // с: короче — не фильм (трейлер, ролик), плагин молчит
    var MIN_EPISODE = 60;           // с: короче — не серия
    var YOUTUBE_RE = /(?:youtube\.com|youtu\.be)\//i;

    var Controller = {
        _inited: false,
        _session: 0,
        _data: null,
        _ctx: null,
        _ids: [],
        _records: {},
        _combined: null,
        _segments: [],
        _post: null,
        _duration: 0,
        _lastDuration: 0,
        _mode: 'default',
        _idle: '',
        _native: false,
        _resumed: false,
        _loadDone: false,
        _detect: '',
        _active: null,
        _skipped: {},
        _dismissed: {},
        _marksAt: 0,
        _marks: null,       // что с отметками на шкале: { st: drawn | lampa | noduration | nohost | short, n, has }
        _prefetchTimer: null,
        _prefetched: {},
        _imdb: {},

        init: function () {
            if (this._inited) return;
            this._inited = true;
            var self = this;
            Settings.init();
            Keys.bind();
            Menu.initCard();
            Sync.init();
            renamePluginEntry();
            setTimeout(function () { Store.cleanup(); }, 5000);
            function on(listener, name, fn) {
                try { if (listener && typeof listener.follow === 'function') listener.follow(name, fn); } catch (e) {}
            }
            on(Lampa.Player.listener, 'create', function (e) { self._onCreate(e); });
            on(Lampa.Player.listener, 'start', function (data) { self._onPlayerStart(data); });
            on(Lampa.Player.listener, 'destroy', function () { self._onDestroy(); });
            if (Lampa.PlayerVideo) {
                on(Lampa.PlayerVideo.listener, 'timeupdate', function (e) { self._onTimeUpdate(e); });
                on(Lampa.PlayerVideo.listener, 'loadeddata', function () { self._drawMarks(true); });
            }
            if (Lampa.PlayerPlaylist) on(Lampa.PlayerPlaylist.listener, 'set', function () { self._schedulePrefetch(); });
            this._initHdr();
            log('Plugin v' + VERSION + ' initialized | keys: ' + Keys.mode + ' | auto: ' + Settings.isAutoSkip() +
                ' | confidence: ' + Settings.confidence());
        },

        // Профиль HDR/SDR от «Адаптивных субтитров»: кнопка и предупреждение приглушаются в HDR
        _initHdr: function () {
            try {
                var st = window.AdaptiveSubs && window.AdaptiveSubs.state;
                if (st && st.profile) Hdr.set(st.profile === 'hdr', st.brightness);
            } catch (e) {}
            try {
                Lampa.Listener.follow('adaptive_subs', function (e) {
                    if (e && e.type === 'profile') Hdr.set(e.profile === 'hdr', e.brightness);
                });
            } catch (e) {}
        },

        _reset: function (data) {
            clearTimeout(this._prefetchTimer);
            this._prefetchTimer = null;
            this._data = data || null;
            this._ctx = null;
            this._ids = [];
            this._records = {};
            this._combined = null;
            this._segments = [];
            this._post = null;
            this._duration = 0;
            this._mode = 'default';
            this._idle = '';
            this._native = false;
            this._resumed = false;
            this._loadDone = false;
            this._detect = '';
            this._active = null;
            this._skipped = {};
            this._dismissed = {};
            this._marksAt = 0;
            this._marks = null;
            this._dropLogged = {};
        },

        _teardownUI: function () {
            this._active = null;
            Button.destroy();
            Warn.destroy();
            Marks.clear();
        },

        _setIdle: function (reason) {
            this._idle = reason;
            this._teardownUI();
            log('Idle:', reason);
        },

        // Текущая серия в плейлисте: тот же объект или тот же url; первый — только если серия одна
        _playlistItem: function (data) {
            var list = data && data.playlist, i;
            if (!Array.isArray(list) || !list.length) return null;
            for (i = 0; i < list.length; i++) if (list[i] === data) return list[i];
            if (typeof data.url === 'string' && data.url) {
                for (i = 0; i < list.length; i++) {
                    if (list[i] && typeof list[i].url === 'string' && list[i].url === data.url) return list[i];
                }
            }
            return list.length === 1 ? list[0] : null;
        },

        _seasonEpisode: function (obj) {
            var s = toInt(obj && obj.season), e = toInt(obj && obj.episode);
            if ((s === null || e === null) && obj && typeof obj.title === 'string') {
                var m = obj.title.match(/[Ss](\d{1,2})[Ee](\d{1,4})/);
                if (m) {
                    if (s === null) s = toInt(m[1]);
                    if (e === null) e = toInt(m[2]);
                }
            }
            return { season: s, episode: e };
        },

        // ctx: { tmdb, imdb, season, episode, movie, anime, original_name, card, season_hint, torr, key } или null
        _extractMeta: function (data) {
            data = data || {};
            if (data.iptv || data.tv || data.youtube || (typeof data.url === 'string' && YOUTUBE_RE.test(data.url))) return null;
            var card = data.card || null;
            if (!card) {
                try {
                    var act = Lampa.Activity.active();
                    if (act) card = act.card || act.movie || null;
                } catch (e) {}
            }
            var tmdb = Logic.seriesId(card);
            if (!tmdb) return null;
            var se = this._seasonEpisode(data);
            if (se.season === null || se.episode === null) {
                var item = this._playlistItem(data);
                if (item && item !== data) {
                    var se2 = this._seasonEpisode(item);
                    if (se.season === null) se.season = se2.season;
                    if (se.episode === null) se.episode = se2.episode;
                }
            }
            var imdb = card.imdb_id || (card.external_ids && card.external_ids.imdb_id) || null;
            var ctx = {
                tmdb: tmdb,
                imdb: typeof imdb === 'string' && /^tt\d{7,8}$/.test(imdb) ? imdb : null,
                season: se.season,
                episode: se.episode,
                movie: false,
                anime: AniskipCore.isAnime(card),
                original_name: card.original_name || card.original_title || null,
                card: card,
                season_hint: null,
                torr: Torr.target(data),
                key: null
            };
            var series = !!(card.name && !card.title) || !!card.number_of_seasons || !!card.first_air_date;
            if (se.season !== null && se.episode !== null) series = true;
            if (series) {
                if (se.season === null || se.episode === null) return null;
                ctx.season_hint = Logic.seasonHint(card, se.season);
            } else {
                if (!Settings.moviesEnabled()) return null;
                ctx.movie = true;
                ctx.season = ctx.episode = null;
            }
            ctx.key = Logic.episodeKey(ctx);
            return ctx.key ? ctx : null;
        },

        // imdb_id нужен IntroDB и IntroHater; у неполной карточки его нет — спрашиваем TMDB через Lampa
        // (Lampa делает так же: interaction/card.js, TMDB.external_imdb_id)
        _ensureImdb: function (ctx) {
            if (ctx.imdb || !/^\d+$/.test(ctx.tmdb)) return Promise.resolve(ctx.imdb);
            var self = this, type = ctx.movie ? 'movie' : 'tv', key = type + ctx.tmdb;
            if (this._imdb.hasOwnProperty(key)) {
                ctx.imdb = this._imdb[key];
                return Promise.resolve(ctx.imdb);
            }
            var api = null;
            try { api = Lampa.Api.sources.tmdb; } catch (e) {}
            if (!api || typeof api.external_imdb_id !== 'function') return Promise.resolve(null);
            return new Promise(function (resolve) {
                var done = false;
                function finish(id) {
                    if (done) return;
                    done = true;
                    ctx.imdb = id;
                    resolve(id);
                }
                setTimeout(function () { finish(null); }, IMDB_WAIT);
                try {
                    api.external_imdb_id({ type: type, id: ctx.tmdb }, function (id) {
                        id = typeof id === 'string' && /^tt\d{7,8}$/.test(id) ? id : null;
                        self._imdb[key] = id;
                        finish(id);
                    });
                } catch (e) { finish(null); }
            });
        },

        // Серия уже начата/просмотрена — заставку не перематываем автоматически
        _hasTimecode: function (data) {
            var savedTime = 0, savedPercent = 0, hasHistory = false;
            function scan(obj) {
                if (!obj || !obj.timeline) return;
                var tl = obj.timeline;
                if (tl.time && !isNaN(tl.time)) savedTime = Math.max(savedTime, parseFloat(tl.time));
                if (tl.percent && !isNaN(tl.percent)) savedPercent = Math.max(savedPercent, parseFloat(tl.percent));
                if (tl.duration && tl.percent && !savedTime) savedTime = tl.duration * (tl.percent / 100);
                if (tl.hash && Lampa.Timeline && typeof Lampa.Timeline.view === 'function') {
                    var v = Lampa.Timeline.view(tl.hash, tl);
                    if (v && (v.percent > 0 || v.time > 0)) {
                        hasHistory = true;
                        savedTime = Math.max(savedTime, parseFloat(v.time) || 0);
                        savedPercent = Math.max(savedPercent, parseFloat(v.percent) || 0);
                    }
                }
            }
            try {
                scan(data);
                if (Lampa.Player && typeof Lampa.Player.playdata === 'function') {
                    var pd = Lampa.Player.playdata();
                    if (pd && pd !== data) scan(pd);
                }
            } catch (e) {}
            var has = savedTime > 15 || savedPercent > 5 || hasHistory;
            if (has) log('Existing timecode/history (time: ' + savedTime + 's, percent: ' + savedPercent + '%) — intro/recap only by button');
            return has;
        },

        // ---------- E4: таймкоды из кэша — встроенному пропуску Lampa ----------
        // Lampa читает data.segments на 'start' (player/segments.js), поэтому подставляем их раньше — на 'create'
        _onCreate: function (e) {
            var data = e && e.data;
            if (!data || typeof data !== 'object') return;
            if (data.segments && data.segments._skip_intro) delete data.segments;     // наши прошлые данные на том же объекте
            if (!Settings.isEnabled() || !Settings.nativeEnabled() || hasNativeSegments(data)) return;
            try {
                var ctx = this._extractMeta(data);
                if (!ctx || Series.get(ctx.tmdb).mode === 'off') return;
                var ik = (ctx.movie ? 'movie' : 'tv') + ctx.tmdb;
                if (!ctx.imdb && this._imdb[ik]) ctx.imdb = this._imdb[ik];
                var lampa = Logic.toLampaSegments(this._cachedSegments(ctx, this._lastDuration), function (t) { return Settings.isTypeEnabled(t); });
                if (!lampa) return;
                lampa._skip_intro = true;
                data.segments = lampa;
                log('Native mode: ' + lampa.skip.length + ' segment(s) passed to Lampa for', ctx.key);
            } catch (err) {
                log('Native mode error:', err && err.message);
            }
        },

        // Только то, что уже лежит в кэше (эвристика не передаётся: Lampa может пропустить её без кнопки)
        _cachedSegments: function (ctx, guessDur) {
            var records = {}, user = UserMarks.get(ctx);
            if (user.length) records.user = { st: 'ok', s: user };
            // кэш серии не зависит от imdb_id: берём и записи IntroDB/IntroHater, даже если imdb_id ещё не узнали
            Loader.sourceIds(ctx, false, true).forEach(function (id) {
                var rec = Store.getRecord(ctx, id, Sources[id].variant(ctx, guessDur));
                if (rec) records[id] = { st: rec.st, s: rec.s || [], x: rec.x || {} };
            });
            var c = Logic.combine(records, ctx.anime === true ? Logic.ORDER_ANIME : Logic.ORDER_OTHER);
            var segs = c.segments.filter(function (s) { return !Logic.isHeuristic(s); });
            segs = Logic.applyShift(segs, 0, Series.get(ctx.tmdb).shift, false);
            return guessDur > 0 ? segs.filter(function (s) { return Logic.plausible(s, guessDur); }) : segs;
        },

        // ---------- Старт серии ----------
        _onPlayerStart: function (data) {
            this._session++;
            this._teardownUI();
            AudioDet.destroy();
            this._reset(data);
            if (!Settings.isEnabled()) return this._setIdle('disabled');
            var ctx = this._extractMeta(data);
            if (!ctx) {
                log('Not a series/movie or missing metadata — idle');
                this._idle = 'meta';
                return;
            }
            this._ctx = ctx;
            this._native = !!(data && data.segments && data.segments._skip_intro);
            if (!this._native && hasNativeSegments(data)) {
                log('Lampa has its own skip segments for this video — plugin stays idle');
                return this._setIdle('lampa');
            }
            this._mode = Series.get(ctx.tmdb).mode;
            this._resumed = this._hasTimecode(data);
            if (this._mode === 'off') return this._setIdle('series');
            this._load();
        },

        _load: function () {
            var self = this, ctx = this._ctx, session = this._session;
            function isCurrent() { return self._session === session; }
            this._records = {};
            this._loadDone = false;
            this._detect = '';
            // imdb_id нужен только IntroDB/IntroHater: остальные источники стартуют сразу, не дожидаясь TMDB
            var imdbP = this._ensureImdb(ctx).then(function (id) {
                if (isCurrent() && !id) log('No imdb_id for', ctx.key, '— IntroDB/IntroHater skipped');
                return id;
            });
            var waitImdb = !IMDB_RE.test(ctx.imdb || '');
            this._ids = Loader.sourceIds(ctx, false, waitImdb);
            log('Loading', ctx.key, '| sources:', this._ids.join(', ') || 'none', waitImdb ? '(imdb_id pending)' : '', ctx.torr ? '| torrserver' : '');
            try {
                this._records = Loader.load(ctx, {
                    isCurrent: isCurrent,
                    imdb: waitImdb ? imdbP : null,
                    // длительность берём не сразу: на 'start' элемент видео ещё может отдавать старую
                    duration: function () { return 0; },
                    waitDuration: function () {
                        return delay(500).then(function () { return isCurrent() ? Net.waitDuration(isCurrent) : 0; }).then(function (d) {
                            if (d && isCurrent()) self._lastDuration = d;     // для кэша на 'create' следующего запуска
                            return d;
                        });
                    },
                    drop: function (id) {
                        if (isCurrent()) self._ids = self._ids.filter(function (x) { return x !== id; });
                    },
                    update: function (records, done) {
                        if (!isCurrent()) return;
                        self._records = records;
                        self.recompute();
                        if (done) {
                            self._loadDone = true;
                            self._schedulePrefetch();
                        }
                        if (done || self._dbSettled()) self._maybeDetect(isCurrent);
                    }
                }, false);
            } catch (err) { log('Load error:', err && err.message); }
            this.recompute();
        },

        // Все базы (кроме глав — ffprobe бывает долгим) ответили
        _dbSettled: function () {
            for (var i = 0; i < this._ids.length; i++) {
                if (this._ids[i] !== 'chapters' && !this._records[this._ids[i]]) return false;
            }
            return true;
        },

        // ---------- Эвристика: только для недостающих типов и только если базы не сказали «нет» ----------
        _maybeDetect: function (isCurrent) {
            var self = this, ctx = this._ctx, c = this._combined;
            if (this._detect || !ctx || ctx.movie || this._native || !c || !Settings.isDetectEnabled()) return;
            var need = {};
            ['intro', 'credits'].forEach(function (t) {
                if (Settings.isTypeEnabled(t) && !Logic.hasType(c.segments, t) && !c.no[t]) need[t] = true;
            });
            if (!need.intro && !need.credits) return;
            this._detect = 'run';
            Net.waitDuration(isCurrent).then(function (dur) {
                if (!isCurrent()) return;
                var variant = dur ? 'L' + Logic.bucket(dur) : '', cached = Store.getRecord(ctx, 'det', variant);
                if (cached) {
                    log('Using cached detection for', ctx.key);
                    return self._setDet({ st: cached.st, s: cached.s || [] });
                }
                var video = getVideo();
                if (!video) { self._detect = 'none'; return; }
                return Subs.detect(video, dur).then(function (segs) {
                    if (!isCurrent()) return;
                    segs = (segs || []).filter(function (s) { return s && need[s.type]; });
                    if (segs.length) return self._saveDet(ctx, variant, segs);
                    if (!need.intro || !Settings.isAudioDetectEnabled()) { self._detect = 'none'; return; }
                    log('No subtitle segments, trying audio...');
                    return AudioDet.detect(video, isCurrent).then(function (seg) {
                        if (!isCurrent()) return;
                        if (seg) self._saveDet(ctx, variant, [seg]);
                        else self._detect = 'none';
                    });
                });
            }).then(null, function (err) {
                log('Detection error:', err && err.message);
                if (isCurrent()) self._detect = 'none';
            });
        },

        _saveDet: function (ctx, variant, segs) {
            Store.putRecord(ctx, 'det', variant, { st: 'ok', s: segs });
            log('Detection found', segs.length, 'segment(s):', segs.map(function (s) { return s.type + '/' + s.src; }).join(', '));
            this._setDet({ st: 'ok', s: segs });
        },

        _setDet: function (rec) {
            this._records.det = rec;
            this._detect = 'done';
            this.recompute();
        },

        // ---------- Итоговый список сегментов ----------
        recompute: function () {
            var ctx = this._ctx;
            if (!ctx || this._idle) return;
            var c = Logic.combine(this._records, ctx.anime === true ? Logic.ORDER_ANIME : Logic.ORDER_OTHER);
            var dur = this._duration, s = Series.get(ctx.tmdb), counts = {};
            var segs = Logic.applyShift(c.segments, dur, s.shift, Settings.autoShift());
            if (dur) {
                var dropLogged = this._dropLogged || (this._dropLogged = {});
                segs = AniskipCore.applyOffsets(segs, dur).filter(function (seg) {
                    if (Logic.plausible(seg, dur)) return true;
                    var sig = seg.type + seg.start + '-' + seg.end + seg.src;
                    if (!dropLogged[sig]) log('Dropped implausible', seg.type, seg.start + '-' + seg.end, '(' + seg.src + ') for length', Math.round(dur));
                    dropLogged[sig] = true;
                    return false;
                });
            }
            segs = segs.map(function (seg) {
                var x = copyObject(seg);
                counts[x.type] = (counts[x.type] || 0) + 1;
                x.k = x.type + '|' + (counts[x.type] - 1);       // устойчивый ключ: пересчёт не «возрождает» пропущенное
                return x;
            });
            this._combined = c;
            this._post = c.post && c.post.start >= 0 ? { start: Math.max(0, c.post.start + s.shift), end: c.post.end ? c.post.end + s.shift : 0 } : null;
            this._segments = segs;
            if (this._active) {
                var still = this._byKey(this._active.k);
                if (!still) this._hideButton();
                else this._active = still;
            }
            this._drawMarks(true);
        },

        _byKey: function (k) {
            for (var i = 0; i < this._segments.length; i++) if (this._segments[i].k === k) return this._segments[i];
            return null;
        },

        _enabled: function () {
            return this._segments.filter(function (s) { return Settings.isTypeEnabled(s.type); });
        },

        _isShort: function () {
            var d = this._duration;
            return !!(this._ctx && d > 0 && d < (this._ctx.movie ? MIN_MOVIE : MIN_EPISODE));
        },

        _drawMarks: function (force) {
            if (this._idle || !this._ctx) return;
            var t = now();
            if (!force && t - this._marksAt < 5000) return;
            this._marksAt = t;
            if (this._native && this._lampaMarksOk()) {
                Marks.clear();
                return this._marksState('lampa');
            }
            var dur = this._duration || videoDuration() || seekableEnd();
            if (!dur) return this._marksState('noduration');
            if (this._isShort()) {
                Marks.clear();
                return this._marksState('short');
            }
            // при передаче в Lampa — только то, что получила Lampa: без «до конца файла» и без эвристики
            var segs = this._native ? this._segments.filter(function (s) { return !s.toEnd && !Logic.isHeuristic(s); }) : this._segments;
            var n = Marks.draw(segs, dur);
            this._marksState(n < 0 ? 'nohost' : 'drawn', n, dur);
        },

        // Режим «Отдавать таймкоды в Lampa»: Lampa 3.4.4 рисует свои отметки только на 'loadeddata' и при смене сегментов,
        // с длиной из video.duration; если длина тогда была неизвестна, ширина отметок 0 — тогда рисуем свои.
        // Без стилей сегментов (нет position: absolute) отметки Lampa тоже не видны — тогда тоже рисуем свои
        _lampaMarksOk: function () {
            try {
                var list = document.querySelectorAll('.player-panel__timeline-segments .player-panel__timeline-segment');
                for (var i = 0; i < list.length; i++) {
                    if (!(parseFloat(list[i].style.width) > 0)) continue;
                    if (!window.getComputedStyle || window.getComputedStyle(list[i]).position === 'absolute') return true;
                }
            } catch (e) {}
            return false;
        },

        // Для «Источников» в меню плеера и журнала: почему отметок нет на шкале (одна запись на изменение)
        _marksState: function (st, n, dur) {
            n = n > 0 ? n : 0;
            var has = this._segments.length > 0;
            if (this._marks && this._marks.st === st && this._marks.n === n && this._marks.has === has) return;
            this._marks = { st: st, n: n, has: has };
            if (!has) return;               // таймкодов ещё нет — в журнал не пишем
            if (st === 'drawn') log('Timeline marks:', n, 'drawn, duration', Math.round(dur), 's');
            else log('Timeline marks:', st);
        },

        _marksText: function () {
            var m = this._marks;
            if (!m || !this._segments.length) return '';
            if (m.st === 'drawn') return m.n ? tr('marks_drawn', { n: m.n }) : '';
            return m.st === 'noduration' || m.st === 'nohost' || m.st === 'lampa' ? tr('marks_' + m.st) : '';
        },

        // ---------- Воспроизведение ----------
        _onTimeUpdate: function (e) {
            if (!this._ctx || this._idle) return;
            if (this._native) return this._drawMarks(false);    // пропуском занимается Lampa; проверяем только её отметки
            if (!Settings.isEnabled()) {
                if (this._active) this._hideButton();
                Warn.hide();
                return;
            }
            var dur = e && typeof e.duration === 'number' && isFinite(e.duration) && e.duration > 0 ? e.duration : videoDuration();
            if (dur && Math.abs(dur - this._duration) >= 1) {
                this._duration = dur;
                this.recompute();
            } else {
                this._drawMarks(false);
            }
            // Слишком короткое видео (трейлер, ролик) — молчим; длина HLS может расти, поэтому без «вечного» отказа
            if (this._isShort()) {
                Warn.hide();
                if (this._active) this._hideButton();
                return;
            }
            var time = e && typeof e.current === 'number' && isFinite(e.current) ? e.current : videoTime();
            var segs = this._enabled();
            if (!segs.length) {
                Warn.hide();
                if (this._active) this._hideButton();
                return;
            }
            var seg = Logic.findSegment(segs, time);
            if (!seg) {
                this._dismissed = {};
                if (this._active) this._hideButton();
                this._updateWarn(segs, time, dur);
                return;
            }
            Warn.hide();
            if (this._skipped[seg.k] || this._dismissed[seg.k]) return;
            if (nativeSkipVisible()) {
                if (this._active) this._hideButton();
                return;
            }
            if (this._active && this._active.k === seg.k) return;
            this._decide(seg, dur);
        },

        _isTailSeg: function (seg, dur) {
            if (seg.type !== 'credits' && seg.type !== 'preview') return false;
            return Logic.isTail(seg, dur, Logic.chainEnd(seg, this._enabled(), null));
        },

        // Сцена после титров (IntroDB post_credits): хвост не пропускаем дальше её начала
        _postFor: function (seg, dur) {
            var p = this._post;
            if (!p || !seg || (seg.type !== 'credits' && seg.type !== 'preview')) return null;
            if (p.start < seg.start || (dur && p.start >= dur - 1)) return null;
            return p;
        },

        _wouldAuto: function (seg) {
            if (Logic.isHeuristic(seg) || this._mode === 'button') return false;
            if (this._resumed && (seg.type === 'intro' || seg.type === 'recap')) return false;
            if (!Logic.trustOk(seg, Settings.confidence())) return false;
            return this._mode === 'auto' || Settings.isAutoSkip();
        },

        _decide: function (seg, dur) {
            this._active = seg;
            if (this._wouldAuto(seg)) return this._doSkip(seg, true);
            var introLike = seg.type === 'intro' || seg.type === 'recap';
            var smart = this._mode !== 'button' && !Logic.isHeuristic(seg) && !(this._resumed && introLike) &&
                Logic.trustOk(seg, Settings.confidence()) && Smart.hasSkipped(this._ctx.tmdb, seg.type);
            if (smart) this._showCountdown(seg, dur);
            else this._showButton(seg, dur);
        },

        _nextLabel: function (seg, dur) {
            if (!this._isTailSeg(seg, dur) || this._postFor(seg, dur) || !canNext()) return null;
            return Logic.episodeLabel(nextItem());
        },

        _labelFor: function (seg, dur) {
            if (this._nextLabel(seg, dur) !== null) return tr('next_episode');
            return tr(I18n.has('label_' + seg.type) ? 'label_' + seg.type : 'skip');
        },

        _badgeFor: function (seg, dur) {
            if (seg.src === 'subs') return tr('badge_subs');
            if (seg.src === 'ass') return tr('badge_ass');
            if (seg.src === 'audio') return tr('badge_audio');
            if (this._isTailSeg(seg, dur) && this._postFor(seg, dur)) return tr('badge_post');
            if (seg.approx) return '\u2248 Aniskip';
            return '';
        },

        _updateWarn: function (segs, time, dur) {
            var up = Logic.upcoming(segs, time, WARN_LEAD);
            if (!up || this._skipped[up.k] || nativeSkipVisible() || Button.isVisible()) return Warn.hide();
            var n = Math.max(1, Math.ceil(up.start - time)), auto = this._wouldAuto(up), next = this._nextLabel(up, dur), text;
            if (next !== null && auto) text = tr('warn_next_in', { n: n }) + (next ? ': ' + next : '');
            else {
                text = tr('warn_type_in', { type: typeName(up.type), n: n });
                if (auto) text += ' \u2014 ' + tr('will_' + up.type);
                else if (next) text += ' \u00b7 ' + tr('warn_then', { next: next });
            }
            Warn.show(text);
        },

        _showButton: function (seg, dur) {
            var self = this, k = seg.k;
            Button.show({
                label: this._labelFor(seg, dur),
                badge: this._badgeFor(seg, dur),
                sub: this._nextLabel(seg, dur) || '',
                hint: tr('hint_press', { key: keyTitle(Settings.skipKeyName()) }),
                countdown: false,
                timeout: Settings.buttonTimeout(),
                onSkip: function () {
                    var cur = self._byKey(k) || seg;
                    if (self._ctx) Smart.rememberSkip(self._ctx.tmdb, cur.type);
                    self._doSkip(cur, false);
                },
                onTimeout: function () {
                    if (self._active && self._active.k === k) self._active = null;
                    self._dismissed[k] = true;
                }
            });
        },

        _showCountdown: function (seg, dur) {
            var self = this, k = seg.k;
            Button.show({
                label: this._labelFor(seg, dur),
                badge: this._badgeFor(seg, dur),
                sub: this._nextLabel(seg, dur) || '',
                hint: tr('hint_cancel', { key: keyTitle(Settings.cancelKeyName()) }),
                countdown: true,
                onSkip: function () { self._doSkip(self._byKey(k) || seg, true); },
                onCancel: function () {
                    log('Auto-skip cancelled by user');
                    if (self._ctx) Smart.forgetSkip(self._ctx.tmdb, seg.type);
                    self._skipped[k] = true;
                    self._active = null;
                    Button.destroy();
                }
            });
        },

        _hideButton: function () {
            this._active = null;
            Button.hide();
        },

        // -> 'seek' | 'post' | 'to_end' | 'next' | 'end'
        _doSkip: function (seg, auto) {
            this._skipped[seg.k] = true;
            this._active = null;
            Button.destroy();
            Warn.hide();
            var dur = videoDuration() || this._duration, t = videoTime(), how;
            var tailLike = seg.type === 'credits' || seg.type === 'preview';
            var end = tailLike ? Logic.chainEnd(seg, this._enabled(), null) : seg.end;
            try {
                if (tailLike && Logic.isTail(seg, dur, end)) {
                    var post = this._postFor(seg, dur);
                    if (post) {
                        seekTo(post.start);
                        Stats.add(seg.type, post.start - t);
                        log('Skip', seg.type, '-> post-credits scene at', post.start, auto ? '(auto)' : '(manual)');
                        return 'post';
                    }
                    Stats.add(seg.type, dur ? dur - t : 0);
                    how = goNext();
                    log('Skip', seg.type, 'at the end of the episode ->', how, auto ? '(auto)' : '(manual)');
                    return how;
                }
                var target = dur ? Math.min(end, dur) : end;
                seekTo(target);
                Stats.add(seg.type, target - t);
                log('Skipped', seg.type, 'to', target, auto ? '(auto)' : '(manual)');
                return 'seek';
            } catch (e) {
                log('Error skipping:', e && e.message);
                return 'error';
            }
        },

        // ---------- Предзагрузка следующей серии ----------
        _schedulePrefetch: function () {
            var self = this, session = this._session;
            if (!this._ctx || this._ctx.movie || this._idle || this._prefetchTimer) return;
            this._prefetchTimer = setTimeout(function () {
                self._prefetchTimer = null;
                if (self._session === session) self._prefetchNext();
            }, PREFETCH_DELAY);
        },

        _ctxFromItem: function (item, base) {
            var se = this._seasonEpisode(item);
            if (se.season === null || se.episode === null) return null;
            var ctx = copyObject(base);
            ctx.season = se.season;
            ctx.episode = se.episode;
            ctx.torr = null;
            ctx.season_hint = Logic.seasonHint(base.card, se.season);
            ctx.key = Logic.episodeKey(ctx);
            return ctx;
        },

        _prefetchNext: function () {
            var ctx = this._ctx, item = nextItem();
            if (!ctx || !item || this._idle || !Settings.isEnabled()) return null;
            var next = this._ctxFromItem(item, ctx);
            if (!next || next.key === ctx.key || this._prefetched[next.key]) return null;
            this._prefetched[next.key] = true;
            // длина следующей серии неизвестна: берём текущую (кэш длины подходит в пределах ±10 с)
            var dur = this._duration || videoDuration();
            log('Prefetch', next.key, dur ? '(assumed length ' + Math.round(dur) + ' s)' : '');
            Loader.load(next, { duration: function () { return dur; } }, true);
            return next.key;
        },

        // ---------- Для меню ----------
        reload: function () {
            if (!this._ctx || !this._data || (this._idle && this._idle !== 'series')) return;
            this._session++;
            clearTimeout(this._prefetchTimer);
            this._prefetchTimer = null;
            this._teardownUI();
            this._records = {};
            this._combined = null;
            this._segments = [];
            this._post = null;
            this._dismissed = {};
            this._idle = '';
            this._mode = Series.get(this._ctx.tmdb).mode;
            if (this._mode === 'off') return this._setIdle('series');
            this._load();
        },

        refresh: function () {
            if (!this._ctx) return;
            var mode = Series.get(this._ctx.tmdb).mode;
            if (this._idle === 'series') {
                if (mode !== 'off') this.reload();
                return;
            }
            if (this._idle) return;
            this._mode = mode;
            if (mode === 'off') return this._setIdle('series');
            this.recompute();
        },

        describe: function () {
            var ctx = this._ctx, self = this;
            if (!ctx) return '';
            if (this._idle === 'lampa') return tr('desc_lampa');
            if (this._idle === 'series') return tr(ctx.movie ? 'desc_off_movie' : 'desc_off_series');
            if (this._isShort()) return tr('desc_short');
            var parts = [];
            this._segments.forEach(function (s) {
                var to = s.end >= Logic.END_SENTINEL ? tr('desc_end') : fmtTime(s.end);
                var extra = (s.approx ? ', \u2248' : '') + (s.shift ? ', ' + tr('desc_shift', { v: Menu._shiftText(s.shift) }) : '');
                parts.push(typeName(s.type) + ' ' + fmtTime(s.start) + '\u2013' + to + ' (' + sourceName(s.src) + extra + ')');
            });
            if (!parts.length) parts.push(tr(this._loadDone ? 'desc_none' : 'desc_loading'));
            var st = [];
            this._ids.forEach(function (id) {
                var r = self._records[id], name = sourceName(id);
                if (!r) st.push(name + ': ' + tr('desc_waiting'));
                else if (r.st === 'error') st.push(name + ': ' + statusText(r.kind, tr('st_error')));
                else st.push(name + ': ' + tr(r.st === 'ok' ? 'desc_found' : 'desc_empty') + (r.cached ? ' (' + tr('desc_cached') + ')' : ''));
            });
            if (this._native) st.push(tr('desc_native'));
            var tail = st.join(', ');
            // после точки — с заглавной буквы («главы файла: есть» -> «Главы файла: есть»)
            if (tail) tail = tail.charAt(0).toUpperCase() + tail.slice(1);
            var marks = this._marksText();
            return parts.join('; ') + (tail ? '. ' + tail : '') + (marks ? '. ' + marks : '');
        },

        aniskipTarget: function () {
            var r = this._records && this._records.aniskip, x = r && r.x;
            return x && x.mal && x.ep ? { mal: x.mal, ep: x.ep } : null;
        },

        // Сегмент Aniskip (со skipId) у текущей позиции — для голоса «против»
        aniskipSegmentNear: function (t) {
            var r = this._records && this._records.aniskip;
            if (!r || !Array.isArray(r.s)) return null;
            var best = null, bestD = 31;
            r.s.forEach(function (s) {
                if (!s || !s.id) return;
                var d = t < s.start ? s.start - t : (t > s.end ? t - s.end : 0);
                if (d < bestD) { best = s; bestD = d; }
            });
            return best;
        },

        _onDestroy: function () {
            this._session++;
            if (this._duration) this._lastDuration = this._duration;
            this._teardownUI();
            AudioDet.destroy();
            this._reset(null);
        }
    };
