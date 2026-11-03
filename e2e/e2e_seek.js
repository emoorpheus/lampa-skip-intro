// Перемотка в самом начале потока, как на Android TV (Tanix TX9, HLS через системный плеер): перемотка, заданная до готовности
// видео, теряется — видео идёт с начала. Модель: первые 2,5 с после запуска присваивание currentTime запоминается, но не
// выполняется (до конца окна currentTime отдаёт заданное значение, потом — настоящую позицию). Таймкоды от источника видео,
// «Всегда автопропуск» включён.
// A) readyState в окне = 1 (данных ещё нет): плагин ждёт готовности видео и перематывает один раз, успешно.
// B) readyState не помогает (сразу 4): плагин проверяет позицию и повторяет перемотку.
// C) без потерь: после удачного автопропуска пользователь перематывает назад в заставку — плагин не мешает.
const { open, BASE } = require('./lib');
const assert = require('assert');
const GOT = { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8, source: 'tmdb',
    genre_ids: [10765, 18, 10759], origin_country: ['US'], original_language: 'en',
    seasons: [{ season_number: 1, episode_count: 10, air_date: '2011-04-17' }] };
const SEGS = { skip: [{ start: 0, end: 30 }, { start: 3640, end: 3700 }], ad: [] };
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({ storage: { language: 'en', skip_intro_button_timeout: '0', player_segments_skip: 'auto', skip_intro_auto: 'true' } });
    global.__env = env;
    assert.ok(await env.ev(() => !!(window.__SKIP_INTRO_TEST__ && window.__SKIP_INTRO_TEST__.Controller)), 'тестовый хук autoskip не заполнен');
    await env.ev(() => {
        const ct = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
        const rs = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
        window.__lossy = { until: 0, lowReady: false, lost: 0 };
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true,
            get() { return Date.now() < window.__lossy.until && this.__pending !== undefined ? this.__pending : ct.get.call(this); },
            set(v) {
                if (Date.now() < window.__lossy.until) { this.__pending = v; window.__lossy.lost++; return; }
                this.__pending = undefined;
                ct.set.call(this, v);
            } });
        Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true,
            get() { return window.__lossy.lowReady && Date.now() < window.__lossy.until ? 1 : rs.get.call(this); } });
    });
    const play = (lossyMs, lowReady) => env.ev(({ BASE, GOT, SEGS, lossyMs, lowReady }) => {
        window.__lossy.until = lossyMs ? Date.now() + lossyMs : 0;
        window.__lossy.lowReady = lowReady;
        window.__lossy.lost = 0;
        const list = [
            { title: 'Game.of.Thrones.S01E01.webm', season: 1, episode: 1, url: BASE + 'video/got_s01e01.webm', card: GOT, segments: JSON.parse(JSON.stringify(SEGS)) },
            { title: 'Game.of.Thrones.S01E02.webm', season: 1, episode: 2, url: BASE + 'video/got_s01e02.webm', card: GOT }
        ];
        Lampa.Player.play(list[0]);
        Lampa.Player.playlist(list);
    }, { BASE, GOT, SEGS, lossyMs, lowReady });
    const time = () => env.ev(() => Math.round(Lampa.PlayerVideo.video().currentTime * 10) / 10);
    const lost = () => env.ev(() => window.__lossy.lost);
    const logsFrom = (n) => env.pluginLogs().slice(n);
    const close = async () => { await env.ev(() => Lampa.Player.close()); await env.wait(1000); };

    // A) данных ещё нет (readyState 1), перемотка в окне теряется
    let n = env.pluginLogs().length;
    await play(2500, true);
    await env.wait(5500);
    const tA = await time(), lA = await lost(), logA = logsFrom(n);
    console.log('A: time ' + tA + ', lost seeks ' + lA + '\n' + logA.join('\n'));
    check('A) видео ещё не готово: заставка 0:00–0:30 всё-таки пропущена (позиция после 0:30)', () => assert.ok(tA >= 30 && tA < 40, String(tA)));
    check('A) плагин дождался готовности видео: ни одна перемотка не потерялась, в журнале «Skipped intro to 30 (auto)» один раз', () => {
        assert.strictEqual(lA, 0);
        assert.strictEqual(logA.filter((l) => /Skipped intro to 30 \(auto\)/.test(l)).length, 1, logA.join(' | '));
    });
    await close();

    // B) readyState сразу 4, перемотка в окне теряется: плагин повторяет
    n = env.pluginLogs().length;
    await play(2500, false);
    await env.wait(6000);
    const tB = await time(), lB = await lost(), logB = logsFrom(n);
    console.log('B: time ' + tB + ', lost seeks ' + lB + '\n' + logB.join('\n'));
    check('B) перемотка потерялась (модель сработала)', () => assert.ok(lB >= 1, String(lB)));
    check('B) плагин заметил, что позиция в заставке, и повторил перемотку: позиция после 0:30', () => assert.ok(tB >= 30 && tB < 40, String(tB)));
    check('B) журнал: «Skip did not take effect … retrying» и «Skip worked, position 0:3…»', () => {
        assert.ok(logB.some((l) => /Skip did not take effect/.test(l) && /retrying/.test(l)), logB.join(' | '));
        assert.ok(logB.some((l) => /Skip worked, position 0:3\d/.test(l)), logB.join(' | '));
    });
    await close();

    // C) без потерь: автопропуск, затем пользователь сам возвращается в заставку — плагин не перематывает снова
    n = env.pluginLogs().length;
    await play(0, false);
    await env.wait(2500);
    const tC1 = await time();
    await env.ev(() => Lampa.PlayerVideo.to(5));
    await env.wait(3000);
    const tC2 = await time(), logC = logsFrom(n);
    console.log('C: ' + tC1 + ' -> ' + tC2 + '\n' + logC.join('\n'));
    check('C) автопропуск сработал, после ручного возврата на 0:05 плагин не мешает (позиция 0:05–0:12)', () => {
        assert.ok(tC1 >= 30 && tC1 < 36, String(tC1));
        assert.ok(tC2 >= 5 && tC2 < 12, String(tC2));
        assert.strictEqual(logC.filter((l) => /Skipped intro/.test(l)).length, 1, logC.join(' | '));
    });
    await close();

    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) { console.log(global.__env.logs.slice(-60).join('\n')); } process.exit(2); });
