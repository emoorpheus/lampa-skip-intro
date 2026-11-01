// Аниме через (эмулированный) TorrServer в настоящей Lampa 3.4.4:
// S1E1 — ARM -> AniList -> Aniskip (GET), S1E2 — в Aniskip пусто -> эвристика по ASS из /subs TorrServer (список берёт сама Lampa).
const { open, BASE } = require('./lib');
const assert = require('assert');
const H = '0123456789abcdef0123456789abcdef01234567';
const AOT = { id: 1429, name: 'Атака титанов', original_name: '進撃の巨人', first_air_date: '2013-04-07', number_of_seasons: 4, source: 'tmdb',
    genre_ids: [16, 10759, 10765], origin_country: ['JP'], original_language: 'ja', seasons: [{ season_number: 1, episode_count: 25, air_date: '2013-04-07' }] };
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const tsLog = async () => (await (await fetch(BASE + 'ts/__log')).json());
    const env = await open({
        storage: { torrserver_url: BASE + 'ts', skip_intro_button_timeout: '0', skip_intro_auto: 'true' },
        mocks: [
            { match: 'api.theintrodb.org/v4/media', reply: { status: 404, body: { error: 'No submissions', code: 'no_submissions' } } },
            { match: 'tv/1429/external_ids', reply: { body: { id: 1429, imdb_id: 'tt2560140' } } },
            { match: 'api.introdb.app/segments', reply: { status: 404, body: { error: 'No segments found' }, cors: '*' } },
            { match: 'introhater.com/api/segments/', reply: { body: [] } },
            { match: 'arm.haglund.dev/api/v2/themoviedb?id=1429', reply: { body: [{ myanimelist: 16498, anilist: 16498, themoviedb: 1429, 'themoviedb-season': 1, thetvdb: 267440, 'thetvdb-season': 1, imdb: 'tt2560140' }] } },
            { match: 'graphql.anilist.co', method: 'POST', reply: { body: { data: { Page: { media: [{ idMal: 16498, episodes: 25, format: 'TV', status: 'FINISHED', startDate: { year: 2013, month: 4, day: 7 }, nextAiringEpisode: null }] } } } } },
            { match: 'api.aniskip.com/v2/relation-rules/', reply: { status: 404, body: { found: false, statusCode: 404, message: 'No relation rules found', rules: [] } } },
            { match: 'api.aniskip.com/v2/skip-times/16498/1?', method: 'GET', reply: { body: { found: true, statusCode: 200, message: 'Successfully found skip times', results: [
                { interval: { startTime: 242.6, endTime: 332.6 }, skipType: 'op', skipId: 'e2e-op-1', episodeLength: 1420 },
                { interval: { startTime: 1329.9, endTime: 1420 }, skipType: 'ed', skipId: 'e2e-ed-1', episodeLength: 1420 }] } } },
            { match: 'api.aniskip.com/v2/skip-times/16498/2?', method: 'GET', reply: { status: 404, body: { found: false, statusCode: 404, message: 'No skip times found', results: [] } } }
        ]
    });
    global.__env = env;
    await tsLog();
    await env.ev(({ BASE, AOT, H }) => {
        const item = (n) => ({ title: 'Shingeki.no.Kyojin.S01E0' + n + '.1080p.mkv', season: 1, episode: n, card: AOT, torrent_hash: H,
            url: BASE + 'ts/stream/' + encodeURIComponent('Shingeki.no.Kyojin.S01E0' + n + '.1080p.mkv') + '?link=' + H + '&index=' + n + '&play' });
        Lampa.Player.play(item(1));
        Lampa.Player.playlist([item(1), item(2)]);
    }, { BASE, AOT, H });
    await env.wait(5000);
    const s1 = await env.ev(() => ({ d: window.__SKIP_INTRO_TEST__.Controller.describe(),
        dur: (document.querySelector('video') || {}).duration }));
    console.log('S1E1: ' + JSON.stringify(s1));
    check('S1E1 (1420 с): Aniskip через ARM (одна запись MAL на сезон — AniList не нужен), опенинг и эндинг', () => {
        assert.strictEqual(Math.round(s1.dur), 1420);
        assert.ok(/Заставка 4:0[23]–5:3[23] \(Aniskip/.test(s1.d), s1.d);
        assert.ok(/Титры 22:(09|10)–(23:40|конец) \(Aniskip/.test(s1.d), s1.d);
        assert.ok(env.mocked.some((m) => m.startsWith('GET https://arm.haglund.dev/api/v2/themoviedb?id=1429')));
        assert.ok(!env.mocked.some((m) => m.startsWith('POST https://graphql.anilist.co')), 'AniList не нужен');
        assert.ok(env.mocked.some((m) => /skip-times\/16498\/1\?.*episodeLength=0$/.test(m)), 'параллельно «любая длина»');
        assert.ok(env.mocked.some((m) => /GET https:\/\/api\.aniskip\.com\/v2\/skip-times\/16498\/1\?.*episodeLength=1420/.test(m)), env.mocked.join(' | '));
    });
    // автопропуск (база Aniskip): перемотка сама
    await env.ev(() => Lampa.PlayerVideo.to(238));
    await env.wait(9000);
    const t1 = await env.ev(() => document.querySelector('video').currentTime);
    check('«Всегда автопропуск»: опенинг Aniskip пропущен сам (обратный отсчёт)', () => assert.ok(t1 >= 332 && t1 < 345, String(t1)));
    // в следующую серию штатно (to_end)
    await env.ev(() => Lampa.PlayerPanel.listener.send('to_end', {}));
    await env.wait(6000);
    const log = await tsLog();
    const s2 = await env.ev(() => ({ d: window.__SKIP_INTRO_TEST__.Controller.describe(), key: window.__SKIP_INTRO_TEST__.Controller._ctx && window.__SKIP_INTRO_TEST__.Controller._ctx.key,
        subs: (() => { try { return (document.querySelector('video') || {}).customSubs || null; } catch (e) { return null; } })() }));
    console.log('TorrServer: ' + log.join(' | '));
    console.log('S1E2: ' + JSON.stringify(s2).slice(0, 600));
    check('Lampa сама взяла список субтитров у TorrServer (/subs) и файл ASS (format=original)', () => {
        assert.ok(log.some((l) => l.startsWith('GET /ts/subs/' + H + '/2') && !l.includes('track=')), log.join(' | '));
        assert.ok(log.some((l) => l.includes('/ts/subs/' + H + '/2?track=0&format=original')), log.join(' | '));
    });
    check('S1E2: в Aniskip пусто -> заставка и титры по субтитрам ASS (песни OP/ED)', () => {
        assert.strictEqual(s2.key, 'skip3_1429_s1_e2');
        assert.ok(/Заставка 1:29–3:00 \(по субтитрам ASS\)/.test(s2.d), s2.d);
        assert.ok(/Титры 21:39–23:05 \(по субтитрам ASS\)/.test(s2.d), s2.d);
    });
    await env.ev(() => Lampa.PlayerVideo.to(86));
    await env.wait(5000);
    const b2 = await env.ev(() => { const b = document.querySelector('.skip-intro-button'); return { vis: !!(b && b.classList.contains('visible')), text: b ? b.textContent : '', t: document.querySelector('video').currentTime }; });
    check('эвристика ASS — только кнопкой, даже при «Всегда автопропуск»', () => {
        assert.ok(b2.vis && b2.text.includes('Пропустить заставку') && b2.text.includes('(по субтитрам ASS)'), JSON.stringify(b2));
        assert.ok(b2.t > 89 && b2.t < 95, 'сама не перемотала: ' + b2.t);
    });
    check('в Aniskip ничего не отправлялось (только GET)', () => assert.ok(!env.mocked.some((m) => m.startsWith('POST') && m.includes('aniskip')), env.mocked.join(' | ')));
    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    console.log(env.pluginLogs().join('\n'));
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) console.log(global.__env.logs.filter((l) => /PAGEERROR|SkipIntro/.test(l)).join('\n')); process.exit(2); });
