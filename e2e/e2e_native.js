// Режим «Отдавать таймкоды в Lampa» (эксперимент) в настоящей Lampa 3.4.4: таймкоды серии из кэша уходят в data.segments,
// Lampa рисует свои отметки на шкале, плагин свои не дублирует и не показывает свою кнопку.
// Сборка Lampa без стилей сегментов (правила .player-panel__timeline-segment удаляются со страницы): отметки Lampa есть,
// но не видны — плагин рисует свои.
const { open, BASE } = require('./lib');
const assert = require('assert');
const GOT = { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8, source: 'tmdb',
    genre_ids: [10765, 18, 10759], origin_country: ['US'], original_language: 'en',
    seasons: [{ season_number: 1, episode_count: 10, air_date: '2011-04-17' }] };
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({
        storage: { language: 'en', skip_intro_native: 'true', skip_intro_button_timeout: '0' },
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
    const play = () => env.ev(({ BASE, GOT }) => {
        const list = [
            { title: 'Game.of.Thrones.S01E01.2160p.HDR.webm', season: 1, episode: 1, url: BASE + 'video/got_s01e01.webm', card: GOT },
            { title: 'Game.of.Thrones.S01E02.2160p.HDR.webm', season: 1, episode: 2, url: BASE + 'video/got_s01e02.webm', card: GOT }
        ];
        Lampa.Player.play(list[0]);
        Lampa.Player.playlist(list);
    }, { BASE, GOT });
    const describe = () => env.ev(() => window.__SKIP_INTRO_TEST__.Controller.describe());
    const marks = () => env.ev(() => {
        const box = (m) => { const cs = getComputedStyle(m), r = m.getBoundingClientRect(); return { pos: cs.position, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, style: m.style.width }; };
        return {
            lampa: Array.from(document.querySelectorAll('.player-panel__timeline-segments .player-panel__timeline-segment')).map(box),
            own: Array.from(document.querySelectorAll('.player-panel__timeline .skip-intro-mark')).map(box)
        };
    });

    // 1-й запуск: в кэше ничего нет — обычный режим; таймкоды запрашиваются и кэшируются
    await play();
    await env.wait(4000);
    const d1 = await describe();
    console.log('run 1: ' + d1);
    check('1-й запуск (кэш пуст): обычный режим, свои отметки — «Timeline marks: 2»', () => {
        assert.ok(/TheIntroDB: found/.test(d1) && !/passed to Lampa/.test(d1) && /\. Timeline marks: 2$/.test(d1), d1);
    });
    await env.ev(() => Lampa.Player.close());
    await env.wait(1000);

    // 2-й запуск: таймкоды из кэша переданы Lampa
    await play();
    await env.wait(4000);
    const d2 = await describe(), m2 = await marks();
    console.log('run 2: ' + d2 + '\nmarks: ' + JSON.stringify(m2));
    check('2-й запуск: в журнале «Native mode: 1 segment(s) passed to Lampa» (заставка; титры «до конца» не передаются)', () =>
        assert.ok(env.pluginLogs().some((l) => /Native mode: 1 segment\(s\) passed to Lampa for/.test(l)), env.pluginLogs().slice(-10).join(' | ')));
    check('Lampa 3.4.4 рисует свою отметку: ширина > 0, position absolute', () => {
        assert.strictEqual(m2.lampa.length, 1, JSON.stringify(m2));
        assert.ok(parseFloat(m2.lampa[0].style) > 0 && m2.lampa[0].w > 0 && m2.lampa[0].h > 0, JSON.stringify(m2.lampa[0]));
        assert.strictEqual(m2.lampa[0].pos, 'absolute');
    });
    check('плагин свои отметки не дублирует; «Sources»: «passed to Lampa. Lampa draws the timeline marks»', () => {
        assert.strictEqual(m2.own.length, 0, JSON.stringify(m2.own));
        assert.ok(/passed to Lampa\. Lampa draws the timeline marks$/.test(d2), d2);
        assert.ok(env.pluginLogs().some((l) => /Timeline marks: lampa/.test(l)), env.pluginLogs().slice(-10).join(' | '));
    });
    await env.ev(() => Lampa.PlayerVideo.to(440));
    await env.wait(2500);
    const btn = await env.ev(() => { const b = document.querySelector('.skip-intro-button'); return b ? b.classList.contains('visible') : false; });
    check('в заставке своей кнопки нет (пропуском занимается Lampa)', () => assert.strictEqual(btn, false));

    // сборка Lampa без стилей сегментов шкалы: отметки Lampa остаются в DOM, но не видны
    const removed = await env.ev(() => {
        let n = 0;
        Array.from(document.styleSheets).forEach((sh) => {
            let rules = null;
            try { rules = sh.cssRules; } catch (e) { return; }
            for (let i = rules.length - 1; i >= 0; i--) {
                if (rules[i].selectorText && rules[i].selectorText.indexOf('player-panel__timeline-segment') !== -1) { sh.deleteRule(i); n++; }
            }
        });
        window.__SKIP_INTRO_TEST__.Controller._drawMarks(true);
        return n;
    });
    const d3 = await describe(), m3 = await marks();
    console.log('without Lampa segment CSS (' + removed + ' rules removed): ' + d3 + '\nmarks: ' + JSON.stringify(m3));
    check('без стилей сегментов отметка Lampa не видна (position static), плагин рисует свою — «Timeline marks: 1»', () => {
        assert.ok(removed >= 3, String(removed));
        assert.strictEqual(m3.lampa.length, 1);
        assert.strictEqual(m3.lampa[0].pos, 'static');
        assert.strictEqual(m3.own.length, 1, JSON.stringify(m3.own));
        assert.ok(m3.own[0].pos === 'absolute' && m3.own[0].w > 0 && m3.own[0].h > 0, JSON.stringify(m3.own[0]));
        assert.ok(Math.abs(m3.own[0].w - m2.lampa[0].w) < 1, m3.own[0].w + ' vs ' + m2.lampa[0].w);
        assert.ok(/passed to Lampa\. Timeline marks: 1$/.test(d3), d3);
    });
    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    console.log('plugin logs:\n' + env.pluginLogs().slice(0, 40).join('\n'));
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) { console.log(global.__env.logs.slice(-60).join('\n')); } process.exit(2); });
