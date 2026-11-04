'use strict';
// autoskip в «браузере»: события плеера Lampa, сеть, кнопка, клавиши, меню
const assert = require('assert');
const { test, run, createEnv, fixture, PKG } = require('./lib/harness');
const { setup, tidb, introdb, introhater, ms, play, ep, GOT, AOT, INCEPTION } = require('./lib/scen');

const J = (x) => JSON.parse(JSON.stringify(x));
const OK = 13, BACK = 8;

function gotEnv(o) {
    o = o || {};
    const env = setup(o);
    env.bridge.imdb['tv:1399'] = 'tt0944947';
    tidb(env, Object.assign({
        S1E1: { group_duration_ms: 3700000, intro: [ms(437, 531, { confidence: 0.9, submission_count: 5 })], credits: [ms(3631.5, null, { confidence: 0.9, submission_count: 4 })] },
        S1E2: { group_duration_ms: 3400000, intro: [ms(100, 190, { confidence: 0.9, submission_count: 5 })] }
    }, o.tidb || {}));
    introdb(env, o.introdb || {});
    introhater(env, o.introhater || {});
    return env;
}

async function startGot(env, pos, o) {
    const data = play(env, [ep(1), ep(2), ep(3)], pos || 0, o);
    await env.advance(300);
    env.T.loaded((o && o.duration) || 3700);
    await env.advance(1000);
    return data;
}

test('полный сценарий: imdb через TMDB Lampa, запросы баз, предупреждение за 5 с, кнопка, OK -> перемотка', async () => {
    const env = gotEnv();
    await startGot(env);
    assert.deepStrictEqual(env.log.imdb, ['tv:1399'], 'imdb_id спрошен у TMDB через Lampa');
    const t = env.requests('api.theintrodb.org');
    assert.strictEqual(t.length, 1);
    assert.match(t[0].url, /tmdb_id=1399&season=1&episode=1&details=true&duration_ms=3700000$/);
    assert.strictEqual(env.requests('api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1').length, 1);
    assert.strictEqual(env.requests('introhater.com/api/segments/tt0944947:1:1').length, 1);
    assert.strictEqual(env.requests('aniskip').length + env.requests('arm.haglund').length, 0, 'не аниме — Aniskip не спрашиваем');
    await env.playTo(430, 432.5);
    assert.strictEqual(env.warn() && env.warn().text, 'Заставка через 5 с');
    await env.playTo(432.75, 436.75);
    assert.strictEqual(env.warn().text, 'Заставка через 1 с');
    await env.playTo(437, 437.5);
    const b = env.button();
    assert.ok(b && b.visible, 'кнопка видна');
    assert.strictEqual(b.label, 'Пропустить заставку');
    assert.strictEqual(b.hint, 'нажмите OK');
    assert.strictEqual(env.warn().visible, false, 'предупреждение скрыто, пока видна кнопка');
    assert.strictEqual(env.T.key(OK, 'keydown'), false, 'OK на нажатии Lampa сама игнорирует — ждём отпускания');
    assert.strictEqual(env.T.key(OK, 'keyup'), true, 'OK на отпускании забрали у Lampa');
    assert.deepStrictEqual(env.log.lampaKeys, [], 'Lampa не получила OK');
    assert.deepStrictEqual(env.log.seeks, [531]);
    await env.advance(400);
    assert.strictEqual(env.button(), null, 'кнопка убрана');
    await env.playTo(531, 533);
    assert.strictEqual(env.button(), null, 'пропущенное не появляется снова');
    assert.match(env.S.Stats.text(), /1 пропуск\)$/);
    assert.strictEqual(env.S.Smart.hasSkipped('1399', 'intro'), true);
    assert.strictEqual(env.errors.length, 0, J(env.errors.map((e) => e.where + ' ' + e.e.message)));
});

test('отметки на шкале времени: после .player-panel__timeline-segments, позиция в процентах', async () => {
    const env = gotEnv();
    await startGot(env);
    await env.playTo(10, 10.5);
    const m = env.marks();
    assert.strictEqual(m.length, 2);
    assert.ok(Math.abs(m[0].left - 437 / 3700 * 100) < 1e-6);
    assert.ok(Math.abs(m[0].width - 94 / 3700 * 100) < 1e-6);
    assert.ok(Math.abs(m[1].left + m[1].width - 100) < 1e-6, 'титры «до конца» — до конца шкалы');
    const host = env.W.document.querySelector('.player-panel__timeline');
    assert.deepStrictEqual(J(host.childNodes.map((n) => n.className)), ['player-panel__timeline-segments', 'skip-intro-marks', 'player-panel__position']);
    env.T.destroy();
    assert.strictEqual(env.marks().length, 0, 'после закрытия плеера отметки убраны');
});

test('титры в конце + следующая серия: «Следующая серия» с подписью, OK -> штатный to_end Lampa (отметка 100%)', async () => {
    const env = gotEnv();
    await startGot(env);
    await env.playTo(3626, 3627);
    assert.strictEqual(env.warn().text, 'Титры через 5 с \u00b7 далее S01E02 \u2014 The Kingsroad');
    await env.playTo(3631.5, 3632);
    const b = env.button();
    assert.strictEqual(b.label, 'Следующая серия');
    assert.strictEqual(b.sub, 'S01E02 \u2014 The Kingsroad');
    env.T.press(OK);
    assert.deepStrictEqual(env.log.events, ['to_end', 'setEnd', 'next'], 'переход через Lampa: пауза, «просмотрено», следующая');
    assert.deepStrictEqual(env.log.seeks, []);
});

test('титры последней серии: to_end без следующей — Lampa перематывает в конец (to(-1))', async () => {
    const env = gotEnv({ tidb: { S1E3: { intro: [], credits: [ms(3500, null)] } } });
    play(env, [ep(1), ep(2), ep(3)], 2);
    await env.advance(300); env.T.loaded(3600); await env.advance(1000);
    await env.playTo(3500, 3500.5);
    assert.strictEqual(env.button().label, 'Пропустить титры');
    assert.strictEqual(env.button().sub, '');
    env.T.press(OK);
    assert.deepStrictEqual(env.log.events, ['to_end']);
    assert.deepStrictEqual(env.log.seeks, [-1]);
});

test('автопропуск: заставка перематывается сама, предупреждение «— будет пропущена»; титры -> следующая серия', async () => {
    const env = gotEnv({ settings: { skip_intro_auto: 'true' } });
    await startGot(env);
    await env.playTo(433, 433.5);
    assert.strictEqual(env.warn().text, 'Заставка через 4 с \u2014 будет пропущена');
    await env.playTo(437, 437.25);
    assert.deepStrictEqual(env.log.seeks, [531]);
    assert.strictEqual(env.button(), null);
    await env.playTo(3626.5, 3627);
    assert.strictEqual(env.warn().text, 'Следующая серия через 5 с: S01E02 \u2014 The Kingsroad');
    await env.playTo(3631.5, 3631.75);
    assert.deepStrictEqual(env.log.events, ['to_end', 'setEnd', 'next']);
});

test('порог доверия «высокий»: мало подтверждений — вместо автопропуска кнопка', async () => {
    const env = gotEnv({ settings: { skip_intro_auto: 'true', skip_intro_confidence: 'high' },
        tidb: { S1E1: { intro: [ms(437, 531, { confidence: 0.9, submission_count: 2 })] } } });
    await startGot(env);
    await env.playTo(433, 433.5);
    assert.strictEqual(env.warn().text, 'Заставка через 4 с');
    await env.playTo(437, 437.5);
    assert.deepStrictEqual(env.log.seeks, []);
    assert.strictEqual(env.button().label, 'Пропустить заставку');
});

test('порог «низкий»: заставка TheIntroDB с conf 0,016, IntroDB уверена и подтверждает — автопропуск (TX9, «Игра престолов»)', async () => {
    const env = gotEnv({ android: true, settings: { skip_intro_auto: 'true' },
        tidb: { S1E1: { group_duration_ms: 3700000, intro: [ms(437, 531, { confidence: 0.016, submission_count: 5 })] } },
        introdb: { 'tt0944947:S1E1': { intro: { start_sec: 436, end_sec: 528, confidence: 1, submission_count: 1 }, recap: null, outro: null, post_credits: null } } });
    await startGot(env);
    await env.playTo(437, 437.5);
    assert.deepStrictEqual(J(env.log.seeks), [531], 'таймкоды TheIntroDB, подтверждение IntroDB');
    assert.match(env.S.Controller.describe(), /Заставка 7:17–8:51 \(TheIntroDB, подтвердила IntroDB\)/);
});

test('порог «низкий»: TheIntroDB не уверена, IntroDB не подтверждает — нет автопропуска по TheIntroDB, берётся IntroDB', async () => {
    const env = gotEnv({ android: true, settings: { skip_intro_auto: 'true' },
        tidb: { S1E1: { group_duration_ms: 3700000, intro: [ms(437, 531, { confidence: 0.016, submission_count: 5 })] } },
        introdb: { 'tt0944947:S1E1': { intro: { start_sec: 470, end_sec: 528, confidence: 1, submission_count: 1 }, recap: null, outro: null, post_credits: null } } });
    await startGot(env);
    await env.playTo(437, 437.5);
    assert.deepStrictEqual(J(env.log.seeks), []);
    await env.playTo(470, 470.5);
    assert.deepStrictEqual(J(env.log.seeks), [528]);
});

test('серия уже начата (Timeline): заставку не перематываем автоматически, только кнопкой', async () => {
    const env = gotEnv({ settings: { skip_intro_auto: 'true' } });
    env.bridge.timeline.h1 = { percent: 40, time: 1500, duration: 3700 };
    await startGot(env, 0, { data: { timeline: { hash: 'h1', percent: 40, time: 1500 } } });
    await env.playTo(437, 437.5);
    assert.deepStrictEqual(env.log.seeks, []);
    assert.strictEqual(env.button().label, 'Пропустить заставку');
});

