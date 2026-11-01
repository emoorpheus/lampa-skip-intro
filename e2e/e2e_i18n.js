// Английский интерфейс в настоящей Lampa 3.4.4 (язык Lampa — English): «Источники», предупреждение, кнопка, раздел настроек.
// Отметки на шкале: свой стиль .skip-intro-mark — отметки видны и тогда, когда у шкалы нет стилей сегментов Lampa
// (имитация сборки Lampa с другими стилями: правила .player-panel__timeline-segment удаляются со страницы).
const { open, BASE } = require('./lib');
const assert = require('assert');
const GOT = { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8, source: 'tmdb',
    genre_ids: [10765, 18, 10759], origin_country: ['US'], original_language: 'en',
    seasons: [{ season_number: 1, episode_count: 10, air_date: '2011-04-17' }] };
const CYR = /[\u0400-\u04FF]/;
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({
        storage: { language: 'en', skip_intro_button_timeout: '0' },
        mocks: [
            { match: 'api.theintrodb.org/v4/media', reply: (req) => {
                const ep = new URL(req.url()).searchParams.get('episode');
                if (ep === '1') return { body: { tmdb_id: 1399, type: 'tv', group_duration_ms: 3700000, intro: [{ start_ms: 437000, end_ms: 531000, confidence: 0.9, submission_count: 5 }], credits: [{ start_ms: 3631500, end_ms: null, confidence: 0.9, submission_count: 4 }] }, delay: 100 };
                return { status: 404, body: { error: 'No submissions', code: 'no_submissions' } };
            } },
            { match: 'api.introdb.app/segments', reply: { body: { intro: null, recap: null, outro: null, post_credits: null }, cors: 'https://introdb.app' } },
            { match: 'introhater.com/api/segments/', reply: { body: [] } },
            { match: 'tv/1399/external_ids', reply: { body: { id: 1399, imdb_id: 'tt0944947', tvdb_id: 121361 } } }
        ]
    });
    global.__env = env;
    assert.ok(await env.ev(() => !!(window.__SKIP_INTRO_TEST__ && window.__SKIP_INTRO_TEST__.Controller)), 'тестовый хук autoskip не заполнен');
    const lang = await env.ev(() => ({ next: Lampa.Lang.translate('settings_player_next_episode'), plugin: window.__SKIP_INTRO_TEST__.I18n.lang() }));
    check('Lampa на английском (Lampa.Lang: «Next episode»), плагин выбрал английский', () => {
        assert.strictEqual(lang.next, 'Next episode');
        assert.strictEqual(lang.plugin, 'en');
    });
    await env.ev(({ BASE, GOT }) => {
        const list = [
            { title: 'Game.of.Thrones.S01E01.2160p.HDR.webm', season: 1, episode: 1, url: BASE + 'video/got_s01e01.webm', card: GOT },
            { title: 'Game.of.Thrones.S01E02.2160p.HDR.webm', season: 1, episode: 2, url: BASE + 'video/got_s01e02.webm', card: GOT }
        ];
        Lampa.Player.play(list[0]);
        Lampa.Player.playlist(list);
    }, { BASE, GOT });
    await env.wait(4000);
    const d1 = await env.ev(() => window.__SKIP_INTRO_TEST__.Controller.describe());
    console.log('describe: ' + d1);
    check('«Sources» на английском: Intro 7:17–8:51 (TheIntroDB…), TheIntroDB: found, Timeline marks: 2', () => {
        assert.ok(/^Intro 7:17–8:51 \(TheIntroDB/.test(d1) && /TheIntroDB: found/.test(d1) && /\. Timeline marks: 2$/.test(d1), d1);
        assert.ok(!CYR.test(d1), d1);
    });
    const style = () => env.ev(() => Array.from(document.querySelectorAll('.player-panel__timeline .skip-intro-mark')).map((m) => {
        const cs = getComputedStyle(m), r = m.getBoundingClientRect();
        return { pos: cs.position, h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10, bg: cs.backgroundColor };
    }));
    const s1 = await style();
    console.log('marks: ' + JSON.stringify(s1));
    check('отметки на шкале: position absolute, высота шкалы, цвет как у сегментов Lampa', () => {
        assert.strictEqual(s1.length, 2, JSON.stringify(s1));
        s1.forEach((m) => { assert.strictEqual(m.pos, 'absolute'); assert.ok(m.h > 0 && m.w > 0, JSON.stringify(m)); assert.strictEqual(m.bg, 'rgba(110, 219, 255, 0.5)'); });
    });
    // сборка Lampa без стилей сегментов шкалы: удаляем правила и перерисовываем отметки
    const removed = await env.ev(() => {
        let n = 0;
        Array.from(document.styleSheets).forEach((sh) => {
            let rules = null;
            try { rules = sh.cssRules; } catch (e) { return; }
            for (let i = rules.length - 1; i >= 0; i--) {
                if (rules[i].selectorText && rules[i].selectorText.indexOf('player-panel__timeline-segment') !== -1) { sh.deleteRule(i); n++; }
            }
        });
        const T = window.__SKIP_INTRO_TEST__;
        T.Marks.clear();
        T.Controller._drawMarks(true);
        return n;
    });
    const s2 = await style();
    console.log('without Lampa segment CSS (' + removed + ' rules removed): ' + JSON.stringify(s2));
    check('без стилей сегментов Lampa отметки всё равно видны (свой стиль .skip-intro-mark)', () => {
        assert.ok(removed >= 3, String(removed));
        assert.strictEqual(s2.length, 2, JSON.stringify(s2));
        s2.forEach((m, i) => { assert.strictEqual(m.pos, 'absolute'); assert.strictEqual(m.h, s1[i].h); assert.strictEqual(m.w, s1[i].w); assert.strictEqual(m.bg, 'rgba(110, 219, 255, 0.5)'); });
    });
    await env.ev(() => Lampa.PlayerVideo.to(430));
    await env.wait(3500);
    const warn = await env.ev(() => { const w = document.querySelector('.skip-intro-warn'); return w ? { text: w.textContent, vis: w.classList.contains('visible') } : null; });
    check('предупреждение «Intro in N s»', () => assert.ok(warn && warn.vis && /^Intro in \d s$/.test(warn.text), JSON.stringify(warn)));
    await env.wait(4500);
    await env.shot('e2e_i18n_button');
    const btn = await env.ev(() => {
        const b = document.querySelector('.skip-intro-button'), q = (c) => (b.querySelector(c) || {}).textContent || '';
        return b ? { vis: b.classList.contains('visible'), label: q('.skip-intro-label'), hint: q('.skip-intro-hint') } : null;
    });
    check('кнопка «Skip intro», подсказка «press OK»', () => { assert.ok(btn && btn.vis, JSON.stringify(btn)); assert.strictEqual(btn.label, 'Skip intro'); assert.strictEqual(btn.hint, 'press OK'); });
    await env.page.keyboard.press('Enter');
    await env.wait(1500);
    const t = await env.ev(() => document.querySelector('video').currentTime);
    check('OK (Enter) — перемотка на 531 с', () => assert.ok(t >= 531 && t < 536, String(t)));
    await env.ev(() => Lampa.Player.close());
    await env.wait(1000);
    // раздел настроек
    const folders = await env.ev(() => new Promise((res) => {
        Lampa.Controller.toggle('settings');
        setTimeout(() => res(Array.from(document.querySelectorAll('.settings-folder')).map((f) => f.getAttribute('data-component') + '=' + f.textContent.trim())), 600);
    }));
    check('в настройках Lampa раздел «Skip Intro»', () => assert.ok(folders.includes('skip_intro=Skip Intro'), folders.join(' | ')));
    const page = await env.ev(() => new Promise((res) => {
        Lampa.Settings.create('skip_intro');
        setTimeout(() => {
            const body = document.querySelector('.settings__body');
            res({ text: body ? body.textContent : '', items: Array.from(document.querySelectorAll('.settings__body .settings-param, .settings__body .settings-param-title')).map((el) =>
                (el.getAttribute('data-name') || (el.getAttribute('data-static') ? 'static' : 'title')) + '=' + ((el.querySelector('.settings-param__name') || el).textContent.trim())) });
        }, 400);
    }));
    console.log('skip_intro: ' + page.items.length + '\n  ' + page.items.join('\n  '));
    check('раздел на английском: пункты, значения и описания без кириллицы', () => {
        for (const n of ['skip_intro_enabled=Enable plugin', 'skip_intro_auto=Always auto-skip', 'skip_intro_diag_check=Check now', 'static=Plugin version', 'static=TheIntroDB', 'static=ARM (anime → MyAnimeList)', 'static=Statistics'])
            assert.ok(page.items.includes(n), n + ' нет в ' + page.items.length + ' пунктах');
        assert.ok(page.items.length >= 30, String(page.items.length));
        const m = page.text.match(/[^\s]*[\u0400-\u04FF][^\s]*/g);
        assert.ok(!m, 'кириллица: ' + (m || []).slice(0, 5).join(' '));
    });
    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    console.log('plugin logs:\n' + env.pluginLogs().slice(0, 30).join('\n'));
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) { console.log(global.__env.logs.slice(-60).join('\n')); } process.exit(2); });
