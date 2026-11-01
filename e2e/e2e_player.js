// Сценарий в настоящей Lampa 3.4.4 (веб-сборка yumata/lampa) в Chromium, внешняя сеть — заглушки.
// Проверяем: загрузку плагинов Lampa, таймкоды из TheIntroDB, CORS IntroDB в настоящем браузере,
// кнопку и OK через настоящий Keypad, метки на шкале, «Следующая серия» через PlayerPanel 'to_end',
// приглушение кнопки в HDR по событию «adaptive_subs» (его шлёт плагин Adaptive Subtitles; здесь — имитация).
const { open, BASE } = require('./lib');
const PKG = require('../package.json');
const assert = require('assert');
const GOT = { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8, source: 'tmdb',
    genre_ids: [10765, 18, 10759], origin_country: ['US'], original_language: 'en',
    seasons: [{ season_number: 1, episode_count: 10, air_date: '2011-04-17' }] };
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({
        storage: { skip_intro_button_timeout: '0' },
        mocks: [
            { match: 'api.theintrodb.org/v4/media', reply: (req) => {
                const ep = new URL(req.url()).searchParams.get('episode');
                if (ep === '1') return { body: { tmdb_id: 1399, type: 'tv', group_duration_ms: 3700000, intro: [{ start_ms: 437000, end_ms: 531000, confidence: 0.9, submission_count: 5 }], credits: [{ start_ms: 3631500, end_ms: null, confidence: 0.9, submission_count: 4 }] }, delay: 100 };
                return { status: 404, body: { error: 'No submissions', code: 'no_submissions' } };
            } },
            { match: 'api.introdb.app/segments', reply: { body: { intro: { start_sec: 437, end_sec: 531, confidence: 1, submission_count: 2 }, recap: null, outro: null, post_credits: null, no_intro: false, no_recap: true, no_outro: false }, cors: 'https://introdb.app' } },
            { match: 'introhater.com/api/segments/', reply: { body: [] } },
            { match: 'tv/1399/external_ids', reply: { body: { id: 1399, imdb_id: 'tt0944947', tvdb_id: 121361 } } }
        ]
    });
    global.__env = env;
    assert.ok(await env.ev(() => !!(window.__SKIP_INTRO_TEST__ && window.__SKIP_INTRO_TEST__.Controller)), 'тестовый хук autoskip не заполнен');
    check('Lampa готова, плагин инициализирован (версия из package.json)', () => {
        assert.ok(env.ready);
        assert.ok(env.pluginLogs().some((l) => l.includes('[SkipIntro]] Plugin v' + PKG.version + ' initialized')), env.pluginLogs().join(' | '));
    });
    // запуск серии с плейлистом, как онлайн-плагин
    await env.ev(({ BASE, GOT }) => {
        const list = [
            { title: 'Game.of.Thrones.S01E01.2160p.HDR.webm', season: 1, episode: 1, url: BASE + 'video/got_s01e01.webm', card: GOT },
            { title: 'Game.of.Thrones.S01E02.2160p.HDR.webm', season: 1, episode: 2, url: BASE + 'video/got_s01e02.webm', card: GOT }
        ];
        Lampa.Player.play(list[0]);
        Lampa.Player.playlist(list);
    }, { BASE, GOT });
    await env.wait(4000);
    // как Adaptive Subtitles при HDR-видео: событие в Lampa.Listener (формат события — README, «Integration»)
    await env.ev(() => Lampa.Listener.send('adaptive_subs', { type: 'profile', profile: 'hdr', kind: 'hdr', brightness: 0.48, source: 'name' }));
    const st1 = await env.ev(() => {
        const v = document.querySelector('video');
        return { dur: v && v.duration, t: v && v.currentTime, paused: v && v.paused, opened: Lampa.Player.opened(), hdr: window.__SKIP_INTRO_TEST__.Hdr.on };
    });
    check('видео открыто в плеере Lampa, длина 3700 с', () => { assert.ok(st1.opened); assert.strictEqual(Math.round(st1.dur), 3700); });
    check('событие «adaptive_subs» (HDR) принято через настоящий Lampa.Listener', () => assert.strictEqual(st1.hdr, true));
    check('запросы: TheIntroDB с длиной, IntroDB и IntroHater по imdb из TMDB Lampa', () => {
        assert.ok(env.mocked.some((m) => /theintrodb\.org\/v4\/media\?tmdb_id=1399&season=1&episode=1&details=true&duration_ms=3700000/.test(m)), env.mocked.join(' | '));
        assert.ok(env.mocked.some((m) => m.includes('api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1')));
        assert.ok(env.mocked.some((m) => m.includes('introhater.com/api/segments/tt0944947:1:1')));
    });
    const d1 = await env.ev(() => window.__SKIP_INTRO_TEST__.Controller.describe());
    check('IntroDB в настоящем браузере заблокирован CORS (ответ только для https://introdb.app)', () => {
        assert.ok(env.mocked.some((m) => m.includes('api.introdb.app/segments')), 'запрос к IntroDB был');
        assert.ok(/(^|[^e])IntroDB: нет ответа \(возможно, CORS или нет сети\)/.test(d1), d1);
    });
    check('для не-аниме (жанры TMDB без 16) Aniskip/ARM не запрашиваются', () => {
        assert.ok(!env.external['arm.haglund.dev'] && !env.mocked.some((m) => m.includes('arm.haglund.dev')), JSON.stringify(env.external));
        assert.ok(!/Aniskip:/.test(d1), d1);
    });
    check('сегменты: заставка 437–531 и титры до конца (TheIntroDB)', () => assert.ok(/Заставка 7:17–8:51 \(TheIntroDB/.test(d1) && /Титры 1:00:3[12]–(конец|1:01:40) \(TheIntroDB/.test(d1), d1));
    const marks = await env.ev(() => Array.from(document.querySelectorAll('.player-panel__timeline .skip-intro-mark')).map((m) => m.className + ' ' + m.style.left + ' ' + m.style.width));
    check('метки на настоящей шкале Lampa', () => { assert.strictEqual(marks.length, 2, JSON.stringify(marks)); assert.ok(marks[0].includes('11.81')); });
    // перемотка к заставке настоящим PlayerVideo.to
    await env.ev(() => Lampa.PlayerVideo.to(430));
    await env.wait(3500);
    await env.shot('e2e_warn');
    const warn = await env.ev(() => { const w = document.querySelector('.skip-intro-warn'); return w ? { text: w.textContent, vis: w.classList.contains('visible') } : null; });
    check('предупреждение «Заставка через N с»', () => assert.ok(warn && warn.vis && /^Заставка через \d с$/.test(warn.text), JSON.stringify(warn)));
    await env.wait(4500);
    await env.shot('e2e_button');
    const btn = await env.ev(() => { const b = document.querySelector('.skip-intro-button'); return b ? { vis: b.classList.contains('visible'), text: b.textContent, filter: b.style.filter, t: document.querySelector('video').currentTime } : null; });
    check('кнопка «Пропустить заставку» видна, приглушена в HDR (brightness 0.48 + 0.15)', () => { assert.ok(btn && btn.vis, JSON.stringify(btn)); assert.ok(btn.text.includes('Пропустить заставку')); assert.strictEqual(btn.filter, 'brightness(0.63)'); });
    await env.page.keyboard.press('Enter');
    await env.wait(1500);
    await env.shot('e2e_after_enter');
    const after = await env.ev(() => { const v = document.querySelector('video'); return { t: v ? v.currentTime : null, btn: !!document.querySelector('.skip-intro-button.visible'), paused: v ? v.paused : null, opened: Lampa.Player.opened(), body: document.body.className }; });
    console.log('after Enter: ' + JSON.stringify(after));
    check('OK (Enter) через настоящий Keypad — перемотка на 531 с, плеер не поставлен на паузу', () => { assert.ok(after.t >= 531 && after.t < 536, String(after.t)); assert.strictEqual(after.btn, false); assert.strictEqual(after.paused, false); });
    // титры у конца — «Следующая серия» через PlayerPanel 'to_end'
    await env.ev(() => Lampa.PlayerVideo.to(3629));
    await env.wait(4500);
    await env.shot('e2e_next');
    const nb = await env.ev(() => { const b = document.querySelector('.skip-intro-button'); return b ? { vis: b.classList.contains('visible'), text: b.textContent } : null; });
    check('у титров кнопка «Следующая серия» с номером и названием', () => { assert.ok(nb && nb.vis, JSON.stringify(nb)); assert.ok(nb.text.includes('Следующая серия') && nb.text.includes('S01E02'), nb.text); });
    await env.page.keyboard.press('Enter');
    await env.wait(4000);
    const n2 = await env.ev(() => ({ url: (document.querySelector('video') || {}).src || '', pd: Lampa.Player.playdata() && Lampa.Player.playdata().episode, ctx: window.__SKIP_INTRO_TEST__.Controller._ctx && window.__SKIP_INTRO_TEST__.Controller._ctx.key }));
    check('Lampa переключила на 2-ю серию (to_end -> Playlist.next), плагин перешёл на S1E2', () => { assert.ok(n2.url.endsWith('got_s01e02.webm'), n2.url); assert.strictEqual(n2.ctx, 'skip3_1399_s1_e2'); });
    const d2 = await env.ev(() => window.__SKIP_INTRO_TEST__.Controller.describe());
    const st2 = await env.ev(() => ({ dur: (document.querySelector('video') || {}).duration, hdr: window.__SKIP_INTRO_TEST__.Hdr.on }));
    console.log('S1E2 describe: ' + d2);
    console.log('S1E2 state: ' + JSON.stringify(st2));
    check('2-я серия: длина 3400 с, TheIntroDB запрошен с duration_ms=3400000, состояние HDR сохранено', () => {
        assert.strictEqual(Math.round(st2.dur), 3400);
        assert.ok(env.mocked.some((m) => /theintrodb\.org\/v4\/media\?tmdb_id=1399&season=1&episode=2&details=true&duration_ms=3400000/.test(m)), env.mocked.join(' | '));
        assert.strictEqual(st2.hdr, true);
    });
    console.log('mocked:\n' + env.mocked.join('\n'));
    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    console.log('plugin logs:\n' + env.pluginLogs().slice(0, 40).join('\n'));
    await env.shot('e2e_end');
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) { console.log(global.__env.logs.slice(-80).join('\n')); } process.exit(2); });
