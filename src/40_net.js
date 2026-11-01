
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
            name: 'MKV chapters',
            applicable: function (ctx) { return Settings.chaptersEnabled() && !!ctx.torr; },
            variant: function (ctx) { return ctx.torr ? 'h' + ctx.torr.hash.slice(0, 10) + '_' + ctx.torr.index : ''; },
            fetch: function (ctx) {
                return Torr.ffp(ctx.torr).then(function (r) {
                    if (!r || !r.status) throw netError(r && r.timeout ? 'timeout' : 'network');
                    if (r.status === 404) throw netError('unavailable', 404, 'ffprobe is not available on TorrServer');
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
            if (!types[seg.type]) return Promise.reject(netError('format', 0, 'segment type is not supported by Aniskip'));
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
