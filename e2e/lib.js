// Общие помощники e2e: локальная Lampa в Chromium, внешняя сеть — только заглушки
const { chromium } = require('playwright');
const path = require('path');
// Chromium: путь в переменной CHROMIUM_PATH, иначе браузер Playwright (npx playwright install chromium)
const CHROMIUM = process.env.CHROMIUM_PATH || undefined;
const BASE = 'http://127.0.0.1:8123/';
const PLUGINS = [{ url: BASE + 'plugins/autoskip.js', status: 1 }];

async function open(o) {
    o = o || {};
    const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const external = {}, mocked = [];
    const mocks = o.mocks || [];
    await ctx.route('**/*', async (route) => {
        const req = route.request(), u = req.url();
        if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        for (const m of mocks) {
            if (u.indexOf(m.match) === -1 || (m.method && m.method !== req.method())) continue;
            mocked.push(req.method() + ' ' + u);
            const r = typeof m.reply === 'function' ? m.reply(req) : m.reply;
            if (r.delay) await new Promise((res) => setTimeout(res, r.delay));
            const headers = Object.assign({ 'content-type': r.type || 'application/json' }, r.cors === null ? {} : { 'access-control-allow-origin': r.cors || '*', 'access-control-allow-headers': '*' });
            return route.fulfill({ status: r.status || 200, headers, body: r.text !== undefined ? r.text : JSON.stringify(r.body) });
        }
        const host = new URL(u).host;
        if ((o.live || []).includes(host)) { mocked.push('LIVE ' + req.method() + ' ' + u); return route.continue(); }
        external[host] = (external[host] || 0) + 1;
        return route.abort('connectionrefused');
    });
    const settings = Object.assign({ language: 'ru', plugins: JSON.stringify(PLUGINS) }, o.storage || {});
    await ctx.addInitScript((s) => {
        if (window.sessionStorage.getItem('__seeded')) return;
        window.sessionStorage.setItem('__seeded', '1');
        for (const k of Object.keys(s)) window.localStorage.setItem(k, s[k]);
    }, settings);
    // тестовые хуки плагинов задаются до загрузки страницы (плагин читает их при выполнении)
    if (o.hooks !== false) await ctx.addInitScript(() => { window.__SKIP_INTRO_TEST__ = {}; });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
    page.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e && e.stack || e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { await page.waitForTimeout(500); ready = await page.evaluate(() => !!window.appready); }
    // Стартовая активность Lampa при запуске вызывает Controller.toContent(), который закрывает плеер
    // (app.min.js: ActivitySlide.start -> Controller.toggle('content') -> toContent -> Player.close).
    // Поэтому ждём, пока первая активность создана, и ещё немного.
    let act = false;
    for (let i = 0; i < 40 && ready && !act; i++) { await page.waitForTimeout(250); act = await page.evaluate(() => { try { const a = Lampa.Activity.active(); return !!(a && a.component); } catch (e) { return false; } }); }
    if (act) await page.waitForTimeout(1500);
    const env = { browser, ctx, page, logs, external, mocked, ready, activity: act,
        async close() { await page.close(); await browser.close(); },
        wait: (ms) => page.waitForTimeout(ms),
        ev: (fn, arg) => page.evaluate(fn, arg),
        async shot(name) { await page.screenshot({ path: path.join(__dirname, name + '.png') }); },
        errors() { return logs.filter((l) => /^PAGEERROR|^error/.test(l)); },
        pluginLogs() { return logs.filter((l) => /SkipIntro/.test(l)); }
    };
    return env;
}

module.exports = { open, BASE, PLUGINS };
