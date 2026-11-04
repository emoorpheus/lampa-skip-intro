
    // ---------- Плеер ----------
    function getVideo() {
        try { return Lampa.PlayerVideo.video(); } catch (e) { return null; }
    }

    function videoDuration() {
        var v = getVideo(), d = v && v.duration;
        return d && isFinite(d) && d > 0 ? d : 0;
    }

    // Конец доступного диапазона: запасная длина для отметок на шкале, если duration = NaN или Infinity
    // (так бывает у части потоков и WebView); на логику пропуска не влияет
    function seekableEnd() {
        try {
            var v = getVideo(), s = v && v.seekable;
            if (!s || !s.length) return 0;
            var end = s.end(s.length - 1);
            return isFinite(end) && end > 0 ? end : 0;
        } catch (e) { return 0; }
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

    // Перемотка средствами Lampa (как её встроенный пропуск): -1 = почти конец файла.
    // Lampa 3.4.4 PlayerVideo.to ставит currentTime = Math.min(seconds, video.duration) и глотает ошибку
    // (app.min.js L25658-25666): пока длина видео неизвестна (NaN), перемотки нет — тогда позицию ставим сами
    function seekTo(seconds) {
        var cur = getVideo();
        if (cur && seconds >= 0 && typeof cur.duration === 'number' && isNaN(cur.duration)) {
            try { cur.currentTime = seconds; } catch (e) { log('Error seeking:', e && e.message); }
            return;
        }
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

    // То же уведомление, что показывает Lampa 3.4.4 после своего пропуска сегмента (app.min.js L25006-25009): «Сегмент пропущен»
    function lampaSkippedBell() {
        try {
            Lampa.Bell.push({ text: Lampa.Lang.translate('player_segments_skiped'), icon: Lampa.Template.string('icon_viewed') });
        } catch (e) {}
    }

    var UI_CSS = ".skip-intro-button{position:absolute;right:40px;bottom:180px;padding:0;background:rgba(0,0,0,.65);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1.5px solid rgba(255,255,255,.2);border-radius:12px;color:#fff;font-size:1em;cursor:pointer;z-index:9999;-webkit-transition:opacity .4s ease,-webkit-transform .4s ease,border-color .3s ease;transition:opacity .4s ease,transform .4s ease,border-color .3s ease;opacity:0;pointer-events:none;-webkit-transform:translateX(20px);transform:translateX(20px);outline:none;font-family:inherit;line-height:1.4;white-space:nowrap;overflow:hidden;display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-orient:vertical;-webkit-flex-direction:column;flex-direction:column;box-shadow:0 4px 24px rgba(0,0,0,.4)}.skip-intro-button.visible{opacity:1;pointer-events:auto;-webkit-transform:translateX(0);transform:translateX(0)}.skip-intro-button:focus,.skip-intro-button:hover{border-color:rgba(255,255,255,.6);background:rgba(0,0,0,.8)}.skip-intro-content{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center;padding:14px 28px;position:relative;z-index:2}.skip-intro-content:hover{background:rgba(255,255,255,.08)}.skip-intro-icon{width:20px;height:20px;-webkit-flex-shrink:0;flex-shrink:0;opacity:.9;margin-left:10px}.skip-intro-progress{position:absolute;bottom:0;left:0;height:3px;background:linear-gradient(90deg,rgba(255,255,255,.9),rgba(200,200,255,.7));border-radius:0 0 10px 10px;transition:width .1s linear;z-index:3}.skip-intro-badge{font-size:.7em;opacity:.6;margin-left:16px;font-weight:400}.skip-intro-hint{font-size:.7em;opacity:.7;margin-left:18px;font-weight:400;border:1px solid rgba(255,255,255,.35);border-radius:4px;padding:1px 6px;letter-spacing:.5px}" +
        ".skip-intro-sub{font-size:.75em;opacity:.7;padding:0 28px 12px;margin-top:-8px;max-width:30em;overflow:hidden;text-overflow:ellipsis;position:relative;z-index:2}" +
        ".skip-intro-warn{position:absolute;right:40px;bottom:180px;padding:10px 20px;background:rgba(0,0,0,.55);border-radius:10px;color:#fff;font-size:.9em;line-height:1.4;opacity:0;-webkit-transition:opacity .3s ease;transition:opacity .3s ease;pointer-events:none;z-index:9998;white-space:nowrap;max-width:40em;overflow:hidden;text-overflow:ellipsis}.skip-intro-warn.visible{opacity:.9}" +
        ".skip-intro-marks{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}.skip-intro-mark{position:absolute;top:0;height:100%;-webkit-border-radius:5em;border-radius:5em;background-color:rgba(110,219,255,.5)}.skip-intro-mark--weak{opacity:.5}.skip-intro-mark--ad{background-color:rgba(252,198,60,.5)}" +
        ".skip-intro-report{font-size:1.35em;line-height:1.4;padding-bottom:1em}.skip-intro-report__hint{opacity:.75;margin-bottom:.3em}.skip-intro-report__h{font-weight:700;margin-top:.8em}.skip-intro-report__l,.skip-intro-report__log{white-space:pre-wrap;word-wrap:break-word}.skip-intro-report__log{font-family:monospace;font-size:.85em;line-height:1.35}";

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

    // ---------- «Назад» на Android TV во время обратного отсчёта ----------
    // Приложение Lampa для Android не передаёт «Назад» странице, а вызывает window.history.back (lampa-app, MainActivity.kt,
    // onBackPressedDispatcher). Lampa на popstate вызывает функцию из Activity.call — обычно Controller.back
    // (app.min.js L52070-52081, L53456-53458), и плеер закрывается. Пока идёт отсчёт, ставим свою функцию: «Назад» отменяет
    // автопропуск. Потом ставим ту же, что Controller.toggle. После отмены клавишей одно «Назад» через popstate в течение
    // BACK_SWALLOW_MS не закрывает плеер: на случай, если приложение передаёт и клавишу, и history.back
    var BACK_SWALLOW_MS = 1000;
    var BackGuard = {
        _armed: false,
        _until: 0,
        _set: function (fn) {
            try {
                if (window.Lampa && Lampa.Activity && typeof Lampa.Activity.call === 'function') {
                    Lampa.Activity.call(fn);
                    return true;
                }
            } catch (e) {}
            return false;
        },
        arm: function () {
            var self = this;
            this._until = 0;
            if (this._set(function () { self._onBack(); })) this._armed = true;
        },
        release: function (afterCancel) {
            if (!this._armed) return;
            if (afterCancel) { this._until = now() + BACK_SWALLOW_MS; return; }
            this._restore();
        },
        _restore: function () {
            this._armed = false;
            this._until = 0;
            this._set(function () { Lampa.Controller.back(); });
        },
        _onBack: function () {
            if (Button.isCountdown()) {
                Button.trigger('cancel');
                this._restore();
                return;
            }
            var swallow = this._until > 0 && now() < this._until;
            this._restore();
            if (!swallow) { try { Lampa.Controller.back(); } catch (e) {} }
        }
    };

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
        _cancelled: false,

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
            this._cancelled = false;
            if (opts.countdown) BackGuard.arm();
            else BackGuard.release(false);
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
            if (action === 'cancel') this._cancelled = true;
            fn();
            return true;
        },

        isCountdown: function () {
            return !!(this._visible && this._opts && this._opts.countdown);
        },

        _releaseBack: function () {
            BackGuard.release(this._cancelled);
            this._cancelled = false;
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
            this._releaseBack();
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
            this._releaseBack();
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
    // Своё оформление (.skip-intro-mark в UI_CSS) повторяет Lampa 3.4.4, поэтому отметки видны и в сборках Lampa,
    // где у шкалы другие стили. Возвращает число отметок или -1, если шкалы плеера нет.
    // all — без фильтра по типам из настроек (сегменты самой Lampa: skip и ad)
    var Marks = {
        _el: null,
        _sig: '',
        _n: 0,
        draw: function (segments, duration, all) {
            var host = document.querySelector('.player-panel__timeline');
            if (!host) return -1;
            if (!(duration > 0)) return 0;
            var list = (segments || []).filter(function (s) { return s && (all || Settings.isTypeEnabled(s.type)); });
            var sig = duration.toFixed(0) + ':' + list.map(function (s) { return s.type + s.start + '-' + s.end + (s.src || ''); }).join(',');
            if (this._el && this._el.parentNode === host && this._sig === sig) return this._n;
            injectCSS();
            // отметки позиционируются от шкалы: если у неё нет position, задаём сами
            try {
                if (window.getComputedStyle && window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
            } catch (e) {}
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
            this._n = 0;
            for (var i = 0; i < list.length; i++) {
                var s = list[i], a = Math.min(duration, s.start), b = Math.min(duration, s.end);
                if (!(b > a)) continue;
                var m = document.createElement('div');
                m.className = 'player-panel__timeline-segment player-panel__timeline-segment--' + (s.type === 'ad' ? 'ad' : 'skip') +
                    ' skip-intro-mark skip-intro-mark--' + s.type +
                    (Logic.isHeuristic(s) ? ' skip-intro-mark--weak' : '');
                m.style.left = (a / duration * 100) + '%';
                m.style.width = ((b - a) / duration * 100) + '%';
                this._el.appendChild(m);
                this._n++;
            }
            return this._n;
        },
        clear: function () {
            if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
            this._el = null;
            this._sig = '';
            this._n = 0;
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
                    var code = keyCodeOf(e.keyCode || e.which, e);
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
            var code = keyCodeOf(parseInt(e.code, 10), e.event), held = 0;
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
