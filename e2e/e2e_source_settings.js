// Таймкоды от источника видео (data.segments) и настройки плагина в настоящей Lampa 3.4.4 (длина видео известна).
// Режим сериала «Выкл»: не пропускает никто (Lampa получает пустые сегменты, плагин в ожидании). Выключенный тип (заставка):
// не пропускается, остальные типы работают. Реклама (ad): кнопка «Skip ad». Фильмы выключены в настройках плагина:
// таймкоды остаются у Lampa и её встроенный пропуск работает как раньше. Длина видео неизвестна (как на Android TV), автопропуск:
// заставку перематывает плагин.
const { open, BASE } = require('./lib');
const assert = require('assert');
const GOT = { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8, source: 'tmdb',
    genre_ids: [10765, 18, 10759], origin_country: ['US'], original_language: 'en',
    seasons: [{ season_number: 1, episode_count: 10, air_date: '2011-04-17' }] };
const MOVIE = { id: 27205, title: 'Inception', original_title: 'Inception', release_date: '2010-07-15', genre_ids: [28, 878, 12], source: 'tmdb' };
const SEGS = { skip: [{ start: 0, end: 30 }, { start: 437, end: 531 }, { start: 3640, end: 3700 }], ad: [] };
const SEGS_AD = { skip: [], ad: [{ start: 0, end: 20 }] };
const SEGS_MOVIE = { skip: [{ start: 0, end: 30 }], ad: [] };
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({ storage: { language: 'en', skip_intro_button_timeout: '0', player_segments_skip: 'auto' } });
    global.__env = env;
    assert.ok(await env.ev(() => !!(window.__SKIP_INTRO_TEST__ && window.__SKIP_INTRO_TEST__.Controller)), 'тестовый хук autoskip не заполнен');
    const play = (item) => env.ev(({ BASE, item }) => {
        const list = [
            Object.assign({ url: BASE + 'video/got_s01e01.webm' }, item),
            item.card.title ? null : { title: 'Game.of.Thrones.S01E02.webm', season: 1, episode: 2, url: BASE + 'video/got_s01e02.webm', card: item.card }
        ].filter(Boolean);
        Lampa.Player.play(list[0]);
        Lampa.Player.playlist(list);
    }, { BASE, item });
    const episode = (segs) => ({ title: 'Game.of.Thrones.S01E01.webm', season: 1, episode: 1, card: GOT, segments: JSON.parse(JSON.stringify(segs)) });
    const state = () => env.ev(() => {
        const b = document.querySelector('.skip-intro-button'), v = Lampa.PlayerVideo.video(), pd = Lampa.Player.playdata() || {};
        const ls = document.querySelector('.player-skip');
        return { btn: b && b.classList.contains('visible') ? b.textContent : '', lampaBtn: !!(ls && !ls.classList.contains('hide')),
            time: Math.round(v.currentTime * 10) / 10, url: v.src || '', segs: pd.segments ? JSON.stringify(pd.segments) : null,
            lampaMarks: document.querySelectorAll('.player-panel__timeline-segments .player-panel__timeline-segment').length,
            ownMarks: Array.from(document.querySelectorAll('.player-panel__timeline .skip-intro-mark')).map((m) => m.className.replace(/.*skip-intro-mark--/, '')),
            idle: window.__SKIP_INTRO_TEST__.Controller._idle || null };
    });
    const logsFrom = (n) => env.pluginLogs().slice(n);
    const TAKE = /Video source segments are skipped by the plugin settings \(Lampa got none\)/;
    const close = async () => { await env.ev(() => Lampa.Player.close()); await env.wait(1000); };

    // 1) режим сериала «Выкл», автопропуск включён: Lampa получила пустые сегменты, плагин в ожидании — заставка не пропущена
    await env.ev(() => { window.__SKIP_INTRO_TEST__.Series.set(1399, { mode: 'off' }); Lampa.Storage.set('skip_intro_auto', 'true'); });
    let n = env.pluginLogs().length;
    await play(episode(SEGS));
    await env.wait(3000);
    const s1 = await state(), l1 = logsFrom(n);
    console.log('series off: ' + JSON.stringify(s1));
    check('режим сериала «Выкл»: журнал «Idle: series», сегменты у плагина, у Lampa ни отметок, ни кнопки', () => {
        assert.ok(l1.some((l) => TAKE.test(l)), l1.join(' | '));
        assert.ok(l1.some((l) => /Idle: series/.test(l)), l1.join(' | '));
        assert.strictEqual(s1.idle, 'series');
        assert.strictEqual(s1.lampaMarks, 0);
        assert.strictEqual(s1.lampaBtn, false);
    });
    check('режим сериала «Выкл»: заставка 0:00–0:30 не пропущена ни плагином, ни Lampa; кнопки плагина нет; data.segments прежние', () => {
        assert.ok(s1.time > 1 && s1.time < 10, String(s1.time));
        assert.strictEqual(s1.btn, '');
        assert.strictEqual(s1.segs, JSON.stringify(SEGS));
    });
    await close();
    await env.ev(() => window.__SKIP_INTRO_TEST__.Series.set(1399, { mode: 'default' }));

    // 2) тип «Заставка» выключен, автопропуск включён: заставка не пропущена, титры у конца — следующая серия
    await env.ev(() => Lampa.Storage.set('skip_intro_type_intro', 'false'));
    n = env.pluginLogs().length;
    await play(episode(SEGS));
    await env.wait(3000);
    const s2 = await state();
    console.log('intro type off: ' + JSON.stringify(s2));
    check('тип «Заставка» выключен: заставка 0:00–0:30 не пропущена, кнопки нет, у Lampa отметок нет', () => {
        assert.ok(s2.time > 1 && s2.time < 10, String(s2.time));
        assert.strictEqual(s2.btn, '');
        assert.strictEqual(s2.lampaMarks, 0);
        assert.ok(!logsFrom(n).some((l) => /Skipped intro/.test(l)), logsFrom(n).join(' | '));
    });
    await env.ev(() => Lampa.PlayerVideo.to(3636));
    await env.wait(7000);
    const s2b = await state();
    check('тип «Заставка» выключен: титры источника у конца файла пропущены автоматически -> S01E02', () => {
        assert.ok(logsFrom(n).some((l) => /Skip credits at the end of the episode -> to_end \(auto\)/.test(l)), logsFrom(n).slice(-6).join(' | '));
        assert.ok(s2b.url.endsWith('got_s01e02.webm'), s2b.url);
    });
    await close();
    await env.ev(() => { Lampa.Storage.set('skip_intro_type_intro', 'true'); Lampa.Storage.set('skip_intro_auto', 'false'); });

    // 3) реклама от источника (ad), автопропуск выключен: кнопка «Skip ad», OK — перемотка на 0:20
    n = env.pluginLogs().length;
    await play(episode(SEGS_AD));
    await env.wait(1500);
    const s3 = await state();
    console.log('ad: ' + JSON.stringify(s3));
    check('реклама источника: кнопка плагина «Skip ad», отметка плагина типа ad, у Lampa ни отметок, ни кнопки', () => {
        assert.ok(/Skip ad/.test(s3.btn), JSON.stringify(s3));
        assert.deepStrictEqual(s3.ownMarks, ['ad'], JSON.stringify(s3.ownMarks));
        assert.strictEqual(s3.lampaMarks, 0);
        assert.strictEqual(s3.lampaBtn, false);
    });
    await env.page.keyboard.press('Enter');
    await env.wait(1200);
    const s3b = await state();
    check('реклама источника: OK (Enter) — перемотка на 0:20, кнопка убрана, журнал «Skipped ad to 20 (manual)»', () => {
        assert.ok(s3b.time >= 20 && s3b.time < 24, String(s3b.time));
        assert.strictEqual(s3b.btn, '');
        assert.ok(logsFrom(n).some((l) => /Skipped ad to 20 \(manual\)/.test(l)), logsFrom(n).slice(-5).join(' | '));
    });
    await close();

    // 4) фильмы выключены в настройках плагина: таймкоды фильма остаются у Lampa, её автопропуск (player_segments_skip = auto) работает
    await env.ev(() => Lampa.Storage.set('skip_intro_movies', 'false'));
    n = env.pluginLogs().length;
    await play({ title: 'Inception.2010.webm', card: MOVIE, segments: JSON.parse(JSON.stringify(SEGS_MOVIE)) });
    await env.wait(4000);
    const s4 = await state(), l4 = logsFrom(n);
    console.log('movies off: ' + JSON.stringify(s4));
    check('фильмы выключены: плагин таймкоды не берёт (журнал без «Video source segments…»), у Lampa 1 отметка', () => {
        assert.ok(!l4.some((l) => TAKE.test(l)), l4.join(' | '));
        assert.strictEqual(s4.lampaMarks, 1);
        assert.deepStrictEqual(s4.ownMarks, []);
    });
    check('фильмы выключены: встроенный автопропуск Lampa перемотал 0:00–0:30', () => assert.ok(s4.time >= 30 && s4.time < 40, String(s4.time)));
    await close();
    await env.ev(() => Lampa.Storage.set('skip_intro_movies', 'true'));

    // 5) как на Android TV: длина видео неизвестна (video.duration = NaN), автопропуск включён — заставку перематывает плагин
    await env.ev(() => {
        const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
        window.__hideDuration = true;
        Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return window.__hideDuration ? NaN : d.get.call(this); } });
        Lampa.Storage.set('skip_intro_auto', 'true');
    });
    n = env.pluginLogs().length;
    const errs5 = env.logs.filter((l) => /send error/.test(l)).length;
    await play(episode(SEGS));
    await env.wait(2500);
    const s5 = await state(), dur5 = await env.ev(() => Lampa.PlayerVideo.video().duration);
    console.log('auto, duration NaN: ' + JSON.stringify(s5));
    check('длина неизвестна (NaN), автопропуск: заставка 0:00–0:30 перемотана плагином без кнопки, Lampa не пробовала (нет «send error»)', () => {
        assert.ok(isNaN(dur5), String(dur5));
        assert.ok(s5.time >= 30 && s5.time < 36, String(s5.time));
        assert.ok(logsFrom(n).some((l) => /Skipped intro to 30 \(auto\)/.test(l)), logsFrom(n).join(' | '));
        assert.strictEqual(env.logs.filter((l) => /send error/.test(l)).length, errs5);
        assert.strictEqual(s5.lampaMarks, 0);
    });
    await close();
    await env.ev(() => { window.__hideDuration = false; Lampa.Storage.set('skip_intro_auto', 'false'); });

    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    check('внешняя сеть не тронута: запросы к Aniskip не уходили', () =>
        assert.ok(!Object.keys(env.external).some((h) => /aniskip/.test(h)) && !env.mocked.some((u) => /aniskip/.test(u)), JSON.stringify(env.external)));
    console.log(results.join('\n'));
    console.log('plugin logs:\n' + env.pluginLogs().slice(0, 40).join('\n'));
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) { console.log(global.__env.logs.slice(-60).join('\n')); } process.exit(2); });
