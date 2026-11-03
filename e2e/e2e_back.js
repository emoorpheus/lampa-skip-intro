// «Назад» во время обратного отсчёта (умный режим), как в Android-приложении Lampa: приложение не передаёт клавишу странице,
// а вызывает window.history.back (lampa-app, MainActivity.kt, onBackPressedDispatcher). Модель: событие popstate.
// Lampa на popstate вызывает функцию из Activity.call — обычно Controller.back, и плеер закрывается (app.min.js L52070-52081).
// A) popstate во время отсчёта: автопропуск отменён, плеер открыт, заставка идёт.
// B) следующий popstate: плеер закрывается, как обычно в Lampa.
// C) отсчёт закончился (автопропуск), потом popstate: плеер закрывается.
// D) клавиша Escape (27) во время отсчёта (webOS, браузер): отмена, плеер открыт.
const { open, BASE } = require('./lib');
const assert = require('assert');
const GOT = { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8, source: 'tmdb',
    genre_ids: [10765, 18, 10759], origin_country: ['US'], original_language: 'en',
    seasons: [{ season_number: 1, episode_count: 10, air_date: '2011-04-17' }] };
const SEGS = { skip: [{ start: 0, end: 30 }, { start: 3640, end: 3700 }], ad: [] };
const SMART = JSON.stringify({ '1399_intro': true });
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({ storage: { language: 'en', skip_intro_button_timeout: '0', player_segments_skip: 'auto', skip_intro_auto: 'false' } });
    global.__env = env;
    assert.ok(await env.ev(() => !!(window.__SKIP_INTRO_TEST__ && window.__SKIP_INTRO_TEST__.Controller)), 'тестовый хук autoskip не заполнен');
    const play = () => env.ev(({ BASE, GOT, SEGS, SMART }) => {
        Lampa.Storage.set('skip_intro_smart', SMART);
        const list = [
            { title: 'Game.of.Thrones.S01E01.webm', season: 1, episode: 1, url: BASE + 'video/got_s01e01.webm', card: GOT, segments: JSON.parse(JSON.stringify(SEGS)) },
            { title: 'Game.of.Thrones.S01E02.webm', season: 1, episode: 2, url: BASE + 'video/got_s01e02.webm', card: GOT }
        ];
        Lampa.Player.play(list[0]);
        Lampa.Player.playlist(list);
    }, { BASE, GOT, SEGS, SMART });
    const countdown = () => env.ev(() => !!document.querySelector('.skip-intro-button.countdown.visible'));
    const waitCountdown = async () => { for (let i = 0; i < 30; i++) { if (await countdown()) return true; await env.wait(100); } return false; };
    const opened = () => env.ev(() => !!Lampa.Player.opened());
    const time = () => env.ev(() => Math.round(Lampa.PlayerVideo.video().currentTime * 10) / 10);
    const back = () => env.ev(() => window.dispatchEvent(new PopStateEvent('popstate')));
    const logsFrom = (n) => env.pluginLogs().slice(n);
    const close = async () => { if (await opened()) await env.ev(() => Lampa.Player.close()); await env.wait(1000); };

    // A, B
    let n = env.pluginLogs().length;
    await play();
    const cdA = await waitCountdown();
    await env.wait(500);
    await back();
    await env.wait(300);
    const openA = await opened(), cdA2 = await countdown();
    await env.wait(5000);
    const tA = await time(), logA = logsFrom(n);
    console.log('A: countdown ' + cdA + ', opened ' + openA + ', time ' + tA + '\n' + logA.join('\n'));
    check('A) отсчёт был на экране (умный режим)', () => assert.ok(cdA));
    check('A) «Назад» (popstate) во время отсчёта: плеер открыт, отсчёт убран, «Auto-skip cancelled by user»', () => {
        assert.strictEqual(openA, true);
        assert.strictEqual(cdA2, false);
        assert.ok(logA.some((l) => /Auto-skip cancelled by user/.test(l)), logA.join(' | '));
    });
    check('A) заставка не пропущена: через 5 с позиция до 0:30, «Skipped» нет', () => {
        assert.ok(tA > 3 && tA < 30, String(tA));
        assert.ok(!logA.some((l) => /Skipped intro/.test(l)), logA.join(' | '));
    });
    await back();
    await env.wait(1000);
    const openB = await opened();
    check('B) следующий «Назад» (popstate) закрывает плеер, как в Lampa', () => assert.strictEqual(openB, false));
    await close();

    // C
    n = env.pluginLogs().length;
    await play();
    const cdC = await waitCountdown();
    await env.wait(5000);
    const tC = await time(), logC = logsFrom(n);
    await back();
    await env.wait(1000);
    const openC = await opened();
    console.log('C: countdown ' + cdC + ', time ' + tC + ', opened after back ' + openC + '\n' + logC.join('\n'));
    check('C) без «Назад» отсчёт закончился автопропуском (позиция после 0:30)', () => {
        assert.ok(cdC);
        assert.ok(tC >= 30 && tC < 40, String(tC));
        assert.ok(logC.some((l) => /Skipped intro to 30 \(auto\)/.test(l)), logC.join(' | '));
    });
    check('C) после автопропуска «Назад» (popstate) закрывает плеер', () => assert.strictEqual(openC, false));
    await close();

    // D
    n = env.pluginLogs().length;
    await play();
    const cdD = await waitCountdown();
    await env.wait(500);
    await env.page.keyboard.press('Escape');
    await env.wait(1500);
    const openD = await opened(), logD = logsFrom(n);
    console.log('D: countdown ' + cdD + ', opened ' + openD + '\n' + logD.join('\n'));
    check('D) Escape (27) во время отсчёта: отмена, плеер открыт', () => {
        assert.ok(cdD);
        assert.strictEqual(openD, true);
        assert.ok(logD.some((l) => /Auto-skip cancelled by user/.test(l)), logD.join(' | '));
    });
    await close();

    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) { console.log(global.__env.logs.slice(-60).join('\n')); } process.exit(2); });
