'use strict';
// Прокси IntroDB (proxy/introdb_proxy.py): настоящий процесс Python 3 и подставной «IntroDB» на 127.0.0.1 — в интернет тест не ходит.
// Адреса строит сам плагин (Net.applyProxy + Sources.introdb.url) во всех формах настройки: {url}, {encoded}, префикс.
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { test, run, createEnv, fixture, ROOT } = require('./lib/harness');

const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const SCRIPT = path.join(ROOT, 'proxy', 'introdb_proxy.py');
const IRON = fixture('introdb_ironman.json'), GOT = fixture('introdb_got.json');
const UA = 'LampaSkipIntro-IntroDB-proxy/1.0';

const up = { hits: [], headers: [] };
const children = [], servers = [];

function listen(handler) {
    return new Promise((res) => { const s = http.createServer(handler); servers.push(s); s.listen(0, '127.0.0.1', () => res(s.address().port)); });
}
function freePort() {
    return new Promise((res) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
// Подставной api.introdb.app: ответы по imdb_id
function upstream(req, rsp) {
    up.hits.push(req.url); up.headers.push(req.headers);
    const q = new URL(req.url, 'http://x').searchParams, id = q.get('imdb_id');
    const send = (status, body, h) => { rsp.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://introdb.app' }, h || {})); rsp.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (id === 'tt0371746') return send(200, IRON);
    if (id === 'tt0944947') return send(200, GOT);
    if (id === 'tt0000404') return send(404, { error: 'not found' });
    if (id === 'tt0000500') return send(500, { error: 'boom' });
    if (id === 'tt0000429') return send(429, { error: 'slow down' }, { 'Retry-After': '120' });
    if (id === 'tt0000777') return send(200, 'x'.repeat(300 * 1024));
    return send(404, { error: 'unknown' });
}
async function startProxy(upstreamUrl, rate) {
    const port = await freePort();
    const env = Object.assign({}, process.env, { INTRODB_PROXY_UPSTREAM: upstreamUrl });
    const ch = spawn(PY, [SCRIPT, '--host', '127.0.0.1', '--port', String(port), '--rate', String(rate), '--quiet'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; ch.stderr.on('data', (d) => { err += d; });
    children.push(ch);
    for (let i = 0; i < 50; i++) {
        try { const r = await get('http://127.0.0.1:' + port + '/health'); if (r.status === 200) return 'http://127.0.0.1:' + port; } catch (e) { /* ещё стартует */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('прокси не запустился: ' + err);
}
function request(method, url, headers) {
    return new Promise((res, rej) => {
        const r = http.request(url, { method, headers: headers || {} }, (rsp) => {
            const chunks = []; rsp.on('data', (c) => chunks.push(c));
            rsp.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch (e) { /* не JSON */ } res({ status: rsp.statusCode, headers: rsp.headers, text, json }); });
        });
        r.on('error', rej); r.end();
    });
}
const get = (url, headers) => request('GET', url, headers);

let P, PR, PD, S;
const pluginUrl = (proxy, ctx) => S.Net.applyProxy(proxy, S.Sources.introdb.url(ctx));
const GOT_CTX = { imdb: 'tt0944947', season: 1, episode: 1, movie: false };

test('/health отвечает; CORS «*» на любом ответе прокси', async () => {
    const r = await get(P + '/health');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { ok: true, service: 'introdb-proxy', version: '1.0' });
    assert.strictEqual(r.headers['access-control-allow-origin'], '*');
});

test('все формы настройки плагина ({url}, {encoded}, ?url={encoded}, префикс) -> 200 и тот же ответ; в IntroDB — один запрос, дальше кэш', async () => {
    const forms = [P + '/{url}', P + '/?url={encoded}', P + '/{encoded}', P + '/'];
    const urls = forms.map((f) => pluginUrl(f, GOT_CTX));
    assert.strictEqual(urls[0], P + '/https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1');
    assert.strictEqual(urls[3], urls[0]);
    const before = up.hits.length, caches = [];
    for (const u of urls) {
        const r = await get(u);
        assert.strictEqual(r.status, 200, u + ' -> ' + r.text);
        assert.strictEqual(r.headers['access-control-allow-origin'], '*');
        assert.deepStrictEqual(r.json, GOT);
        caches.push(r.headers['x-proxy-cache']);
        const parsed = S.Logic.parseIntroDB(r.status, r.json);
        assert.strictEqual(parsed.st, 'ok');
        assert.strictEqual(JSON.stringify(parsed.s.filter((x) => x.type === 'intro').map((x) => [x.start, x.end])), '[[437,531]]'); // объекты из vm — сравнение через JSON
    }
    assert.deepStrictEqual(caches, ['MISS', 'HIT', 'HIT', 'HIT']);
    assert.deepStrictEqual(up.hits.slice(before), ['/segments?imdb_id=tt0944947&season=1&episode=1']);
    const h = up.headers[up.headers.length - 1];
    assert.strictEqual(h['user-agent'], UA);
    assert.strictEqual(h.accept, 'application/json');
});

test('фильм (is_movie=true) — запрос в IntroDB в каноническом виде, ответ без изменений', async () => {
    const before = up.hits.length;
    const r = await get(pluginUrl(P + '/{url}', { imdb: 'tt0371746', movie: true }));
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, IRON);
    assert.match(r.headers['content-type'], /^application\/json/);
    assert.deepStrictEqual(up.hits.slice(before), ['/segments?imdb_id=tt0371746&is_movie=true']);
});

test('не открытый прокси: чужие адреса, пути, параметры -> 403/400, в IntroDB ничего не уходит', async () => {
    const before = up.hits.length;
    const cases = [
        ['/https://api.theintrodb.org/v4/media?tmdb_id=1399', 403],
        ['/http://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1', 403],
        ['/https://api.introdb.app:8443/segments?imdb_id=tt0944947&season=1&episode=1', 403],
        ['/https://user:pass@api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1', 403],
        ['/https://api.introdb.app.evil.example/segments?imdb_id=tt0944947&season=1&episode=1', 403],
        ['/https://127.0.0.1/segments?imdb_id=tt0944947&season=1&episode=1', 403],
        ['/https://api.introdb.app/segments/submit?imdb_id=tt0944947', 403],
        ['/https://api.introdb.app/intro?imdb_id=tt0944947&season=1&episode=1', 403],
        ['/https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1&api_key=x', 400],
        ['/https://api.introdb.app/segments?imdb_id=tt0944947&imdb_id=tt0371746&is_movie=true', 400],
        ['/https://api.introdb.app/segments?imdb_id=abc&is_movie=true', 400],
        ['/https://api.introdb.app/segments?imdb_id=tt0944947&season=1', 400],
        ['/https://api.introdb.app/segments?season=1&episode=1', 400],
        ['/', 400],
        ['/?url=', 400]
    ];
    for (const [p, code] of cases) {
        const r = await get(P + p);
        assert.strictEqual(r.status, code, p + ' -> ' + r.status + ' ' + r.text);
        assert.strictEqual(r.headers['access-control-allow-origin'], '*', p);
        assert.ok(r.json && typeof r.json.error === 'string', p);
    }
    assert.strictEqual(up.hits.length, before);
});

test('методы: OPTIONS -> 204 с CORS (и Private Network), POST/HEAD -> 405; в IntroDB ничего не уходит', async () => {
    const before = up.hits.length, u = pluginUrl(P + '/{url}', GOT_CTX);
    const o = await request('OPTIONS', u, { Origin: 'http://lampa.test', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'accept', 'Access-Control-Request-Private-Network': 'true' });
    assert.strictEqual(o.status, 204);
    assert.strictEqual(o.headers['access-control-allow-origin'], '*');
    assert.strictEqual(o.headers['access-control-allow-methods'], 'GET, OPTIONS');
    assert.strictEqual(o.headers['access-control-allow-headers'], 'accept');
    assert.strictEqual(o.headers['access-control-allow-private-network'], 'true');
    const p = await request('POST', u);
    assert.strictEqual(p.status, 405);
    assert.strictEqual(p.headers['access-control-allow-origin'], '*');
    const h = await request('HEAD', u);
    assert.strictEqual(h.status, 405);
    assert.strictEqual(up.hits.length, before);
});

test('ответы IntroDB 404 и 500 передаются как есть (плагин: 404 — «пусто», 500 — ошибка); 404 кэшируется, 500 — нет', async () => {
    const u404 = P + '/https://api.introdb.app/segments?imdb_id=tt0000404&is_movie=true';
    const a = await get(u404), b = await get(u404);
    assert.deepStrictEqual([a.status, a.headers['x-proxy-cache'], b.status, b.headers['x-proxy-cache']], [404, 'MISS', 404, 'HIT']);
    assert.strictEqual(S.Logic.parseIntroDB(a.status, a.json).st, 'empty');
    const u500 = P + '/https://api.introdb.app/segments?imdb_id=tt0000500&is_movie=true';
    const before = up.hits.length;
    const c = await get(u500), d = await get(u500);
    assert.deepStrictEqual([c.status, d.status, up.hits.length - before], [500, 500, 2]);
    assert.throws(() => S.Logic.parseIntroDB(c.status, c.json));
});

test('слишком большой ответ IntroDB -> 502 с CORS', async () => {
    const r = await get(P + '/https://api.introdb.app/segments?imdb_id=tt0000777&is_movie=true');
    assert.strictEqual(r.status, 502);
    assert.strictEqual(r.headers['access-control-allow-origin'], '*');
});

test('IntroDB недоступна -> 502 с CORS и понятной ошибкой (плагин увидит HTTP 502, а не «CORS/нет сети»)', async () => {
    const r = await get(PD + '/https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1');
    assert.strictEqual(r.status, 502);
    assert.strictEqual(r.headers['access-control-allow-origin'], '*');
    assert.match(r.json.error, /^IntroDB недоступна/);
});

test('лимит --rate 2: третий новый запрос за минуту — 429 от самого прокси, в IntroDB не уходит; кэш лимитом не считается', async () => {
    const m = (id) => PR + '/https://api.introdb.app/segments?imdb_id=' + id + '&is_movie=true';
    const before = up.hits.length;
    const a = await get(m('tt0371746')), b = await get(m('tt0000404')), c = await get(m('tt0371746')), d = await get(m('tt0000500'));
    assert.deepStrictEqual([a.status, b.status, c.status, c.headers['x-proxy-cache'], d.status], [200, 404, 200, 'HIT', 429]);
    assert.ok(+d.headers['retry-after'] >= 1 && +d.headers['retry-after'] <= 61, d.headers['retry-after']);
    assert.strictEqual(up.hits.length - before, 2);
});

test('IntroDB ответила 429 -> прокси передаёт 429 и делает паузу (Retry-After), следующие запросы в IntroDB не идут', async () => {
    const PZ = await startProxy('http://127.0.0.1:' + up.port, 100);
    const before = up.hits.length;
    const a = await get(PZ + '/https://api.introdb.app/segments?imdb_id=tt0000429&is_movie=true');
    const b = await get(PZ + '/https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1');
    assert.deepStrictEqual([a.status, a.headers['retry-after'], b.status], [429, '120', 429]);
    assert.ok(+b.headers['retry-after'] > 100, b.headers['retry-after']);
    assert.strictEqual(up.hits.length - before, 1);
});

(async () => {
    if (spawnSync(PY, ['-c', 'import sys; assert sys.version_info >= (3, 7)']).status !== 0) {
        console.log('\n=== прокси IntroDB ===\n  итого: 0 прошло, 0 не прошло (пропущено: нет Python 3.7+, задайте PYTHON=...)');
        return;
    }
    try {
        up.port = await listen(upstream);
        P = await startProxy('http://127.0.0.1:' + up.port, 100);
        PR = await startProxy('http://127.0.0.1:' + up.port, 2);
        PD = await startProxy('http://127.0.0.1:' + (await freePort()), 100);
        const env = createEnv(); env.load('autoskip'); S = env.S;
        await run('прокси IntroDB (proxy/introdb_proxy.py)');
    } finally {
        children.forEach((c) => c.kill());
        servers.forEach((s) => s.close());
    }
})().catch((e) => { console.error(e); process.exitCode = 1; children.forEach((c) => c.kill()); servers.forEach((s) => s.close()); });
