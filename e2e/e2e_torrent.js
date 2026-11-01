// Торрент через (эмулированный) TorrServer в настоящей Lampa 3.4.4: адрес /stream/...?link=&index=&play,
// главы MKV из /ffp -> таймкоды; один запрос /ffp на файл (общий кэш window.__lampa_ffp__ — его же использует Adaptive Subtitles).
const { open, BASE } = require('./lib');
const assert = require('assert');
const H = 'abcdef0123456789abcdef0123456789abcdef01';
const GOT = { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8, source: 'tmdb',
    genre_ids: [10765, 18, 10759], origin_country: ['US'], original_language: 'en' };
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const tsLog = async () => (await (await fetch(BASE + 'ts/__log')).json());
    await tsLog();
    const env = await open({
        storage: { torrserver_url: BASE + 'ts', skip_intro_button_timeout: '0' },
        mocks: [
            { match: 'api.theintrodb.org/v4/media', reply: { status: 404, body: { error: 'No submissions', code: 'no_submissions' } } },
            { match: 'api.introdb.app/segments', reply: { status: 404, body: { error: 'not found' } } },
            { match: 'introhater.com/api/segments/', reply: { body: [] } },
            { match: 'tv/1399/external_ids', reply: { body: { id: 1399, imdb_id: 'tt0944947' } } }
        ]
    });
    global.__env = env;
    await tsLog();
    await env.ev(({ BASE, GOT, H }) => Lampa.Player.play({
        title: 'Game.of.Thrones.S01E01.mkv', season: 1, episode: 1, card: GOT, torrent_hash: H,
        url: BASE + 'ts/stream/' + encodeURIComponent('Game.of.Thrones.S01E01.mkv') + '?link=' + H + '&index=1&play'
    }), { BASE, GOT, H });
    await env.wait(4500);
    const log = await tsLog();
    const st = await env.ev(() => {
        const v = document.querySelector('video');
        return { dur: v && v.duration, opened: Lampa.Player.opened(), ffp: !!(window.__lampa_ffp__ && window.__lampa_ffp__.v === 1),
            d: window.__SKIP_INTRO_TEST__.Controller.describe(),
            marks: Array.from(document.querySelectorAll('.player-panel__timeline .skip-intro-mark')).length };
    });
    console.log('TorrServer: ' + log.join(' | '));
    console.log('state: ' + JSON.stringify(st));
    check('видео из /ts/stream открыто в плеере Lampa', () => { assert.ok(st.opened); assert.strictEqual(Math.round(st.dur), 3700); });
    check('один запрос /ffp на файл; общий кэш window.__lampa_ffp__ (v1) установлен', () => {
        assert.strictEqual(log.filter((l) => l.includes('/ffp/' + H + '/1')).length, 1, log.join(' | '));
        assert.strictEqual(st.ffp, true);
    });
    check('autoskip: заставка и титры из глав MKV, метки на шкале', () => {
        assert.ok(/Заставка 7:17–8:51 \(главы/i.test(st.d), st.d);
        assert.ok(/Титры 1:00:3[12]–(1:01:40|конец) \(главы/i.test(st.d), st.d);
        assert.strictEqual(st.marks, 2);
    });
    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    console.log(env.pluginLogs().join('\n'));
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) console.log(global.__env.logs.filter((l) => /PAGEERROR|SkipIntro/.test(l)).join('\n')); process.exit(2); });
