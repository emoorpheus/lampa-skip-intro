
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
