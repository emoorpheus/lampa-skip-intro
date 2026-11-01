// Прокси IntroDB в настоящей Lampa 3.4.4 и настоящем Chromium (CORS проверяет сам браузер):
// Lampa (http://127.0.0.1:8123) -> proxy/introdb_proxy.py (http://127.0.0.1:8124, процесс Python) -> подставной IntroDB в server.js.
// LIVE=1 — прокси ходит в настоящий api.introdb.app (только чтение; ответы могут меняться со временем).
const { open, BASE } = require('./lib');
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const PY = process.env.PYTHON || 'python3';
const LIVE = process.env.LIVE === '1';
const PORT = 8124, PROXY = 'http://127.0.0.1:' + PORT;
const MOVIE = { id: 1726, title: 'Железный человек', original_title: 'Iron Man', release_date: '2008-04-30', genre_ids: [28, 878, 12], source: 'tmdb' };
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }
const getJson = (url) => new Promise((res, rej) => http.get(url, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => { try { res({ status: r.statusCode, json: JSON.parse(b) }); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
    if (spawnSync(PY, ['-c', 'import sys; assert sys.version_info >= (3, 7)']).status !== 0) { console.log('пропущено: нет Python 3.7+ (PYTHON=...)'); process.exit(0); }
    const penv = Object.assign({}, process.env);
    if (LIVE) delete penv.INTRODB_PROXY_UPSTREAM; else penv.INTRODB_PROXY_UPSTREAM = BASE + '__introdb';
    const proxy = spawn(PY, [path.join(__dirname, '..', 'proxy', 'introdb_proxy.py'), '--host', '127.0.0.1', '--port', String(PORT)], { env: penv, stdio: ['ignore', 'ignore', 'pipe'] });
    let plog = ''; proxy.stderr.on('data', (d) => { plog += d; });
    global.__proxy = proxy;
    let health = null;
    for (let i = 0; i < 50 && !health; i++) { try { health = await getJson(PROXY + '/health'); } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
    check('прокси запущен: /health', () => assert.ok(health && health.status === 200 && health.json.ok, plog));
    if (!LIVE) await getJson(BASE + '__introdb/__log');
    const env = await open({
        storage: { skip_intro_introdb_proxy: PROXY + '/{url}', skip_intro_button_timeout: '0' },
        live: ['127.0.0.1:' + PORT],
        mocks: [
            { match: 'api.theintrodb.org/v4/media', reply: { status: 404, body: { error: 'Media not found', code: 'media_not_found' } } },
            { match: 'movie/1726/external_ids', reply: { body: { id: 1726, imdb_id: 'tt0371746' } } }
        ]
    });
    global.__env = env;
    await env.ev(({ BASE, MOVIE }) => Lampa.Player.play({ title: 'Iron.Man.2008.1080p.BluRay.webm', url: BASE + 'video/movie_7600.webm', card: MOVIE }), { BASE, MOVIE });
    await env.wait(4500);
    const d = await env.ev(() => window.__SKIP_INTRO_TEST__.Controller.describe());
    const diag = await env.ev(() => window.__SKIP_INTRO_TEST__.Diag.text('introdb'));
    console.log('describe: ' + d + '\ndiag: ' + diag + '\nзапросы:\n' + env.mocked.join('\n'));
    check('IntroDB запрошен через прокси (браузер прочитал ответ — CORS прокси подходит), напрямую в api.introdb.app — ни одного запроса', () => {
        assert.ok(env.mocked.includes('LIVE GET ' + PROXY + '/https://api.introdb.app/segments?imdb_id=tt0371746&is_movie=true'), env.mocked.join(' | '));
        assert.ok(!env.external['api.introdb.app'], JSON.stringify(env.external));
    });
    check('таймкоды через прокси: титры 1:57:18–2:05:40 (IntroDB), «заставка» в конце фильма отброшена', () => {
        assert.ok(/^Титры 1:57:18–2:05:40 \(IntroDB\)/.test(d), d);
        assert.ok(!/Заставка/.test(d), d);
    });
    check('«Диагностика»: IntroDB работает · через прокси', () => assert.match(diag, /^Работает, \d+ мс, только что · через прокси$/));
    // другие формы настройки — тот же источник плагина (Sources.introdb.fetch) из страницы
    const forms = await env.ev(async (PROXY) => {
        const T = window.__SKIP_INTRO_TEST__, out = [];
        for (const p of [PROXY + '/?url={encoded}', PROXY + '/']) {
            Lampa.Storage.set('skip_intro_introdb_proxy', p);
            try {
                const r = await T.Sources.introdb.fetch({ imdb: 'tt0944947', season: 1, episode: 1, movie: false });
                out.push(p + ' -> ' + r.st + ' ' + r.s.map((x) => x.type + ' ' + x.start + '–' + x.end).join(', '));
            } catch (e) { out.push(p + ' -> ошибка ' + (e && (e.kind || e.message))); }
        }
        return out;
    }, PROXY);
    console.log(forms.join('\n'));
    check('формы «?url={encoded}» и префикс: GoT S1E1 через прокси — заставка 437–531', () => {
        assert.strictEqual(forms.length, 2);
        forms.forEach((f) => assert.ok(/ -> ok .*intro 437–531/.test(f), f));
    });
    if (!LIVE) {
        const log = (await getJson(BASE + '__introdb/__log')).json;
        console.log('подставной IntroDB:\n' + log.join('\n'));
        check('в IntroDB ушло по одному запросу на фильм и на серию (вторая форма — из кэша прокси), с User-Agent прокси', () => {
            assert.deepStrictEqual(log.map((l) => l.split(' ').slice(0, 2).join(' ')), ['GET /__introdb/segments?imdb_id=tt0371746&is_movie=true', 'GET /__introdb/segments?imdb_id=tt0944947&season=1&episode=1']);
            assert.ok(log.every((l) => / LampaSkipIntro-IntroDB-proxy\/1\.0$/.test(l)), log.join(' | '));
        });
    }
    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    console.log('журнал прокси:\n' + plog.trim());
    await env.close();
    proxy.kill();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__proxy) global.__proxy.kill(); if (global.__env) console.log(global.__env.logs.filter((l) => /PAGEERROR|SkipIntro/.test(l)).join('\n')); process.exit(2); });