test('умный режим: однажды пропущенную заставку дальше — отсчёт 4 с; «Назад» отменяет без выхода из плеера', async () => {
    const env = gotEnv();
    env.S.Smart.rememberSkip('1399', 'intro');
    await startGot(env);
    await env.playTo(437, 437.25);
    let b = env.button();
    assert.ok(b.countdown, 'кнопка с обратным отсчётом');
    assert.strictEqual(b.hint, 'нажмите Назад для отмены');
    assert.strictEqual(env.T.key(BACK, 'keydown'), true, '«Назад» забран у Lampa');
    assert.deepStrictEqual(env.log.lampaKeys, []);
    assert.strictEqual(env.button(), null);
    await env.advance(5000);
    assert.deepStrictEqual(env.log.seeks, [], 'после отмены не перематываем');
    assert.strictEqual(env.S.Smart.hasSkipped('1399', 'intro'), false, 'отмена «забывает» сериал');
    // без отмены — через 4 с перемотка
    const env2 = gotEnv();
    env2.S.Smart.rememberSkip('1399', 'intro');
    await startGot(env2);
    await env2.playTo(437, 437.25);
    await env2.advance(4100);
    assert.deepStrictEqual(env2.log.seeks, [531]);
});

// Android-приложение Lampa: «Назад» не приходит клавишей, а вызывает window.history.back -> popstate -> Activity.call
test('Android: «Назад» (history.back) во время отсчёта отменяет автопропуск и не закрывает плеер; потом «Назад» — как в Lampa', async () => {
    const env = gotEnv();
    env.S.Smart.rememberSkip('1399', 'intro');
    await startGot(env);
    await env.playTo(437, 437.25);
    assert.ok(env.button() && env.button().countdown, 'отсчёт');
    env.T.historyBack();
    assert.deepStrictEqual(env.log.events.filter((e) => /^controller\.back/.test(e)), [], 'плеер не закрыт');
    assert.ok(env.log.console.includes('[SkipIntro] Auto-skip cancelled by user'), env.log.console.slice(-3).join(' | '));
    assert.strictEqual(env.button(), null);
    await env.advance(5000);
    assert.deepStrictEqual(env.log.seeks, [], 'после отмены не перематываем');
    env.T.historyBack();
    assert.deepStrictEqual(env.log.events.filter((e) => /^controller\.back/.test(e)), ['controller.back:player'], 'следующее «Назад» закрывает плеер');
});

test('Android: после автопропуска по отсчёту и при обычной кнопке «Назад» (history.back) работает как в Lampa', async () => {
    const env = gotEnv();
    env.S.Smart.rememberSkip('1399', 'intro');
    await startGot(env);
    await env.playTo(437, 437.25);
    await env.advance(4100);
    assert.deepStrictEqual(env.log.seeks, [531]);
    env.T.historyBack();
    assert.deepStrictEqual(env.log.events.filter((e) => /^controller\.back/.test(e)), ['controller.back:player']);
    const env2 = gotEnv();
    await startGot(env2);
    await env2.playTo(437, 437.25);
    assert.ok(env2.button() && !env2.button().countdown, 'обычная кнопка');
    env2.T.historyBack();
    assert.deepStrictEqual(env2.log.events.filter((e) => /^controller\.back/.test(e)), ['controller.back:player']);
});

test('отмена клавишей «Назад», следом history.back в течение 1 с — плеер не закрывается; позже — закрывается', async () => {
    const env = gotEnv();
    env.S.Smart.rememberSkip('1399', 'intro');
    await startGot(env);
    await env.playTo(437, 437.25);
    assert.strictEqual(env.T.key(BACK, 'keydown'), true);
    env.T.historyBack();
    assert.deepStrictEqual(env.log.events.filter((e) => /^controller\.back/.test(e)), [], 'второе «Назад» того же нажатия проглочено');
    await env.advance(1500);
    env.T.historyBack();
    assert.deepStrictEqual(env.log.events.filter((e) => /^controller\.back/.test(e)), ['controller.back:player']);
});

test('клавиши: без кнопки OK уходит Lampa; долгое OK (≥ 800 мс) не перехватывается', async () => {
    const env = gotEnv();
    await startGot(env);
    await env.playTo(100, 100.5);
    env.T.press(OK);
    assert.deepStrictEqual(env.log.lampaKeys, ['enter']);
    await env.playTo(437, 437.5);
    env.T.key(OK, 'keydown');
    await env.advance(900);
    assert.strictEqual(env.T.key(OK, 'keyup'), false, 'долгое нажатие остаётся Lampa (у неё это «long»)');
    assert.deepStrictEqual(env.log.seeks, [], 'долгое нажатие — не пропуск');
    // другой контроллер (меню открыто) — клавиши не трогаем
    env.L.Controller._name = 'select';
    env.T.press(OK);
    assert.deepStrictEqual(env.log.seeks, []);
    env.L.Controller._name = 'player';
    env.T.press(OK);
    assert.deepStrictEqual(env.log.seeks, [531]);
});

test('кнопка скрывается через 10 с и в этом сегменте больше не показывается; после выхода из сегмента — снова', async () => {
    const env = gotEnv();
    await startGot(env);
    await env.playTo(437, 437.5);
    assert.ok(env.button().visible);
    await env.playTo(437.75, 448);
    assert.strictEqual(env.button(), null);
    await env.playTo(448.25, 450);
    assert.strictEqual(env.button(), null, 'в том же сегменте не возвращается');
    await env.playTo(300, 300.5);              // перемотали назад, вне сегмента
    await env.playTo(437, 437.5);
    assert.ok(env.button(), 'при новом входе в сегмент — снова кнопка');
});


test('сцена после титров (IntroDB post_credits): хвост не пропускаем дальше её начала', async () => {
    const env = gotEnv({ android: true, tidb: { S1E1: { intro: [] } },
        introdb: { 'tt0944947:S1E1': { intro: null, recap: null, outro: { start_sec: 3600, end_sec: 3690, confidence: 1, submission_count: 3 },
            post_credits: { start_sec: 3650, end_sec: 3680 }, no_intro: false, no_recap: false, no_outro: false } } });
    await startGot(env);
    await env.playTo(3600, 3600.5);
    const b = env.button();
    assert.strictEqual(b.label, 'Пропустить титры');
    assert.strictEqual(b.badge, '(после титров есть сцена)');
    env.T.press(OK);
    assert.deepStrictEqual(env.log.seeks, [3650]);
    assert.deepStrictEqual(env.log.events, [], 'к следующей серии не переходим');
});

test('предзагрузка: через 10 с после старта — таймкоды следующей серии (без глав); вторая серия берёт их из кэша', async () => {
    const env = gotEnv();
    await startGot(env);
    await env.advance(10000);
    const pre = env.requests(/theintrodb.*season=1&episode=2/);
    assert.strictEqual(pre.length, 1, 'TheIntroDB для S01E02 запрошен заранее');
    assert.match(pre[0].url, /duration_ms=3700000/, 'длина — как у текущей серии');
    assert.strictEqual(env.requests('tt0944947:1:2').length, 1, 'IntroHater тоже');
    await env.advance(15000);
    assert.strictEqual(env.requests(/episode=3|:1:3/).length, 0, 'только следующая серия');
    env.T.destroy();
    play(env, [ep(1), ep(2), ep(3)], 1);
    await env.advance(300); env.T.loaded(3705); await env.advance(1000);
    assert.strictEqual(env.requests(/theintrodb.*season=1&episode=2/).length, 1, 'длина ±10 с — запись из кэша');
    assert.match(env.S.Controller.describe(), /TheIntroDB: есть \(кэш\)/);
    await env.playTo(100, 100.5);
    assert.strictEqual(env.button().label, 'Пропустить заставку');
});

test('смена серии: поздние ответы прошлой серии не попадают в новую', async () => {
    const env = gotEnv({ tidb: { S1E1: () => ({ status: 200, body: { intro: [ms(437, 531)] }, delay: 3000 }) } });
    play(env, [ep(1), ep(2), ep(3)], 0);
    await env.advance(300); env.T.loaded(3700); await env.advance(1000);
    env.T.destroy();
    play(env, [ep(1), ep(2), ep(3)], 1);
    await env.advance(300); env.T.loaded(3400); await env.advance(6000);
    const segs = J(env.S.Controller._segments).map((x) => x.start);
    assert.deepStrictEqual(segs, [100], 'только заставка S01E02');
    assert.ok(env.S.Store.getRecord(env.clone({ tmdb: '1399', season: 1, episode: 1 }), 'theintrodb', 'L3700'), 'ответ S01E01 всё же сохранён в кэш');
});

test('ошибки сети и сервера не кэшируются: следующий запуск спрашивает снова', async () => {
    const env = gotEnv({ tidb: { S1E1: () => ({ status: 500, body: { error: 'x' } }) } });
    await startGot(env);
    assert.match(env.S.Controller.describe(), /TheIntroDB: ошибка сервера/);
    assert.match(env.S.Controller.describe(), /IntroDB: нет ответа \(возможно, CORS или нет сети\)/);
    assert.strictEqual(env.S.Store.getRecord(env.clone({ tmdb: '1399', season: 1, episode: 1 }), 'theintrodb', 'L3700'), null);
    assert.strictEqual(env.S.Health.get('theintrodb').st, 'http');
    assert.strictEqual(env.S.Health.get('introdb').st, 'network');
    env.T.destroy();
    await startGot(env);
    assert.strictEqual(env.requests('api.theintrodb.org').length, 2);
    assert.strictEqual(env.requests('api.introdb.app').length, 2);
});

test('IntroDB: на Android — через приложение (без CORS), иначе — через прокси из настроек', async () => {
    const env = gotEnv({ android: 17, tidb: { S1E1: { intro: [] } }, introdb: { 'tt0944947:S1E1': J(require('./fixtures/introdb_got.json')) } });
    await startGot(env);
    const r = env.requests('api.introdb.app');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].native, true, 'запрос через Lampa.Reguest().native (AndroidJS)');
    assert.strictEqual(J(env.S.Controller._segments)[0].src, 'introdb');
    assert.match(env.S.Diag.text('introdb'), /через приложение Android$/);
    // старое приложение Android (< 16) — обычный запрос
    const old = gotEnv({ android: 15 });
    assert.strictEqual(old.S.Sources.introdb.transport(), 'direct');
    // прокси
    const p = gotEnv({ settings: { skip_intro_introdb_proxy: 'https://proxy.example/{url}' }, tidb: { S1E1: { intro: [] } } });
    p.on('proxy.example/', (req) => ({ status: 200, body: J(require('./fixtures/introdb_got.json')), delay: 20 }), { cors: '*' });
    await startGot(p);
    const pr = p.requests('proxy.example');
    assert.strictEqual(pr.length, 1);
    assert.strictEqual(pr[0].url, 'https://proxy.example/https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1');
    assert.deepStrictEqual(J(p.S.Controller._segments).map((x) => [x.type, x.src]), [['intro', 'introdb'], ['credits', 'introdb']]);
    assert.match(p.S.Diag.text('introdb'), /через прокси$/);
});

