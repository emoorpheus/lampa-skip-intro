// Таймкоды передал источник видео (балансер, data.segments) в настоящей Lampa 3.4.4.
// Контроль (плагин выключен): как на приставке с Android, длина видео на 'loadeddata' ещё неизвестна (video.duration = NaN) —
// встроенный пропуск Lampa сегмента с 0 с падает на currentTime = NaN.
// Плагин включён: таймкоды источника пропускает плагин по своим настройкам (кнопка или автопропуск), Lampa получает пустые
// сегменты — ни её отметок, ни её пропуска; data.segments после старта прежние.
// Включена передача таймкодов в Lampa: пропускает Lampa, плагин в ожидании — рисует отметки сам, если у Lampa они нулевой
// ширины (длина из video.seekable), и перематывает вместо Lampa, пока длина неизвестна; когда длина известна — не вмешивается.
// «Диагностика» в настройках показывает отметки последнего просмотра (для пультов без цветных кнопок).
const { open, BASE } = require('./lib');
const assert = require('assert');
const GOT = { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8, source: 'tmdb',
    genre_ids: [10765, 18, 10759], origin_country: ['US'], original_language: 'en',
    seasons: [{ season_number: 1, episode_count: 10, air_date: '2011-04-17' }] };
const SEGS = { skip: [{ start: 0, end: 30 }, { start: 437, end: 531 }, { start: 3640, end: 3700 }], ad: [] };
const DESC = 'The video source provided timestamps \u2014 Lampa\u2019s built-in skip is active';
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({ storage: { language: 'en', skip_intro_button_timeout: '0', player_segments_skip: 'auto' } });
    global.__env = env;
    assert.ok(await env.ev(() => !!(window.__SKIP_INTRO_TEST__ && window.__SKIP_INTRO_TEST__.Controller)), 'тестовый хук autoskip не заполнен');
    const play = () => env.ev(({ BASE, GOT, SEGS }) => {
        const list = [
            { title: 'Game.of.Thrones.S01E01.webm', season: 1, episode: 1, url: BASE + 'video/got_s01e01.webm', card: GOT, segments: JSON.parse(JSON.stringify(SEGS)) },
            { title: 'Game.of.Thrones.S01E02.webm', season: 1, episode: 2, url: BASE + 'video/got_s01e02.webm', card: GOT }
        ];
        Lampa.Player.play(list[0]);
        Lampa.Player.playlist(list);
    }, { BASE, GOT, SEGS });
    const describe = () => env.ev(() => window.__SKIP_INTRO_TEST__.Controller.describe());
    const marks = () => env.ev(() => {
        const box = (m) => { const r = m.getBoundingClientRect(); return { cls: m.className, w: Math.round(r.width * 10) / 10, style: m.style.width, left: m.style.left }; };
        return {
            lampa: Array.from(document.querySelectorAll('.player-panel__timeline-segments .player-panel__timeline-segment')).map(box),
            own: Array.from(document.querySelectorAll('.player-panel__timeline .skip-intro-mark')).map(box),
            duration: Lampa.PlayerVideo.video().duration,
            time: Math.round(Lampa.PlayerVideo.video().currentTime * 10) / 10,
            seekable: (() => { const v = Lampa.PlayerVideo.video(); return v.seekable && v.seekable.length ? v.seekable.end(v.seekable.length - 1) : null; })()
        };
    });

    // уведомления Lampa (Bell) и Noty: после пропуска сегмента Lampa показывает Bell «Segment skipped» со значком icon_viewed
    const notices = () => env.ev(() => ({
        bell: Array.from(document.querySelectorAll('.bell__item')).map((b) => ({ text: b.querySelector('.bell__item-text').textContent.trim(),
            icon: b.querySelector('.bell__item-icon').innerHTML.trim() })),
        noty: ((document.querySelector('.noty') || {}).textContent || '').trim()
    }));
    // 0) контроль без плагина: длина неизвестна (video.duration отдаёт NaN, пока флаг не снят) — Lampa 3.4.4 сегмент 0–30 с не пропускает
    await env.ev(() => {
        const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
        window.__hideDuration = true;
        Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return window.__hideDuration ? NaN : d.get.call(this); } });
        Lampa.Storage.set('skip_intro_enabled', 'false');
    });
    await play();
    await env.wait(5000);
    const m0 = await marks();
    console.log('plugin off: ' + JSON.stringify(m0));
    check('контроль, плагин выключен: встроенный пропуск Lampa на сегменте с 0 с падает («[Subscribe] send error: … currentTime … non-finite», как в логе с приставки), позиция < 30 с', () => {
        assert.ok(isNaN(m0.duration), JSON.stringify(m0));
        assert.ok(env.logs.some((l) => /Subscribe/.test(l) && /send error/.test(l) && /currentTime/.test(l) && /non-finite/.test(l)),
            env.logs.filter((l) => /Subscribe|currentTime/.test(l)).slice(0, 3).join(' | ') || 'нет записи');
        assert.ok(m0.time > 1 && m0.time < 30, 'сегмент 0–30 с не пропущен, позиция ' + m0.time);
        assert.ok(env.pluginLogs().some((l) => /Idle: disabled/.test(l)), env.pluginLogs().slice(-4).join(' | '));
    });
    await env.ev(() => { Lampa.Player.close(); Lampa.Storage.set('skip_intro_enabled', 'true'); });
    await env.wait(1000);

    const playState = () => env.ev(() => {
        const b = document.querySelector('.skip-intro-button'), v = Lampa.PlayerVideo.video(), pd = Lampa.Player.playdata() || {};
        const ls = document.querySelector('.player-skip');
        return { btn: b && b.classList.contains('visible') ? b.textContent : '', lampaBtn: !!(ls && !ls.classList.contains('hide')),
            time: Math.round(v.currentTime * 10) / 10, url: v.src || '', episode: pd.episode,
            segs: pd.segments ? JSON.stringify(pd.segments) : null, ctx: (window.__SKIP_INTRO_TEST__.Controller._ctx || {}).key };
    });
    const SRC_LOG = /Video source segments are skipped by the plugin settings \(Lampa got none\): skip 0:00\u20130:30, skip 7:17\u20138:51, skip 1:00:40\u20131:01:40/;

    // 1) плагин включён (автопропуск в плагине выключен), длина неизвестна: таймкоды источника — у плагина, кнопка «Skip intro»
    const errs0 = env.logs.filter((l) => /send error/.test(l)).length;
    await play();
    await env.wait(1500);
    const p1 = await playState(), m1 = await marks();
    console.log('takeover: ' + JSON.stringify(p1) + '\nmarks: ' + JSON.stringify(m1));
    check('журнал: «Video source segments are skipped by the plugin settings (Lampa got none): skip 0:00–0:30, skip 7:17–8:51, skip 1:00:40–1:01:40»', () =>
        assert.ok(env.pluginLogs().some((l) => SRC_LOG.test(l)), env.pluginLogs().slice(-8).join(' | ')));
    check('Lampa получила пустые сегменты: её отметок нет, её кнопки нет, её пропуск не пробовал (нет «send error»); data.segments после старта прежние', () => {
        assert.ok(isNaN(m1.duration), JSON.stringify(m1));
        assert.strictEqual(m1.lampa.length, 0, JSON.stringify(m1.lampa));
        assert.strictEqual(p1.lampaBtn, false);
        assert.strictEqual(env.logs.filter((l) => /send error/.test(l)).length, errs0);
        assert.strictEqual(p1.segs, JSON.stringify(SEGS));
    });
    check('кнопка плагина «Skip intro» с начала серии, позиция не тронута (автопропуск выключен)', () => {
        assert.ok(/Skip intro/.test(p1.btn), JSON.stringify(p1));
        assert.ok(p1.time < 5, String(p1.time));
    });
    await env.page.keyboard.press('Enter');
    await env.wait(1200);
    const p1b = await playState(), n1 = await notices(), d1 = await describe();
    await env.wait(4000);
    const m1b = await marks();
    console.log('after Enter: ' + JSON.stringify(p1b) + '\n' + d1 + '\nmarks: ' + JSON.stringify(m1b));
    check('OK (Enter): перемотка на 0:30 при длине NaN (позицию ставит плагин), кнопка убрана, уведомлений нет', () => {
        assert.ok(p1b.time >= 30 && p1b.time < 34, String(p1b.time));
        assert.strictEqual(p1b.btn, '');
        assert.deepStrictEqual(n1.bell, [], JSON.stringify(n1));
        assert.ok(env.pluginLogs().some((l) => /Skipped intro to 30 \(manual\)/.test(l)), env.pluginLogs().slice(-5).join(' | '));
    });
    check('«Sources»: «Intro 0:00–0:30 (video source); Intro 7:17–8:51 (video source); Credits 1:00:40–1:01:40 (video source)…»', () =>
        assert.ok(d1.startsWith('Intro 0:00\u20130:30 (video source); Intro 7:17\u20138:51 (video source); Credits 1:00:40\u20131:01:40 (video source). '), d1));
    check('отметки рисует плагин: 3, длина из video.seekable, видимая ширина > 0', () => {
        assert.strictEqual(m1b.lampa.length, 0);
        assert.strictEqual(m1b.own.length, 3, JSON.stringify(m1b.own));
        assert.ok(m1b.own.every((x) => x.w > 0), JSON.stringify(m1b.own));
        assert.ok(/skip-intro-mark--intro/.test(m1b.own[0].cls) && /skip-intro-mark--credits/.test(m1b.own[2].cls), JSON.stringify(m1b.own));
    });
    await env.ev(() => Lampa.Player.close());
    await env.wait(1000);

    // 2) длина известна, автопропуск в плагине включён: заставка с 0:00 — сама, титры у конца — следующая серия
    await env.ev(() => { window.__hideDuration = false; Lampa.Storage.set('skip_intro_auto', 'true'); });
    await play();
    await env.wait(1500);
    const p2 = await playState(), m2 = await marks();
    console.log('auto: ' + JSON.stringify(p2) + '\nmarks: ' + JSON.stringify(m2));
    check('автопропуск плагина: заставка 0:00–0:30 перемотана без кнопки; у Lampa отметок нет', () => {
        assert.ok(p2.time >= 30 && p2.time < 34, String(p2.time));
        assert.strictEqual(p2.btn, '');
        assert.ok(env.pluginLogs().some((l) => /Skipped intro to 30 \(auto\)/.test(l)), env.pluginLogs().slice(-5).join(' | '));
        assert.strictEqual(m2.lampa.length, 0, JSON.stringify(m2.lampa));
    });
    await env.ev(() => Lampa.PlayerVideo.to(3636));
    await env.wait(7000);
    const p2b = await playState();
    console.log('after credits: ' + JSON.stringify(p2b));
    check('титры источника у конца файла (1:00:40–1:01:40) -> следующая серия: Lampa переключила на S01E02, плагин перешёл на неё', () => {
        assert.ok(env.pluginLogs().some((l) => /Skip credits at the end of the episode -> to_end \(auto\)/.test(l)), env.pluginLogs().slice(-6).join(' | '));
        assert.ok(p2b.url.endsWith('got_s01e02.webm'), p2b.url);
        assert.strictEqual(p2b.ctx, 'skip3_1399_s1_e2');
    });
    await env.ev(() => { Lampa.Player.close(); Lampa.Storage.set('skip_intro_auto', 'false'); });
    await env.wait(1000);

    // 3) передача таймкодов в Lampa включена, длина неизвестна на 'loadeddata': пропускает Lampa, плагин в ожидании
    await env.ev(() => { window.__hideDuration = true; Lampa.Storage.set('skip_intro_native', 'true'); });
    const errs3 = env.logs.filter((l) => /send error/.test(l)).length;
    await play();
    await env.wait(1200);
    const n3 = await notices();
    await env.wait(5000);
    const m3 = await marks(), d3 = await describe();
    console.log('native, duration hidden: ' + d3 + '\nmarks: ' + JSON.stringify(m3));
    check('передача в Lampa: журнал «Lampa has its own skip segments… plugin stays idle», «Idle: lampa»; базы не запрашиваются', () => {
        const pl = env.pluginLogs();
        assert.ok(pl.some((l) => /Lampa has its own skip segments for this video — plugin stays idle/.test(l)), pl.slice(-10).join(' | '));
        assert.ok(pl.some((l) => /Idle: lampa/.test(l)));
        assert.ok(!env.mocked.some((u) => /theintrodb|introdb|introhater/.test(u)), env.mocked.join(' | '));
    });
    check('Lampa 3.4.4 при неизвестной длине: 3 отметки нулевой ширины', () => {
        assert.ok(isNaN(m3.duration) && m3.seekable > 3000, JSON.stringify(m3));
        assert.strictEqual(m3.lampa.length, 3);
        assert.ok(m3.lampa.every((x) => x.w === 0), JSON.stringify(m3.lampa));
    });
    check('пропуск Lampa снова падает, но сегмент 0–30 с пропускает плагин: позиция > 30 с, журнал, уведомление', () => {
        assert.ok(env.logs.filter((l) => /send error/.test(l)).length > errs3, 'Lampa пробовала пропустить');
        assert.ok(m3.time > 30 && m3.time < 40, 'позиция ' + m3.time);
        const pl = env.pluginLogs();
        assert.ok(pl.some((l) => /Source segments: skip 0:00\u20130:30, skip 7:17\u20138:51, skip 1:00:40\u20131:01:40/.test(l)), pl.slice(-8).join(' | '));
        assert.ok(pl.some((l) => /Lampa's built-in skip cannot work while the video length is unknown \(skip 0:00\u20130:30\) \u2014 plugin skips to 0:30/.test(l)), pl.slice(-8).join(' | '));
        assert.ok(pl.some((l) => /Plugin skip worked, position 0:3\d/.test(l)), pl.slice(-8).join(' | '));
        assert.deepStrictEqual(n3.bell.map((b) => b.text), ['Segment skipped'], JSON.stringify(n3));
        assert.strictEqual(n3.noty, '', 'своего сообщения плагин не показывает');
    });
    check('плагин рисует все 3 отметки сам: длина из video.seekable, видимая ширина > 0, стиль сегментов Lampa', () => {
        assert.strictEqual(m3.own.length, 3, JSON.stringify(m3.own));
        assert.ok(m3.own.every((x) => x.w > 0 && /player-panel__timeline-segment--skip skip-intro-mark skip-intro-mark--skip/.test(x.cls)), JSON.stringify(m3.own));
        assert.ok(Math.abs(parseFloat(m3.own[1].left) - 437 / m3.seekable * 100) < 0.01, m3.own[1].left);
    });
    check('«Sources»: «' + DESC + '. Lampa’s built-in skip failed (video length not known yet) — skipped by the plugin: 1. Timeline marks: 3»; журнал «Timeline marks: 3 drawn over Lampa\'s zero-width marks»', () => {
        assert.strictEqual(d3, DESC + '. Lampa\u2019s built-in skip failed (video length not known yet) \u2014 skipped by the plugin: 1. Timeline marks: 3');
        assert.ok(env.pluginLogs().some((l) => /Timeline marks: 3 drawn over Lampa's zero-width marks, duration \d+ s/.test(l)), env.pluginLogs().slice(-6).join(' | '));
    });
    const diag3 = await env.ev(() => window.__SKIP_INTRO_TEST__.Diag.marksText());
    check('«Diagnostics» → «Timeline marks (last playback)»: «Drawn by the plugin: 3 · timestamps from the video source, video length 1:01:40, just now»', () =>
        assert.strictEqual(diag3, 'Drawn by the plugin: 3 \u00b7 timestamps from the video source, video length 1:01:40, just now'));
    await env.ev(() => Lampa.Player.close());
    await env.wait(1000);

    // 4) передача в Lampa, длина известна: Lampa рисует и пропускает сама, плагин не дублирует
    await env.ev(() => { window.__hideDuration = false; });
    await play();
    await env.wait(1200);
    const n4 = await notices();
    await env.wait(3800);
    const m4 = await marks(), d4 = await describe();
    console.log('native, duration known: ' + d4 + '\nmarks: ' + JSON.stringify(m4));
    check('передача в Lampa, длина известна: у Lampa 3 отметки шириной > 0, своих у плагина нет, в «Sources» ничего лишнего', () => {
        assert.strictEqual(m4.lampa.length, 3, JSON.stringify(m4));
        assert.ok(m4.lampa.every((x) => x.w > 0), JSON.stringify(m4.lampa));
        assert.strictEqual(m4.own.length, 0, JSON.stringify(m4.own));
        assert.strictEqual(d4, DESC);
    });
    check('передача в Lampa, длина известна: встроенный пропуск Lampa сработал (позиция после 30 с), плагин не вмешивался', () => {
        assert.ok(m4.time >= 30, String(m4.time));
        assert.strictEqual(env.pluginLogs().filter((l) => /plugin skips to/.test(l)).length, 1);
    });
    check('уведомление после пропуска плагином — то же, что Lampa показывает после своего пропуска (текст и значок)', () => {
        assert.strictEqual(n4.bell.length, 1, JSON.stringify(n4));
        assert.deepStrictEqual(n3.bell, n4.bell);
    });
    await env.ev(() => Lampa.Player.close());
    await env.wait(800);

    // 5) экран настроек Lampa: пункт виден сразу после версии
    const diagItems = await env.ev(() => new Promise((res) => {
        Lampa.Controller.toggle('settings');
        setTimeout(() => {
            Lampa.Settings.create('skip_intro');
            setTimeout(() => {
                const items = Array.from(document.querySelectorAll('.settings__body .settings-param')).map((el) => ({
                    name: ((el.querySelector('.settings-param__name') || {}).textContent || '').trim(),
                    descr: ((el.querySelector('.settings-param__descr') || {}).textContent || '').trim() }));
                const i = items.findIndex((x) => x.name === 'Plugin version');
                res(i >= 0 ? items.slice(i, i + 2) : items.slice(-3));
            }, 500);
        }, 600);
    }));
    console.log('settings: ' + JSON.stringify(diagItems));
    check('настройки → Skip Intro → Diagnostics: после «Plugin version» — «Timeline marks (last playback)»: «Drawn by Lampa · timestamps from the video source, just now»', () => {
        assert.strictEqual(diagItems.length, 2, JSON.stringify(diagItems));
        assert.strictEqual(diagItems[1].name, 'Timeline marks (last playback)');
        assert.strictEqual(diagItems[1].descr, 'Drawn by Lampa \u00b7 timestamps from the video source, just now');
    });
    check('ошибок JavaScript на странице нет (ошибка пропуска Lampa ловится её же обработчиком событий)', () =>
        assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    console.log('plugin logs:\n' + env.pluginLogs().slice(0, 30).join('\n'));
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) { console.log(global.__env.logs.slice(-60).join('\n')); } process.exit(2); });
