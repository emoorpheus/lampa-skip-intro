'use strict';
// Общие сценарии для тестов autoskip: карточки, серии, маршруты баз
const { createEnv } = require('./harness');

const GOT = { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8,
    genres: [{ id: 18 }, { id: 10765 }], original_language: 'en', origin_country: ['US'],
    seasons: [{ season_number: 1, episode_count: 10, air_date: '2011-04-17' }, { season_number: 2, episode_count: 10, air_date: '2012-04-01' }] };
const AOT = { id: 1429, name: 'Attack on Titan', original_name: '進撃の巨人', first_air_date: '2013-04-07', number_of_seasons: 4,
    genres: [{ id: 16 }, { id: 10759 }], original_language: 'ja', origin_country: ['JP'],
    seasons: [{ season_number: 4, episode_count: 30, air_date: '2020-12-07' }] };
const INCEPTION = { id: 27205, title: 'Inception', original_title: 'Inception', imdb_id: 'tt1375666', release_date: '2010-07-15', genres: [{ id: 28 }] };
const TITLES = ['Winter Is Coming', 'The Kingsroad', 'Lord Snow'];

function ep(n, extra) {
    return Object.assign({ title: TITLES[n - 1] || ('Episode ' + n), season: 1, episode: n, url: 'https://cdn.example/got/s01e0' + n + '.mp4' }, extra || {});
}

function setup(opts) {
    opts = opts || {};
    const env = createEnv(opts);
    env.T.playerDom();
    if (opts.settings) for (const k of Object.keys(opts.settings)) env.setStorage(k, opts.settings[k]);
    if (opts.android) {
        env.bridge.platform = 'android';
        env.W.AndroidJS = { appVersion: () => '1.10.2-' + (opts.android === true ? 17 : opts.android) };
    }
    env.load('autoskip');
    return env;
}

// TheIntroDB: ответ по сериям { 'S1E1': {intro:[...], credits:[...]} }; иначе 404 no_submissions
function tidb(env, table, extra) {
    env.on('api.theintrodb.org/v4/media', (req) => {
        const u = new URL(req.url), k = u.searchParams.get('season') ? 'S' + u.searchParams.get('season') + 'E' + u.searchParams.get('episode') : 'M' + u.searchParams.get('tmdb_id');
        const body = table[k];
        if (typeof body === 'function') return body(req, u);
        if (!body) return { status: 404, body: { error: 'No submissions', code: 'no_submissions' } };
        return { status: 200, body: Object.assign({ tmdb_id: +u.searchParams.get('tmdb_id') }, body), delay: (extra && extra.delay) || 30 };
    }, { cors: '*' });
}

// IntroDB: CORS только для https://introdb.app (проверено: access-control-allow-origin: https://introdb.app)
function introdb(env, table, extra) {
    env.on('api.introdb.app/segments', (req) => {
        const u = new URL(req.url.replace(/^https:\/\/proxy\.example\//, ''));
        const k = u.searchParams.get('is_movie') === 'true' ? 'M' + u.searchParams.get('imdb_id') : u.searchParams.get('imdb_id') + ':S' + u.searchParams.get('season') + 'E' + u.searchParams.get('episode');
        const body = table[k] || { intro: null, recap: null, outro: null, post_credits: null, no_intro: false, no_recap: false, no_outro: false };
        return { status: 200, body, delay: 40 };
    }, Object.assign({ cors: 'https://introdb.app' }, extra || {}));
}

function introhater(env, table) {
    env.on('introhater.com/api/segments/', (req) => {
        const id = decodeURIComponent(req.url.split('/api/segments/')[1]);
        return { status: 200, body: table[id] || [], delay: 50 };
    }, { cors: '*' });
}

const ms = (a, b, o) => Object.assign({ start_ms: a === null ? null : a * 1000, end_ms: b === null ? null : b * 1000 }, o || {});

// Запуск серии из плейлиста (как онлайн-плагин: Player.play(item) + Player.playlist(list))
function play(env, list, pos, o) {
    o = o || {};
    const pl = env.clone(list);
    const data = pl[pos];
    if (o.card !== false) data.card = env.clone(o.card || GOT);
    if (o.data) Object.assign(data, env.clone(o.data));
    env.T.play(data, { playlist: o.noPlaylist ? null : pl, position: pos, customSubs: o.customSubs && env.clone(o.customSubs) });
    return data;
}

module.exports = { setup, tidb, introdb, introhater, ms, play, ep, GOT, AOT, INCEPTION };
