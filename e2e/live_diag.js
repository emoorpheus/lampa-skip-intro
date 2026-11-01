// Живая проверка из настоящего Chromium (origin http://127.0.0.1:8123): кнопка «Проверить сейчас» в настройках Lampa.
// Только чтение: GET к базам таймкодов и ARM, POST-запрос чтения GraphQL к AniList. В Aniskip ничего не отправляется.
const { open } = require('./lib');
(async () => {
    const env = await open({ live: ['api.theintrodb.org', 'api.introdb.app', 'introhater.com', 'api.aniskip.com', 'arm.haglund.dev', 'graphql.anilist.co'] });
    await env.ev(() => new Promise((res) => { Lampa.Controller.toggle('settings'); setTimeout(res, 500); }));
    await env.ev(() => new Promise((res) => { Lampa.Settings.create('skip_intro'); setTimeout(res, 500); }));
    await env.ev(() => { $('.settings__body .settings-param[data-name="skip_intro_diag_check"]').trigger('hover:enter'); });
    await env.wait(12000);
    const diag = await env.ev(() => {
        const NAMES = { theintrodb: 'TheIntroDB', introdb: 'IntroDB', introhater: 'IntroHater', aniskip: 'Aniskip', arm: 'ARM (аниме → MyAnimeList)', anilist: 'AniList' };
        const statics = Array.from(document.querySelectorAll('.settings__body .settings-param[data-static="true"]'));
        const out = {};
        Object.keys(NAMES).forEach((s) => {
            const el = statics.find((e) => (e.querySelector('.settings-param__name') || {}).textContent === NAMES[s]);
            out[s] = el ? (el.querySelector('.settings-param__descr') || {}).textContent : '(нет пункта)';
        });
        out.health = JSON.parse(JSON.stringify(window.__SKIP_INTRO_TEST__.Health.get ? ['theintrodb','introdb','introhater','aniskip','arm','anilist'].map((s) => [s, window.__SKIP_INTRO_TEST__.Health.get(s)]) : []));
        return out;
    });
    console.log(new Date().toISOString());
    console.log(JSON.stringify(diag, null, 1));
    console.log('requests:\n' + env.mocked.join('\n'));
    console.log(env.logs.filter((l) => /CORS|Access-Control|blocked/i.test(l)).slice(0, 10).join('\n'));
    await env.close();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
