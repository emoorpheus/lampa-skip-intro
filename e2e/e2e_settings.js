// Настройки плагина в настоящей Lampa 3.4.4: раздел, пункты, кнопка «Проверить сейчас»,
// переключатель и выбор значения через настоящие события Lampa ('hover:enter'). Внешняя сеть — заглушки.
const { open } = require('./lib');
const PKG = require('../package.json');
const assert = require('assert');
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({
        mocks: [
            { match: 'api.theintrodb.org/v4/media', reply: { body: { tmdb_id: 1399, type: 'tv', intro: [{ start_ms: 437000, end_ms: 531000, confidence: 0.9, submission_count: 5 }] } } },
            { match: 'api.introdb.app/segments', reply: { body: { intro: { start_sec: 437, end_sec: 531 } }, cors: 'https://introdb.app' } },
            { match: 'introhater.com/api/segments/', reply: { body: [] } },
            { match: 'api.aniskip.com/v2/skip-times/40028/1', method: 'GET', reply: { body: { found: true, statusCode: 200, message: 'Successfully found skip times',
                results: [{ interval: { startTime: 242.6, endTime: 332.6 }, skipType: 'op', skipId: 'e2e-op', episodeLength: 1420 }] } } },
            { match: 'arm.haglund.dev/api/v2/themoviedb?id=1429', reply: { body: [{ anidb: 9541, anilist: 16498, myanimelist: 16498, themoviedb: 1429 }] } },
            { match: 'graphql.anilist.co', method: 'POST', reply: { body: { data: { Page: { media: [] } } } } }
        ]
    });
    global.__env = env;
    const names = (comp) => env.ev((comp) => new Promise((res) => {
        Lampa.Settings.create(comp);
        setTimeout(() => res(Array.from(document.querySelectorAll('.settings__body .settings-param, .settings__body .settings-param-title')).map((el) =>
            (el.getAttribute('data-name') || (el.getAttribute('data-static') ? 'static' : 'title')) + '=' + ((el.querySelector('.settings-param__name') || el).textContent.trim()))), 400);
    }), comp);
    // главный экран настроек
    const folders = await env.ev(() => new Promise((res) => {
        Lampa.Controller.toggle('settings');
        setTimeout(() => res(Array.from(document.querySelectorAll('.settings-folder')).map((f) => f.getAttribute('data-component') + '=' + f.textContent.trim())), 600);
    }));
    check('в настройках Lampa есть раздел «Пропуск заставок»', () => {
        assert.ok(folders.includes('skip_intro=Пропуск заставок'), folders.join(' | '));
    });
    const skip = await names('skip_intro');
    console.log('skip_intro: ' + skip.length + '\n  ' + skip.join('\n  '));
    check('раздел «Пропуск заставок» отрисован Lampa: основные пункты и диагностика', () => {
        for (const n of ['skip_intro_enabled=Включить плагин', 'skip_intro_auto=Всегда автопропуск', 'skip_intro_diag_check=Проверить сейчас', 'static=Версия плагина', 'static=TheIntroDB', 'static=ARM (аниме → MyAnimeList)', 'static=Статистика'])
            assert.ok(skip.includes(n), n + ' нет в ' + skip.length + ' пунктах');
        assert.ok(skip.length >= 30, String(skip.length));
    });
    const ver = await env.ev(() => {
        const el = Array.from(document.querySelectorAll('.settings__body .settings-param')).filter((e) => { const n = e.querySelector('.settings-param__name'); return n && n.textContent.trim() === 'Версия плагина'; })[0];
        const d = el && el.querySelector('.settings-param__descr');
        return d ? d.textContent.trim() : null;
    });
    check('версия видна на экране настроек («Диагностика»): Skip Intro ' + PKG.version, () => assert.strictEqual(ver, 'Skip Intro ' + PKG.version));
    // переключатель через настоящее событие Lampa
    const trig = await env.ev(() => new Promise((res) => {
        const el = $('.settings__body .settings-param[data-name="skip_intro_auto"]');
        const before = Lampa.Storage.field('skip_intro_auto');
        el.trigger('hover:enter');
        setTimeout(() => res({ before, after: Lampa.Storage.field('skip_intro_auto'), value: el.find('.settings-param__value').text(),
            plugin: window.__SKIP_INTRO_TEST__.Settings.isAutoSkip() }), 300);
    }));
    check('переключатель «Всегда автопропуск» меняет Storage, плагин видит новое значение', () => {
        assert.strictEqual(trig.before, false); assert.strictEqual(trig.after, true); assert.strictEqual(trig.plugin, true);
    });
    // кнопка «Проверить сейчас»
    await env.ev(() => { $('.settings__body .settings-param[data-name="skip_intro_diag_check"]').trigger('hover:enter'); });
    await env.wait(2500);
    const diag = await env.ev(() => {
        const out = {};
        const NAMES = { theintrodb: 'TheIntroDB', introdb: 'IntroDB', introhater: 'IntroHater', aniskip: 'Aniskip', arm: 'ARM (аниме → MyAnimeList)', anilist: 'AniList', chapters: 'Главы MKV (TorrServer)', stats: 'Статистика' };
        const statics = Array.from(document.querySelectorAll('.settings__body .settings-param[data-static="true"]'));
        Object.keys(NAMES).forEach((s) => {
            const el = statics.find((e) => (e.querySelector('.settings-param__name') || {}).textContent === NAMES[s]);
            out[s] = el ? (el.querySelector('.settings-param__descr') || {}).textContent : '(нет пункта)';
        });
        out.noty = (document.querySelector('.noty') || {}).textContent || '';
        return out;
    });
    console.log('diag: ' + JSON.stringify(diag, null, 1));
    check('«Проверить сейчас»: статусы источников в настоящем браузере', () => {
        assert.ok(/^Работает, \d+ мс, только что$/.test(diag.theintrodb), diag.theintrodb);
        assert.ok(/^Нет ответа \(возможно, CORS или нет сети\).* · напрямую$/.test(diag.introdb), diag.introdb);
        assert.ok(/^Работает \(для серии пусто\)/.test(diag.introhater), diag.introhater);
        assert.ok(/^Работает/.test(diag.aniskip) && /^Работает/.test(diag.arm) && /^Работает/.test(diag.anilist), JSON.stringify(diag));
        assert.ok(/^Ещё не запрашивался/.test(diag.chapters), diag.chapters);
    });
    check('Aniskip в проверке — только GET (ничего не отправляется)', () => {
        assert.ok(!env.mocked.some((m) => m.startsWith('POST') && m.includes('aniskip')), env.mocked.join(' | '));
        assert.ok(env.mocked.some((m) => m.startsWith('POST https://graphql.anilist.co')));
    });
    // «Отчёт для разработчика»: окно Lampa.Modal крупным текстом, прокрутка стрелками, «Назад» — обратно в настройки
    await env.ev(() => { $('.settings__body .settings-param[data-name="skip_intro_diag_report"]').trigger('hover:enter'); });
    await env.wait(600);
    const rep = await env.ev(() => {
        const m = document.querySelector('.modal');
        const lines = Array.from(document.querySelectorAll('.modal .skip-intro-report > div')).map((d) => d.className.replace('skip-intro-report__', '') + ': ' + d.textContent);
        const body = document.querySelector('.modal .skip-intro-report__l'), name = document.querySelector('.settings-param__name');
        const sc = document.querySelector('.modal .scroll__content');
        return { open: !!m, title: (document.querySelector('.modal__title') || {}).textContent, lines,
            ctrl: Lampa.Controller.enabled().name, font: body ? parseFloat(getComputedStyle(body).fontSize) : 0,
            settingsFont: name ? parseFloat(getComputedStyle(name).fontSize) : 0, scrollable: sc ? sc.scrollHeight > sc.clientHeight : null };
    });
    console.log('report: ' + JSON.stringify({ title: rep.title, ctrl: rep.ctrl, font: rep.font, settingsFont: rep.settingsFont, scrollable: rep.scrollable, n: rep.lines.length }) + '\n  ' + rep.lines.slice(0, 16).join('\n  '));
    await env.shot('e2e_report');
    const topOf = () => env.ev(() => { const d = document.querySelector('.modal .skip-intro-report__hint'); return d ? Math.round(d.getBoundingClientRect().top) : null; });
    const top0 = await topOf();
    await env.page.keyboard.press('ArrowDown');
    await env.wait(400);
    const top1 = await topOf();
    await env.page.keyboard.press('Escape');
    await env.wait(500);
    const after = await env.ev(() => ({ open: !!document.querySelector('.modal'), ctrl: Lampa.Controller.enabled().name,
        settings: !!document.querySelector('.settings__body .settings-param[data-name="skip_intro_diag_report"]') }));
    check('«Отчёт для разработчика»: окно с версией, устройством, источниками, отметками и журналом', () => {
        assert.ok(rep.open, 'окно открыто');
        assert.strictEqual(rep.title, 'Skip Intro — отчёт');
        assert.strictEqual(rep.ctrl, 'modal');
        const t = rep.lines.join('\n');
        assert.ok(t.indexOf('l: Skip Intro ' + PKG.version + ' · Lampa 3.4.4 · ') >= 0, t);
        assert.ok(/h: Изменённые настройки\nl: auto: true\n/.test(t), t);
        assert.ok(/l: TheIntroDB — Работает, \d+ мс/.test(t), t);
        assert.ok(/h: Журнал \(последние \d+\)\nlog: \d\d:\d\d:\d\d Plugin v/.test(t), t);
        assert.ok(!/127\.0\.0\.1|https?:\/\//.test(t), 'нет адресов');
        assert.ok(rep.font > rep.settingsFont, 'текст крупнее пунктов настроек: ' + rep.font + ' > ' + rep.settingsFont);
    });
    check('«Отчёт»: стрелка вниз прокручивает, «Назад» закрывает окно и возвращает в настройки', () => {
        assert.ok(rep.scrollable, 'отчёт длиннее окна');
        assert.ok(top1 < top0, 'прокрутка вниз: ' + top0 + ' -> ' + top1);
        assert.deepStrictEqual(after, { open: false, ctrl: 'settings_component', settings: true });
    });
    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    await env.shot('e2e_settings');
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) console.log(global.__env.logs.filter((l) => /PAGEERROR|SkipIntro/.test(l)).join('\n')); process.exit(2); });
