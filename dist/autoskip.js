/*!
 * Skip Intro for Lampa v1.0.0 (MIT License)
 * Skip button and auto-skip for intros, recaps, credits and previews in TV shows, and for credits in movies.
 * Timestamps: TheIntroDB v4, IntroDB, IntroHater, Aniskip (anime: ARM -> MyAnimeList, AniList search as a fallback),
 * MKV chapters via TorrServer, your own marks. If no database knows the intro, a subtitle heuristic (SRT/VTT/ASS)
 * and, optionally, an audio heuristic are used; heuristic results are only offered as a button.
 * The user interface is in Russian. ES5 + Promise, no dependencies.
 */
(function () {
    'use strict';

    var VERSION = "1.0.0";
    var MIN = 6e4;
    var HOUR = 36e5;
    var DAY = 864e5;
    var TTL = {
        ok: 7 * DAY,            // таймкоды из баз
        empty: DAY / 2,         // база честно ответила «ничего нет»
        det: 30 * DAY,          // результат эвристики
        chapOk: 30 * DAY,       // главы файла (свойство самого файла)
        chapEmpty: 7 * DAY,
        armOk: 30 * DAY,        // ARM: TMDB -> MAL
        armEmpty: 7 * DAY,
        alDone: 30 * DAY,       // AniList: вышедший тайтл
        alLive: DAY,            // AniList: выходит / анонс — число серий меняется
        rules: 30 * DAY,        // правила Aniskip
        rulesEmpty: 7 * DAY,
        map: 30 * DAY,          // запасной поиск AniList
        mapNull: 7 * DAY
    };
    var CACHE_LIMIT = 400;
    var CACHE_PREFIX = 'skip3_';
    var MERGE_GAP = 1;              // с: сегменты одного типа с таким зазором считаются одним
    var TAIL_SECONDS = 15;          // как в Lampa (player/skip.js): до конца файла < 15 с — конец серии
    var BUCKET = 5;                 // с: шаг «длины файла» в ключах кэша
    var BUCKET_NEAR = 10;           // с: допуск при поиске записи с другой длиной файла
    var PART_FORMATS = ['TV', 'TV_SHORT', 'ONA'];
    var SEGMENT_TYPES = ['intro', 'recap', 'credits', 'preview'];
    var ANY_SEASON_MARK = /season\s*\d|part\s*\d|\d(?:st|nd|rd|th)\s+season|final\s+season|\u7b2c\s*\d+\s*\u671f/;
    // Ключи v2.11 — удаляются при первом запуске v3
    var OLD_KEY_RE = [
        /^skip_[A-Za-z0-9-]+_s\d+_e\d+_L\d+$/,
        /^aniskip_map_[A-Za-z0-9-]+_s\d+$/,
        /^skip_intro_det_[A-Za-z0-9-]+_s\d+_e\d+_L\d+$/
    ];

    function contains(list, value) {
        if (!list) return false;
        for (var i = 0; i < list.length; i++) if (list[i] === value) return true;
        return false;
    }

    function copyObject(obj) {
        var out = {};
        for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
        return out;
    }

    function toInt(value) {
        if (value === null || value === undefined || value === '') return null;
        var n = parseInt(value, 10);
        return isNaN(n) ? null : n;
    }

    function toNum(value) {
        if (value === null || value === undefined || value === '') return null;
        var n = typeof value === 'number' ? value : parseFloat(value);
        return isNaN(n) || !isFinite(n) ? null : n;
    }

    function clamp(v, a, b) {
        return v < a ? a : (v > b ? b : v);
    }

    function pad2(n) {
        n = toInt(n) || 0;
        return n < 10 ? '0' + n : String(n);
    }

    function round3(v) {
        return Math.round(v * 1000) / 1000;
    }

    // 1 пропуск, 2 пропуска, 5 пропусков
    function plural(n, one, few, many) {
        var a = Math.abs(n) % 100, b = a % 10;
        if (a > 10 && a < 20) return many;
        if (b === 1) return one;
        if (b >= 2 && b <= 4) return few;
        return many;
    }

    function isObj(v) {
        return !!v && typeof v === 'object' && !(v instanceof Array);
    }

    // ===================== Чистая логика (тестируется в Node) =====================
    // Сегмент: { type, start, end, src, toEnd?, conf?, n?, approx?, ref?, id?, kind?, verified? }
    //   toEnd — конец неизвестен заранее («до конца файла»), end уточняется по длине видео;
    //   conf — доверие 0..1, n — число подтверждений, ref — длина эталонного файла (с), id — skipId Aniskip.

    var AniskipCore = {
        isAnime: function (card) {
            if (!card) return null;
            var genreIds = null;
            if (Array.isArray(card.genre_ids)) genreIds = card.genre_ids;
            else if (Array.isArray(card.genres)) genreIds = card.genres.map(function (g) { return g && g.id; });
            if (!genreIds || !genreIds.length) return null;
            if (genreIds.indexOf(16) === -1) return false;
            var lang = card.original_language || null;
            var origins = Array.isArray(card.origin_country) ? card.origin_country : null;
            if (!origins && Array.isArray(card.production_countries)) {
                origins = card.production_countries.map(function (c) { return c && c.iso_3166_1; });
            }
            if (lang === null && origins === null) return null;
            if (lang === 'ja') return true;
            if (origins && origins.indexOf('JP') !== -1) return true;
            return false;
        },

        // ---------- Запасной путь: поиск в AniList по названию (как в v2.11) ----------
        buildSearchQueries: function (originalName, season) {
            if (!originalName) return [];
            var queries = [originalName];
            if (season >= 2 && /^[\u0000-\u024f\s]+$/.test(originalName)) queries.push(originalName + ' Season ' + season);
            return queries;
        },

        _titleOf: function (m) {
            var t = (m && m.title) || {};
            return ((t.romaji || '') + ' ' + (t.english || '') + ' ' + (t.native || '')).toLowerCase();
        },

        _seasonMark: function (season) {
            return new RegExp('season\\s*' + season + '\\b|part\\s*' + season + '\\b|\\b' + season +
                '(?:st|nd|rd|th)\\s+season|\\u7b2c\\s*' + season + '\\s*\\u671f');
        },

        // hint = { year, month, episodes } из card.seasons (TMDB). Премьера в декабре относится
        // к зимнему сезону следующего года, поэтому сравниваем и startDate, и seasonYear.
        scoreEntry: function (m, season, hint) {
            var score = 0, title = this._titleOf(m);
            if (hint) {
                var start = m.startDate || {}, years = [], diff = null, i;
                if (start.year) years.push(start.year);
                if (m.seasonYear) years.push(m.seasonYear);
                if (hint.year) {
                    for (i = 0; i < years.length; i++) {
                        var d = Math.abs(years[i] - hint.year);
                        if (diff === null || d < diff) diff = d;
                    }
                }
                if (diff !== null) score += diff === 0 ? 4 : (diff === 1 ? 1 : -3);
                if (hint.year && hint.month && start.year === hint.year && start.month === hint.month) score += 1;
                if (hint.episodes && m.episodes && m.episodes === hint.episodes) score += 2;
            }
            if (this._seasonMark(season).test(title)) score += 3;
            else if (ANY_SEASON_MARK.test(title) && !(season >= 2 && /final\s+season/.test(title))) score -= 2;
            return score;
        },

        pickSeasonEntry: function (mediaList, season, hint) {
            if (!Array.isArray(mediaList) || !mediaList.length) return null;
            var i, m;
            if (hint && (hint.year || hint.episodes)) {
                var best = null, tied = [];
                for (i = 0; i < mediaList.length; i++) {
                    m = mediaList[i];
                    if (!m || !m.idMal) continue;
                    var score = this.scoreEntry(m, season, hint);
                    if (best === null || score > best) { best = score; tied = [m]; }
                    else if (score === best) tied.push(m);
                }
                if (best !== null && best >= 3) return this._firstOfChain(tied);
            }
            if (season >= 2) {
                var re = this._seasonMark(season);
                for (i = 0; i < mediaList.length; i++) {
                    m = mediaList[i];
                    if (m && m.idMal && re.test(this._titleOf(m))) return m;
                }
                return null;
            }
            var firstMark = this._seasonMark(1);
            for (i = 0; i < mediaList.length; i++) {
                m = mediaList[i];
                if (!m || !m.idMal) continue;
                var t = this._titleOf(m);
                if (!ANY_SEASON_MARK.test(t) || firstMark.test(t)) return m;
            }
            return mediaList[0] && mediaList[0].idMal ? mediaList[0] : null;
        },

        _firstOfChain: function (list) {
            if (list.length < 2) return list[0] || null;
            var sequels = {}, i;
            for (i = 0; i < list.length; i++) {
                var next = this.nextPart(list[i]);
                if (next) sequels[next.malId] = true;
            }
            for (i = 0; i < list.length; i++) if (!sequels[list[i].idMal]) return list[i];
            return list[0];
        },

        nextPart: function (entry) {
            var edges = entry && entry.relations && entry.relations.edges;
            if (!Array.isArray(edges)) return null;
            for (var i = 0; i < edges.length; i++) {
                var edge = edges[i], node = edge && edge.node;
                if (edge && edge.relationType === 'SEQUEL' && node && node.idMal && contains(PART_FORMATS, node.format)) {
                    return { malId: node.idMal, eps: node.episodes || null };
                }
            }
            return null;
        },

        // Сезон TMDB длиннее записи AniList — продолжение нумерации в следующей части
        resolveEpisode: function (map, episode) {
            if (map && map.eps && map.next && map.next.malId && episode > map.eps) {
                return { malId: map.next.malId, episode: episode - map.eps };
            }
            return { malId: map ? map.malId : null, episode: episode };
        },

        // ---------- Основной путь: ARM (TMDB -> MAL) ----------
        // ARM: [{ myanimelist, media, themoviedb-season, ... }] -> компактный вид для кэша
        reduceArm: function (list) {
            var out = [];
            if (!Array.isArray(list)) return out;
            for (var i = 0; i < list.length; i++) {
                var e = list[i], mal = e ? toInt(e.myanimelist) : null;
                if (!mal || mal <= 0) continue;
                var s = e['themoviedb-season'];
                out.push({ m: mal, s: s === null || s === undefined ? null : toInt(s), md: e.media ? String(e.media) : null });
            }
            return out;
        },

        // Какие записи MAL относятся к сезону TMDB:
        //   { mode: 'season', ids } — у ARM есть сезоны TMDB (части сезона идут цепочкой);
        //   { mode: 'show', mal }   — ARM знает только сериал целиком (One Piece): нужен сквозной номер.
        armPick: function (entries, season) {
            if (!Array.isArray(entries) || !season || season < 1) return null;
            var bySeason = [], nulls = [], hasSeasons = false, seen = {}, i, e;
            for (i = 0; i < entries.length; i++) {
                e = entries[i];
                if (!e || !e.m || e.md === 'MOVIE') continue;
                if (typeof e.s === 'number') {
                    if (e.s > 0) hasSeasons = true;
                    if (e.s === season && !seen[e.m]) { seen[e.m] = true; bySeason.push(e.m); }
                } else if (e.s === null) {
                    nulls.push(e);
                }
            }
            if (bySeason.length) return { mode: 'season', ids: bySeason };
            if (hasSeasons || !nulls.length) return null;
            if (nulls.length === 1) return { mode: 'show', mal: nulls[0].m };
            var tv = nulls.filter(function (x) { return x.md === 'TV'; });
            return tv.length === 1 ? { mode: 'show', mal: tv[0].m } : null;
        },

        // info: { <mal>: { eps, fmt, st, y, mo, d, next } } из AniList (idMal_in)
        // -> части сезона по дате премьеры; анонсы, отменённые и фильмы не участвуют
        buildChain: function (ids, info) {
            var out = [], i;
            info = info || {};
            for (i = 0; i < ids.length; i++) {
                var x = info[ids[i]];
                if (!x) continue;
                if (x.st === 'NOT_YET_RELEASED' || x.st === 'CANCELLED' || x.fmt === 'MOVIE') continue;
                var eps = x.eps > 0 ? x.eps : (x.next > 1 ? x.next - 1 : null);
                out.push({ mal: ids[i], eps: eps, y: x.y || 9999, mo: x.mo || 12, d: x.d || 31, i: i });
            }
            out.sort(function (a, b) { return (a.y - b.y) || (a.mo - b.mo) || (a.d - b.d) || (a.i - b.i); });
            return out.map(function (x) { return { mal: x.mal, eps: x.eps }; });
        },

        // Серия сезона TMDB -> { mal, ep, over } (over: номер больше, чем серий в последней части)
        locateInChain: function (chain, episode) {
            if (!Array.isArray(chain) || !chain.length || !(episode > 0)) return null;
            var cum = 0;
            for (var i = 0; i < chain.length; i++) {
                var c = chain[i];
                if (c.eps && episode > cum + c.eps && i < chain.length - 1) { cum += c.eps; continue; }
                var ep = episode - cum;
                return { mal: c.mal, ep: ep, over: !!(c.eps && ep > c.eps) };
            }
            return null;
        },

        // Сквозной номер серии по card.seasons (сезон 0 не считается).
        // Если номер больше числа серий сезона — TMDB уже нумерует сквозь (One Piece: S2 = 62, 63…).
        absoluteEpisode: function (card, season, episode) {
            if (!(episode > 0) || !(season >= 1)) return null;
            if (season === 1) return episode;
            var list = card && Array.isArray(card.seasons) ? card.seasons : null;
            if (!list) return null;
            var counts = {}, i;
            for (i = 0; i < list.length; i++) {
                var s = list[i], n = s ? toInt(s.season_number) : null, c = s ? toInt(s.episode_count) : null;
                if (n !== null && n >= 1 && c !== null && c >= 0) counts[n] = c;
            }
            if (counts[season] && episode > counts[season]) return episode;
            var sum = 0;
            for (i = 1; i < season; i++) {
                if (counts[i] === undefined) return null;
                sum += counts[i];
            }
            return sum + episode;
        },

        // Правила Aniskip (relation-rules): применяется первое совпавшее
        applyRules: function (rules, episode) {
            if (!Array.isArray(rules) || !(episode > 0)) return null;
            for (var i = 0; i < rules.length; i++) {
                var r = rules[i], from = r && r.from, to = r && r.to;
                if (!from || !to || !to.malId || !(from.start > 0) || !(to.start > 0)) continue;
                if (episode < from.start || (from.end && episode > from.end)) continue;
                var ep = to.start + (episode - from.start);
                if (to.end && ep > to.end) continue;
                return { mal: toInt(to.malId), ep: ep };
            }
            return null;
        },

        _aniskipTypeMap: { op: 'intro', 'mixed-op': 'intro', ed: 'credits', 'mixed-ed': 'credits', recap: 'recap' },

        mapAniskipTypes: function (results) {
            var out = [];
            if (!Array.isArray(results)) return out;
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                if (!r || !r.interval) continue;
                var type = this._aniskipTypeMap[r.skipType];
                var start = r.interval.startTime, end = r.interval.endTime;
                if (!type || typeof start !== 'number' || typeof end !== 'number' || end <= start || start < 0) continue;
                var seg = { type: type, start: round3(start), end: round3(end), src: 'aniskip', kind: r.skipType };
                if (r.episodeLength > 0) seg.ref = r.episodeLength;
                if (r.skipId) seg.id = String(r.skipId);
                out.push(seg);
            }
            return out;
        },

        // Под реальную длительность: «до конца файла» получает конец, выходящее за файл обрезается
        applyOffsets: function (segments, duration) {
            if (!Array.isArray(segments) || !duration) return segments;
            var out = [];
            for (var i = 0; i < segments.length; i++) {
                var seg = segments[i];
                if (!seg) continue;
                if (seg.start >= duration - 1) continue;
                if (seg.toEnd || seg.end > duration) {
                    seg = copyObject(seg);
                    seg.end = duration;
                }
                if (seg.end - seg.start < 1) continue;
                out.push(seg);
            }
            return out;
        },

        // Пересекающиеся (или вплотную идущие) сегменты одного типа объединяются (ed + mixed-ed)
        mergeOverlaps: function (segments) {
            if (!Array.isArray(segments)) return [];
            var out = [], i;
            for (i = 0; i < segments.length; i++) if (segments[i]) out.push(segments[i]);
            function mergeOnce() {
                for (var a = 0; a < out.length; a++) {
                    for (var b = a + 1; b < out.length; b++) {
                        var x = out[a], y = out[b];
                        if (x.type !== y.type || y.start > x.end + MERGE_GAP || y.end < x.start - MERGE_GAP) continue;
                        var m = copyObject(x);
                        m.start = Math.min(x.start, y.start);
                        m.end = Math.max(x.end, y.end);
                        if (!y.approx) delete m.approx;
                        if (y.toEnd) m.toEnd = true;
                        out[a] = m;
                        out.splice(b, 1);
                        return true;
                    }
                }
                return false;
            }
            while (mergeOnce()) {}
            out.sort(function (p, q) { return p.start - q.start; });
            return out;
        }
    };

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
            var code = s !== null && e !== null ? 'S' + pad2(s) + 'E' + pad2(e) : (e !== null ? 'Серия ' + e : '');
            if (code && title) return code + ' \u2014 ' + title;
            return code || title;
        },

        formatSaved: function (sec) {
            sec = Math.max(0, Math.round(sec || 0));
            var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
            if (h) return h + ' ч ' + m + ' мин';
            if (m) return m + ' мин';
            return sec + ' с';
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


    // ===================== Плагин =====================

    var SCRIPT_SRC = '';
    try { SCRIPT_SRC = (document.currentScript && document.currentScript.src) || ''; } catch (e) {}

    var PLUGIN_NAME = 'Skip Intro/Outro + Aniskip';
    var PLUGIN_AUTHOR = "";    // package.json config.pluginAuthor (пусто — не показывается)
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


    // ---------- Сеть ----------
    var Net = {
        // -> { status, text, json }; reject только при сетевой ошибке (kind: network) и таймауте (kind: timeout)
        request: function (method, url, opts) {
            opts = opts || {};
            return new Promise(function (resolve, reject) {
                var xhr, timer = null, done = false;
                function finish(err, value) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (err) reject(err);
                    else resolve(value);
                }
                try {
                    xhr = new XMLHttpRequest();
                    xhr.open(method, url, true);
                    if (!opts.raw) xhr.setRequestHeader('Accept', 'application/json');
                    if (opts.body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
                    if (opts.headers) for (var h in opts.headers) if (opts.headers.hasOwnProperty(h)) xhr.setRequestHeader(h, opts.headers[h]);
                } catch (e) {
                    return finish(netError('network', 0, e && e.message));
                }
                timer = setTimeout(function () {
                    finish(netError('timeout'));
                    try { xhr.abort(); } catch (e) {}
                }, opts.timeout || NET_TIMEOUT);
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4 || done) return;
                    var status = xhr.status, text = xhr.responseText || '';
                    if (!status) return finish(netError('network'));
                    finish(null, { status: status, text: text, json: opts.raw ? null : Net.parse(text) });
                };
                xhr.onerror = function () { finish(netError('network')); };
                try { xhr.send(opts.body !== undefined ? JSON.stringify(opts.body) : null); } catch (e) { finish(netError('network', 0, e && e.message)); }
            });
        },

        parse: function (text) {
            if (!text || !/^\s*[\[{]/.test(text)) return null;
            try { return JSON.parse(text); } catch (e) { return null; }
        },

        get: function (url, opts) { return this.request('GET', url, opts); },
        post: function (url, body, opts) {
            opts = opts ? copyObject(opts) : {};
            opts.body = body;
            return this.request('POST', url, opts);
        },
        text: function (url, timeout) {
            return this.request('GET', url, { raw: true, timeout: timeout }).then(function (r) {
                if (r.status < 200 || r.status >= 300) throw httpFail(r.status);
                return r.text;
            });
        },

        // Android-приложение Lampa делает запрос само (AndroidJS.httpReq) — без ограничений CORS
        canNative: function () {
            try {
                if (!(Lampa.Platform && Lampa.Platform.is && Lampa.Platform.is('android'))) return false;
                if (typeof AndroidJS === 'undefined' || !AndroidJS.appVersion) return false;
                var code = parseInt(String(AndroidJS.appVersion()).split('-').pop(), 10);
                return code >= 16 && typeof Lampa.Reguest === 'function';
            } catch (e) { return false; }
        },

        native: function (url, timeout) {
            return new Promise(function (resolve, reject) {
                var done = false, timer = setTimeout(function () { finish(netError('timeout')); }, timeout || NET_TIMEOUT);
                function finish(err, value) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (err) reject(err);
                    else resolve(value);
                }
                try {
                    var req = new Lampa.Reguest();
                    req.native(url, function (data) {
                        var json = typeof data === 'string' ? Net.parse(data) : data;
                        finish(null, { status: 200, text: typeof data === 'string' ? data : '', json: json });
                    }, function (x) {
                        var status = x && toInt(x.status);
                        if (!status) return finish(netError('network'));
                        var text = x && typeof x.responseText === 'string' ? x.responseText : '';
                        finish(null, { status: status, text: text, json: Net.parse(text) });
                    }, false, { timeout: timeout || NET_TIMEOUT });
                } catch (e) {
                    finish(netError('network', 0, e && e.message));
                }
            });
        },

        // Прокси: «{url}» — подставить адрес как есть, «{encoded}» — закодированным, иначе — префикс
        applyProxy: function (proxy, url) {
            if (!proxy) return url;
            if (proxy.indexOf('{url}') !== -1) return proxy.replace('{url}', url);
            if (proxy.indexOf('{encoded}') !== -1) return proxy.replace('{encoded}', encodeURIComponent(url));
            return proxy + url;
        },

        waitDuration: function (isCurrent, maxMs) {
            return new Promise(function (resolve) {
                var tries = 0, limit = Math.ceil((maxMs || 15000) / 250);
                (function check() {
                    if (isCurrent && !isCurrent()) return resolve(0);
                    var d = videoDuration();
                    if (d) return resolve(d);
                    if (++tries >= limit) return resolve(0);
                    setTimeout(check, 250);
                })();
            });
        }
    };

    // ---------- TorrServer ----------
    // Общий кэш ffprobe для autoskip и adaptive_subs: один запуск ffprobe на файл
    function sharedFfp() {
        if (!window.__lampa_ffp__ || typeof window.__lampa_ffp__.get !== 'function') {
            window.__lampa_ffp__ = {
                v: 1,
                _p: {},
                get: function (base, hash, index, auth, timeout) {
                    var key = (base + '|' + hash + '|' + index).toLowerCase(), cache = this._p;
                    if (cache[key]) return cache[key];
                    var p = new Promise(function (resolve) {
                        var xhr, done = false, timer;
                        function finish(r) {
                            if (done) return;
                            done = true;
                            clearTimeout(timer);
                            if (!r || r.status !== 200) setTimeout(function () { if (cache[key] === p) delete cache[key]; }, 6e4);
                            resolve(r);
                        }
                        try {
                            xhr = new XMLHttpRequest();
                            xhr.open('GET', base + '/ffp/' + hash + '/' + index, true);
                            if (auth) xhr.setRequestHeader('Authorization', auth);
                            xhr.onreadystatechange = function () {
                                if (xhr.readyState !== 4) return;
                                var json = null;
                                try { json = JSON.parse(xhr.responseText); } catch (e) {}
                                finish({ status: xhr.status, json: json });
                            };
                            xhr.onerror = function () { finish({ status: 0, json: null }); };
                            timer = setTimeout(function () {
                                try { xhr.abort(); } catch (e) {}
                                finish({ status: 0, json: null, timeout: true });
                            }, timeout || 3e4);
                            xhr.send(null);
                        } catch (e) { finish({ status: 0, json: null }); }
                    });
                    cache[key] = p;
                    return p;
                }
            };
        }
        return window.__lampa_ffp__;
    }

    var Torr = {
        // { base, hash, index } из адреса потока TorrServer (/stream, /play, /gst)
        target: function (data) {
            var url = data && typeof data.url === 'string' ? data.url : '';
            var base = url.match(/^(https?:\/\/[^\/?#]+(?:\/[^?#]*?)?)\/(?:stream|play|gst)(?:\/|\?|$)/);
            if (!base) return null;
            var hash = null, index = null, m;
            if (data && typeof data.torrent_hash === 'string' && /^[a-fA-F0-9]{40}$/.test(data.torrent_hash)) hash = data.torrent_hash;
            if (!hash) {
                m = url.match(/[?&]link=([a-fA-F0-9]{40})(?![a-fA-F0-9])/) || url.match(/\/(?:play|gst)\/([a-fA-F0-9]{40})(?![a-fA-F0-9])/);
                if (m) hash = m[1];
            }
            m = url.match(/[?&]index=(\d+)/) || url.match(/\/play\/[a-fA-F0-9]{40}\/(\d+)/);
            if (m) index = toInt(m[1]);
            if (!hash || index === null) return null;
            return { base: base[1], hash: hash.toLowerCase(), index: index };
        },

        // Как Lampa (utils/reguest.js): Basic-авторизация, если включена и запрос идёт на адрес TorrServer
        auth: function (base) {
            try {
                var on = Lampa.Storage.field('torrserver_auth');
                if (!(on === true || on === 'true')) return null;
                var urls = [Lampa.Storage.get('torrserver_url', ''), Lampa.Storage.get('torrserver_url_two', '')], hit = false;
                for (var i = 0; i < urls.length; i++) {
                    var u = String(urls[i] || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
                    if (u && base.indexOf(u) !== -1) hit = true;
                }
                if (!hit) return null;
                var pair = Lampa.Storage.get('torrserver_login', '') + ':' + (Lampa.Storage.value ? Lampa.Storage.value('torrserver_password', '') : Lampa.Storage.get('torrserver_password', ''));
                var enc = Lampa.Base64 && Lampa.Base64.encode ? Lampa.Base64.encode(pair) : btoa(pair);
                return 'Basic ' + enc;
            } catch (e) { return null; }
        },

        ffp: function (target) {
            return sharedFfp().get(target.base, target.hash, target.index, this.auth(target.base), FFP_TIMEOUT);
        }
    };

    // ---------- Источники таймкодов ----------
    // fetch(ctx, dur) -> Promise<{ st, s, x }>; ошибка -> reject (в кэш не попадает)
    var IMDB_RE = /^tt\d{7,8}$/;

    var Sources = {
        theintrodb: {
            name: 'TheIntroDB',
            usesDuration: true,
            applicable: function (ctx) { return !!ctx.tmdb && /^\d+$/.test(String(ctx.tmdb)); },
            variant: function (ctx, dur) { return dur ? 'L' + Logic.bucket(dur) : ''; },
            // По документации tmdb_id переводится сервером из нумерации TMDB в порядок TVDB —
            // номера сезона и серии в Lampa как раз из TMDB
            url: function (ctx, dur) {
                var q = 'tmdb_id=' + encodeURIComponent(ctx.tmdb);
                if (!ctx.movie) q += '&season=' + ctx.season + '&episode=' + ctx.episode;
                q += '&details=true';
                if (dur) q += '&duration_ms=' + Math.round(dur * 1000);
                return 'https://api.theintrodb.org/v4/media?' + q;
            },
            fetch: function (ctx, dur) {
                return Net.get(this.url(ctx, dur)).then(function (r) { return Logic.parseTheIntroDB(r.status, r.json); });
            }
        },

        introdb: {
            name: 'IntroDB',
            needsImdb: true,
            // assumeImdb: imdb_id ещё спрашиваем у TMDB — источник ждёт ответа, остальные не ждут
            applicable: function (ctx, assumeImdb) { return !!assumeImdb || IMDB_RE.test(ctx.imdb || ''); },
            variant: function () { return ''; },
            url: function (ctx) {
                return 'https://api.introdb.app/segments?imdb_id=' + ctx.imdb +
                    (ctx.movie ? '&is_movie=true' : '&season=' + ctx.season + '&episode=' + ctx.episode);
            },
            transport: function () {
                if (Net.canNative()) return 'android';
                return Settings.introdbProxy() ? 'proxy' : 'direct';
            },
            fetch: function (ctx) {
                var url = this.url(ctx), how = this.transport(), p;
                if (how === 'android') p = Net.native(url);
                else if (how === 'proxy') p = Net.get(Net.applyProxy(Settings.introdbProxy(), url));
                else p = Net.get(url);
                return p.then(function (r) { return Logic.parseIntroDB(r.status, r.json); });
            }
        },

        introhater: {
            name: 'IntroHater',
            needsImdb: true,
            applicable: function (ctx, assumeImdb) { return !ctx.movie && (!!assumeImdb || IMDB_RE.test(ctx.imdb || '')); },
            variant: function () { return ''; },
            url: function (ctx) {
                return 'https://introhater.com/api/segments/' + ctx.imdb + ':' + ctx.season + ':' + ctx.episode;
            },
            fetch: function (ctx) {
                return Net.get(this.url(ctx)).then(function (r) { return Logic.parseIntroHater(r.status, r.json); });
            }
        },

        aniskip: {
            name: 'Aniskip',
            usesDuration: true,
            applicable: function (ctx) {
                return Settings.isAniskipEnabled() && !ctx.movie && ctx.anime !== false && /^\d+$/.test(String(ctx.tmdb || ''));
            },
            variant: function (ctx, dur) { return dur ? 'L' + Logic.bucket(dur) : 'any'; },
            fetch: function (ctx, dur) {
                return Anime.resolve(ctx).then(function (target) {
                    if (!target) return { st: 'empty', s: [], x: { map: 'none' } };
                    return Anime.skipTimes(target, dur).then(function (res) {
                        res.x = { mal: res.mal, ep: res.ep, via: target.via };
                        return res;
                    });
                });
            }
        },

        chapters: {
            name: 'Главы MKV',
            applicable: function (ctx) { return Settings.chaptersEnabled() && !!ctx.torr; },
            variant: function (ctx) { return ctx.torr ? 'h' + ctx.torr.hash.slice(0, 10) + '_' + ctx.torr.index : ''; },
            fetch: function (ctx) {
                return Torr.ffp(ctx.torr).then(function (r) {
                    if (!r || !r.status) throw netError(r && r.timeout ? 'timeout' : 'network');
                    if (r.status === 404) throw netError('unavailable', 404, 'ffprobe недоступен на TorrServer');
                    if (r.status !== 200) throw httpFail(r.status);
                    return Logic.parseChapters(r.json, ctx.movie);
                });
            }
        }
    };

    // ---------- Аниме: TMDB -> MAL (ARM, AniList), правила Aniskip ----------
    var Anime = {
        ARM: 'https://arm.haglund.dev/api/v2/themoviedb?id=',
        GQL_IDS: 'query($ids:[Int]){Page(perPage:50){media(idMal_in:$ids,type:ANIME){idMal episodes format status startDate{year month day} nextAiringEpisode{episode}}}}',
        GQL_SEARCH: 'query($s:String){Page(perPage:20){media(search:$s,type:ANIME,format_in:[TV,TV_SHORT,ONA]){' +
            'idMal seasonYear startDate{year month} episodes format title{romaji english native} ' +
            'relations{edges{relationType node{idMal episodes format seasonYear}}}}}}',

        arm: function (tmdb) {
            var key = CACHE_PREFIX + 'arm_' + tmdb, cached = Store.getAux(key);
            if (cached) return Promise.resolve(cached.list || []);
            var t0 = now();
            return Net.get(this.ARM + encodeURIComponent(tmdb)).then(function (r) {
                var list;
                if (r.status === 404) list = [];
                else if (r.status === 200 && Array.isArray(r.json)) list = AniskipCore.reduceArm(r.json);
                else if (r.status === 200 && isObj(r.json)) list = AniskipCore.reduceArm([r.json]);
                else throw httpFail(r.status);
                Health.set('arm', list.length ? 'ok' : 'empty', now() - t0, r.status);
                Store.setAux(key, { list: list });
                return list;
            }, function (err) {
                Health.set('arm', Health.fromError(err), now() - t0);
                throw err;
            });
        },

        info: function (ids) {
            var out = {}, missing = [], i;
            for (i = 0; i < ids.length; i++) {
                var c = Store.getAux(CACHE_PREFIX + 'al_' + ids[i]);
                if (c) out[ids[i]] = c;
                else missing.push(ids[i]);
            }
            if (!missing.length) return Promise.resolve(out);
            var t0 = now();
            return Net.post('https://graphql.anilist.co', { query: this.GQL_IDS, variables: { ids: missing } }).then(function (r) {
                if (r.status !== 200 || !r.json || !r.json.data) throw httpFail(r.status || 500);
                Health.set('anilist', 'ok', now() - t0, r.status);
                var media = (r.json.data.Page && r.json.data.Page.media) || [], got = {};
                media.forEach(function (m) {
                    if (!m || !m.idMal) return;
                    var sd = m.startDate || {};
                    var rec = { eps: m.episodes || null, fmt: m.format || null, st: m.status || null, y: sd.year || null, mo: sd.month || null, d: sd.day || null,
                        next: m.nextAiringEpisode && m.nextAiringEpisode.episode ? m.nextAiringEpisode.episode : null };
                    Store.setAux(CACHE_PREFIX + 'al_' + m.idMal, rec);
                    out[m.idMal] = rec;
                    got[m.idMal] = true;
                });
                missing.forEach(function (id) {
                    if (!got[id]) Store.setAux(CACHE_PREFIX + 'al_' + id, { st: 'UNKNOWN' });
                });
                return out;
            }, function (err) {
                Health.set('anilist', Health.fromError(err), now() - t0);
                throw err;
            });
        },

        rules: function (mal) {
            var key = CACHE_PREFIX + 'rr_' + mal, cached = Store.getAux(key);
            if (cached) return Promise.resolve(cached.rules || []);
            return Net.get('https://api.aniskip.com/v2/relation-rules/' + mal).then(function (r) {
                var rules;
                if (r.status === 404) rules = [];
                else if (r.status === 200 && r.json) rules = Array.isArray(r.json.rules) ? r.json.rules : [];
                else throw httpFail(r.status);
                Store.setAux(key, { rules: rules });
                return rules;
            });
        },

        // Запасной путь v2.11: поиск по названию (только если жанр — точно аниме)
        searchMap: function (ctx) {
            var key = CACHE_PREFIX + 'map_' + ctx.tmdb + '_s' + ctx.season, cached = Store.getAux(key);
            if (cached) return Promise.resolve(cached.malId ? { malId: cached.malId, eps: cached.eps || null, next: cached.next || null } : null);
            var queries = AniskipCore.buildSearchQueries(ctx.original_name, ctx.season), self = this;
            if (!queries.length) return Promise.resolve(null);
            function attempt(i) {
                if (i >= queries.length) return Promise.resolve(null);
                return Net.post('https://graphql.anilist.co', { query: self.GQL_SEARCH, variables: { s: queries[i] } }).then(function (r) {
                    if (r.status !== 200) throw httpFail(r.status);
                    var media = (r.json && r.json.data && r.json.data.Page && r.json.data.Page.media) || [];
                    var picked = AniskipCore.pickSeasonEntry(media, ctx.season, ctx.season_hint);
                    if (picked && picked.idMal) return { malId: picked.idMal, eps: picked.episodes || null, next: AniskipCore.nextPart(picked) };
                    return attempt(i + 1);
                });
            }
            return attempt(0).then(function (map) {
                Store.setAux(key, { malId: map ? map.malId : null, eps: map ? map.eps : null, next: map ? map.next : null });
                return map;
            });
        },

        // -> { mal, ep, over?, via } или null (сопоставления нет)
        resolve: function (ctx) {
            var self = this;
            return this.arm(ctx.tmdb).then(function (list) {
                var pick = AniskipCore.armPick(list, ctx.season);
                if (!pick) return null;
                if (pick.mode === 'show') {
                    var abs = AniskipCore.absoluteEpisode(ctx.card, ctx.season, ctx.episode);
                    return abs ? { mal: pick.mal, ep: abs, via: 'arm-abs' } : null;
                }
                if (pick.ids.length === 1) return { mal: pick.ids[0], ep: ctx.episode, via: 'arm' };
                return self.info(pick.ids).then(function (info) {
                    var loc = AniskipCore.locateInChain(AniskipCore.buildChain(pick.ids, info), ctx.episode);
                    if (loc) loc.via = 'arm-chain';
                    return loc;
                }, function () {
                    return { mal: pick.ids[0], ep: ctx.episode, via: 'arm' };
                });
            }, function (err) {
                if (ctx.anime === true && ctx.original_name) return null;
                throw err;
            }).then(function (target) {
                if (target || ctx.anime !== true || !ctx.original_name) return target;
                return self.searchMap(ctx).then(function (map) {
                    if (!map || !map.malId) return null;
                    var t = AniskipCore.resolveEpisode(map, ctx.episode);
                    return { mal: t.malId, ep: t.episode, via: 'anilist' };
                });
            });
        },

        _get: function (mal, ep, len) {
            var url = 'https://api.aniskip.com/v2/skip-times/' + mal + '/' + ep +
                '?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap&episodeLength=' + len;
            return Net.get(url).then(function (r) {
                if (r.status === 404) return { found: false, s: [] };
                if (r.status !== 200 || !r.json) throw httpFail(r.status);
                var ok = r.json.found && Array.isArray(r.json.results);
                return { found: !!ok, s: ok ? AniskipCore.mapAniskipTypes(r.json.results) : [] };
            });
        },

        // Точная длина и «любая длина» — параллельно; если не найдено — правила Aniskip
        _pair: function (mal, ep, dur) {
            var exactLen = dur ? Math.round(dur) : 0, fails = 0, self = this, last = null;
            function soft(p) { return p.then(null, function (e) { fails++; last = e; return { found: false, s: [] }; }); }
            var reqs = exactLen ? [soft(self._get(mal, ep, exactLen)), soft(self._get(mal, ep, 0))] : [soft(self._get(mal, ep, 0))];
            return Promise.all(reqs).then(function (r) {
                if (fails === reqs.length) throw last || netError('network');
                var exact = r.length > 1 ? r[0].s : [], any = r.length > 1 ? r[1].s : r[0].s;
                return { found: r[0].found || (r[1] && r[1].found), s: Logic.combineAniskip(exact, any) };
            });
        },

        skipTimes: function (target, dur) {
            var self = this;
            function done(mal, ep, res) {
                return { st: res.s.length ? 'ok' : 'empty', s: res.s, mal: mal, ep: ep };
            }
            function viaRules(mal, ep) {
                return self.rules(mal).then(function (rules) {
                    var t = AniskipCore.applyRules(rules, ep);
                    if (!t || (t.mal === mal && t.ep === ep)) return null;
                    return self._pair(t.mal, t.ep, dur).then(function (res) { return done(t.mal, t.ep, res); });
                }, function () { return null; });
            }
            if (target.over) {
                return viaRules(target.mal, target.ep).then(function (r) {
                    return r || self._pair(target.mal, target.ep, dur).then(function (res) { return done(target.mal, target.ep, res); });
                });
            }
            return this._pair(target.mal, target.ep, dur).then(function (res) {
                if (res.found || res.s.length) return done(target.mal, target.ep, res);
                return viaRules(target.mal, target.ep).then(function (r) { return r || done(target.mal, target.ep, res); });
            });
        },

        // Отправка отметки и голос — только по команде пользователя и при включённой настройке
        submit: function (mal, ep, seg, duration) {
            var types = { intro: 'op', credits: 'ed', recap: 'recap' };
            if (!types[seg.type]) return Promise.reject(netError('format', 0, 'тип не поддерживается Aniskip'));
            return Net.post('https://api.aniskip.com/v2/skip-times/' + mal + '/' + ep, {
                skipType: types[seg.type],
                providerName: 'Lampa',
                startTime: round3(seg.start),
                endTime: round3(seg.end),
                episodeLength: round3(duration),
                submitterId: submitterId()
            }).then(function (r) {
                if (r.status < 200 || r.status >= 300) throw httpFail(r.status);
                return r.json;
            });
        },

        vote: function (skipId, type) {
            return Net.post('https://api.aniskip.com/v2/skip-times/vote/' + encodeURIComponent(skipId), { voteType: type }).then(function (r) {
                if (r.status < 200 || r.status >= 300) throw httpFail(r.status);
                return r.json;
            });
        }
    };


    // ---------- Загрузка таймкодов серии: все источники параллельно, результат — по мере ответов ----------
    var Loader = {
        _inflight: {},

        // waitImdb: imdb_id ещё не известен, но ожидается — источники, которым он нужен, включаем условно
        sourceIds: function (ctx, prefetch, waitImdb) {
            var ids = ['chapters', 'theintrodb', 'introdb', 'introhater', 'aniskip'], out = [];
            for (var i = 0; i < ids.length; i++) {
                var src = Sources[ids[i]];
                if (prefetch && ids[i] === 'chapters') continue;      // ffprobe следующего файла — лишняя нагрузка на TorrServer
                if (src.applicable(ctx, !!waitImdb && !!src.needsImdb)) out.push(ids[i]);
            }
            return out;
        },

        // Один запрос на источник/серию/вариант, даже если серию одновременно грузят предзагрузка и плеер
        _fetch: function (ctx, id, dur, variant) {
            var key = Logic.episodeKey(ctx) + '|' + id + '|' + variant, self = this;
            if (this._inflight[key]) return this._inflight[key];
            var src = Sources[id], t0 = now();
            var p = src.fetch(ctx, dur).then(function (res) {
                Health.set(id, res.st, now() - t0, 200);
                Store.putRecord(ctx, id, variant, res);
                return res;
            }, function (err) {
                Health.set(id, Health.fromError(err), now() - t0, err && err.status);
                log(src.name + ':', err && (err.kind || err.message), err && err.status ? err.status : '');
                return { st: 'error', kind: Health.fromError(err), s: [] };
            });
            this._inflight[key] = p;
            function clear() { if (self._inflight[key] === p) delete self._inflight[key]; }
            p.then(clear, clear);
            return p;
        },

        // hooks: { isCurrent(), duration() -> с (0 — неизвестна), waitDuration() -> Promise<с>,
        //         imdb -> Promise (imdb_id ещё спрашиваем: ждут только IntroDB/IntroHater),
        //         drop(id) — источник выбыл (imdb_id так и не нашёлся), update(records, done, id) }
        load: function (ctx, hooks, prefetch) {
            var self = this, records = {};
            var waitImdb = !!hooks.imdb && !IMDB_RE.test(ctx.imdb || '');
            var ids = this.sourceIds(ctx, prefetch, waitImdb), pending = ids.length;
            var user = UserMarks.get(ctx);
            if (user.length) records.user = { st: 'ok', s: user };
            function alive() { return !hooks.isCurrent || hooks.isCurrent(); }
            function settle(id, rec) {
                if (!alive()) return;
                if (rec) records[id] = rec;
                else if (hooks.drop) hooks.drop(id);
                pending--;
                if (hooks.update) hooks.update(records, pending === 0, id);
            }
            if (!pending) {
                if (hooks.update) setTimeout(function () { if (alive()) hooks.update(records, true, null); }, 0);
                return records;
            }
            ids.forEach(function (id) {
                var src = Sources[id];
                var gate = waitImdb && src.needsImdb ? hooks.imdb : Promise.resolve();
                gate.then(function () {
                    if (!alive()) return;
                    if (!src.applicable(ctx)) return settle(id, null);
                    var known = hooks.duration ? hooks.duration() : 0;
                    var durP = !src.usesDuration ? Promise.resolve(0) :
                        (known ? Promise.resolve(known) : (hooks.waitDuration ? hooks.waitDuration() : Promise.resolve(0)));
                    return durP.then(function (dur) {
                        if (!alive()) return;
                        var variant = src.variant(ctx, dur), cached = Store.getRecord(ctx, id, variant);
                        if (cached) return settle(id, { st: cached.st, s: cached.s || [], x: cached.x || {}, cached: true });
                        return self._fetch(ctx, id, dur, variant).then(function (res) { settle(id, res); });
                    });
                }).then(null, function (err) {
                    log('Loader error', id, err && err.message);
                    settle(id, { st: 'error', kind: 'network', s: [] });
                });
            });
            return records;
        }
    };


    // ---------- Эвристика по субтитрам: паузы в SRT/VTT, песни (OP/ED) в ASS ----------
    var Subs = {
        _pick: function (subs) {
            var ass = null, other = null;
            for (var i = 0; i < subs.length; i++) {
                var s = subs[i];
                if (!s || !s.url) continue;
                var fmt = String(s.format || '').toLowerCase();
                if (!ass && (s.ass || fmt === 'ass' || fmt === 'ssa' || /\.(?:ass|ssa)(?:$|\?)/i.test(s.url))) ass = s;
                else if (!other) other = s;
            }
            return { ass: ass, other: other };
        },

        // -> Promise<[сегменты]> (src: 'ass' — по песням, 'subs' — по паузам)
        detect: function (video, duration) {
            var self = this;
            try {
                var subs = video && video.customSubs;
                if (!subs || !subs.length) return Promise.resolve(this._fromTracks(video));
                var pick = this._pick(subs);
                if (pick.ass) {
                    return Net.text(pick.ass.url, 8e3).then(function (text) {
                        var events = Logic.parseAss(text), out = Logic.assSongs(events, duration);
                        if (!Logic.hasType(out, 'intro')) {
                            var talk = events.filter(function (e) { return !Logic.isSongEvent(e); });
                            var gap = Logic.gapIntro(talk, DETECT_WINDOW);
                            if (gap) out.push(gap);
                        }
                        return out;
                    }, function () {
                        return pick.ass.vtt ? self._fromText(pick.ass.vtt) : [];
                    });
                }
                var sub = pick.other;
                if (!sub) return Promise.resolve([]);
                return this._fromText(sub.vtt || sub.url);
            } catch (e) {
                log('Subtitle detection error:', e && e.message);
                return Promise.resolve([]);
            }
        },

        _fromText: function (url) {
            return Net.text(url, 8e3).then(function (text) {
                var gap = Logic.gapIntro(Logic.parseSrtVtt(text), DETECT_WINDOW);
                return gap ? [gap] : [];
            }, function () { return []; });
        },

        _fromTracks: function (video) {
            try {
                var tracks = video && video.textTracks;
                if (!tracks || !tracks.length) return [];
                for (var i = 0; i < tracks.length; i++) {
                    var t = tracks[i];
                    if (!t.cues || t.cues.length <= 5) continue;
                    var cues = [];
                    for (var j = 0; j < t.cues.length; j++) cues.push({ start: t.cues[j].startTime, end: t.cues[j].endTime });
                    var gap = Logic.gapIntro(cues, DETECT_WINDOW);
                    return gap ? [gap] : [];
                }
            } catch (e) {}
            return [];
        }
    };

    // ---------- Эвристика по звуку (по умолчанию выключена) ----------
    // После createMediaElementSource звук элемента идёт только через граф Web Audio,
    // поэтому элемент подключается лишь к работающему (running) AudioContext.
    var AudioDet = {
        _context: null,
        _analyser: null,
        _source: null,
        _element: null,
        _sampleTimer: null,
        _timeoutTimer: null,
        _finish: null,

        _isMediaElement: function (el) {
            if (!el || typeof el.addEventListener !== 'function') return false;
            return !window.HTMLMediaElement || el instanceof window.HTMLMediaElement;
        },

        _stopSampling: function (result) {
            if (this._sampleTimer) { clearInterval(this._sampleTimer); this._sampleTimer = null; }
            if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
            var finish = this._finish;
            this._finish = null;
            if (finish) finish(result === undefined ? null : result);
        },

        _ensureRunning: function () {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return Promise.resolve(false);
            if (!this._context || this._context.state === 'closed') {
                try {
                    this._context = new Ctx();
                } catch (e) {
                    log('AudioDetector: cannot create AudioContext:', e && e.message);
                    this._context = null;
                    return Promise.resolve(false);
                }
            }
            var ctx = this._context;
            if (ctx.state === 'running') return Promise.resolve(true);
            return new Promise(function (resolve) {
                var done = false, timer = null;
                function finish() {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve(ctx.state === 'running');
                }
                timer = setTimeout(finish, 1500);
                try {
                    var p = ctx.resume();
                    if (p && typeof p.then === 'function') p.then(finish, finish);
                } catch (e) {
                    finish();
                }
            });
        },

        _connect: function (video) {
            if (this._source && this._analyser && this._element === video) return true;
            if (this._source) this._disconnect();
            try {
                this._source = this._context.createMediaElementSource(video);
                this._element = video;
            } catch (e) {
                log('AudioDetector connect error:', e && e.message);
                this._source = null;
                return false;
            }
            try {
                this._analyser = this._context.createAnalyser();
                this._analyser.fftSize = 2048;
                this._source.connect(this._analyser);
                this._analyser.connect(this._context.destination);
                return true;
            } catch (e2) {
                log('AudioDetector analyser error:', e2 && e2.message);
                try { this._source.connect(this._context.destination); } catch (e3) {}
                this._analyser = null;
                return false;
            }
        },

        _disconnect: function () {
            try { if (this._source) this._source.disconnect(); } catch (e) {}
            try { if (this._analyser) this._analyser.disconnect(); } catch (e) {}
            this._source = null;
            this._analyser = null;
            this._element = null;
        },

        _closeContext: function () {
            try { if (this._context && this._context.state !== 'closed') this._context.close(); } catch (e) {}
            this._context = null;
        },

        detect: function (video, isCurrent) {
            var self = this;
            this._stopSampling(null);
            if (!this._isMediaElement(video)) {
                log('AudioDetector: not an HTML media element — skipped');
                return Promise.resolve(null);
            }
            if ((video.currentTime || 0) > DETECT_WINDOW - 30) {
                log('AudioDetector: playback started after the intro window — skipped');
                return Promise.resolve(null);
            }
            return this._ensureRunning().then(function (running) {
                if (isCurrent && !isCurrent()) return null;
                if (!running) {
                    log('AudioDetector: AudioContext is not running (autoplay policy) — audio left untouched');
                    if (!self._source) self._closeContext();
                    return null;
                }
                if (!self._connect(video)) return null;
                return self._sample(video, isCurrent);
            });
        },

        _sample: function (video, isCurrent) {
            var self = this;
            return new Promise(function (resolve) {
                var samples = [], data = new Uint8Array(self._analyser.frequencyBinCount), startTime = video.currentTime || 0;
                self._finish = resolve;
                self._sampleTimer = setInterval(function () {
                    if (!self._analyser || (isCurrent && !isCurrent())) return self._stopSampling(null);
                    try {
                        var t = video.currentTime;
                        if (t - startTime > DETECT_WINDOW || t > DETECT_WINDOW + 60) return self._stopSampling(self._analyzeEnergy(samples));
                        if (video.paused) return;
                        self._analyser.getByteFrequencyData(data);
                        var sum = 0;
                        for (var i = 0; i < data.length; i++) sum += data[i];
                        samples.push({ time: t, energy: sum / data.length });
                    } catch (e) {
                        self._stopSampling(null);
                    }
                }, 500);
                self._timeoutTimer = setTimeout(function () {
                    self._stopSampling(samples.length > 10 ? self._analyzeEnergy(samples) : null);
                }, (DETECT_WINDOW + 10) * 1000);
            });
        },

        _analyzeEnergy: function (samples) {
            if (samples.length < 20) return null;
            var smooth = [], i;
            for (i = 2; i < samples.length - 2; i++) {
                var avg = (samples[i - 2].energy + samples[i - 1].energy + samples[i].energy + samples[i + 1].energy + samples[i + 2].energy) / 5;
                smooth.push({ time: samples[i].time, energy: avg });
            }
            if (smooth.length < 10) return null;
            var sorted = smooth.map(function (x) { return x.energy; });
            sorted.sort(function (a, b) { return a - b; });
            var median = sorted[Math.floor(sorted.length / 2)], high = 1.3 * median, low = 0.8 * median;
            var start = null, end = null, loudCount = 0, inLoud = false;
            for (i = 0; i < smooth.length; i++) {
                var s = smooth[i];
                if (s.time > DETECT_WINDOW) break;
                if (s.energy > high) {
                    if (!inLoud) { inLoud = true; start = s.time; loudCount = 0; }
                    loudCount++;
                } else if (inLoud && s.energy < low) {
                    var len = s.time - start;
                    if (len >= 15 && len <= 150 && loudCount >= 10) { end = s.time; break; }
                    inLoud = false;
                    start = null;
                    loudCount = 0;
                }
            }
            if (start === null || end === null) return null;
            log('Audio energy intro detected:', Math.round(start), '→', Math.round(end));
            return { type: 'intro', start: Math.round(start), end: Math.round(end), src: 'audio' };
        },

        destroy: function () {
            this._stopSampling(null);
            var el = this._element, pip = false;
            try { pip = !!el && document.pictureInPictureElement === el; } catch (e) {}
            if (pip) {
                log('AudioDetector: video is in Picture-in-Picture — audio graph kept');
                return;
            }
            this._disconnect();
            this._closeContext();
        }
    };


    // ---------- Плеер ----------
    function getVideo() {
        try { return Lampa.PlayerVideo.video(); } catch (e) { return null; }
    }

    function videoDuration() {
        var v = getVideo(), d = v && v.duration;
        return d && isFinite(d) && d > 0 ? d : 0;
    }

    function videoTime() {
        var v = getVideo();
        return v && typeof v.currentTime === 'number' && isFinite(v.currentTime) ? v.currentTime : 0;
    }

    function canNext() {
        try {
            return !!(Lampa.PlayerPlaylist && typeof Lampa.PlayerPlaylist.canNext === 'function' && Lampa.PlayerPlaylist.canNext());
        } catch (e) { return false; }
    }

    function nextItem() {
        try {
            if (!canNext()) return null;
            var list = Lampa.PlayerPlaylist.get(), pos = Lampa.PlayerPlaylist.position();
            return Array.isArray(list) && typeof pos === 'number' ? list[pos + 1] || null : null;
        } catch (e) { return null; }
    }

    // Перемотка средствами Lampa (как её встроенный пропуск): -1 = почти конец файла
    function seekTo(seconds) {
        try {
            if (Lampa.PlayerVideo && typeof Lampa.PlayerVideo.to === 'function') {
                Lampa.PlayerVideo.to(seconds);
                return;
            }
        } catch (e) {
            log('PlayerVideo.to failed:', e && e.message);
        }
        var v = getVideo();
        if (!v) return;
        try {
            v.currentTime = seconds < 0 ? Math.max(0, (v.duration || 0) - 3) : seconds;
            setTimeout(function () {
                try { if (v.paused) v.play(); } catch (e) {}
            }, 100);
        } catch (e) {
            log('Error seeking:', e);
        }
    }

    // Штатный переход Lampa (player.js, событие панели to_end): есть следующая серия —
    // пауза, отметка «просмотрено» (Timeline.setEnd) и Playlist.next(); нет — в конец файла
    function goNext() {
        try {
            if (Lampa.PlayerPanel && Lampa.PlayerPanel.listener && typeof Lampa.PlayerPanel.listener.send === 'function') {
                Lampa.PlayerPanel.listener.send('to_end', {});
                return 'to_end';
            }
        } catch (e) {
            log('to_end failed:', e && e.message);
        }
        if (canNext()) {
            try { if (Lampa.PlayerVideo && typeof Lampa.PlayerVideo.pause === 'function') Lampa.PlayerVideo.pause(); } catch (e) {}
            try { Lampa.PlayerPlaylist.next(); return 'next'; } catch (e) {}
        }
        seekTo(-1);
        return 'end';
    }

    function isPlayerControllerActive() {
        try {
            if (Lampa.Controller && typeof Lampa.Controller.enabled === 'function') {
                var enabled = Lampa.Controller.enabled();
                if (enabled && typeof enabled.name === 'string') return enabled.name === 'player';
            }
        } catch (e) {}
        return true;
    }

    function nativeSkipVisible() {
        try {
            var el = document.querySelector('.player-skip');
            return !!(el && el.classList && !el.classList.contains('hide'));
        } catch (e) { return false; }
    }

    function hasNativeSegments(data) {
        var s = data && data.segments;
        return !!(s && Array.isArray(s.skip) && s.skip.length);
    }

    function fmtTime(sec) {
        sec = Math.max(0, Math.round(sec || 0));
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s);
    }

    function noty(text) {
        try { Lampa.Noty.show(text); } catch (e) { log(text); }
    }

    var UI_CSS = ".skip-intro-button{position:absolute;right:40px;bottom:180px;padding:0;background:rgba(0,0,0,.65);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1.5px solid rgba(255,255,255,.2);border-radius:12px;color:#fff;font-size:1em;cursor:pointer;z-index:9999;-webkit-transition:opacity .4s ease,-webkit-transform .4s ease,border-color .3s ease;transition:opacity .4s ease,transform .4s ease,border-color .3s ease;opacity:0;pointer-events:none;-webkit-transform:translateX(20px);transform:translateX(20px);outline:none;font-family:inherit;line-height:1.4;white-space:nowrap;overflow:hidden;display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-orient:vertical;-webkit-flex-direction:column;flex-direction:column;box-shadow:0 4px 24px rgba(0,0,0,.4)}.skip-intro-button.visible{opacity:1;pointer-events:auto;-webkit-transform:translateX(0);transform:translateX(0)}.skip-intro-button:focus,.skip-intro-button:hover{border-color:rgba(255,255,255,.6);background:rgba(0,0,0,.8)}.skip-intro-content{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center;padding:14px 28px;position:relative;z-index:2}.skip-intro-content:hover{background:rgba(255,255,255,.08)}.skip-intro-icon{width:20px;height:20px;-webkit-flex-shrink:0;flex-shrink:0;opacity:.9;margin-left:10px}.skip-intro-progress{position:absolute;bottom:0;left:0;height:3px;background:linear-gradient(90deg,rgba(255,255,255,.9),rgba(200,200,255,.7));border-radius:0 0 10px 10px;transition:width .1s linear;z-index:3}.skip-intro-badge{font-size:.7em;opacity:.6;margin-left:16px;font-weight:400}.skip-intro-hint{font-size:.7em;opacity:.7;margin-left:18px;font-weight:400;border:1px solid rgba(255,255,255,.35);border-radius:4px;padding:1px 6px;letter-spacing:.5px}" +
        ".skip-intro-sub{font-size:.75em;opacity:.7;padding:0 28px 12px;margin-top:-8px;max-width:30em;overflow:hidden;text-overflow:ellipsis;position:relative;z-index:2}" +
        ".skip-intro-warn{position:absolute;right:40px;bottom:180px;padding:10px 20px;background:rgba(0,0,0,.55);border-radius:10px;color:#fff;font-size:.9em;line-height:1.4;opacity:0;-webkit-transition:opacity .3s ease;transition:opacity .3s ease;pointer-events:none;z-index:9998;white-space:nowrap;max-width:40em;overflow:hidden;text-overflow:ellipsis}.skip-intro-warn.visible{opacity:.9}" +
        ".skip-intro-marks{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}.skip-intro-mark--weak{opacity:.5}";

    function injectCSS() {
        if (document.getElementById('skip-intro-css')) return;
        var style = document.createElement('style');
        style.id = 'skip-intro-css';
        style.textContent = UI_CSS;
        document.head.appendChild(style);
    }

    // Приглушение в HDR (событие плагина «Адаптивные субтитры»)
    var Hdr = {
        on: false,
        brightness: 0.6,
        set: function (on, brightness) {
            this.on = !!on;
            if (brightness > 0 && brightness <= 1) this.brightness = Math.max(0.45, Math.min(0.85, brightness + 0.15));
            this.apply(Button._el);
            this.apply(Warn._el);
        },
        apply: function (el) {
            if (!el || !el.style) return;
            var f = this.on && Settings.hdrDim() ? 'brightness(' + this.brightness + ')' : '';
            el.style.filter = f;
            el.style.webkitFilter = f;
        }
    };

    function playerHost() {
        return document.querySelector('.player') || document.body;
    }

    // ---------- Кнопка ----------
    var Button = {
        _el: null,
        _label: null,
        _badge: null,
        _hint: null,
        _sub: null,
        _progress: null,
        _opts: null,
        _visible: false,
        _fadeTimer: null,
        _hideTimer: null,
        _showTimer: null,
        _countdownTimer: null,

        _create: function () {
            var self = this;
            var el = document.createElement('div');
            el.className = 'skip-intro-button';
            el.setAttribute('tabindex', '1');
            var content = document.createElement('div');
            content.className = 'skip-intro-content';
            var label = document.createElement('span');
            label.className = 'skip-intro-label';
            content.appendChild(label);
            var badge = document.createElement('span');
            badge.className = 'skip-intro-badge';
            content.appendChild(badge);
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'skip-intro-icon');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'currentColor');
            var p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p1.setAttribute('d', 'M5.5 18.5V5.5L14 12L5.5 18.5Z');
            var p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p2.setAttribute('d', 'M14 18.5V5.5L22.5 12L14 18.5Z');
            svg.appendChild(p1);
            svg.appendChild(p2);
            content.appendChild(svg);
            var hint = document.createElement('span');
            hint.className = 'skip-intro-hint';
            content.appendChild(hint);
            el.appendChild(content);
            var sub = document.createElement('div');
            sub.className = 'skip-intro-sub';
            el.appendChild(sub);
            var progress = document.createElement('div');
            progress.className = 'skip-intro-progress';
            progress.style.width = '0%';
            el.appendChild(progress);
            content.addEventListener('click', function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                self.trigger('skip');
            });
            playerHost().appendChild(el);
            this._el = el;
            this._label = label;
            this._badge = badge;
            this._hint = hint;
            this._sub = sub;
            this._progress = progress;
            Hdr.apply(el);
        },

        _clearTimers: function () {
            if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
            if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
            if (this._showTimer) { clearTimeout(this._showTimer); this._showTimer = null; }
        },

        // opts: { label, badge, hint, sub, countdown, timeout (с), onSkip, onCancel, onTimeout }
        show: function (opts) {
            var self = this, created = false;
            this._clearTimers();
            clearTimeout(this._fadeTimer);
            injectCSS();
            Warn.hide();
            if (!this._el) {
                this._create();
                created = true;
            }
            this._opts = opts;
            this._visible = true;
            this._label.textContent = opts.label;
            this._badge.textContent = opts.badge || '';
            this._badge.style.display = opts.badge ? '' : 'none';
            this._hint.textContent = opts.hint || '';
            this._sub.textContent = opts.sub || '';
            this._sub.style.display = opts.sub ? '' : 'none';
            this._progress.style.width = '0%';
            if (opts.countdown) this._el.classList.add('countdown');
            else this._el.classList.remove('countdown');
            if (created) {
                this._showTimer = setTimeout(function () {
                    self._showTimer = null;
                    if (self._visible && self._el) self._el.classList.add('visible');
                }, 50);
            } else {
                this._el.classList.add('visible');
            }
            if (opts.countdown) {
                var started = now();
                this._countdownTimer = setInterval(function () {
                    var k = Math.min(1, (now() - started) / COUNTDOWN_MS);
                    if (self._progress) self._progress.style.width = (100 * k) + '%';
                    if (k >= 1) {
                        self._clearTimers();
                        self.trigger('skip');
                    }
                }, 50);
            } else if (opts.timeout > 0) {
                this._hideTimer = setTimeout(function () {
                    self._hideTimer = null;
                    if (self._opts !== opts) return;
                    self.hide();
                    if (typeof opts.onTimeout === 'function') opts.onTimeout();
                }, opts.timeout * 1000);
            }
        },

        trigger: function (action) {
            var opts = this._opts;
            if (!opts || !this._visible) return false;
            var fn = action === 'cancel' ? opts.onCancel : opts.onSkip;
            if (typeof fn !== 'function') return false;
            fn();
            return true;
        },

        // Lampa выполняет OK на отпускании (keyup), остальные клавиши — на нажатии (keydown)
        handleKey: function (phase, code, heldMs, domMode) {
            if (!this._visible || !this._opts) return false;
            var action = null;
            if (contains(Settings.getSkipKeys(), code)) action = 'skip';
            else if (this._opts.countdown && contains(Settings.getCancelKeys(), code)) action = 'cancel';
            if (!action || !isPlayerControllerActive()) return false;
            var onKeyup = !domMode && contains(ENTER_CODES, code);
            if (phase !== (onKeyup ? 'keyup' : 'keydown')) return false;
            if (onKeyup && heldMs >= LONGPRESS_MS) return false;
            return this.trigger(action);
        },

        hide: function () {
            this._clearTimers();
            this._visible = false;
            this._opts = null;
            if (!this._el) return;
            var el = this._el, self = this;
            el.classList.remove('visible');
            clearTimeout(this._fadeTimer);
            this._fadeTimer = setTimeout(function () {
                if (el.parentNode) el.parentNode.removeChild(el);
                if (self._el === el) self._reset();
            }, 350);
        },

        destroy: function () {
            this._clearTimers();
            clearTimeout(this._fadeTimer);
            if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
            this._reset();
        },

        _reset: function () {
            this._el = this._label = this._badge = this._hint = this._sub = this._progress = null;
            this._opts = null;
            this._visible = false;
        },

        isVisible: function () {
            return this._visible;
        }
    };

    // ---------- Предупреждение за 5 с (пассивное: клавиши не перехватывает) ----------
    var Warn = {
        _el: null,
        _text: '',
        show: function (text) {
            if (Button.isVisible()) return this.hide();
            injectCSS();
            if (!this._el) {
                var el = document.createElement('div');
                el.className = 'skip-intro-warn';
                playerHost().appendChild(el);
                this._el = el;
                Hdr.apply(el);
                setTimeout(function () { if (Warn._el === el && Warn._text) el.classList.add('visible'); }, 30);
            } else {
                this._el.classList.add('visible');
            }
            if (this._text !== text) {
                this._text = text;
                this._el.textContent = text;
            }
        },
        hide: function () {
            this._text = '';
            if (this._el) this._el.classList.remove('visible');
        },
        destroy: function () {
            if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
            this._el = null;
            this._text = '';
        },
        visible: function () {
            return !!this._text;
        }
    };

    // ---------- Отметки на шкале времени (как у Lampa: player/panel/segments.js) ----------
    var Marks = {
        _el: null,
        _sig: '',
        draw: function (segments, duration) {
            var host = document.querySelector('.player-panel__timeline');
            if (!host || !(duration > 0)) return;
            var list = (segments || []).filter(function (s) { return s && Settings.isTypeEnabled(s.type); });
            var sig = duration.toFixed(0) + ':' + list.map(function (s) { return s.type + s.start + '-' + s.end + (s.src || ''); }).join(',');
            if (this._el && this._el.parentNode === host && this._sig === sig) return;
            injectCSS();
            if (!this._el || this._el.parentNode !== host) {
                if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
                this._el = document.createElement('div');
                this._el.className = 'skip-intro-marks';
                var after = host.querySelector('.player-panel__timeline-segments');
                if (after && after.nextSibling) host.insertBefore(this._el, after.nextSibling);
                else host.appendChild(this._el);
            }
            while (this._el.firstChild) this._el.removeChild(this._el.firstChild);
            this._sig = sig;
            for (var i = 0; i < list.length; i++) {
                var s = list[i], a = Math.min(duration, s.start), b = Math.min(duration, s.end);
                if (!(b > a)) continue;
                var m = document.createElement('div');
                m.className = 'player-panel__timeline-segment player-panel__timeline-segment--skip skip-intro-mark skip-intro-mark--' + s.type +
                    (Logic.isHeuristic(s) ? ' skip-intro-mark--weak' : '');
                m.style.left = (a / duration * 100) + '%';
                m.style.width = ((b - a) / duration * 100) + '%';
                this._el.appendChild(m);
            }
        },
        clear: function () {
            if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
            this._el = null;
            this._sig = '';
        }
    };

    // ---------- Клавиши: один раз и одним каналом ----------
    var Keys = {
        mode: null,
        _enterDownAt: 0,

        bind: function () {
            if (this.mode) return;
            var self = this, kp = window.Lampa && Lampa.Keypad && Lampa.Keypad.listener;
            if (kp && typeof kp.follow === 'function') {
                this.mode = 'keypad';
                kp.follow('keydown', function (e) { self._onKeypad('keydown', e); });
                kp.follow('keyup', function (e) { self._onKeypad('keyup', e); });
            } else {
                this.mode = 'dom';
                window.addEventListener('keydown', function (e) {
                    var code = e.keyCode || e.which;
                    if (Button.handleKey('keydown', code, 0, true) || self._menuKey('keydown', code)) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }, true);
            }
        },

        _menuKey: function (phase, code) {
            if (phase !== 'keydown' || !contains(Settings.getMenuKeys(), code)) return false;
            if (!isPlayerControllerActive() || !Controller._ctx) return false;
            Menu.openPlayer();
            return true;
        },

        _onKeypad: function (phase, e) {
            if (!e) return;
            var code = parseInt(e.code, 10), held = 0;
            if (contains(ENTER_CODES, code)) {
                if (phase === 'keydown') {
                    if (!this._enterDownAt) this._enterDownAt = now();
                } else {
                    held = this._enterDownAt ? now() - this._enterDownAt : 0;
                    this._enterDownAt = 0;
                }
            }
            var used = Button.handleKey(phase, code, held, false) || this._menuKey(phase, code);
            if (used && e.event && typeof e.event.preventDefault === 'function') e.event.preventDefault();
        }
    };


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


    // ---------- Контроллер: одна сессия воспроизведения ----------
    var PREFETCH_DELAY = 1e4;       // мс после старта серии: предзагрузка таймкодов следующей серии
    var IMDB_WAIT = 3e3;            // мс: сколько ждать imdb_id из TMDB (через Lampa) до запуска загрузки
    var MIN_MOVIE = 1200;           // с: короче — не фильм (трейлер, ролик), плагин молчит
    var MIN_EPISODE = 60;           // с: короче — не серия
    var WILL_SKIP = { intro: 'будет пропущена', recap: 'будет пропущен', credits: 'будут пропущены', preview: 'будет пропущено' };
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
            if (this._native || this._idle || !this._ctx) return;
            var t = now();
            if (!force && t - this._marksAt < 5000) return;
            this._marksAt = t;
            var dur = this._duration || videoDuration();
            if (!dur) return;
            if (this._isShort()) Marks.clear();
            else Marks.draw(this._segments, dur);
        },

        // ---------- Воспроизведение ----------
        _onTimeUpdate: function (e) {
            if (!this._ctx || this._idle || this._native) return;
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
            if (this._nextLabel(seg, dur) !== null) return 'Следующая серия';
            return LABELS[seg.type] || 'Пропустить';
        },

        _badgeFor: function (seg, dur) {
            if (seg.src === 'subs') return '(по субтитрам)';
            if (seg.src === 'ass') return '(по субтитрам ASS)';
            if (seg.src === 'audio') return '(по звуку)';
            if (this._isTailSeg(seg, dur) && this._postFor(seg, dur)) return '(после титров есть сцена)';
            if (seg.approx) return '\u2248 Aniskip';
            return '';
        },

        _updateWarn: function (segs, time, dur) {
            var up = Logic.upcoming(segs, time, WARN_LEAD);
            if (!up || this._skipped[up.k] || nativeSkipVisible() || Button.isVisible()) return Warn.hide();
            var n = Math.max(1, Math.ceil(up.start - time)), auto = this._wouldAuto(up), next = this._nextLabel(up, dur), text;
            if (next !== null && auto) text = 'Следующая серия через ' + n + ' с' + (next ? ': ' + next : '');
            else {
                text = TYPE_NAMES[up.type] + ' через ' + n + ' с';
                if (auto) text += ' \u2014 ' + WILL_SKIP[up.type];
                else if (next) text += ' \u00b7 далее ' + next;
            }
            Warn.show(text);
        },

        _showButton: function (seg, dur) {
            var self = this, k = seg.k;
            Button.show({
                label: this._labelFor(seg, dur),
                badge: this._badgeFor(seg, dur),
                sub: this._nextLabel(seg, dur) || '',
                hint: 'нажмите ' + KEY_TITLES[Settings.skipKeyName()],
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
                hint: 'нажмите ' + KEY_TITLES[Settings.cancelKeyName()] + ' для отмены',
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
            if (this._idle === 'lampa') return 'Таймкоды передал источник видео \u2014 работает встроенный пропуск Lampa';
            if (this._idle === 'series') return 'Для этого ' + (ctx.movie ? 'фильма' : 'сериала') + ' пропуск выключен';
            if (this._isShort()) return 'Слишком короткое видео \u2014 плагин не вмешивается';
            var parts = [];
            this._segments.forEach(function (s) {
                var to = s.end >= Logic.END_SENTINEL ? 'конец' : fmtTime(s.end);
                var extra = (s.approx ? ', \u2248' : '') + (s.shift ? ', сдвиг ' + Menu._shiftText(s.shift) : '');
                parts.push(TYPE_NAMES[s.type] + ' ' + fmtTime(s.start) + '\u2013' + to + ' (' + (SOURCE_NAMES[s.src] || s.src) + extra + ')');
            });
            if (!parts.length) parts.push(this._loadDone ? 'Таймкодов не найдено' : 'Загрузка\u2026');
            var st = [];
            this._ids.forEach(function (id) {
                var r = self._records[id], name = SOURCE_NAMES[id] || id;
                if (!r) st.push(name + ': ждём ответ');
                else if (r.st === 'error') st.push(name + ': ' + (STATUS_TEXT[r.kind] || 'ошибка'));
                else st.push(name + ': ' + (r.st === 'ok' ? 'есть' : 'пусто') + (r.cached ? ' (кэш)' : ''));
            });
            if (this._native) st.push('переданы в Lampa');
            var tail = st.join(', ');
            // после точки — с заглавной буквы («главы файла: есть» -> «Главы файла: есть»)
            if (tail) tail = tail.charAt(0).toUpperCase() + tail.slice(1);
            return parts.join('; ') + (tail ? '. ' + tail : '');
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


    // ---------- Хук для тестов: window.__SKIP_INTRO_TEST__ = {} до загрузки плагина ----------
    if (window.__SKIP_INTRO_TEST__ && typeof window.__SKIP_INTRO_TEST__ === 'object') {
        var T = window.__SKIP_INTRO_TEST__;
        T.core = AniskipCore;
        T.Logic = Logic;
        T.Settings = Settings;
        T.Store = Store;
        T.Health = Health;
        T.Series = Series;
        T.UserMarks = UserMarks;
        T.Smart = Smart;
        T.Stats = Stats;
        T.Sync = Sync;
        T.Net = Net;
        T.Torr = Torr;
        T.sharedFfp = sharedFfp;
        T.Sources = Sources;
        T.Anime = Anime;
        T.Loader = Loader;
        T.Subs = Subs;
        T.AudioDet = AudioDet;
        T.Button = Button;
        T.Warn = Warn;
        T.Marks = Marks;
        T.Hdr = Hdr;
        T.Keys = Keys;
        T.Menu = Menu;
        T.Diag = Diag;
        T.Controller = Controller;
        T.renamePluginEntry = renamePluginEntry;
        T.goNext = goNext;
        T.boot = boot;
    }

    function boot() {
        if (window.Lampa && Lampa.SettingsApi && Lampa.Player && Lampa.Player.listener && Lampa.Storage) Controller.init();
        else setTimeout(boot, 500);
    }

    function follow() {
        Lampa.Listener.follow('app', function (e) {
            if (e && e.type === 'ready') boot();
        });
        if (window.appready) boot();
        else setTimeout(boot, 1000);
    }

    if (window.Lampa && Lampa.Listener) {
        follow();
    } else {
        var waitLampa = setInterval(function () {
            if (window.Lampa && Lampa.Listener) {
                clearInterval(waitLampa);
                follow();
            }
        }, 300);
    }
})();
