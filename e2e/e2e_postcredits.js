// Фильм с ошибкой в базе, в настоящей Lampa 3.4.4: IntroDB через поле «прокси» (в браузере напрямую — CORS),
// живой ответ IntroDB для Iron Man (tt0371746, 2026-11-01): «intro» 7512–7545 внутри титров 7038–7540 и сцены после титров 7540–7580.
// Ожидание: «заставка» в конце отброшена, «Пропустить титры» -> начало сцены после титров, на сцене кнопок нет.
const { open, BASE } = require('./lib');
const assert = require('assert');
const FIX = require('../tests/fixtures/introdb_ironman.json');
const MOVIE = { id: 1726, title: 'Железный человек', original_title: 'Iron Man', release_date: '2008-04-30', genre_ids: [28, 878, 12], source: 'tmdb' };
const PROXY = 'https://proxy.example/{url}';
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({
        storage: { skip_intro_introdb_proxy: PROXY, skip_intro_button_timeout: '0' },
        mocks: [
            { match: 'https://proxy.example/https://api.introdb.app/segments', reply: { body: FIX } },
            { match: 'api.introdb.app/segments', reply: { body: FIX, cors: 'https://introdb.app' } },
            { match: 'api.theintrodb.org/v4/media', reply: { status: 404, body: { error: 'Media not found', code: 'media_not_found' } } },
            { match: 'movie/1726/external_ids', reply: { body: { id: 1726, imdb_id: 'tt0371746' } } }
        ]
    });
    global.__env = env;
    const press = (code) => env.ev((code) => {
        for (const type of ['keydown', 'keyup']) {
            const e = new KeyboardEvent(type, { bubbles: true, cancelable: true });
            Object.defineProperty(e, 'keyCode', { get: () => code });
            Object.defineProperty(e, 'which', { get: () => code });
            window.dispatchEvent(e);
        }
    }, code);
    const btn = () => env.ev(() => { const b = document.querySelector('.skip-intro-button'); return b ? { vis: b.classList.contains('visible'), text: b.textContent } : null; });
    const vid = () => env.ev(() => { const v = document.querySelector('video'); return { t: v.currentTime, dur: v.duration, paused: v.paused, opened: Lampa.Player.opened() }; });
    await env.ev(({ BASE, MOVIE }) => Lampa.Player.play({ title: 'Iron.Man.2008.1080p.BluRay.webm', url: BASE + 'video/movie_7600.webm', card: MOVIE }), { BASE, MOVIE });
    await env.wait(4500);
    const d = await env.ev(() => window.__SKIP_INTRO_TEST__.Controller.describe());
    const marks = await env.ev(() => Array.prototype.map.call(document.querySelectorAll('.skip-intro-mark'), (m) => m.className));
    const v0 = await vid();
    console.log('describe: ' + d + '\nmarks: ' + JSON.stringify(marks) + '\nvideo: ' + JSON.stringify(v0) + '\nmocked:\n' + env.mocked.join('\n'));
    check('видео 7600 с открыто; IntroDB запрошен через прокси, напрямую — нет', () => {
        assert.ok(v0.opened); assert.strictEqual(Math.round(v0.dur), 7600);
        assert.ok(env.mocked.includes('GET https://proxy.example/https://api.introdb.app/segments?imdb_id=tt0371746&is_movie=true'), env.mocked.join(' | '));
        assert.ok(!env.mocked.some((m) => m.startsWith('GET https://api.introdb.app/')), env.mocked.join(' | '));
    });
    check('«заставка» 7512–7545 отброшена: в описании и на шкале только титры (IntroDB)', () => {
        assert.ok(/^Титры 1:57:18–2:05:40 \(IntroDB\)/.test(d), d);
        assert.ok(!/Заставка/.test(d), d);
        assert.strictEqual(marks.length, 1, JSON.stringify(marks));
        assert.ok(/skip-intro-mark--credits/.test(marks[0]), marks[0]);
    });
    await env.ev(() => Lampa.PlayerVideo.to(7036));
    await env.wait(4500);
    const b1 = await btn();
    check('у титров — «Пропустить титры» (не конец файла: после титров есть сцена)', () => {
        assert.ok(b1 && b1.vis && b1.text.includes('Пропустить титры'), JSON.stringify(b1));
    });
    await press(13);
    await env.wait(1500);
    const v1 = await vid();
    check('OK — перемотка к началу сцены после титров (7540 с), фильм продолжается', () => {
        assert.ok(v1.opened && v1.t >= 7540 && v1.t < 7546 && !v1.paused, JSON.stringify(v1));
    });
    await env.wait(4000);
    const b2 = await btn(), v2 = await vid();
    check('на сцене после титров нет кнопки «Пропустить заставку», перемотки дальше не было', () => {
        assert.ok(!b2 || !b2.vis, JSON.stringify(b2));
        assert.ok(v2.t >= v1.t && v2.t < v1.t + 8, JSON.stringify([v1, v2]));
    });
    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    console.log(env.pluginLogs().join('\n'));
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) console.log(global.__env.logs.filter((l) => /PAGEERROR|SkipIntro/.test(l)).join('\n')); process.exit(2); });
