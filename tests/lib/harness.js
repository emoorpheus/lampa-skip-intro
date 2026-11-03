'use strict';
// Тестовое окружение: vm-контекст = window браузера, фейковая Lampa, управляемые часы и сеть.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'dist');            // собранный плагин: npm run build
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PRELUDE = fs.readFileSync(path.join(__dirname, 'prelude.js'), 'utf8');
const FILES = { autoskip: path.join(OUT, 'autoskip.js') };
const START = Date.UTC(2026, 10, 1, 9, 0, 0);

function tick() { return new Promise((r) => setImmediate(r)); }

function createEnv(opts) {
    opts = opts || {};
    const log = { noty: [], bell: [], selects: [], seeks: [], events: [], video: [], toggles: [], lampaKeys: [], synced: [], removed: [], imdb: [], console: [] };
    const net = { routes: [], requests: [], unmatched: [] };
    const errors = [];
    const bridge = {
        startTime: opts.startTime || START,
        origin: opts.origin || 'http://lampa.mx',
        scriptSrc: opts.scriptSrc || '',
        platform: opts.platform || 'browser',
        activity: null,
        timeline: {},
        imdb: {},
        media: {},
        log,
        error(e, where) { errors.push({ e, where }); if (process.env.DEBUG) console.error('[env error]', where, e && e.stack || e); },
        random(arr) { nodeCrypto.randomFillSync(arr); },
        btoa: (s) => Buffer.from(String(s), 'latin1').toString('base64'),
        atob: (s) => Buffer.from(String(s), 'base64').toString('latin1'),
        // Маршрут: первым совпавшим считается добавленный позже (тест может переопределить)
        route(req) {
            net.requests.push(req);
            for (let i = net.routes.length - 1; i >= 0; i--) {
                const r = net.routes[i];
                if (r.method && r.method !== req.method) continue;
                if (typeof r.match === 'string' ? req.url.indexOf(r.match) === -1 : (r.match instanceof RegExp ? !r.match.test(req.url) : !r.match(req))) continue;
                let res = typeof r.reply === 'function' ? r.reply(req) : r.reply;
                if (res === undefined) continue;
                res = Object.assign({}, res);
                // CORS: браузер не отдаёт ответ чужому источнику — для скрипта это сетевая ошибка (status 0)
                if (!req.native && r.cors && r.cors !== '*' && r.cors !== bridge.origin) return { status: 0, text: '', delay: res.delay, cors: true };
                const text = res.text !== undefined ? res.text : (res.body === undefined ? '' : JSON.stringify(res.body));
                return { status: res.status === undefined ? 200 : res.status, text, delay: res.delay || 0, hang: !!res.hang };
            }
            net.unmatched.push(req.method + ' ' + req.url);
            return { status: 0, text: '', delay: 0 };
        }
    };
    const consoleProxy = {
        log: (...a) => { log.console.push(a.map(String).join(' ')); if (process.env.DEBUG) console.log(...a); },
        warn: (...a) => { log.console.push('WARN ' + a.join(' ')); },
        error: (...a) => { log.console.push('ERROR ' + a.join(' ')); }
    };
    const ctx = vm.createContext({ __bridge: bridge, console: consoleProxy, unescape, encodeURIComponent, decodeURIComponent, escape });
    vm.runInContext(PRELUDE, ctx, { filename: 'prelude.js' });
    const W = ctx;
    const T = W.__T;
    const IJSON = vm.runInContext('JSON', ctx);
    if (opts.appready !== false) W.appready = true;

    const env = {
        W, T, ctx, log, net, errors, bridge,
        get L() { return W.Lampa; },
        get now() { return T.clock.now; },
        // данные в «мире» плагина (массивы/объекты того же realm)
        clone(x) { return x === undefined ? undefined : IJSON.parse(JSON.stringify(x)); },
        run(code) { return vm.runInContext(code, ctx); },
        on(match, reply, extra) { net.routes.push(Object.assign({ match, reply }, extra || {})); return env; },
        requests(match) {
            return net.requests.filter((r) => typeof match === 'string' ? r.url.indexOf(match) !== -1 : match.test(r.url));
        },
        setStorage(name, value) { W.Lampa.Storage.set(name, typeof value === 'object' && value !== null ? env.clone(value) : value, true); },
        load(name, hookName) {
            if (name === 'autoskip' && opts.hook !== false) W.__SKIP_INTRO_TEST__ = {};
            const code = fs.readFileSync(FILES[name], 'utf8');
            vm.runInContext(code, ctx, { filename: path.basename(FILES[name]) });
            if (name === 'autoskip') env.S = W.__SKIP_INTRO_TEST__;
            return env;
        },
        async flush(rounds) {
            for (let n = 0; n < (rounds || 200); n++) {
                await tick(); await tick();
                if (!T.clock.runNext(T.clock.now)) { await tick(); if (!T.clock.next(T.clock.now)) return; }
            }
        },
        async advance(ms) {
            const target = T.clock.now + ms;
            for (let guard = 0; guard < 100000; guard++) {
                await tick(); await tick();
                if (!T.clock.runNext(target)) break;
            }
            T.clock.now = target;
            await env.flush();
        },
        // время воспроизведения идёт: timeupdate каждые 250 мс (как часто шлёт Lampa — неважно, важна последовательность)
        async playTo(from, to, step) {
            step = step || 0.25;
            for (let t = from; t <= to + 1e-9; t += step) {
                T.tick(Math.round(t * 1000) / 1000);
                await env.advance(step * 1000);
            }
        },
        noty() { return log.noty.slice(); },
        lastSelect() { return log.selects[log.selects.length - 1] || null; },
        pick(prefix) {
            const s = env.lastSelect();
            if (!s) throw new Error('Меню не открыто');
            const item = s.items.find((i) => String(i.title).indexOf(prefix) === 0);
            if (!item) throw new Error('Нет пункта «' + prefix + '» в меню: ' + s.items.map((i) => i.title).join(' | '));
            s.onSelect(item);
            return item;
        },
        button() {
            const el = W.document.querySelector('.skip-intro-button');
            if (!el) return null;
            const q = (c) => { const x = el.querySelector(c); return x ? x.textContent : ''; };
            return { el, visible: el.classList.contains('visible'), label: q('.skip-intro-label'), badge: q('.skip-intro-badge'),
                hint: q('.skip-intro-hint'), sub: q('.skip-intro-sub'), countdown: el.classList.contains('countdown'), filter: el.style.filter || '' };
        },
        warn() {
            const el = W.document.querySelector('.skip-intro-warn');
            return el ? { text: el.textContent, visible: el.classList.contains('visible'), filter: el.style.filter || '' } : null;
        },
        marks() {
            return W.document.querySelectorAll('.skip-intro-mark').map((m) => ({ cls: m.className, left: parseFloat(m.style.left), width: parseFloat(m.style.width) }));
        },
        css(id) { const el = W.document.getElementById(id); return el ? el.textContent : null; }
    };
    return env;
}

// ---------------- мини-раннер ----------------
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function run(title) {
    let ok = 0, fail = 0;
    const only = process.env.ONLY;
    console.log('\n=== ' + title + ' ===');
    for (const t of tests) {
        if (only && t.name.indexOf(only) === -1) continue;
        try {
            await t.fn();
            ok++;
            console.log('  ✓ ' + t.name);
        } catch (e) {
            fail++;
            console.log('  ✗ ' + t.name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, process.env.FULL ? 400 : 6).join('\n      '));
        }
    }
    console.log('  итого: ' + ok + ' прошло, ' + fail + ' не прошло');
    if (fail) process.exitCode = 1;
    return { ok, fail };
}

module.exports = { createEnv, test, run, tick, ROOT, OUT, FILES, PKG, START, fixture: (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', n), 'utf8')) };
