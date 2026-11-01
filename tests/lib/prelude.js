// Выполняется ВНУТРИ vm-контекста (объекты создаются в том же «мире», что и плагин).
// Фейковые: часы и таймеры, localStorage, мини-DOM, XMLHttpRequest, CustomEvent, Lampa.
(function (G) {
    'use strict';
    var B = G.__bridge;                         // мост к тестам (внешний мир): логи, ошибки, маршруты сети

    // ---------------- Часы ----------------
    var clock = { now: B.startTime, seq: 0, timers: {} };
    Date.now = function () { return clock.now; };
    G.setTimeout = function (fn, ms) {
        var id = ++clock.seq, args = Array.prototype.slice.call(arguments, 2);
        clock.timers[id] = { id: id, at: clock.now + Math.max(0, +ms || 0), fn: fn, args: args, iv: 0 };
        return id;
    };
    G.setInterval = function (fn, ms) {
        var id = ++clock.seq, iv = Math.max(1, +ms || 0);
        clock.timers[id] = { id: id, at: clock.now + iv, fn: fn, args: [], iv: iv };
        return id;
    };
    G.clearTimeout = G.clearInterval = function (id) { if (id) delete clock.timers[id]; };
    clock.next = function (limit) {
        var best = null;
        for (var k in clock.timers) {
            var t = clock.timers[k];
            if (t.at <= limit && (!best || t.at < best.at || (t.at === best.at && t.id < best.id))) best = t;
        }
        return best;
    };
    clock.runNext = function (limit) {
        var t = clock.next(limit);
        if (!t) return false;
        if (t.at > clock.now) clock.now = t.at;
        if (t.iv) t.at += t.iv; else delete clock.timers[t.id];
        try { t.fn.apply(G, t.args); } catch (e) { B.error(e, 'timer'); }
        return true;
    };
    clock.count = function () { return Object.keys(clock.timers).length; };
    G.__clock = clock;

    // ---------------- localStorage ----------------
    function LS() { this._m = {}; this._k = []; this.quota = Infinity; this.fail = null; }
    Object.defineProperty(LS.prototype, 'length', { get: function () { return this._k.length; } });
    LS.prototype.getItem = function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; };
    LS.prototype.size = function () { var n = 0; for (var k in this._m) n += k.length + this._m[k].length; return n; };
    LS.prototype.setItem = function (k, v) {
        k = String(k); v = String(v);
        if (this.fail && this.fail(k, v)) { var e1 = new Error('QuotaExceededError'); e1.name = 'QuotaExceededError'; throw e1; }
        var old = this.getItem(k), size = this.size() - (old === null ? 0 : k.length + old.length) + k.length + v.length;
        if (size > this.quota) { var e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
        if (old === null) this._k.push(k);
        this._m[k] = v;
    };
    LS.prototype.removeItem = function (k) {
        k = String(k);
        if (!Object.prototype.hasOwnProperty.call(this._m, k)) return;
        delete this._m[k];
        this._k.splice(this._k.indexOf(k), 1);
    };
    LS.prototype.key = function (i) { return i >= 0 && i < this._k.length ? this._k[i] : null; };
    LS.prototype.clear = function () { this._m = {}; this._k = []; };
    G.localStorage = new LS();

    // ---------------- Мини-DOM ----------------
    function ClassList(el) { this._el = el; }
    ClassList.prototype._get = function () { return (this._el.className || '').split(/\s+/).filter(Boolean); };
    ClassList.prototype.contains = function (c) { return this._get().indexOf(c) !== -1; };
    ClassList.prototype.add = function () {
        var l = this._get();
        for (var i = 0; i < arguments.length; i++) if (l.indexOf(arguments[i]) === -1) l.push(arguments[i]);
        this._el.className = l.join(' ');
    };
    ClassList.prototype.remove = function () {
        var rm = Array.prototype.slice.call(arguments);
        this._el.className = this._get().filter(function (c) { return rm.indexOf(c) === -1; }).join(' ');
    };
    ClassList.prototype.toggle = function (c, force) {
        var on = force === undefined ? !this.contains(c) : !!force;
        if (on) this.add(c); else this.remove(c);
        return on;
    };

    function El(tag, ns) {
        this.nodeType = 1;
        this.tagName = String(tag).toUpperCase();
        this.nodeName = this.tagName;
        this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
        this.childNodes = [];
        this.parentNode = null;
        this.attributes = {};
        this.style = {};
        this._text = '';
        this._ls = {};
        this.classList = new ClassList(this);
    }
    Object.defineProperty(El.prototype, 'className', {
        get: function () { return this.attributes['class'] || ''; },
        set: function (v) { this.attributes['class'] = String(v); }
    });
    Object.defineProperty(El.prototype, 'id', {
        get: function () { return this.attributes.id || ''; },
        set: function (v) { this.attributes.id = String(v); }
    });
    Object.defineProperty(El.prototype, 'children', { get: function () { return this.childNodes.slice(); } });
    Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
    Object.defineProperty(El.prototype, 'nextSibling', {
        get: function () {
            if (!this.parentNode) return null;
            var s = this.parentNode.childNodes, i = s.indexOf(this);
            return s[i + 1] || null;
        }
    });
    Object.defineProperty(El.prototype, 'textContent', {
        get: function () { return this._text + this.childNodes.map(function (c) { return c.textContent; }).join(''); },
        set: function (v) {
            this.childNodes.forEach(function (c) { c.parentNode = null; });
            this.childNodes = [];
            this._text = v === null || v === undefined ? '' : String(v);
        }
    });
    El.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
    El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; };
    El.prototype.removeAttribute = function (k) { delete this.attributes[k]; };
    El.prototype.appendChild = function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
        n.parentNode = this;
        this.childNodes.push(n);
        return n;
    };
    El.prototype.removeChild = function (n) {
        var i = this.childNodes.indexOf(n);
        if (i < 0) throw new Error('NotFoundError: removeChild');
        this.childNodes.splice(i, 1);
        n.parentNode = null;
        return n;
    };
    El.prototype.insertBefore = function (n, ref) {
        if (!ref) return this.appendChild(n);
        if (n.parentNode) n.parentNode.removeChild(n);
        var i = this.childNodes.indexOf(ref);
        if (i < 0) throw new Error('NotFoundError: insertBefore');
        n.parentNode = this;
        this.childNodes.splice(i, 0, n);
        return n;
    };
    El.prototype.addEventListener = function (type, fn) { (this._ls[type] = this._ls[type] || []).push(fn); };
    El.prototype.removeEventListener = function (type, fn) {
        var l = this._ls[type]; if (!l) return;
        var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
    };
    El.prototype.dispatchEvent = function (ev) {
        var self = this;
        (this._ls[ev.type] || []).slice().forEach(function (fn) { fn.call(self, ev); });
        return !ev.defaultPrevented;
    };
    El.prototype.click = function () {
        var ev = { type: 'click', defaultPrevented: false, preventDefault: function () { this.defaultPrevented = true; }, stopPropagation: function () {} };
        this.dispatchEvent(ev);
    };
    function parseCompound(s) {
        var m, out = { tag: null, id: null, cls: [] }, re = /([.#]?)([A-Za-z0-9_\-]+)/g;
        while ((m = re.exec(s)) !== null) {
            if (m[1] === '.') out.cls.push(m[2]);
            else if (m[1] === '#') out.id = m[2];
            else out.tag = m[2].toUpperCase();
        }
        return out;
    }
    function matchCompound(el, c) {
        if (el.nodeType !== 1) return false;
        if (c.tag && el.tagName !== c.tag) return false;
        if (c.id && el.id !== c.id) return false;
        for (var i = 0; i < c.cls.length; i++) if (!el.classList.contains(c.cls[i])) return false;
        return true;
    }
    function matchSel(el, sel, root) {
        var parts = sel.trim().split(/\s+/).map(parseCompound);
        if (!matchCompound(el, parts[parts.length - 1])) return false;
        var cur = el.parentNode;
        for (var i = parts.length - 2; i >= 0; i--) {
            while (cur && cur !== root && !matchCompound(cur, parts[i])) cur = cur.parentNode;
            if (!cur || cur === root) return false;
            cur = cur.parentNode;
        }
        return true;
    }
    function walk(node, fn) {
        for (var i = 0; i < node.childNodes.length; i++) {
            var c = node.childNodes[i];
            if (fn(c) === true) return true;
            if (walk(c, fn) === true) return true;
        }
        return false;
    }
    El.prototype.querySelectorAll = function (sel) {
        var out = [], list = sel.split(','), root = this;
        walk(this, function (n) {
            for (var i = 0; i < list.length; i++) if (matchSel(n, list[i], root)) { out.push(n); break; }
        });
        return out;
    };
    El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
    El.prototype.contains = function (n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; };

    var doc = new El('#document');
    doc.nodeType = 9;
    var html = doc.appendChild(new El('html'));
    var head = html.appendChild(new El('head'));
    var body = html.appendChild(new El('body'));
    doc.documentElement = html;
    doc.head = head;
    doc.body = body;
    doc.currentScript = B.scriptSrc ? { src: B.scriptSrc } : null;
    doc.pictureInPictureElement = null;
    doc.createElement = function (tag) { return new El(tag); };
    doc.createElementNS = function (ns, tag) { var e = new El(tag, ns); e.tagName = tag; return e; };
    doc.createTextNode = function (t) { var e = new El('#text'); e.nodeType = 3; e._text = String(t); return e; };
    doc.getElementById = function (id) { var f = null; walk(doc, function (n) { if (n.id === id) { f = n; return true; } }); return f; };
    doc.createEvent = function () {
        return { initCustomEvent: function (type, b, c, detail) { this.type = type; this.detail = detail; } };
    };
    G.document = doc;
    G.__El = El;

    // ---------------- window ----------------
    G.window = G;
    G.self = G;
    G.navigator = { userAgent: 'Mozilla/5.0 (test) LampaTest' };
    G.location = { href: B.origin + '/', origin: B.origin, protocol: B.origin.split(':')[0] + ':' };
    var winLs = {};
    G.addEventListener = function (type, fn) { (winLs[type] = winLs[type] || []).push(fn); };
    G.removeEventListener = function (type, fn) { var l = winLs[type]; if (l && l.indexOf(fn) >= 0) l.splice(l.indexOf(fn), 1); };
    G.dispatchEvent = function (ev) {
        (winLs[ev.type] || []).slice().forEach(function (fn) { try { fn.call(G, ev); } catch (e) { B.error(e, 'window listener'); } });
        return !ev.defaultPrevented;
    };
    G.CustomEvent = function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; };
    G.crypto = { getRandomValues: function (arr) { B.random(arr); return arr; } };
    G.btoa = B.btoa;
    G.atob = B.atob;
    G.matchMedia = function (q) { return { matches: !!(B.media && B.media[q]), media: q }; };
    G.HTMLMediaElement = function HTMLMediaElement() {};

    // ---------------- XMLHttpRequest ----------------
    function XHR() {
        this.readyState = 0; this.status = 0; this.responseText = ''; this.timeout = 0;
        this._h = {}; this._aborted = false; this._done = false;
        this.onreadystatechange = null; this.onload = null; this.onerror = null; this.ontimeout = null;
    }
    XHR.prototype.open = function (method, url) { this._method = String(method).toUpperCase(); this._url = String(url); this.readyState = 1; };
    XHR.prototype.setRequestHeader = function (k, v) { if (this.readyState !== 1) throw new Error('InvalidStateError'); this._h[k] = String(v); };
    XHR.prototype.abort = function () { this._aborted = true; this._done = true; this.readyState = 0; };
    XHR.prototype._fire = function (name) { var fn = this['on' + name]; if (typeof fn === 'function') { try { fn.call(this, { type: name }); } catch (e) { B.error(e, 'xhr ' + name); } } };
    XHR.prototype._finish = function (status, text, kind) {
        if (this._aborted || this._done) return;
        this._done = true;
        this.status = status; this.responseText = text || ''; this.readyState = 4;
        this._fire('readystatechange');
        if (kind === 'timeout') this._fire('timeout');
        else if (!status) this._fire('error');
        else this._fire('load');
    };
    XHR.prototype.send = function (body) {
        var self = this, req = { method: this._method, url: this._url, headers: this._h, body: body === undefined ? null : body, at: clock.now };
        var plan = B.route(req);           // { status, text, delay, hang } — готовый ответ от маршрутов теста
        req.plan = plan;
        if (this.timeout > 0) G.setTimeout(function () { self._finish(0, '', 'timeout'); }, this.timeout);
        if (plan.hang) return;
        G.setTimeout(function () { self._finish(plan.status, plan.text); }, plan.delay || 0);
    };
    G.XMLHttpRequest = XHR;

    // ---------------- Lampa ----------------
    function Subscribe() { this._l = {}; }
    Subscribe.prototype.follow = function (type, fn) {
        var self = this;
        String(type).split(',').forEach(function (n) { var l = self._l[n] = self._l[n] || []; if (l.indexOf(fn) === -1) l.push(fn); });
        return this;
    };
    Subscribe.prototype.remove = function (type, fn) { var l = this._l[type]; if (l && l.indexOf(fn) >= 0) l.splice(l.indexOf(fn), 1); return this; };
    Subscribe.prototype.send = function (type, ev) {
        var l = (this._l[type] || []).slice(), self = this;
        if (ev === undefined) ev = {};
        // как в Lampa (utils/subscribe.js): ошибка подписчика ловится и пишется в консоль
        try { for (var i = 0; i < l.length; i++) l[i].call(self, ev); } catch (e) { B.error(e, 'subscribe ' + type); }
        return this;
    };
    Subscribe.prototype.count = function (type) { return (this._l[type] || []).length; };

    var readed = {}, defaults = {};
    var Storage = {
        listener: new Subscribe(),
        // Порт Lampa core/storage/storage.js get()
        get: function (name, empty) {
            var value = readed[name];
            if (typeof value === 'undefined') value = G.localStorage.getItem(name);
            value = value || empty || '';
            if (value == 'true' || value == 'false') return value == 'true';
            if (readed[name] && typeof value === 'object') return readed[name];
            var convert = parseInt(value);
            if (!isNaN(convert) && /^\d+$/.test(value)) return convert;
            var i = typeof value === 'string' ? value[0] : '';
            if (i == '[' || i == '{') { try { value = JSON.parse(value); } catch (e) {} }
            readed[name] = value;
            return value;
        },
        value: function (name, empty) { return G.localStorage.getItem(name) || empty || ''; },
        set: function (name, value, nolisten) {
            readed[name] = value;
            var write = value && typeof value === 'object' ? JSON.stringify(value) : value;
            try { G.localStorage.setItem(name, write); } catch (e) { if (e.name === 'QuotaExceededError') G.localStorage.removeItem(name); }
            if (!nolisten) Storage.listener.send('change', { name: name, value: value });
        },
        field: function (name) { return Storage.get(name, defaults[name] + ''); },
        sync: function (name, type) { B.log.synced.push([name, type]); },
        remove: function (name, value) { B.log.removed.push([name, value]); },
        _forget: function (name) { if (name) delete readed[name]; else readed = {}; },
        _defaults: defaults
    };

    var video = null;
    function makeVideo(o) {
        o = o || {};
        var v = new El('video');
        v.duration = o.duration === undefined ? NaN : o.duration;
        v.currentTime = o.currentTime || 0;
        v.paused = false;
        v.customSubs = o.customSubs || null;
        v.textTracks = o.textTracks || [];
        if (o.mediaId) v.mediaId = o.mediaId;
        v.play = function () { v.paused = false; B.log.video.push('play'); };
        v.pause = function () { v.paused = true; B.log.video.push('pause'); };
        return v;
    }

    var Player = { listener: new Subscribe(), _data: null, _opened: false,
        playdata: function () { return Player._data; },
        opened: function () { return Player._opened; } };

    var PlayerVideo = {
        listener: new Subscribe(),
        video: function () { return video; },
        // Как Lampa (player/video.js to()): пауза, перемотка (-1 = за 3 с до конца), play
        to: function (seconds) {
            B.log.seeks.push(seconds);
            if (!video) return;
            video.pause();
            if (seconds == -1) video.currentTime = Math.max(0, (video.duration || 0) - 3);
            else video.currentTime = Math.max(0, Math.min(seconds, video.duration));
            video.play();
        },
        pause: function () { if (video) video.pause(); }
    };

    var Playlist = {
        listener: new Subscribe(), _list: [], _pos: -1,
        get: function () { return Playlist._list; },
        position: function () { return Playlist._pos; },
        canNext: function () { return Playlist._pos < Playlist._list.length - 1; },
        next: function () {
            if (!Playlist.canNext()) return;
            B.log.events.push('next');
            Playlist.listener.send('select', { playlist: Playlist._list, position: Playlist._pos + 1, item: Playlist._list[Playlist._pos + 1] });
        },
        set: function (list, pos) {
            Playlist._list = list || [];
            Playlist._pos = typeof pos === 'number' ? pos : 0;
            Playlist.listener.send('set', { playlist: Playlist._list, position: Playlist._pos });
        }
    };

    var Panel = { listener: new Subscribe() };
    // Как Lampa (interaction/player.js): «к концу видео»
    Panel.listener.follow('to_end', function () {
        B.log.events.push('to_end');
        if (Playlist.canNext()) {
            PlayerVideo.pause();
            B.log.events.push('setEnd');
            Playlist.next();
        } else PlayerVideo.to(-1);
    });

    var Keypad = { listener: new Subscribe() };
    var Ctrl = { _name: 'player', enabled: function () { return { name: Ctrl._name }; }, toggle: function (n) { Ctrl._name = n; B.log.toggles.push(n); } };

    G.Lampa = {
        Storage: Storage,
        SettingsApi: {
            components: [], params: [],
            addComponent: function (c) { this.components.push(c); },
            addParam: function (p) {
                this.params.push(p);
                var t = p.param && p.param.type, n = p.param && p.param.name;
                if (t === 'select' || t === 'input' || t === 'trigger') defaults[n] = p.param['default'];
            }
        },
        Player: Player,
        PlayerVideo: PlayerVideo,
        PlayerPlaylist: Playlist,
        PlayerPanel: Panel,
        Keypad: Keypad,
        Listener: new Subscribe(),
        Noty: { show: function (t) { B.log.noty.push(String(t)); } },
        Select: { show: function (o) { B.log.selects.push(o); } },
        Controller: Ctrl,
        Platform: { is: function (n) { return B.platform === n; } },
        Activity: { active: function () { return B.activity || null; } },
        Timeline: { view: function (hash) { return (B.timeline && B.timeline[hash]) || { percent: 0, time: 0, duration: 0 }; } },
        Account: { Permit: { sync: false }, hasPremium: function () { return false; } },
        Base64: { encode: function (s) { return B.btoa(unescape(encodeURIComponent(s))); } },
        Reguest: function () {
            this.native = function (url, ok, err, post, params) {
                var plan = B.route({ method: post ? 'POST' : 'GET', url: url, headers: {}, body: post || null, at: clock.now, native: true });
                if (plan.hang) return;
                G.setTimeout(function () {
                    if (plan.status >= 200 && plan.status < 300) {
                        var j = null;
                        try { j = JSON.parse(plan.text); } catch (e) { j = plan.text; }
                        ok(j);
                    } else err({ status: plan.status, responseText: plan.text });
                }, plan.delay || 0);
            };
            this.silent = this.native;
            this.clear = function () {};
        },
        Api: { sources: { tmdb: { external_imdb_id: function (p, cb) {
            B.log.imdb.push(p.type + ':' + p.id);
            var v = B.imdb ? B.imdb[p.type + ':' + p.id] : undefined;
            if (v === undefined) return;            // TMDB не ответил
            G.setTimeout(function () { cb(v); }, B.imdbDelay || 20);
        } } } }
    };

    // ---------------- Помощники для тестов ----------------
    G.__T = {
        clock: clock,
        Subscribe: Subscribe,
        makeVideo: makeVideo,
        setVideo: function (o) { video = o ? makeVideo(o) : null; if (video) { var host = G.document.querySelector('.player') || G.document.body; host.appendChild(video); } return video; },
        video: function () { return video; },
        // Lampa.Player.play(): create -> start (видео ещё старое) -> Video.url -> (плейлист)
        play: function (data, o) {
            o = o || {};
            var run = true;
            Player.listener.send('create', { data: data, abort: function () { run = false; } });
            if (!run) return false;
            Player._data = data;
            Player._opened = true;
            Player.listener.send('start', data);
            if (o.video !== false) G.__T.setVideo({ duration: NaN, currentTime: 0, customSubs: o.customSubs, textTracks: o.textTracks, mediaId: o.mediaId });
            if (o.playlist) Playlist.set(o.playlist, o.position);
            return true;
        },
        loaded: function (duration) {
            if (!video) G.__T.setVideo({});
            video.duration = duration;
            PlayerVideo.listener.send('loadeddata', {});
        },
        tick: function (time, duration) {
            if (video) {
                if (typeof time === 'number') video.currentTime = time;
                if (typeof duration === 'number') video.duration = duration;
            }
            PlayerVideo.listener.send('timeupdate', { duration: video ? video.duration : 0, current: video ? video.currentTime : 0 });
        },
        destroy: function () {
            Player.listener.send('destroy', {});
            Player._opened = false;
            Player._data = null;
            if (video && video.parentNode) video.parentNode.removeChild(video);
            video = null;
        },
        // Lampa core/keypad.js: keydown -> listener; если не defaultPrevented — действие Lampa; keyup -> OK
        key: function (code, phase) {
            var ev = { defaultPrevented: false, preventDefault: function () { this.defaultPrevented = true; } };
            var enter = code === 13 || code === 29443 || code === 117 || code === 65385;
            if (phase === 'keyup') {
                Keypad.listener.send('keyup', { code: code, enabled: true, event: ev });
                if (enter && !ev.defaultPrevented) B.log.lampaKeys.push('enter');
            } else {
                Keypad.listener.send('keydown', { code: code, enabled: true, event: ev });
                if (!ev.defaultPrevented && !enter) B.log.lampaKeys.push('keydown:' + code);
            }
            return ev.defaultPrevented;
        },
        press: function (code) { var a = G.__T.key(code, 'keydown'); var b = G.__T.key(code, 'keyup'); return a || b; },
        playerDom: function () {
            if (G.document.querySelector('.player')) return;
            var p = new El('div'); p.className = 'player';
            var panel = new El('div'); panel.className = 'player-panel';
            var tl = new El('div'); tl.className = 'player-panel__timeline';
            var segs = new El('div'); segs.className = 'player-panel__timeline-segments';
            var other = new El('div'); other.className = 'player-panel__position';
            tl.appendChild(segs); tl.appendChild(other);
            panel.appendChild(tl); p.appendChild(panel);
            G.document.body.appendChild(p);
        },
        El: El
    };
})(this);
