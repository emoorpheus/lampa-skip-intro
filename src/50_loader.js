
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
