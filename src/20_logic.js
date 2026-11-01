    var END_SENTINEL = 1e7;                     // «до конца файла», пока длина видео неизвестна
    var DB_SOURCES = ['theintrodb', 'introdb', 'introhater', 'aniskip'];
    var HEURISTIC_SOURCES = ['subs', 'ass', 'audio'];
    var ORDER_ANIME = ['user', 'chapters', 'aniskip', 'theintrodb', 'introdb', 'introhater', 'det'];
    var ORDER_OTHER = ['user', 'chapters', 'theintrodb', 'introdb', 'introhater', 'aniskip', 'det'];
    var TRUST_LEVELS = { off: 0, low: 1, mid: 2, high: 3 };
    var LIMITS = {                              // разумная длина сегмента, с
        intro: [5, 300], recap: [5, 600], credits: [5, 900], preview: [3, 300]
    };
    var CHAPTER_LIMITS = { intro: [10, 150], recap: [10, 300], credits: [10, 600], preview: [5, 150] };
    // Заставка и рекап бывают в начале файла: начало позже max(10 мин, 40% длины) считаем ошибкой базы.
    // Пример — живой ответ IntroDB для Iron Man (tt0371746, 2026-11-01): «intro» 7512–7545 внутри
    // титров 7038–7540 и сцены после титров 7540–7580.
    var HEAD_MIN = 600;
    var HEAD_SHARE = 0.4;
    var CHAPTER_RULES = [
        { type: 'intro', re: /^(?:op|opening(?:\s+(?:credits|theme|song|titles))?|intro(?:duction)?|title\s+sequence|main\s+titles?|опенинг|заставка|вступление|интро|начальные\s+титры)(?:\s*\d{1,2})?(?:\s*[:\-\u2013\u2014]\s*.+)?$/i },
        { type: 'credits', re: /^(?:ed|ending(?:\s+(?:credits|theme|song|titles))?|end(?:ing)?\s*credits?|credits|closing(?:\s+credits)?|outro|эндинг|титры|финальные\s+титры|конечные\s+титры)(?:\s*\d{1,2})?(?:\s*[:\-\u2013\u2014]\s*.+)?$/i },
        { type: 'preview', re: /^(?:preview|next\s+(?:episode|ep\.?|time)(?:\s+preview)?|yokoku|превью|анонс(?:\s+следующей\s+серии)?|следующая\s+серия|в\s+следующей\s+серии)$/i },
        { type: 'recap', re: /^(?:recap|previously(?:\s+on\b.*)?|ранее(?:\s+в\s+сериале.*)?|в\s+предыдущих\s+сериях|рекап)$/i }
    ];
    var SONG_RE = /(?:^|[^a-zа-яё])(?:op|ed|opening|ending|songs?|karaoke|kara|insert|lyrics?|оп|эд|опенинг|эндинг|песня|караоке)(?:[^a-zа-яё]|$)/i;
    var KEY_EPISODE_RE = /^skip3_(?:[A-Za-z0-9-]+_s\d+_e\d+|m[A-Za-z0-9-]+)$/;
    var KEY_ARM_RE = /^skip3_arm_[A-Za-z0-9-]+$/;
    var KEY_AL_RE = /^skip3_al_\d+$/;
    var KEY_RR_RE = /^skip3_rr_\d+$/;
    var KEY_MAP_RE = /^skip3_map_[A-Za-z0-9-]+_s\d+$/;

    function netError(kind, status, message) {
        var e = new Error(message || kind + (status ? ' ' + status : ''));
        e.kind = kind;
        e.status = status || 0;
        return e;
    }

    function httpFail(status) {
        if (status === 429) return netError('limit', status);
        if (status === 401 || status === 403) return netError('auth', status);
        return netError('http', status);
    }

    var Logic = {
        TAIL_SECONDS: TAIL_SECONDS,
        END_SENTINEL: END_SENTINEL,
        ORDER_ANIME: ORDER_ANIME,
        ORDER_OTHER: ORDER_OTHER,
        netError: netError,

        isHeuristic: function (seg) {
            return !!seg && contains(HEURISTIC_SOURCES, seg.src);
        },

        hasType: function (segments, type) {
            if (!Array.isArray(segments)) return false;
            for (var i = 0; i < segments.length; i++) if (segments[i] && segments[i].type === type) return true;
            return false;
        },

        findSegment: function (segments, time) {
            if (!segments || !segments.length || time === null || time === undefined || isNaN(time)) return null;
            for (var i = 0; i < segments.length; i++) {
                var s = segments[i];
                if (s && time >= s.start && time < s.end) return s;
            }
            return null;
        },

        // Ближайший сегмент, который начнётся в ближайшие lead секунд
        upcoming: function (segments, time, lead) {
            if (!segments || time === null || time === undefined || isNaN(time)) return null;
            var best = null;
            for (var i = 0; i < segments.length; i++) {
                var s = segments[i];
                if (!s || s.start <= time || s.start - time > lead) continue;
                if (!best || s.start < best.start) best = s;
            }
            return best;
        },

        // Титры/превью, которые заканчиваются у самого конца файла, — «хвост» серии
        isTail: function (seg, duration, end) {
            if (!seg || (seg.type !== 'credits' && seg.type !== 'preview')) return false;
            if (seg.toEnd) return true;
            var e = typeof end === 'number' ? end : seg.end;
            return duration > 0 && e >= duration - TAIL_SECONDS;
        },

        // Титры, за которыми сразу идёт превью (если его тоже пропускают), считаются одним хвостом
        chainEnd: function (seg, segments, isEnabled) {
            var end = seg.end, changed = true, guard = 0;
            while (changed && guard++ < 10) {
                changed = false;
                for (var i = 0; i < segments.length; i++) {
                    var s = segments[i];
                    if (!s || s === seg || (s.type !== 'credits' && s.type !== 'preview')) continue;
                    if (isEnabled && !isEnabled(s.type)) continue;
                    if (s.start <= end + 2 && s.end > end) { end = s.end; changed = true; }
                }
            }
            return end;
        },

        bucket: function (duration) {
            return Math.round((duration || 0) / BUCKET) * BUCKET;
        },

        seasonHint: function (card, season) {
            if (!card || !season) return null;
            var list = card.seasons, date, eps;
            function parse(str) {
                var m = /^(\d{4})(?:-(\d{2}))?/.exec(String(str || ''));
                var y = m ? toInt(m[1]) : null, mon = m && m[2] ? toInt(m[2]) : null;
                return { year: y > 0 ? y : null, month: mon >= 1 && mon <= 12 ? mon : null };
            }
            if (Array.isArray(list)) {
                for (var i = 0; i < list.length; i++) {
                    var s = list[i];
                    if (!s || toInt(s.season_number) !== season) continue;
                    date = parse(s.air_date);
                    eps = toInt(s.episode_count);
                    if (date.year || (eps && eps > 0)) {
                        return { year: date.year, month: date.year ? date.month : null, episodes: eps > 0 ? eps : null };
                    }
                }
            }
            if (season === 1 && card.first_air_date) {
                date = parse(card.first_air_date);
                if (date.year) return { year: date.year, month: date.month, episodes: null };
            }
            return null;
        },

        normalizeUrl: function (url) {
            return String(url || '').replace(/^[a-z][a-z0-9+.\-]*:/i, '').replace(/^\/+/, '')
                .replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
        },

        // Правдоподобие положения в файле известной длины; ручные отметки пользователя не проверяем
        plausible: function (seg, duration) {
            if (!seg || !(duration > 0) || seg.src === 'user') return true;
            if (seg.type !== 'intro' && seg.type !== 'recap') return true;
            return seg.start <= Math.max(HEAD_MIN, duration * HEAD_SHARE);
        },

        _sane: function (seg, limits) {
            var lim = (limits || LIMITS)[seg.type];
            if (!lim) return false;
            if (seg.toEnd) return seg.start >= 0;
            var len = seg.end - seg.start;
            return seg.start >= 0 && len >= lim[0] && len <= lim[1];
        },

        // ---------- Разбор ответов источников ----------
        // Каждый парсер: { st: 'ok' | 'empty', s: [сегменты], x: {доп. сведения} } или исключение (ошибка — не кэшируется)

        // TheIntroDB v4: start_ms null — с начала (intro/recap); end_ms null — до конца файла (credits/preview);
        // 0 означает «сегмента нет». 404 с code — валидное «пусто».
        parseTheIntroDB: function (status, json) {
            if (status === 404) {
                var code = isObj(json) ? json.code : null;
                if (code === 'no_submissions' || code === 'episode_not_found' || code === 'media_not_found') {
                    return { st: 'empty', s: [], x: { code: code } };
                }
                throw httpFail(status);
            }
            if (status < 200 || status >= 300) throw httpFail(status);
            if (!isObj(json)) throw netError('format', status);
            var out = [], ref = toNum(json.group_duration_ms), self = this;
            ref = ref > 0 ? ref / 1000 : null;
            SEGMENT_TYPES.forEach(function (type) {
                var list = json[type];
                if (!Array.isArray(list)) return;
                list.forEach(function (x) {
                    if (!isObj(x)) return;
                    var st = toNum(x.start_ms), en = toNum(x.end_ms), seg = { type: type, src: 'theintrodb' };
                    if (type === 'intro' || type === 'recap') {
                        if (en === null || en <= 0) return;
                        seg.start = st === null ? 0 : st / 1000;
                        seg.end = en / 1000;
                    } else {
                        if (st === null || st <= 0 || en === 0) return;
                        seg.start = st / 1000;
                        if (en === null) { seg.end = END_SENTINEL; seg.toEnd = true; }
                        else seg.end = en / 1000;
                    }
                    if (!(seg.end > seg.start)) return;
                    seg.start = round3(seg.start);
                    if (!seg.toEnd) seg.end = round3(seg.end);
                    var conf = toNum(x.confidence), n = toInt(x.submission_count);
                    if (conf !== null) seg.conf = conf;
                    if (n !== null) seg.n = n;
                    if (ref) seg.ref = ref;
                    if (self._sane(seg)) out.push(seg);
                });
            });
            return { st: out.length ? 'ok' : 'empty', s: out, x: ref ? { ref: ref } : {} };
        },

        // IntroDB /segments: поля intro/recap/outro/post_credits или null, флаги no_intro/no_recap/no_outro
        parseIntroDB: function (status, json) {
            if (status === 404) return { st: 'empty', s: [], x: {} };
            if (status < 200 || status >= 300) throw httpFail(status);
            if (!isObj(json)) throw netError('format', status);
            var out = [], x = {}, map = { intro: 'intro', recap: 'recap', outro: 'credits' }, self = this;
            function range(v) {
                if (!isObj(v)) return null;
                var a = toNum(v.start_sec), b = toNum(v.end_sec);
                if (a === null && toNum(v.start_ms) !== null) a = toNum(v.start_ms) / 1000;
                if (b === null && toNum(v.end_ms) !== null) b = toNum(v.end_ms) / 1000;
                return a !== null && b !== null && a >= 0 && b > a ? { start: round3(a), end: round3(b) } : null;
            }
            for (var k in map) {
                if (!map.hasOwnProperty(k)) continue;
                var r = range(json[k]);
                if (!r) continue;
                var seg = { type: map[k], start: r.start, end: r.end, src: 'introdb' };
                var conf = toNum(json[k].confidence), n = toInt(json[k].submission_count);
                if (conf !== null) seg.conf = conf;
                if (n !== null) seg.n = n;
                if (self._sane(seg)) out.push(seg);
            }
            var post = range(json.post_credits);
            if (post) x.post = post;
            var no = {};
            if (json.no_intro === true) no.intro = true;
            if (json.no_recap === true) no.recap = true;
            if (json.no_outro === true) no.credits = true;
            for (var t in no) if (no.hasOwnProperty(t)) { x.no = no; break; }
            return { st: out.length ? 'ok' : 'empty', s: out, x: x };
        },

        // IntroHater: массив { start, end, label, votes, verified, reportCount }.
        // Берём подтверждённые (verified); если их нет — с votes >= 2; с жалобами — нет. По одному на тип.
        parseIntroHater: function (status, json) {
            if (status === 404) return { st: 'empty', s: [], x: {} };
            if (status < 200 || status >= 300) throw httpFail(status);
            if (!Array.isArray(json)) throw netError('format', status);
            var byType = {}, out = [], self = this;
            json.forEach(function (x) {
                if (!isObj(x)) return;
                var a = toNum(x.start), b = toNum(x.end);
                if (a === null || b === null || !(b > a) || a < 0) return;
                var label = String(x.label || '').toLowerCase(), type = 'intro';
                if (label.indexOf('credit') !== -1 || label === 'ed' || label.indexOf('outro') !== -1) type = 'credits';
                else if (label.indexOf('recap') !== -1) type = 'recap';
                else if (label.indexOf('preview') !== -1) type = 'preview';
                var votes = toInt(x.votes) || 0, reports = toInt(x.reportCount) || 0, verified = x.verified === true;
                if (reports > 0 && reports >= votes && !verified) return;
                var seg = { type: type, start: round3(a), end: round3(b), src: 'introhater', n: votes };
                if (verified) seg.verified = true;
                else seg.conf = 0.5;
                if (!self._sane(seg)) return;
                (byType[type] = byType[type] || []).push(seg);
            });
            SEGMENT_TYPES.forEach(function (type) {
                var list = byType[type];
                if (!list) return;
                var pool = list.filter(function (s) { return s.verified; });
                if (!pool.length) pool = list.filter(function (s) { return s.n >= 2; });
                if (!pool.length) return;
                pool.sort(function (p, q) { return (q.n - p.n) || (p.start - q.start); });
                out.push(pool[0]);
            });
            return { st: out.length ? 'ok' : 'empty', s: out, x: {} };
        },

        // Aniskip: found:false (404) — пусто; exact — точная длина, any — любая (недостающее помечается approx)
        combineAniskip: function (exact, any) {
            var result = (exact || []).slice(), have = {};
            result.forEach(function (x) { have[x.type] = true; });
            (any || []).forEach(function (x) {
                if (have[x.type]) return;
                x = copyObject(x);
                x.approx = true;
                result.push(x);
            });
            return AniskipCore.mergeOverlaps(result);
        },

        _chapterTitle: function (title) {
            return String(title || '').replace(/^[\s"'«\[(]+|[\s"'»\])]+$/g, '')
                .replace(/^(?:chapter|глава|part|часть)?\s*\d{1,3}\s*[.:)\-\u2013\u2014]\s*/i, '')
                .replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim();
        },

        chapterType: function (title) {
            var t = this._chapterTitle(title);
            if (!t) return null;
            for (var i = 0; i < CHAPTER_RULES.length; i++) if (CHAPTER_RULES[i].re.test(t)) return CHAPTER_RULES[i].type;
            return null;
        },

        // ffprobe (TorrServer /ffp): chapters[{ start_time, end_time, tags.title }] — только явные названия
        parseChapters: function (json, movie) {
            if (!isObj(json)) throw netError('format', 200);
            var list = Array.isArray(json.chapters) ? json.chapters : [], out = [], self = this;
            var dur = json.format ? toNum(json.format.duration) : null;
            var limits = copyObject(CHAPTER_LIMITS);
            if (movie) limits.credits = [10, 1800];
            list.forEach(function (c) {
                if (!isObj(c)) return;
                var tags = isObj(c.tags) ? c.tags : {};
                var type = self.chapterType(tags.title || tags.TITLE || tags.Title);
                var a = toNum(c.start_time), b = toNum(c.end_time);
                if (!type || a === null || b === null || !(b > a)) return;
                var seg = { type: type, start: round3(a), end: round3(b), src: 'chapters' };
                if (!self._sane(seg, limits)) return;
                if (dur > 0) {
                    if (!self.plausible(seg, dur)) return;
                    if ((type === 'credits' || type === 'preview') && seg.end < dur * 0.6) return;
                }
                out.push(seg);
            });
            // по одному на тип: заставка — первая, титры и превью — последние
            var pick = {}, result = [];
            out.forEach(function (s) {
                var cur = pick[s.type];
                if (!cur) pick[s.type] = s;
                else if ((s.type === 'credits' || s.type === 'preview') && s.start > cur.start) pick[s.type] = s;
            });
            SEGMENT_TYPES.forEach(function (t) { if (pick[t]) result.push(pick[t]); });
            return { st: result.length ? 'ok' : 'empty', s: result, x: { count: list.length } };
        },

        // ---------- Объединение источников ----------
        // records: { src: { st, s, x } }; для каждого типа берётся первый по приоритету источник, где он есть
        combine: function (records, order) {
            var out = [], srcByType = {}, no = {}, post = null;
            records = records || {};
            for (var i = 0; i < order.length; i++) {
                var rec = records[order[i]];
                if (!rec || rec.st !== 'ok' || !Array.isArray(rec.s)) continue;
                for (var j = 0; j < rec.s.length; j++) {
                    var seg = rec.s[j];
                    if (!seg || !contains(SEGMENT_TYPES, seg.type)) continue;
                    if (srcByType[seg.type] && srcByType[seg.type] !== order[i]) continue;
                    srcByType[seg.type] = order[i];
                    out.push(seg);
                }
            }
            for (var k in records) {
                if (!records.hasOwnProperty(k) || !records[k] || !records[k].x) continue;
                var x = records[k].x;
                if (x.no) for (var t in x.no) if (x.no.hasOwnProperty(t) && x.no[t]) no[t] = true;
                if (x.post && !post) post = x.post;
            }
            return { segments: AniskipCore.mergeOverlaps(out), srcByType: srcByType, no: no, post: post };
        },

        // ---------- Порог доверия (автопропуск без кнопки) ----------
        trustOk: function (seg, level) {
            var lv = TRUST_LEVELS.hasOwnProperty(level) ? TRUST_LEVELS[level] : 1;
            if (!seg || this.isHeuristic(seg)) return false;
            if (lv === 0 || seg.src === 'user' || seg.src === 'chapters') return true;
            if (seg.src === 'aniskip') return !(seg.approx && lv >= 2);
            var conf = typeof seg.conf === 'number' ? seg.conf : null;
            var n = typeof seg.n === 'number' ? seg.n : 1;
            if (lv === 1) return conf === null || conf >= 0.5;
            if (lv === 2) return (seg.verified || n >= 2) && (conf === null || conf >= 0.6);
            return (seg.verified || n >= 3) && (conf === null || conf >= 0.8);
        },

        // ---------- Сдвиг таймкодов ----------
        // auto: только хвостовые сегменты (кончаются у конца эталонного файла) привязываются к концу
        // реального файла; manual — ручной сдвиг сериала (с) для данных из баз
        applyShift: function (segments, duration, manual, auto) {
            if (!Array.isArray(segments)) return [];
            manual = toNum(manual) || 0;
            return segments.map(function (seg) {
                if (!seg || !contains(DB_SOURCES, seg.src)) return seg;
                var s = copyObject(seg), delta = 0;
                if (auto && duration > 0 && seg.ref > 0 && (seg.type === 'credits' || seg.type === 'preview') &&
                    (seg.toEnd || seg.end >= seg.ref - TAIL_SECONDS)) {
                    var d = duration - seg.ref;
                    if (Math.abs(d) >= 1.5 && Math.abs(d) <= 90) delta = d;
                }
                delta += manual;
                if (!delta) return seg;
                s.start = Math.max(0, round3(seg.start + delta));
                if (!seg.toEnd) s.end = round3(seg.end + delta);
                s.shift = round3(delta);
                return s.end > s.start ? s : null;
            }).filter(function (s) { return !!s; });
        },

        // Ключ сериала/фильма для кэша и настроек: id TMDB у карточек источников tmdb и cub
        // (как в Lampa, components/watch_history.js), у остальных — «источник-id», чтобы не совпасть с id TMDB
        seriesId: function (card) {
            if (!card || card.id === undefined || card.id === null || card.id === '' || card.id === 0) return null;
            var tmdbOk = !card.source || card.source === 'tmdb' || card.source === 'cub';
            if (tmdbOk) return String(card.id);
            return String(card.source).replace(/[^A-Za-z0-9]/g, '') + '-' + String(card.id).replace(/[^A-Za-z0-9]/g, '');
        },

        // ---------- Кэш ----------
        episodeKey: function (ctx) {
            if (!ctx || !ctx.tmdb) return null;
            if (ctx.movie) return CACHE_PREFIX + 'm' + ctx.tmdb;
            return CACHE_PREFIX + ctx.tmdb + '_s' + ctx.season + '_e' + ctx.episode;
        },

        recordTtl: function (src, st) {
            if (src === 'det') return TTL.det;
            if (src === 'chapters') return st === 'ok' ? TTL.chapOk : TTL.chapEmpty;
            return st === 'ok' ? TTL.ok : TTL.empty;
        },

        isFresh: function (rec, src, now) {
            return !!rec && typeof rec.t === 'number' && (rec.st === 'ok' || rec.st === 'empty') &&
                now - rec.t <= this.recordTtl(src, rec.st) && rec.t <= now + DAY;
        },

        // Запись источника с нужным вариантом; для 'L<длина>' — ближайшая по длине в пределах BUCKET_NEAR
        pickRecord: function (entry, src, variant, now) {
            if (!entry || !isObj(entry.r)) return null;
            var exact = entry.r[src + '|' + (variant || '')];
            if (this.isFresh(exact, src, now)) return exact;
            var m = /^L(\d+)$/.exec(variant || '');
            if (!m) return null;
            var want = toInt(m[1]), best = null, bestDiff = null;
            for (var k in entry.r) {
                if (!entry.r.hasOwnProperty(k)) continue;
                var p = k.split('|');
                if (p[0] !== src) continue;
                var mm = /^L(\d+)$/.exec(p[1] || '');
                if (!mm) continue;
                var diff = Math.abs(toInt(mm[1]) - want);
                if (diff > BUCKET_NEAR || !this.isFresh(entry.r[k], src, now)) continue;
                if (bestDiff === null || diff < bestDiff) { best = entry.r[k]; bestDiff = diff; }
            }
            return best;
        },

        pruneEntry: function (entry, now) {
            var left = 0, changed = false;
            if (!entry || !isObj(entry.r)) return { left: 0, changed: true };
            for (var k in entry.r) {
                if (!entry.r.hasOwnProperty(k)) continue;
                if (this.isFresh(entry.r[k], k.split('|')[0], now)) left++;
                else { delete entry.r[k]; changed = true; }
            }
            return { left: left, changed: changed };
        },

        auxTtl: function (key, obj) {
            if (KEY_ARM_RE.test(key)) return obj && Array.isArray(obj.list) && obj.list.length ? TTL.armOk : TTL.armEmpty;
            if (KEY_AL_RE.test(key)) return obj && obj.st === 'FINISHED' ? TTL.alDone : TTL.alLive;
            if (KEY_RR_RE.test(key)) return obj && Array.isArray(obj.rules) && obj.rules.length ? TTL.rules : TTL.rulesEmpty;
            if (KEY_MAP_RE.test(key)) return obj && obj.malId ? TTL.map : TTL.mapNull;
            return -1;
        },

        isOwnKey: function (key) {
            return KEY_EPISODE_RE.test(key) || KEY_ARM_RE.test(key) || KEY_AL_RE.test(key) || KEY_RR_RE.test(key) || KEY_MAP_RE.test(key);
        },

        isOldKey: function (key) {
            for (var i = 0; i < OLD_KEY_RE.length; i++) if (OLD_KEY_RE[i].test(key)) return true;
            return key === 'skip_intro_detected';
        },

        // entries: [{ key, value }] -> { drop: [ключи], rewrite: { ключ: строка } }
        cleanupPlan: function (entries, now, limit) {
            var drop = [], rewrite = {}, keep = [], i;
            for (i = 0; i < entries.length; i++) {
                var e = entries[i], obj = null;
                if (this.isOldKey(e.key)) { drop.push(e.key); continue; }
                if (!this.isOwnKey(e.key)) continue;
                try { obj = JSON.parse(e.value); } catch (err) {}
                if (!isObj(obj) || typeof obj.t !== 'number' || obj.t > now + DAY) { drop.push(e.key); continue; }
                if (KEY_EPISODE_RE.test(e.key)) {
                    var pr = this.pruneEntry(obj, now);
                    if (!pr.left) { drop.push(e.key); continue; }
                    if (pr.changed) rewrite[e.key] = JSON.stringify(obj);
                } else if (now - obj.t > this.auxTtl(e.key, obj)) {
                    drop.push(e.key);
                    continue;
                }
                keep.push({ key: e.key, t: obj.t });
            }
            if (limit > 0 && keep.length > limit) {
                keep.sort(function (a, b) { return a.t - b.t; });
                for (i = 0; i < keep.length - limit; i++) {
                    drop.push(keep[i].key);
                    delete rewrite[keep[i].key];
                }
            }
            return { drop: drop, rewrite: rewrite };
        },

        // ---------- Субтитры ----------
        _time: function (h, m, s, ms) {
            return 3600 * (toInt(h) || 0) + 60 * toInt(m) + toInt(s) + toInt(ms) / Math.pow(10, String(ms).length);
        },

        parseSrtVtt: function (text) {
            var cues = [], m;
            text = String(text || '').replace(/\r\n?/g, '\n');
            var re = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})/g;
            while ((m = re.exec(text)) !== null) {
                var a = this._time(m[1], m[2], m[3], m[4]), b = this._time(m[5], m[6], m[7], m[8]);
                if (b > a) cues.push({ start: a, end: b });
            }
            return cues;
        },

        // Самая длинная пауза в репликах (15–150 с) в первых 6 минутах — вероятная заставка
        gapIntro: function (cues, window) {
            window = window || 360;
            if (!Array.isArray(cues) || cues.length < 5) return null;
            cues = cues.slice().sort(function (a, b) { return a.start - b.start; });
            var best = null, longest = 0;
            if (cues[0].start >= 15 && cues[0].start <= 150) {
                longest = cues[0].start;
                best = { type: 'intro', start: 0, end: Math.round(cues[0].start), src: 'subs' };
            }
            for (var i = 0; i < cues.length - 1 && !(cues[i].end > window); i++) {
                var gapStart = cues[i].end, gapEnd = cues[i + 1].start, gap = gapEnd - gapStart;
                if (gap >= 15 && gap <= 150 && gapStart < window && gap > longest) {
                    longest = gap;
                    best = { type: 'intro', start: Math.round(gapStart), end: Math.round(gapEnd), src: 'subs' };
                }
            }
            return best;
        },

        _assTime: function (s) {
            var m = /^\s*(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(String(s || ''));
            return m ? this._time(m[1], m[2], m[3], m[4] || '0') : null;
        },

        // ASS/SSA: [Events] с учётом строки Format
        parseAss: function (text) {
            var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n'), section = '', format = null, events = [];
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].replace(/^\uFEFF/, '');
                var sec = /^\s*\[([^\]]+)\]\s*$/.exec(line);
                if (sec) { section = sec[1].toLowerCase(); continue; }
                if (section !== 'events') continue;
                var f = /^\s*Format\s*:\s*(.*)$/i.exec(line);
                if (f) { format = f[1].split(',').map(function (x) { return x.trim().toLowerCase(); }); continue; }
                var d = /^\s*Dialogue\s*:\s*(.*)$/i.exec(line);
                if (!d) continue;
                var fmt = format || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
                var parts = d[1].split(','), ev = {};
                for (var j = 0; j < fmt.length; j++) {
                    if (fmt[j] === 'text') { ev.text = parts.slice(j).join(','); break; }
                    ev[fmt[j]] = parts[j] !== undefined ? parts[j].trim() : '';
                }
                var a = this._assTime(ev.start), b = this._assTime(ev.end);
                if (a === null || b === null || !(b > a)) continue;
                events.push({ start: a, end: b, style: ev.style || '', name: ev.name || '', effect: ev.effect || '', text: ev.text || '' });
            }
            return events;
        },

        isSongEvent: function (ev) {
            if (!ev) return false;
            if (SONG_RE.test(ev.style) || SONG_RE.test(ev.name) || /karaoke/i.test(ev.effect)) return true;
            return /\\k[fo]?\d+/i.test(ev.text) || ev.text.indexOf('\u266a') !== -1 || ev.text.indexOf('\u266b') !== -1;
        },

        // Кластеры строк песен (OP/ED, караоке, ♪): заставка — в начале серии, титры — в конце
        assSongs: function (events, duration) {
            var songs = (events || []).filter(this.isSongEvent).sort(function (a, b) { return a.start - b.start; });
            var clusters = [], cur = null, i;
            for (i = 0; i < songs.length; i++) {
                var ev = songs[i];
                if (cur && ev.start <= cur.end + 8) {
                    cur.end = Math.max(cur.end, ev.end);
                    cur.count++;
                } else {
                    cur = { start: ev.start, end: ev.end, count: 1 };
                    clusters.push(cur);
                }
            }
            var intro = null, credits = null;
            for (i = 0; i < clusters.length; i++) {
                var c = clusters[i], len = c.end - c.start;
                if (c.count < 3 || len < 30 || len > 150) continue;
                var early = c.start < (duration > 0 ? Math.min(600, duration * 0.35) : 600);
                var late = duration > 0 && c.end > duration * 0.65;
                if (early && !intro) intro = c;
                else if (late) credits = c;
            }
            var out = [];
            if (intro) out.push({ type: 'intro', start: Math.max(0, Math.round(intro.start - 1)), end: Math.round(intro.end + 1), src: 'ass' });
            if (credits) out.push({ type: 'credits', start: Math.max(0, Math.round(credits.start - 1)), end: Math.round(credits.end + 1), src: 'ass' });
            return out;
        },

        // ---------- Подписи ----------
        _fileLike: function (t) {
            return /\.(?:mkv|mp4|avi|ts|m2ts|m4v|webm|mov|wmv|flv)$/i.test(t) || /[Ss]\d{1,2}[Ee]\d{1,3}/.test(t) ||
                (t.split('.').length > 3 && t.indexOf(' ') === -1);
        },

        episodeLabel: function (item) {
            if (!item) return '';
            var s = toInt(item.season), e = toInt(item.episode), title = String(item.title || item.name || '').trim();
            title = title.replace(/^.*[\\\/]/, '');
            if (this._fileLike(title)) title = '';
            if (/^(?:серия|episode|эпизод|ep\.?)\s*\d+$|^\d+\s*(?:серия|эпизод)$/i.test(title)) title = '';
            if (title.length > 48) title = title.slice(0, 47).replace(/\s+\S*$/, '') + '\u2026';
            var code = s !== null && e !== null ? 'S' + pad2(s) + 'E' + pad2(e) : (e !== null ? tr('episode_n', { n: e }) : '');
            if (code && title) return code + ' \u2014 ' + title;
            return code || title;
        },

        formatSaved: function (sec) {
            sec = Math.max(0, Math.round(sec || 0));
            var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
            if (h) return tr('dur_hm', { h: h, m: m });
            if (m) return tr('dur_m', { m: m });
            return tr('dur_s', { s: sec });
        },

        // ---------- Передача в Lampa (data.segments) ----------
        toLampaSegments: function (segments, isEnabled) {
            var skip = [];
            (segments || []).forEach(function (s) {
                if (!s || s.toEnd || !(s.end > s.start) || (isEnabled && !isEnabled(s.type))) return;
                skip.push({ start: round3(s.start), end: round3(s.end) });
            });
            return skip.length ? { skip: skip, ad: [] } : null;
        }
    };

    AniskipCore.Logic = Logic;
    AniskipCore.VERSION = VERSION;

    if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') {
        module.exports = AniskipCore;
        return;
    }
    if (typeof window === 'undefined' || window.__skipIntroLoaded) return;
    window.__skipIntroLoaded = true;
