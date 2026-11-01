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