test('диагностика: «Проверить сейчас» — только GET-запросы, итог в уведомлении; статусы в настройках', async () => {
    const env = gotEnv();
    env.setStorage('torrserver_url', 'torrserver.test:8090');
    env.on('api.aniskip.com/v2/skip-times/40028/1', { status: 200, body: { found: true, results: [{ interval: { startTime: 1, endTime: 80 }, skipType: 'op', skipId: 'x', episodeLength: 1435 }] } }, { cors: '*' });
    env.on('arm.haglund.dev/api/v2/themoviedb?id=1429', { status: 200, body: require('./fixtures/arm_1429.json') }, { cors: '*' });
    env.on('graphql.anilist.co', { status: 200, body: { data: { Page: { media: [] } } } }, { cors: '*' });
    env.on('torrserver.test:8090/ffp/status', { status: 404, text: '404 page not found' }, { cors: '*' });
    env.S.Diag.check();
    await env.advance(3000);
    const last = env.noty().pop();
    assert.match(last, /^TheIntroDB: работает; IntroDB: нет ответа \(возможно, CORS или нет сети\); IntroHater: работает \(для серии пусто\); Aniskip: работает; ARM: работает; AniList: работает; Главы MKV: недоступно/);
    const methods = env.net.requests.map((r) => r.method + ' ' + r.url.replace(/\?.*$/, ''));
    assert.ok(methods.every((m) => m.indexOf('POST') !== 0 || m === 'POST https://graphql.anilist.co'), 'кроме AniList (GraphQL) — только GET: ' + methods.join(', '));
    assert.match(env.S.Diag.text('theintrodb'), /^Работает, \d+ мс, только что$/);
    assert.match(env.S.Diag.text('introdb'), /^Нет ответа \(возможно, CORS или нет сети\), \d+ мс, только что · напрямую$/);
    assert.strictEqual(env.S.Diag.text('anilist').indexOf('Работает'), 0);
    const params = env.L.SettingsApi.params.filter((p) => /^skip_intro_diag_/.test(p.param.name)).map((p) => p.param.name);
    assert.deepStrictEqual(J(params), ['skip_intro_diag_t_diag'].slice(1).concat(['skip_intro_diag_version', 'skip_intro_diag_report', 'skip_intro_diag_marks', 'skip_intro_diag_theintrodb', 'skip_intro_diag_introdb', 'skip_intro_diag_introhater', 'skip_intro_diag_aniskip', 'skip_intro_diag_arm', 'skip_intro_diag_anilist', 'skip_intro_diag_chapters', 'skip_intro_diag_check', 'skip_intro_diag_clear', 'skip_intro_diag_stats', 'skip_intro_diag_stats_reset']));
    const ver = env.L.SettingsApi.params.filter((p) => p.param.name === 'skip_intro_diag_version')[0];
    assert.strictEqual(ver.field.name + ': ' + ver.field.description, 'Версия плагина: Skip Intro ' + PKG.version);
});

test('первая серия первого сезона: пересказ из баз не пропускается, запись в журнале; во второй серии — как обычно', async () => {
    const env = gotEnv({ android: 17, settings: { skip_intro_auto: true }, tidb: { S1E1: { group_duration_ms: 3700000, intro: [ms(437, 531, { confidence: 0.9, submission_count: 5 })],
        recap: [ms(531, 590, { confidence: 0.9, submission_count: 3 })], credits: [ms(3631.5, null, { confidence: 0.9, submission_count: 4 })] } },
    introdb: { 'tt0944947:S1E1': { intro: null, recap: { start_sec: 533, end_sec: 600, confidence: 1, submission_count: 1 }, outro: null, post_credits: null } } });
    await startGot(env);
    assert.deepStrictEqual(J(env.S.Controller._segments).map((x) => x.type + ' ' + x.src), ['intro theintrodb', 'credits theintrodb']);
    const lines = ['First episode: recap from the databases ignored \u2014 introdb 8:53\u201310:00',
        'First episode: recap from the databases ignored \u2014 theintrodb 8:51\u20139:50'];
    for (const line of lines) {
        assert.strictEqual(env.log.console.filter((l) => l === '[SkipIntro] ' + line).length, 1, env.log.console.join(' | '));
        assert.ok(env.S.Journal.list().some((x) => x.m === line), 'строка есть в отчёте: ' + line);
    }
    await env.playTo(531, 545);
    assert.ok(!env.log.seeks.some((t) => t >= 589 && t <= 601), 'пересказ 8:51-9:50 не пропущен: ' + J(env.log.seeks));
    const e2 = gotEnv({ tidb: { S1E2: { group_duration_ms: 3400000, intro: [ms(100, 190, { confidence: 0.9, submission_count: 5 })], recap: [ms(10, 60, { confidence: 0.9, submission_count: 3 })] } } });
    await startGot(e2, 1, { duration: 3400 });
    assert.deepStrictEqual(J(e2.S.Controller._segments).map((x) => x.type + ' ' + x.src), ['recap theintrodb', 'intro theintrodb']);
    assert.ok(!e2.log.console.some((l) => /First episode/.test(l)));
});

test('отчёт для разработчика: версия, изменённые настройки, источники, отметки и журнал без адресов; журнал в localStorage', async () => {
    const env = gotEnv();
    env.setStorage('skip_intro_auto', true);
    env.setStorage('skip_intro_introdb_proxy', 'https://proxy.example.test/{url}');
    await startGot(env);
    await env.playTo(10, 10.5);
    env.S.Journal.add(['Test request http://203.0.113.10:8090/stream/Some.Movie.mkv token=abc123 failed']);
    const text = env.S.Report.lines().map((l) => l.c + ': ' + l.t).join('\n');
    assert.match(text, /^hint: Сфотографируйте экран; стрелки вверх и вниз — прокрутка\. Адреса серверов, названия файлов и ключи скрыты\nh: Версия и устройство\n/);
    assert.ok(text.indexOf('l: Skip Intro ' + PKG.version + ' \u00b7 Lampa ') >= 0, text);
    assert.match(text, /h: Изменённые настройки\nl: auto: true · introdb_proxy: задано\n/);
    assert.match(text, /h: Источники\nl: TheIntroDB — Работает, \d+ мс, только что\nl: IntroDB — Нет ответа[^\n]*· через прокси\nl: IntroHater — Работает \(для серии пусто\)/);
    assert.match(text, /h: Отметки на шкале \(последний просмотр\)\nl: Нарисовал плагин: 2, длина видео 1:01:40, только что\n/);
    assert.match(text, /\nlog: \d\d:\d\d:\d\d Source theintrodb: ok 2\n/);
    assert.match(text, /\nlog: \d\d:\d\d:\d\d Segments: intro 7:17–8:51 theintrodb, credits 1:00:32–1:01:40 theintrodb \| length 3700 s\n/);
    assert.match(text, /\nlog: \d\d:\d\d:\d\d Test request <url> token=<hidden> failed$/);
    assert.ok(!/203\.0\.113|proxy\.example|Some\.Movie|abc123/.test(text), 'в отчёте нет адресов, файлов и ключей');
    const log = text.split('\n').filter((l) => /^log: /.test(l));
    assert.match(text, new RegExp('h: Журнал \\(последние ' + log.length + '\\)'));
    await env.advance(3500);
    const saved = JSON.parse(env.W.localStorage.getItem('skip_intro_journal'));
    assert.strictEqual(saved.length, log.length, 'журнал сохранён для отчёта после перезапуска Lampa');
    assert.ok(JSON.stringify(saved).indexOf('203.0.113') < 0);
    for (let i = 0; i < 50; i++) env.S.Journal.add(['line ' + i]);
    assert.strictEqual(env.S.Journal.list().length, 40, 'не больше 40 строк');
    assert.strictEqual(env.S.Report.lines().filter((l) => l.c === 'log').length, 30, 'в отчёте последние 30');
    env.S.Report.open();
    assert.strictEqual(env.noty().pop(), 'Окно отчёта недоступно в этой версии Lampa', 'без Lampa.Modal — понятное сообщение');
    assert.strictEqual(env.errors.length, 0, J(env.errors.map((e) => e.where + ' ' + e.e.message)));
});

test('меню карточки «⋯»: режим сериала «Выключен» — плагин молчит и ничего не запрашивает', async () => {
    const env = gotEnv();
    const e = env.clone({ type: 'options', link: { card: GOT }, options: [] });
    env.L.Listener.send('full', e);
    assert.strictEqual(e.options.length, 1);
    assert.strictEqual(e.options[0].title, 'Пропуск заставок');
    e.options[0].onSelect();
    assert.deepStrictEqual(J(env.lastSelect().items.map((i) => i.title)), ['Режим: как в настройках', 'Сдвиг таймкодов: нет', 'Сбросить кэш таймкодов', 'Забыть пропуски (умный режим)']);
    env.pick('Режим:');
    assert.deepStrictEqual(J(env.lastSelect().items.map((i) => [i.title, !!i.selected])), [['Как в настройках', true], ['Всегда автопропуск', false], ['Только кнопка', false], ['Выключен', false]]);
    env.pick('Выключен');
    assert.strictEqual(env.lastSelect().items[0].title, 'Режим: выключен', 'меню сериала открылось снова с новым значением');
    await startGot(env);
    assert.strictEqual(env.requests('theintrodb').length, 0);
    assert.strictEqual(env.S.Controller.describe(), 'Для этого сериала пропуск выключен');
    await env.playTo(437, 437.5);
    assert.strictEqual(env.button(), null);
});

