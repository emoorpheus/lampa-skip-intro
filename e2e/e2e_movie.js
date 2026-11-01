// Фильм в настоящей Lampa 3.4.4: TheIntroDB без сезона, IntroDB is_movie (CORS), «Пропустить титры» -> конец титров (не конец файла),
// приглушение кнопки по событиям «adaptive_subs» (HDR/SDR; их шлёт плагин Adaptive Subtitles — здесь имитация).
const { open, BASE } = require('./lib');
const assert = require('assert');
const MOVIE = { id: 27205, title: 'Начало', original_title: 'Inception', release_date: '2010-07-15', genre_ids: [28, 878, 12], source: 'tmdb' };
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({
        storage: { skip_intro_button_timeout: '0' },
        mocks: [
            { match: 'api.theintrodb.org/v4/media', reply: (req) => {
                const q = new URL(req.url()).searchParams;
                if (q.get('tmdb_id') === '27205' && !q.has('season')) return { body: { tmdb_id: 27205, type: 'movie', group_duration_ms: 3700000, credits: [{ start_ms: 3400000, end_ms: 3600000, confidence: 0.9, submission_count: 3 }] } };
                return { status: 404, body: { error: 'Media not found', code: 'media_not_found' } };
            } },
            { match: 'movie/27205/external_ids', reply: { body: { id: 27205, imdb_id: 'tt1375666' } } },
            { match: 'api.introdb.app/segments', reply: { body: { outro: { start_sec: 3400, end_sec: 3600 } }, cors: 'https://introdb.app' } }
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
    const profile = (p) => env.ev((p) => Lampa.Listener.send('adaptive_subs', p), p);
    const state = () => env.ev(() => ({ hdrOn: window.__SKIP_INTRO_TEST__.Hdr.on, brightness: window.__SKIP_INTRO_TEST__.Hdr.brightness }));
    await env.ev(({ BASE, MOVIE }) => Lampa.Player.play({ title: 'Inception.2010.2160p.WEB-DL.DV.HDR.webm', url: BASE + 'video/got_s01e01.webm', card: MOVIE }), { BASE, MOVIE });
    await env.wait(4500);
    await profile({ type: 'profile', profile: 'hdr', kind: 'dv', brightness: 0.4, source: 'name' });
    const d = await env.ev(() => window.__SKIP_INTRO_TEST__.Controller.describe());
    console.log('describe: ' + d + '\nmocked:\n' + env.mocked.join('\n'));
    check('фильм: TheIntroDB без сезона и серии, IntroDB с is_movie=true, IntroHater/ARM не запрашиваются', () => {
        assert.ok(env.mocked.some((m) => m === 'GET https://api.theintrodb.org/v4/media?tmdb_id=27205&details=true&duration_ms=3700000'), env.mocked.join(' | '));
        assert.ok(env.mocked.some((m) => m.includes('api.introdb.app/segments?imdb_id=tt1375666') && m.includes('is_movie=true')), env.mocked.join(' | '));
        assert.ok(!env.mocked.some((m) => m.includes('introhater')) && !env.external['introhater.com'] && !env.external['arm.haglund.dev']);
    });
    check('титры фильма 56:40–1:00:00 (TheIntroDB); IntroDB заблокирован CORS', () => {
        assert.ok(/^Титры 56:40–1:00:00 \(TheIntroDB\)/.test(d), d);
        assert.ok(/IntroDB: нет ответа/.test(d.replace('TheIntroDB:', '')), d);
    });
    await env.ev(() => Lampa.PlayerVideo.to(3396));
    await env.wait(5000);
    const btn = await env.ev(() => { const b = document.querySelector('.skip-intro-button'); return b ? { vis: b.classList.contains('visible'), text: b.textContent, filter: b.style.filter } : null; });
    check('у титров фильма — «Пропустить титры» (не «Следующая серия»), приглушена в HDR (Dolby Vision, 0.4 + 0.15)', () => {
        assert.ok(btn && btn.vis && btn.text.includes('Пропустить титры') && !btn.text.includes('Следующая'), JSON.stringify(btn));
        assert.strictEqual(btn.filter, 'brightness(0.55)');
    });
    await press(13);
    await env.wait(1500);
    const after = await env.ev(() => ({ t: document.querySelector('video').currentTime, opened: Lampa.Player.opened(), paused: document.querySelector('video').paused }));
    check('OK — перемотка на конец титров (3600 с), остаток фильма не теряется', () => {
        assert.ok(after.opened && after.t >= 3600 && after.t < 3606 && !after.paused, JSON.stringify(after));
    });
    await profile({ type: 'profile', profile: 'sdr', kind: 'sdr', brightness: 1, source: 'manual' });
    const s1 = await state();
    check('событие SDR (например, выбор вручную в Adaptive Subtitles) — приглушение снято', () => assert.strictEqual(s1.hdrOn, false));
    await profile({ type: 'profile', profile: 'hdr', kind: 'hdr10', brightness: 0.48, source: 'override' });
    const s2 = await state();
    check('снова HDR — приглушение включено, яркость по событию (0.48 + 0.15)', () => { assert.strictEqual(s2.hdrOn, true); assert.strictEqual(s2.brightness, 0.63); });
    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    console.log(env.pluginLogs().join('\n'));
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) console.log(global.__env.logs.filter((l) => /PAGEERROR|SkipIntro/.test(l)).join('\n')); process.exit(2); });