test('режим сериала «Всегда автопропуск» при выключенном общем автопропуске; «Только кнопка» — без отсчёта', async () => {
    const env = gotEnv();
    env.S.Series.set('1399', { mode: 'auto' });
    await startGot(env);
    await env.playTo(437, 437.25);
    assert.deepStrictEqual(env.log.seeks, [531]);
    const env2 = gotEnv({ settings: { skip_intro_auto: 'true' } });
    env2.S.Series.set('1399', { mode: 'button' });
    env2.S.Smart.rememberSkip('1399', 'intro');
    await startGot(env2);
    await env2.playTo(437, 437.5);
    assert.deepStrictEqual(env2.log.seeks, []);
    assert.strictEqual(env2.button().countdown, false);
});

test('сдвиг таймкодов сериала +2 с: данные баз сдвигаются, ваши отметки — нет; смена прямо во время просмотра', async () => {
    const env = gotEnv({ settings: { skip_intro_key_menu: 'red' } });
    await startGot(env);
    await env.playTo(10, 10.25);
    env.T.press(403);
    let sel = env.lastSelect();
    assert.strictEqual(sel.title, 'Пропуск заставок');
    env.pick('Сдвиг таймкодов');
    env.pick('+2 с');
    assert.strictEqual(env.S.Series.get('1399').shift, 2);
    const segs = J(env.S.Controller._segments);
    assert.deepStrictEqual(segs.map((x) => [x.type, x.start, x.shift]), [['intro', 439, 2], ['credits', 3633.5, 2]]);
    assert.match(env.S.Controller.describe(), /^Заставка 7:19–8:53 \(TheIntroDB, сдвиг \+2 с\)/);
    assert.deepStrictEqual(env.log.toggles.slice(-1), [], 'после выбора меню переоткрыто, контроллер не переключён');
});

test('ручная отметка из меню плеера: начало и конец, сохраняется и сразу работает; удаление', async () => {
    const env = gotEnv({ settings: { skip_intro_key_menu: 'blue' }, tidb: { S1E1: { intro: [] } } });
    await startGot(env);
    await env.playTo(60, 60.25);
    env.T.press(406);
    assert.deepStrictEqual(J(env.lastSelect().items.slice(0, 5).map((i) => i.title)), ['Эта серия', 'Отметить: заставка', 'Отметить: титры', 'Отметить: рекап', 'Отметить: превью']);
    env.pick('Отметить: заставка');
    assert.match(env.noty().pop(), /^Начало отмечено: 1:00\./);
    await env.playTo(150, 150.25);
    env.T.press(406);
    const end = env.lastSelect().items[1];
    assert.strictEqual(end.title, 'Конец отметки: заставка');
    assert.strictEqual(end.subtitle, '1:00 \u2014 2:30');
    env.pick('Конец отметки');
    assert.strictEqual(env.noty().pop(), 'Заставка отмечена: 1:00 \u2014 2:30');
    await env.advance(2000);
    assert.deepStrictEqual(J(env.S.Controller._segments).map((x) => [x.type, x.start, x.end, x.src]), [['intro', 60.25, 150.25, 'user']]);
    env.T.destroy();
    await startGot(env);
    await env.playTo(60, 60.5);
    assert.strictEqual(env.button().label, 'Пропустить заставку');
    env.T.press(406);
    env.pick('Удалить мои отметки серии');
    await env.advance(2000);
    assert.deepStrictEqual(J(env.S.Controller._segments), []);
});

test('цветные кнопки с keyCode 0 (Tanix TX9): меню открывается по имени клавиши ColorF3Blue', async () => {
    const env = gotEnv({ settings: { skip_intro_key_menu: 'blue' }, tidb: { S1E1: { intro: [] } } });
    await startGot(env);
    await env.playTo(60, 60.25);
    assert.strictEqual(env.T.key(0, 'keydown', 'ColorF0Red'), false, 'красная — не кнопка меню, Lampa получает её как обычно');
    assert.strictEqual(env.T.key(0, 'keydown', 'ColorF3Blue'), true, 'синяя забрана у Lampa');
    assert.strictEqual(env.lastSelect().items[0].title, 'Эта серия');
    env.T.key(0, 'keyup', 'ColorF3Blue');
    assert.strictEqual(env.T.key(0, 'keydown'), false, 'keyCode 0 без имени клавиши не трогаем');
});

test('Aniskip (аниме): ARM -> AniList -> skip-times; AoT S4E17 = MAL 48583 серия 1; кнопка «≈ Aniskip» для приблизительных', async () => {
    const env = setup();
    tidb(env, {});
    env.on('arm.haglund.dev/api/v2/themoviedb?id=1429', { status: 200, body: require('./fixtures/arm_1429.json'), delay: 30 }, { cors: '*' });
    env.on('graphql.anilist.co', (req) => ({ status: 200, body: require('./fixtures/anilist_ids.json'), delay: 30 }), { cors: '*', method: 'POST' });
    env.on('api.aniskip.com/v2/skip-times/48583/1?', (req) => {
        const len = +new URL(req.url).searchParams.get('episodeLength');
        if (len === 0) return { status: 200, body: { found: true, results: [
            { interval: { startTime: 70, endTime: 160 }, skipType: 'op', skipId: 'op1', episodeLength: 1440 },
            { interval: { startTime: 1330, endTime: 1420 }, skipType: 'ed', skipId: 'ed1', episodeLength: 1440 }] } };
        return { status: 404, body: { found: false, results: [], message: 'No episode found', statusCode: 404 } };
    }, { cors: '*' });
    const list = [{ title: 'Episode 17', season: 4, episode: 17, url: 'https://cdn.example/aot/s4e17.mp4' }, { title: 'Episode 18', season: 4, episode: 18, url: 'https://cdn.example/aot/s4e18.mp4' }];
    play(env, list, 0, { card: AOT });
    await env.advance(300); env.T.loaded(1430); await env.advance(1500);
    const ani = env.requests('api.aniskip.com/v2/skip-times/');
    assert.deepStrictEqual(J(ani.map((r) => r.url.replace(/\?.*episodeLength=/, '?len='))), ['https://api.aniskip.com/v2/skip-times/48583/1?len=1430', 'https://api.aniskip.com/v2/skip-times/48583/1?len=0']);
    assert.strictEqual(J(env.net.requests.find((r) => r.url.indexOf('anilist') !== -1).body).indexOf('idMal_in') !== -1, true);
    const segs = J(env.S.Controller._segments);
    assert.deepStrictEqual(segs.map((x) => [x.type, x.src, !!x.approx]), [['intro', 'aniskip', true], ['credits', 'aniskip', true]]);
    assert.deepStrictEqual(J(env.S.Controller.aniskipTarget()), { mal: 48583, ep: 1 });
    await env.playTo(70, 70.5);
    assert.strictEqual(env.button().badge, '\u2248 Aniskip');
    // повторный запуск: ARM/AniList/правила — из кэша
    env.T.destroy();
    play(env, list, 1, { card: AOT });
    await env.advance(300); env.T.loaded(1430); await env.advance(1500);
    assert.strictEqual(env.requests('arm.haglund').length, 1);
    assert.strictEqual(env.requests('graphql.anilist').length, 1);
    assert.strictEqual(env.requests('skip-times/48583/2').length, 2);
});

test('Aniskip: нет таймкодов у части — правила relation-rules переводят на другую запись MAL', async () => {
    const env = setup();
    tidb(env, {});
    env.on('arm.haglund.dev', { status: 200, body: [{ myanimelist: 40028, media: 'TV', 'themoviedb-season': 4 }] }, { cors: '*' });
    env.on('api.aniskip.com/v2/skip-times/40028/17', { status: 404, body: { found: false, results: [] } }, { cors: '*' });
    env.on('api.aniskip.com/v2/relation-rules/40028', { status: 200, body: require('./fixtures/aniskip_rr.json') }, { cors: '*' });
    env.on('api.aniskip.com/v2/skip-times/48583/1', { status: 200, body: { found: true, results: [{ interval: { startTime: 70, endTime: 160 }, skipType: 'op', skipId: 'z', episodeLength: 1430 }] } }, { cors: '*' });
    play(env, [{ title: 'x', season: 4, episode: 17, url: 'https://cdn.example/a.mp4' }], 0, { card: AOT });
    await env.advance(300); env.T.loaded(1430); await env.advance(2000);
    assert.deepStrictEqual(J(env.S.Controller.aniskipTarget()), { mal: 48583, ep: 1 });
    assert.deepStrictEqual(J(env.S.Controller._segments).map((x) => [x.type, x.start, x.end]), [['intro', 70, 160]]);
});

test('помощь Aniskip: только по команде и при включённой настройке; POST с submitterId, голос «против»', async () => {
    const env = setup({ settings: { skip_intro_key_menu: 'red' } });
    tidb(env, {});
    env.on('arm.haglund.dev', { status: 200, body: [{ myanimelist: 40028, media: 'TV', 'themoviedb-season': 4 }] }, { cors: '*' });
    env.on('api.aniskip.com/v2/skip-times/40028/1?', { status: 200, body: { found: true, results: [{ interval: { startTime: 70, endTime: 160 }, skipType: 'op', skipId: 'sk-1', episodeLength: 1430 }] } }, { cors: '*' });
    const posts = [];
    env.on('api.aniskip.com/v2/skip-times/', (req) => { if (req.method === 'POST') { posts.push(req); return { status: 200, body: { message: 'ok' } }; } return undefined; }, { cors: '*' });
    play(env, [{ title: 'x', season: 4, episode: 1, url: 'https://cdn.example/a.mp4' }], 0, { card: AOT });
    await env.advance(300); env.T.loaded(1430); await env.advance(2000);
    env.S.UserMarks.add(env.S.Controller._ctx, env.clone({ type: 'credits', start: 1340, end: 1425 }), 1430);
    await env.playTo(80, 80.25);
    env.T.press(403);
    let titles = J(env.lastSelect().items.map((i) => i.title));
    assert.ok(titles.every((t) => t.indexOf('Aniskip:') !== 0), 'без настройки пунктов Aniskip нет: ' + titles.join(' | '));
    env.setStorage('skip_intro_aniskip_submit', 'true');
    env.T.press(403);
    titles = J(env.lastSelect().items.map((i) => i.title));
    assert.ok(titles.indexOf('Aniskip: таймкод неверный') !== -1 && titles.indexOf('Aniskip: отправить мои отметки') !== -1, titles.join(' | '));
    env.pick('Aniskip: отправить мои отметки');
    env.T.press(403);
    env.pick('Aniskip: таймкод неверный');
    await env.advance(500);
    assert.strictEqual(posts.length, 2);
    const sub = JSON.parse(posts[0].body);
    assert.strictEqual(posts[0].url, 'https://api.aniskip.com/v2/skip-times/40028/1');
    assert.deepStrictEqual(Object.keys(sub).sort(), ['endTime', 'episodeLength', 'providerName', 'skipType', 'startTime', 'submitterId']);
    assert.strictEqual(sub.skipType, 'ed');
    assert.match(sub.submitterId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.strictEqual(posts[1].url, 'https://api.aniskip.com/v2/skip-times/vote/sk-1');
    assert.deepStrictEqual(JSON.parse(posts[1].body), { voteType: 'downvote' });
    assert.ok(env.noty().indexOf('Отправлено в Aniskip: 1') !== -1 && env.noty().indexOf('Голос отправлен в Aniskip') !== -1, env.noty().join(' | '));
});

test('эвристика по субтитрам: баз нет — заставка по паузе в SRT, только кнопкой (даже при автопропуске), кэш на 30 дней', async () => {
    const env = gotEnv({ settings: { skip_intro_auto: 'true' }, tidb: { S1E1: { intro: [] } } });
    const lines = [];
    const at = (s) => '00:' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + ',000';
    [5, 12, 20, 28, 35, 160, 170, 180, 190, 200].forEach((s, i) => lines.push((i + 1) + '\n' + at(s) + ' --> ' + at(s + 4) + '\nреплика\n'));
    env.on('cdn.example/subs/ru.srt', { status: 200, text: lines.join('\n') }, { cors: '*' });
    await startGot(env, 0, { customSubs: [{ label: 'Русские', url: 'https://cdn.example/subs/ru.srt' }] });
    await env.advance(2000);
    assert.deepStrictEqual(J(env.S.Controller._segments).map((x) => [x.type, x.start, x.end, x.src]), [['intro', 39, 160, 'subs']]);
    await env.playTo(39, 39.5);
    assert.deepStrictEqual(env.log.seeks, [], 'эвристика не перематывает сама');
    assert.strictEqual(env.button().badge, '(по субтитрам)');
    assert.ok(env.marks()[0].cls.indexOf('skip-intro-mark--weak') !== -1, 'на шкале — бледной отметкой');
    env.T.destroy();
    await startGot(env, 0, { customSubs: [{ label: 'Русские', url: 'https://cdn.example/subs/ru.srt' }] });
    await env.advance(2000);
    assert.strictEqual(env.requests('subs/ru.srt').length, 1, 'второй раз — из кэша');
});

test('эвристика по ASS (customSubs, формат ass): песни OP/ED -> заставка и титры, только кнопкой', async () => {
    const env = gotEnv({ settings: { skip_intro_auto: 'true' }, tidb: { S1E1: { intro: [] } } });
    const t = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h + ':' + String(m).padStart(2, '0') + ':' + String(x.toFixed(2)).padStart(5, '0'); };
    const lines = ['[Script Info]', '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
    for (let s = 90; s < 180; s += 6) lines.push('Dialogue: 0,' + t(s) + ',' + t(s + 5) + ',OP,,0,0,0,,{\\k20}la {\\k30}la');
    for (let s = 200; s < 1250; s += 20) lines.push('Dialogue: 0,' + t(s) + ',' + t(s + 4) + ',Default,,0,0,0,,Реплика');
    for (let s = 1300; s < 1385; s += 5) lines.push('Dialogue: 0,' + t(s) + ',' + t(s + 4) + ',ED,,0,0,0,,ending');
    env.on('cdn.example/subs/ep1.ass', { status: 200, text: lines.join('\r\n') }, { cors: '*' });
    await startGot(env, 0, { duration: 1420, customSubs: [{ label: 'RU ASS', format: 'ass', url: 'https://cdn.example/subs/ep1.ass' }, { label: 'RU', url: 'https://cdn.example/subs/ep1.srt' }] });
    await env.advance(2000);
    assert.deepStrictEqual(J(env.S.Controller._segments).map((x) => [x.type, x.start, x.end, x.src]), [['intro', 89, 180, 'ass'], ['credits', 1299, 1385, 'ass']]);
    assert.strictEqual(env.requests('ep1.srt').length, 0, 'ASS приоритетнее SRT');
    await env.playTo(89, 89.5);
    assert.deepStrictEqual(env.log.seeks, [], 'эвристика не перематывает сама');
    assert.strictEqual(env.button().badge, '(по субтитрам ASS)');
});

test('эвристика не запускается, если база честно сказала «заставки нет» (IntroDB no_intro)', async () => {
    const env = gotEnv({ android: true, tidb: { S1E1: { intro: [] } },
        introdb: { 'tt0944947:S1E1': { intro: null, recap: null, outro: null, post_credits: null, no_intro: true, no_recap: false, no_outro: true } } });
    env.on('cdn.example/subs/ru.srt', { status: 200, text: '' }, { cors: '*' });
    await startGot(env, 0, { customSubs: [{ label: 'Русские', url: 'https://cdn.example/subs/ru.srt' }] });
    await env.advance(2000);
    assert.strictEqual(env.requests('subs/ru.srt').length, 0);
});

test('главы MKV через TorrServer /ffp (авторизация как в Lampa) — приоритетнее баз', async () => {
    const H = 'abcdef0123456789abcdef0123456789abcdef01';
    const env = gotEnv({ settings: { torrserver_url: 'http://torrserver.test:8090', torrserver_auth: 'true', torrserver_login: 'user', torrserver_password: 'pa:ss' } });
    env.on('torrserver.test:8090/ffp/' + H + '/2', { status: 200, body: { format: { duration: '3700' }, streams: [], chapters: [
        { start_time: '0', end_time: '430', tags: { title: 'Chapter 1' } }, { start_time: '430', end_time: '525', tags: { title: 'Opening' } }] }, delay: 200 }, { cors: '*' });
    const url = 'http://torrserver.test:8090/stream/GoT.S01E01.mkv?link=' + H + '&index=2&play';
    await startGot(env, 0, { data: { url, torrent_hash: H } });
    const ff = env.requests('/ffp/');
    assert.strictEqual(ff.length, 1);
    assert.strictEqual(ff[0].headers.Authorization, 'Basic ' + Buffer.from('user:pa:ss').toString('base64'));
    assert.deepStrictEqual(J(env.S.Controller._segments).map((x) => [x.type, x.start, x.end, x.src]), [['intro', 430, 525, 'chapters'], ['credits', 3631.5, 1e7, 'theintrodb']]);
    assert.strictEqual(env.W.__lampa_ffp__.v, 1, 'общий кэш ffprobe для «Адаптивных субтитров»');
});

test('передача таймкодов в Lampa (эксперимент): на create кладём data.segments из кэша; своя кнопка не показывается', async () => {
    const env = gotEnv({ settings: { skip_intro_native: 'true' } });
    await startGot(env);
    env.T.destroy();
    const list = env.clone([ep(1), ep(2), ep(3)]);
    list[0].card = env.clone(GOT);
    let seen = null;
    env.L.Player.listener.follow('start', (d) => { seen = J(d.segments); });
    env.T.play(list[0], { playlist: list, position: 0 });
    assert.deepStrictEqual(seen, { skip: [{ start: 437, end: 531 }], ad: [], _skip_intro: true });
    await env.advance(300); env.T.loaded(3700); await env.advance(1500);
    await env.playTo(437, 437.5);
    assert.strictEqual(env.button(), null);
    assert.match(env.S.Controller.describe(), /переданы в Lampa\. Отметки на шкале рисует Lampa$/);
    // тот же объект при повторном запуске: наши прошлые сегменты убираются и кладутся заново
    env.T.destroy();
    env.setStorage('skip_intro_native', 'false');
    env.T.play(list[0], { playlist: list, position: 0 });
    assert.strictEqual(list[0].segments, undefined);
});

// Таймкоды от источника видео (балансер, data.segments) пропускает плагин по своим настройкам; Lampa на 'start' получает пустые
const SRC = { skip: [{ start: 0, end: 30 }, { start: 437, end: 531 }, { start: 3640, end: 3700 }], ad: [{ start: 1800, end: 1830 }] };
const lampaMarks = (env) => env.W.document.querySelectorAll('.player-panel__timeline-segments .player-panel__timeline-segment').length;

test('таймкоды от источника видео — по настройкам плагина: Lampa получает пустые сегменты, кнопка «Пропустить заставку» с 0:00 при неизвестной длине', async () => {
    const env = gotEnv();
    const data = play(env, [ep(1), ep(2), ep(3)], 0, { data: { segments: SRC } });
    assert.strictEqual(lampaMarks(env), 0, 'у Lampa сегментов нет — ни её отметок, ни её пропуска');
    assert.deepStrictEqual(J(data.segments), SRC, 'после рассылки start data.segments вернулись как были (для playdata и внешних плееров)');
    assert.ok(env.log.console.includes('[SkipIntro] Video source segments are skipped by the plugin settings (Lampa got none): ' +
        'skip 0:00\u20130:30, skip 7:17\u20138:51, skip 1:00:40\u20131:01:40, ad 30:00\u201330:30'), env.log.console.slice(-4).join(' | '));
    await env.advance(300);
    env.T.loaded(NaN);
    await env.advance(300);
    env.T.tick(0.3);
    await env.advance(250);
    let b = env.button();
    assert.ok(b && b.visible, 'кнопка плагина');
    assert.strictEqual(b.label, 'Пропустить заставку');
    assert.strictEqual(env.T.video().currentTime, 0.3, 'автопропуск в плагине выключен — сами не перематываем');
    env.T.press(OK);
    assert.strictEqual(env.T.video().currentTime, 30, 'длина NaN: позицию ставим сами (PlayerVideo.to в Lampa 3.4.4 при NaN не перематывает)');
    assert.deepStrictEqual(env.log.bell, [], 'уведомление Lampa — только после её пропуска');
    assert.ok(/^Заставка 0:00\u20130:30 \(источник видео\); Заставка 7:17\u20138:51 \(источник видео\); Реклама 30:00\u201330:30 \(источник видео\); Титры 1:00:40\u20131:01:40 \(источник видео\)\./
        .test(env.S.Controller.describe()), env.S.Controller.describe());
    // длина известна: реклама — «Пропустить рекламу», титры у конца файла — «Следующая серия»
    env.T.tick(1794, 3700);
    await env.advance(250);
    await env.playTo(1795, 1795.5);
    assert.strictEqual(env.warn().text, 'Реклама через 5 с');
    await env.playTo(1800, 1800.5);
    assert.strictEqual(env.button().label, 'Пропустить рекламу');
    env.T.press(OK);
    assert.deepStrictEqual(env.log.seeks, [1830]);
    await env.playTo(3640, 3640.5);
    b = env.button();
    assert.strictEqual(b.label, 'Следующая серия');
    assert.strictEqual(b.sub, 'S01E02 \u2014 The Kingsroad');
    env.T.press(OK);
    assert.deepStrictEqual(env.log.events, ['to_end', 'setEnd', 'next']);
    assert.strictEqual(lampaMarks(env), 0);
    assert.strictEqual(env.errors.length, 0, J(env.errors.map((e) => e.where + ' ' + e.e.message)));
});

test('таймкоды от источника видео + автопропуск плагина: заставка с 0:00 перематывается сама, титры -> следующая серия; отметки рисует плагин', async () => {
    const env = gotEnv({ settings: { skip_intro_auto: 'true' } });
    play(env, [ep(1), ep(2), ep(3)], 0, { data: { segments: SRC } });
    await env.advance(300);
    env.T.loaded(NaN);
    await env.advance(300);
    env.T.tick(0.3);
    await env.advance(250);
    assert.strictEqual(env.T.video().currentTime, 30);
    assert.strictEqual(env.button(), null);
    assert.ok(env.log.console.includes('[SkipIntro] Skipped intro to 30 (auto)'), env.log.console.slice(-4).join(' | '));
    env.T.tick(31, 3700);
    await env.advance(250);
    await env.playTo(31.25, 31.5);
    const m = env.marks();
    assert.deepStrictEqual(J(m.map((x) => /skip-intro-mark--(\w+)/.exec(x.cls)[1])), ['intro', 'intro', 'ad', 'credits'], JSON.stringify(m));
    assert.ok(Math.abs(m[1].left - 437 / 3700 * 100) < 1e-6, J(m[1]));
    assert.strictEqual(env.S.LastMarks.get().mode, 'source');
    assert.strictEqual(env.S.Diag.marksText(), 'Нарисовал плагин: 4 \u00b7 таймкоды от источника видео, по настройкам плагина, длина видео 1:01:40, только что');
    await env.playTo(1800, 1800.25);
    assert.deepStrictEqual(env.log.seeks, [1830], 'реклама — тоже автоматически');
    await env.playTo(3640, 3640.25);
    assert.deepStrictEqual(env.log.events, ['to_end', 'setEnd', 'next']);
    assert.strictEqual(env.errors.length, 0);
});

test('таймкоды от источника видео: выключенные в плагине титры не пропускаются; реклама — тип плагина «Реклама»', async () => {
    const env = gotEnv({ settings: { skip_intro_auto: 'true', skip_intro_type_credits: 'false' } });
    play(env, [ep(1), ep(2), ep(3)], 0, { data: { segments: SRC } });
    await env.advance(300); env.T.loaded(3700); await env.advance(1500);
    await env.playTo(3640, 3641);
    assert.deepStrictEqual(env.log.events, []);
    assert.strictEqual(env.button(), null);
    assert.strictEqual(env.marks().length, 3);
});

test('таймкоды от источника видео: передача таймкодов в Lampa включена или плагин выключен — пропускает Lampa, как раньше', async () => {
    for (const settings of [{ skip_intro_native: 'true' }, { skip_intro_enabled: 'false' }]) {
        const env = gotEnv({ settings });
        const data = play(env, [ep(1), ep(2), ep(3)], 0, { data: { segments: { skip: [{ start: 400, end: 500 }], ad: [] } } });
        await env.advance(300); env.T.loaded(3700); await env.advance(1000);
        assert.strictEqual(lampaMarks(env), 1, J(settings));
        assert.strictEqual(data.segments.skip.length, 1);
        assert.strictEqual(env.requests('theintrodb').length, 0);
        if (settings.skip_intro_native) {
            assert.strictEqual(env.S.Controller.describe(), 'Таймкоды передал источник видео \u2014 работает встроенный пропуск Lampa');
            assert.ok(env.log.console.includes('[SkipIntro] Source segments: skip 6:40\u20138:20'));
        }
        await env.playTo(400, 401);
        assert.strictEqual(env.button(), null);
    }
});

test('таймкоды от источника видео: не серия и не фильм (нет карточки) — data.segments не трогаем', async () => {
    const env = gotEnv();
    play(env, [ep(1), ep(2), ep(3)], 0, { card: false, data: { segments: { skip: [{ start: 400, end: 500 }], ad: [] } } });
    assert.strictEqual(lampaMarks(env), 1);
    assert.ok(env.log.console.includes('[SkipIntro] Not a series/movie or missing metadata \u2014 idle'));
});

const HELPED = 'Встроенный пропуск Lampa не сработал (длина видео ещё неизвестна) \u2014 пропустил плагин: ';

test('передача в Lampa включена, источник передал таймкоды, длина видео неизвестна: пропуск Lampa 3.4.4 упал бы на currentTime = NaN — перематывает плагин, один раз на сегмент', async () => {
    const env = gotEnv({ settings: { skip_intro_native: 'true' } });
    play(env, [ep(1), ep(2), ep(3)], 0, { data: { segments: { skip: [{ start: 0, end: 30 }, { start: 437, end: 531 }], ad: [] } } });
    await env.advance(300);
    env.T.loaded(NaN);
    await env.advance(300);
    assert.ok(env.log.console.includes('[SkipIntro] Source segments: skip 0:00\u20130:30, skip 7:17\u20138:51'), env.log.console.slice(-5).join(' | '));
    env.T.tick(0.3);
    await env.advance(250);
    assert.strictEqual(env.T.video().currentTime, 30);
    assert.deepStrictEqual(env.log.seeks, [], 'не через PlayerVideo.to: в Lampa 3.4.4 он при длине NaN тоже не перематывает');
    assert.deepStrictEqual(env.log.bell, ['Сегмент пропущен'], 'то же уведомление, что у Lampa после её пропуска');
    assert.deepStrictEqual(env.noty(), [], 'своего сообщения нет');
    assert.ok(env.log.console.includes('[SkipIntro] Lampa\'s built-in skip cannot work while the video length is unknown (skip 0:00\u20130:30) \u2014 plugin skips to 0:30'),
        env.log.console.slice(-5).join(' | '));
    env.T.tick(30.25);
    await env.advance(250);
    assert.ok(env.log.console.includes('[SkipIntro] Plugin skip worked, position 0:30'));
    assert.strictEqual(env.S.Controller.describe(), 'Таймкоды передал источник видео \u2014 работает встроенный пропуск Lampa. ' + HELPED + '1. ' +
        'Отметки на шкале: нет \u2014 длина видео неизвестна');
    // вернулись в тот же сегмент — как Lampa (segment.viewed), второй раз не пропускаем
    env.T.tick(10);
    await env.advance(1500);
    env.T.tick(11);
    await env.advance(250);
    assert.strictEqual(env.T.video().currentTime, 11);
    // длина стала известна — Lampa пропускает сама, плагин не вмешивается
    env.T.tick(437.2, 3700);
    await env.advance(250);
    assert.strictEqual(env.T.video().currentTime, 437.2);
    assert.strictEqual(env.log.bell.length, 1);
    assert.strictEqual(env.errors.length, 0);
});

test('пропуск вместо Lampa: реклама — по настройке Lampa для рекламы, как в Lampa (L25002-25003)', async () => {
    const segs = { segments: { skip: [{ start: 300, end: 390 }], ad: [{ start: 0, end: 30 }] } };
    const env = gotEnv({ settings: { skip_intro_native: 'true' } });
    env.setStorage('player_segments_skip', 'auto');
    env.setStorage('player_segments_ad', 'user');
    play(env, [ep(1), ep(2), ep(3)], 0, { data: segs });
    await env.advance(300); env.T.loaded(NaN); await env.advance(300);
    env.T.tick(0.3);
    await env.advance(250);
    assert.strictEqual(env.T.video().currentTime, 0.3, 'реклама «вручную» — не перематываем');
    const env2 = gotEnv({ settings: { skip_intro_native: 'true' } });
    env2.setStorage('player_segments_skip', 'user');
    env2.setStorage('player_segments_ad', 'auto');
    play(env2, [ep(1), ep(2), ep(3)], 0, { data: segs });
    await env2.advance(300); env2.T.loaded(NaN); await env2.advance(300);
    env2.T.tick(0.3);
    await env2.advance(250);
    assert.strictEqual(env2.T.video().currentTime, 30, 'реклама «автоматически» — перематываем');
});

test('пропуск вместо Lampa: в настройках Lampa «вручную» — не вмешиваемся; позиция не сменилась — ещё 2 попытки раз в секунду', async () => {
    const segs = { segments: { skip: [{ start: 0, end: 30 }], ad: [] } };
    const env = gotEnv({ settings: { skip_intro_native: 'true' } });
    env.setStorage('player_segments_skip', 'user');
    play(env, [ep(1), ep(2), ep(3)], 0, { data: segs });
    await env.advance(300); env.T.loaded(NaN); await env.advance(300);
    env.T.tick(0.3);
    await env.advance(250);
    assert.strictEqual(env.T.video().currentTime, 0.3);
    assert.deepStrictEqual(env.log.bell, []);
    // «автоматически», но плеер не принял позицию (тик снова 0,5 с): повтор через 1 с, после трёх попыток — запись в журнал
    const env2 = gotEnv({ settings: { skip_intro_native: 'true' } });
    play(env2, [ep(1), ep(2), ep(3)], 0, { data: segs });
    await env2.advance(300); env2.T.loaded(NaN); await env2.advance(300);
    const tries = [];
    for (let i = 0; i < 6; i++) {
        env2.T.tick(0.5 + i * 0.25);
        await env2.advance(10);
        tries.push(env2.T.video().currentTime);
        await env2.advance(1000);
    }
    assert.deepStrictEqual(tries, [30, 30, 30, 1.25, 1.5, 1.75]);
    assert.ok(env2.log.console.includes('[SkipIntro] Plugin skip did not work after 3 attempts, position 0:01'), env2.log.console.slice(-4).join(' | '));
    assert.ok(env2.S.Controller.describe().includes('. ' + HELPED + '1'), env2.S.Controller.describe());
});

test('длина видео неизвестна (NaN): свой автопропуск ставит позицию сам — PlayerVideo.to в Lampa 3.4.4 при NaN не перематывает', async () => {
    const env = gotEnv({ settings: { skip_intro_auto: 'true' } });
    play(env, [ep(1), ep(2), ep(3)], 0);
    await env.advance(300);
    env.T.loaded(NaN);
    await env.advance(16000);       // длину ждём до 15 с, потом спрашиваем базы без неё
    assert.ok(/^Заставка 7:17–8:51 \(TheIntroDB/.test(env.S.Controller.describe()), env.S.Controller.describe());
    // как Lampa 3.4.4: позиция не изменилась
    env.L.PlayerVideo.to(100);
    assert.strictEqual(env.T.video().currentTime, 0);
    env.log.seeks.length = 0;
    await env.playTo(433, 436.75);
    env.T.tick(437);
    await env.advance(250);
    assert.strictEqual(env.T.video().currentTime, 531, env.S.Controller.describe());
    assert.deepStrictEqual(env.log.seeks, []);
    assert.deepStrictEqual(env.log.bell, [], 'это свой пропуск плагина, не помощь Lampa');
});

test('передача таймкодов в Lampa, длина видео неизвестна: пропуск Lampa упал бы — перематывает плагин', async () => {
    const env = gotEnv({ settings: { skip_intro_native: 'true' } });
    await startGot(env);
    env.T.destroy();
    const list = env.clone([ep(1), ep(2), ep(3)]);
    list[0].card = env.clone(GOT);
    env.T.play(list[0], { playlist: list, position: 0 });
    await env.advance(300); env.T.loaded(NaN); await env.advance(1500);
    await env.playTo(436, 436.75);
    env.T.tick(437);
    await env.advance(250);
    assert.strictEqual(env.T.video().currentTime, 531);
    assert.strictEqual(env.button(), null);
    assert.deepStrictEqual(env.log.bell, ['Сегмент пропущен']);
    assert.ok(env.S.Controller.describe().includes('переданы в Lampa. ' + HELPED + '1'), env.S.Controller.describe());
});

// Android TV (Tanix TX9, HLS через системный плеер): перемотка в самом начале потока теряется, видео идёт с начала.
// Модель: после перемотки timeupdate снова приносит позицию с начала файла
async function startSrcAuto(o) {
    const env = gotEnv({ settings: { skip_intro_auto: 'true' } });
    if (o && o.timeline) env.bridge.timeline.h1 = o.timeline;
    play(env, [ep(1), ep(2), ep(3)], 0, { data: Object.assign({ segments: J(SRC) }, o && o.timeline ? { timeline: Object.assign({ hash: 'h1' }, o.timeline) } : {}) });
    await env.advance(300);
    env.T.loaded(3700);
    await env.advance(300);
    return env;
}

test('перемотка потерялась (видео пошло с начала): плагин повторяет её через 1 с, «Skip worked» после повтора', async () => {
    const env = await startSrcAuto();
    await env.playTo(0.3, 0.3);
    assert.deepStrictEqual(J(env.log.seeks), [30], 'автопропуск заставки');
    await env.playTo(0.55, 1.55);                       // позиция снова с начала — перемотка не выполнилась
    assert.deepStrictEqual(J(env.log.seeks), [30, 30], 'повтор через 1 с');
    assert.ok(env.log.console.some((l) => /Skip did not take effect \(position 0:0\d, readyState \?\) — retrying, attempt 2/.test(l)), env.log.console.slice(-4).join(' | '));
    await env.playTo(30.25, 31);
    assert.ok(env.log.console.includes('[SkipIntro] Skip worked, position 0:31 (attempt 2)'), env.log.console.slice(-4).join(' | '));
    await env.playTo(31.25, 40);
    assert.deepStrictEqual(J(env.log.seeks), [30, 30], 'после удачи больше не перематывает');
    assert.strictEqual(env.button(), null);
    assert.strictEqual(env.errors.length, 0);
});

test('перемотка не удалась 3 раза: дальше для заставки только кнопка; ручной OK перематывает', async () => {
    const env = await startSrcAuto();
    await env.playTo(0.3, 4.3);
    assert.deepStrictEqual(J(env.log.seeks), [30, 30, 30], '3 попытки');
    assert.ok(env.log.console.some((l) => /Skip did not work after 3 attempts, position 0:0\d \(readyState \?\) — button only/.test(l)), env.log.console.slice(-4).join(' | '));
    await env.playTo(4.55, 5);
    assert.deepStrictEqual(J(env.log.seeks), [30, 30, 30], 'больше не перематывает сам');
    assert.strictEqual(env.button() && env.button().label, 'Пропустить заставку');
    env.T.press(OK);
    assert.deepStrictEqual(J(env.log.seeks), [30, 30, 30, 30]);
});

test('пользователь сам вернулся в заставку после удачного автопропуска: плагин не мешает', async () => {
    const env = await startSrcAuto();
    await env.playTo(0.3, 0.3);
    await env.playTo(30.25, 31);
    assert.ok(env.log.console.some((l) => /Skip worked, position 0:3\d \(attempt 1\)/.test(l)), env.log.console.slice(-4).join(' | '));
    await env.playTo(5, 8);
    assert.deepStrictEqual(J(env.log.seeks), [30]);
    assert.strictEqual(env.log.console.filter((l) => l.indexOf('Skipped intro') >= 0).length, 1, 'после перемотки назад не пропускает снова');
    assert.strictEqual(env.button(), null);
});

test('видео ещё без данных (readyState 1): автопропуск ждёт готовности, но не дольше 5 с', async () => {
    const env = await startSrcAuto();
    env.T.video().readyState = 1;
    await env.playTo(0.3, 2);
    assert.deepStrictEqual(J(env.log.seeks), [], 'ждёт');
    assert.ok(env.log.console.includes('[SkipIntro] Video not ready yet (readyState 1) — auto-skip of intro waits'), env.log.console.slice(-4).join(' | '));
    env.T.video().readyState = 4;
    await env.playTo(2.25, 2.25);
    assert.deepStrictEqual(J(env.log.seeks), [30], 'данные есть — перемотал');
    const env2 = await startSrcAuto();
    env2.T.video().readyState = 1;
    await env2.playTo(0.3, 5);
    assert.deepStrictEqual(J(env2.log.seeks), []);
    await env2.playTo(5.25, 5.75);
    assert.deepStrictEqual(J(env2.log.seeks), [30], 'через 5 с — перематывает как есть');
    assert.ok(env2.log.console.includes('[SkipIntro] Video still not ready after 5 s (readyState 1) — skipping anyway'), env2.log.console.slice(-4).join(' | '));
});

test('история Lampa на несколько секунд (4 с, 0 %) — не «начатая» серия: заставка пропускается автоматически; 20 с — только кнопка', async () => {
    const env = await startSrcAuto({ timeline: { percent: 0, time: 4, duration: 3700 } });
    assert.ok(!env.log.console.some((l) => /Existing timecode\/history/.test(l)), env.log.console.join(' | '));
    await env.playTo(0.3, 0.3);
    assert.deepStrictEqual(J(env.log.seeks), [30]);
    const env2 = await startSrcAuto({ timeline: { percent: 0, time: 20, duration: 3700 } });
    assert.ok(env2.log.console.includes('[SkipIntro] Existing timecode/history (time: 20s, percent: 0%) — intro/recap only by button'), env2.log.console.join(' | '));
    await env2.playTo(0.3, 0.55);
    assert.deepStrictEqual(J(env2.log.seeks), []);
    assert.strictEqual(env2.button() && env2.button().label, 'Пропустить заставку');
});

test('фильм с ошибкой в базе (живой ответ IntroDB для Iron Man): «заставка» в конце отброшена, титры -> сцена после титров', async () => {
    // tt0371746, 2026-11-01: intro 7512–7545 лежит внутри титров 7038–7540 и сцены после титров 7540–7580
    const env = setup({ android: true, settings: { skip_intro_auto: 'true' } });
    const IRONMAN = { id: 1726, title: 'Iron Man', original_title: 'Iron Man', imdb_id: 'tt0371746', release_date: '2008-04-30', genres: [{ id: 28 }] };
    tidb(env, {});
    introdb(env, { Mtt0371746: fixture('introdb_ironman.json') });
    play(env, [{ title: 'Iron Man', url: 'https://cdn.example/ironman.mp4' }], 0, { card: IRONMAN, noPlaylist: true });
    await env.advance(300); env.T.loaded(7600); await env.advance(1500);
    assert.strictEqual(env.requests('api.introdb.app/segments?imdb_id=tt0371746&is_movie=true').length, 1);
    await env.playTo(10, 10.5);
    assert.deepStrictEqual(J(env.marks().map((m) => m.cls.indexOf('skip-intro-mark--credits') !== -1)), [true], 'на шкале только титры');
    assert.doesNotMatch(env.S.Controller.describe(), /Заставка/);
    // один timeupdate в титрах: дальше видео уже на 7540 (если бы позиция осталась в титрах, плагин повторил бы перемотку)
    await env.playTo(7038, 7038);
    assert.deepStrictEqual(J(env.log.seeks), [7540], 'автопропуск титров — до сцены после титров');
    await env.playTo(7540, 7546);
    assert.strictEqual(env.button(), null, 'на сцене после титров нет «Пропустить заставку»');
    assert.deepStrictEqual(J(env.log.seeks), [7540], 'сцену после титров не срезали');
    assert.strictEqual(env.errors.length, 0);
});

test('фильм на 94 с длиннее эталона TheIntroDB (TX9, «Железный человек»): титры с 1:58:53, подтверждены IntroDB, автопропуск', async () => {
    const env = setup({ android: true, settings: { skip_intro_auto: 'true' } });
    const IRONMAN = { id: 1726, title: 'Iron Man', original_title: 'Iron Man', imdb_id: 'tt0371746', release_date: '2008-04-30', genres: [{ id: 28 }] };
    tidb(env, { M1726: { group_duration_ms: 7561792, credits: [ms(7039, 7512, { confidence: 0.175, submission_count: 1 }), ms(7546, 7561, { confidence: 0.175, submission_count: 1 })] } });
    introdb(env, { Mtt0371746: fixture('introdb_ironman.json') });
    play(env, [{ title: 'Iron Man', url: 'https://cdn.example/ironman.mp4' }], 0, { card: IRONMAN, noPlaylist: true });
    await env.advance(300); env.T.loaded(7656); await env.advance(1500);
    await env.playTo(7040, 7041);
    assert.strictEqual(env.button(), null, 'на 7040 с фильм ещё идёт');
    assert.deepStrictEqual(J(env.log.seeks), []);
    await env.playTo(7133.5, 7133.5);
    assert.deepStrictEqual(J(env.log.seeks), [7606.208]);
    assert.match(env.S.Controller.describe(), /Титры 1:58:53–2:06:46 \(TheIntroDB, сдвиг \+94[.,]208 с, подтвердила IntroDB\)/);
    assert.strictEqual(env.errors.length, 0);
});

test('фильм: титры из IntroDB (is_movie=true) у конца файла -> в конец без плейлиста', async () => {
    const env = setup({ android: true });
    tidb(env, { M27205: { credits: [ms(8455, null)] } });
    introdb(env, { Mtt1375666: { intro: null, recap: null, outro: { start_sec: 8455, end_sec: 8888 }, post_credits: null } });
    play(env, [{ title: 'Inception', url: 'https://cdn.example/inception.mp4' }], 0, { card: INCEPTION, noPlaylist: true });
    await env.advance(300); env.T.loaded(8880); await env.advance(1500);
    assert.strictEqual(env.requests('api.introdb.app/segments?imdb_id=tt1375666&is_movie=true').length, 1);
    assert.match(env.requests('api.theintrodb.org')[0].url, /tmdb_id=27205&details=true&duration_ms=8880000$/);
    assert.strictEqual(env.requests('introhater').length, 0, 'IntroHater — только сериалы');
    assert.strictEqual(env.log.imdb.length, 0, 'у фильма imdb_id есть в карточке');
    await env.playTo(8455, 8455.5);
    assert.strictEqual(env.button().label, 'Пропустить титры');
    env.T.press(OK);
    assert.deepStrictEqual(env.log.seeks, [-1]);
    // выключено «Фильмы»
    const off = setup({ settings: { skip_intro_movies: 'false' } });
    play(off, [{ title: 'Inception', url: 'https://cdn.example/inception.mp4' }], 0, { card: INCEPTION, noPlaylist: true });
    await off.advance(2000);
    assert.strictEqual(off.net.requests.length, 0);
});

test('трейлер YouTube, IPTV и короткие ролики — плагин молчит', async () => {
    const env = gotEnv();
    env.T.play(env.clone({ title: 'Trailer', url: 'https://www.youtube.com/watch?v=abc', youtube: true, card: INCEPTION }));
    env.T.play(env.clone({ title: 'Channel', url: 'http://iptv.example/1.m3u8', iptv: true }));
    await env.advance(2000);
    assert.strictEqual(env.net.requests.length, 0);
    // «фильм» длиной 3 минуты (ролик) — данные есть, но кнопки нет
    const m = setup();
    tidb(m, { M27205: { intro: [ms(10, 60)] } });
    play(m, [{ title: 'Clip', url: 'https://cdn.example/clip.mp4' }], 0, { card: INCEPTION, noPlaylist: true });
    await m.advance(300); m.T.loaded(180); await m.advance(1500);
    await m.playTo(10, 11);
    assert.strictEqual(m.button(), null);
    assert.strictEqual(m.marks().length, 0);
    assert.strictEqual(m.S.Controller.describe(), 'Слишком короткое видео \u2014 плагин не вмешивается');
});

test('imdb_id из TMDB: TheIntroDB стартует сразу; IntroDB/IntroHater ждут ответа (до 3 с), без ответа — выбывают', async () => {
    const env = gotEnv();
    delete env.bridge.imdb['tv:1399'];
    play(env, [ep(1), ep(2)], 0);
    await env.advance(300); env.T.loaded(3700);
    await env.advance(1000);
    assert.strictEqual(env.requests('theintrodb').length, 1, 'TheIntroDB не ждёт imdb_id');
    assert.strictEqual(env.requests('introdb.app').length + env.requests('introhater').length, 0);
    assert.match(env.S.Controller.describe(), /[,.] IntroDB: ждём ответ/);
    assert.strictEqual(env.S.Controller._loadDone, false);
    await env.advance(2500);
    assert.strictEqual(env.requests('introdb.app').length + env.requests('introhater').length, 0);
    assert.strictEqual(env.S.Controller._loadDone, true, 'загрузка завершена без IntroDB/IntroHater');
    assert.doesNotMatch(env.S.Controller.describe(), /[,.] IntroDB|IntroHater/);
    assert.deepStrictEqual(J(env.S.Controller._segments).map((x) => x.src), ['theintrodb', 'theintrodb']);
    // TMDB ответил через 1,5 с — IntroDB и IntroHater спрашиваются сразу после ответа
    const env2 = gotEnv();
    env2.bridge.imdbDelay = 1500;
    play(env2, [ep(1), ep(2)], 0);
    await env2.advance(300); env2.T.loaded(3700); await env2.advance(500);
    assert.strictEqual(env2.requests('theintrodb').length, 1);
    assert.strictEqual(env2.requests('introdb.app').length, 0);
    await env2.advance(1000);
    assert.strictEqual(env2.requests('introdb.app/segments?imdb_id=tt0944947').length, 1);
    assert.strictEqual(env2.requests('introhater.com/api/segments/tt0944947:1:1').length, 1);
});

test('HDR от «Адаптивных субтитров»: кнопка и предупреждение приглушаются (настройка по умолчанию)', async () => {
    const env = gotEnv();
    await startGot(env);
    env.L.Listener.send('adaptive_subs', env.clone({ type: 'profile', profile: 'hdr', kind: 'hdr10', brightness: 0.48, source: 'ffprobe' }));
    await env.playTo(433, 433.25);
    assert.strictEqual(env.warn().filter, 'brightness(0.63)');
    await env.playTo(437, 437.25);
    assert.strictEqual(env.button().filter, 'brightness(0.63)');
    env.L.Listener.send('adaptive_subs', env.clone({ type: 'profile', profile: 'sdr', kind: 'sdr', brightness: 1 }));
    assert.strictEqual(env.button().filter, '');
});

test('карточка не из TMDB (другой источник): свои ключи и настройки сериала совпадают в плеере и в меню', async () => {
    const env = setup();
    tidb(env, {});
    const card = { id: 555, source: 'ivi', name: 'Сериал', original_name: 'Serial', first_air_date: '2020-01-01' };
    const e = env.clone({ type: 'options', link: { card }, options: [] });
    env.L.Listener.send('full', e);
    e.options[0].onSelect();
    env.pick('Режим:');
    env.pick('Выключен');
    play(env, [{ title: 'x', season: 1, episode: 1, url: 'https://cdn.example/x.mp4' }], 0, { card });
    await env.advance(300); env.T.loaded(2500); await env.advance(1500);
    assert.strictEqual(env.S.Controller._ctx.tmdb, 'ivi-555');
    assert.strictEqual(env.S.Controller.describe(), 'Для этого сериала пропуск выключен', 'режим из меню карточки действует в плеере');
    assert.strictEqual(env.requests('theintrodb').length, 0, 'TheIntroDB знает только id TMDB');
});

test('синхронизация (CUB): по настройке Lampa.Storage.sync для настроек сериалов и отметок; удаление — через Storage.remove', async () => {
    const env = gotEnv({ settings: { skip_intro_sync: 'true' } });
    assert.deepStrictEqual(J(env.log.synced), [['skip_intro_series', 'object_object'], ['skip_intro_user', 'object_object']]);
    env.S.Series.set('1399', { mode: 'auto' });
    env.S.Series.set('1399', { mode: 'default' });
    assert.deepStrictEqual(J(env.log.removed), [['skip_intro_series', '1399']]);
    const off = gotEnv();
    assert.deepStrictEqual(J(off.log.synced), []);
});

test('запись плагина в списке расширений Lampa: имя и автор (если задан в package.json config.pluginAuthor); список сохраняется массивом, как в core/plugins.js', async () => {
    const AUTHOR = (PKG.config && PKG.config.pluginAuthor) || null;
    const env = createEnv({ scriptSrc: 'https://user.github.io/lampa/autoskip.js?v=3' });
    env.T.playerDom();
    env.setStorage('plugins', [{ url: 'https://user.github.io/lampa/autoskip.js', status: 1 }, { url: 'https://other.example/p.js', status: 1, name: 'Other' }]);
    const sets = [];
    const orig = env.L.Storage.set;
    env.L.Storage.set = function (name, value) { if (name === 'plugins') sets.push(value); return orig.apply(this, arguments); };
    env.load('autoskip');
    await env.advance(100);
    assert.strictEqual(sets.length, 1);
    assert.ok(Array.isArray(sets[0]), 'массив, а не строка JSON');
    assert.deepStrictEqual(J(env.L.Storage.get('plugins')).map((p) => [p.name, p.author || null]), [['Skip Intro/Outro + Aniskip', AUTHOR], ['Other', null]]);
    env.L.Storage.set = orig;
});

run('autoskip ' + PKG.version + ' — сценарии в плеере');
