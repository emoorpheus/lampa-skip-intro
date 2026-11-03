'use strict';
// Язык интерфейса: таблица строк (ru/en), выбор языка как у Lampa, английский интерфейс плагина;
// отметки на шкале, когда длина видео неизвестна или у шкалы нет стилей Lampa
const assert = require('assert');
const fs = require('fs');
const { test, run, createEnv, FILES, PKG } = require('./lib/harness');
const { setup, tidb, introdb, introhater, ms, play, ep, GOT } = require('./lib/scen');
const acorn = require('../tools/vendor/acorn.js');

const J = (x) => JSON.parse(JSON.stringify(x));
const CYR = /[\u0400-\u04FF]/;
const OK = 13;
const holes = (s) => (String(s).match(/\{[a-z0-9_]+\}/gi) || []).sort().join(',');

function core(lang) {
    const env = createEnv();
    if (lang) env.setStorage('language', lang);
    env.load('autoskip');
    return { env, S: env.S, L: env.S.Logic };
}

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

// Как у части потоков: duration = Infinity, доступный диапазон — в video.seekable
function seekable(env, end) {
    env.T.video().seekable = env.run('({ length: 1, start: function () { return 0; }, end: function () { return ' + end + '; } })');
}

// ---------- Сборка: строки только в таблице ----------
const SRC = fs.readFileSync(FILES.autoskip, 'utf8');
const AST = acorn.parse(SRC, { ecmaVersion: 5, sourceType: 'script' });
function walk(node, fn) {
    if (!node || typeof node.type !== 'string') return;
    fn(node);
    for (const key of Object.keys(node)) {
        const v = node[key];
        if (Array.isArray(v)) v.forEach((c) => walk(c, fn));
        else if (v && typeof v.type === 'string') walk(v, fn);
    }
}
let TABLE = null;
walk(AST, (n) => { if (n.type === 'VariableDeclarator' && n.id.name === 'I18N') TABLE = n.init; });
const inTable = (n) => TABLE && n.start >= TABLE.start && n.end <= TABLE.end;

test('таблица строк: у каждой строки все языки I18N_LANGS, одинаковые подстановки, нужное число форм (ru 3, en 2), в английском нет кириллицы', () => {
    const { S } = core();
    const keys = Object.keys(S.I18N), LANGS = Array.from(S.I18N_LANGS);
    assert.ok(LANGS.includes('ru') && LANGS.includes('en'), LANGS.join(','));
    assert.ok(keys.length > 150, String(keys.length));
    // сколько форм числа нужно языку — по правилу I18n.form
    const forms = {};
    LANGS.forEach((l) => { forms[l] = 1 + Math.max(...Array.from({ length: 300 }, (x, n) => S.I18n.form(l, n))); });
    assert.strictEqual(forms.ru, 3);
    assert.strictEqual(forms.en, 2);
    const bad = [];
    for (const k of keys) {
        const row = S.I18N[k];
        if (Object.keys(row).sort().join(',') !== LANGS.slice().sort().join(',')) { bad.push(k + ': языки ' + Object.keys(row).join(',')); continue; }
        const plural = Array.isArray(row.ru), h = holes([].concat(row.ru)[0]);
        LANGS.forEach((l) => {
            if (Array.isArray(row[l]) !== plural) return bad.push(k + ': строка в одном языке, формы в другом');
            if (plural && row[l].length !== forms[l]) bad.push(k + ': ' + l + ' форм ' + row[l].length + ' вместо ' + forms[l]);
            [].concat(row[l]).forEach((s) => {
                if (typeof s !== 'string' || !s.trim()) bad.push(k + ': ' + l + ' пустая строка');
                else if (holes(s) !== h) bad.push(k + ': ' + l + ' подстановки ' + JSON.stringify(s));
                else if (l === 'en' && CYR.test(s)) bad.push(k + ': кириллица в en: ' + s);
            });
        });
    }
    assert.deepStrictEqual(bad, []);
});

test('сборка: кириллица в строках кода — только в таблице I18N; ключи tr()/trn() есть в таблице, лишних строк нет', () => {
    const { S } = core();
    assert.ok(TABLE && TABLE.type === 'ObjectExpression', 'var I18N = { ... } в сборке');
    const keys = Object.keys(S.I18N), cyr = [], missing = [], literals = new Set(), prefixes = new Set();
    let calls = 0;
    walk(AST, (n) => {
        if (n.type === 'Literal' && typeof n.value === 'string' && !inTable(n)) {
            literals.add(n.value);
            if (CYR.test(n.value)) cyr.push(SRC.slice(n.start, n.end));
        }
        if (n.type === 'BinaryExpression' && n.operator === '+' && n.left.type === 'Literal' && typeof n.left.value === 'string' && /^[a-z]+_$/.test(n.left.value)) prefixes.add(n.left.value);
        if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && (n.callee.name === 'tr' || n.callee.name === 'trn') && n.arguments[0]) {
            const a = n.arguments[0];
            calls++;
            if (a.type === 'Literal' && !S.I18n.has(a.value)) missing.push(a.value);
            if (a.type === 'BinaryExpression' && a.left.type === 'Literal' && !keys.some((k) => k.indexOf(a.left.value) === 0)) missing.push(a.left.value + '…');
        }
    });
    assert.deepStrictEqual(cyr, [], 'кириллица вне таблицы');
    assert.ok(calls > 150, 'вызовов tr/trn: ' + calls);
    assert.deepStrictEqual(missing, [], 'нет в таблице');
    const unused = keys.filter((k) => !literals.has(k) && !Array.from(prefixes).some((p) => k.indexOf(p) === 0));
    assert.deepStrictEqual(unused, [], 'строки таблицы, которые нигде не используются');
});

test('язык как у Lampa: без выбора — русский (как сама Lampa), ru — русский, en — английский, другие (uk, be, zh) — английский', () => {
    for (const [code, lang, text] of [[null, 'ru', 'Пропустить'], ['ru', 'ru', 'Пропустить'], ['en', 'en', 'Skip'], ['uk', 'en', 'Skip'], ['be', 'en', 'Skip'], ['zh', 'en', 'Skip']]) {
        const { S } = core(code);
        assert.strictEqual(S.I18n.code(), code || 'ru');
        assert.strictEqual(S.I18n.lang(), lang, String(code));
        assert.strictEqual(S.tr('skip'), text, String(code));
    }
    const { S, env } = core();
    env.setStorage('language', 'en');
    assert.strictEqual(S.tr('skip'), 'Skip', 'строки, собираемые на лету, сразу на новом языке (раздел настроек Lampa пересоздаёт перезагрузкой)');
    assert.strictEqual(S.tr('no_such_key'), 'no_such_key');
    assert.strictEqual(S.tr('hint_press', { key: 'OK' }), 'press OK');
    assert.strictEqual(S.I18n.format('{url}/x {n}', { n: 2 }), '{url}/x 2', 'подставляются только переданные значения');
});

test('числа со словом: 1 пропуск, 2 пропуска, 5/11/111 пропусков, 21 пропуск; 1 skip, 0/2/101 skips', () => {
    const ru = core('ru').S, en = core('en').S;
    assert.deepStrictEqual([1, 2, 5, 11, 21, 22, 111].map((n) => ru.trn('n_skips', n)), ['1 пропуск', '2 пропуска', '5 пропусков', '11 пропусков', '21 пропуск', '22 пропуска', '111 пропусков']);
    assert.deepStrictEqual([1, 2, 0, 101].map((n) => en.trn('n_skips', n)), ['1 skip', '2 skips', '0 skips', '101 skips']);
    assert.strictEqual(ru.trn('n_seconds', 10), '10 секунд');
    assert.strictEqual(en.trn('n_seconds', 10), '10 seconds');
});

test('английский: длительность, номер серии, статистика', () => {
    const { S, L, env } = core('en');
    assert.strictEqual(L.formatSaved(59), '59 s');
    assert.strictEqual(L.formatSaved(3780), '1 h 3 min');
    assert.strictEqual(L.episodeLabel(env.clone({ episode: 5, title: '' })), 'Episode 5');
    assert.strictEqual(S.Stats.text(), 'Nothing skipped yet');
    S.Stats.add('intro', 60);
    assert.strictEqual(S.Stats.text(), 'Saved 1 min (1 skip)');
    S.Stats.add('intro', 60);
    assert.strictEqual(S.Stats.text(), 'Saved 2 min (2 skips)');
});

test('английский: раздел настроек «Skip Intro», пункты и значения без кириллицы', () => {
    const env = setup({ settings: { language: 'en' } });
    const comps = env.L.SettingsApi.components, params = env.L.SettingsApi.params;
    assert.ok(comps.some((c) => c.component === 'skip_intro' && c.name === 'Skip Intro'), J(comps.map((c) => c.name)));
    const p = (n) => { const x = params.find((q) => q.param.name === n); assert.ok(x, n); return x; };
    assert.strictEqual(p('skip_intro_enabled').field.name, 'Enable plugin');
    assert.strictEqual(p('skip_intro_auto').field.name, 'Always auto-skip');
    assert.strictEqual(p('skip_intro_diag_check').field.name, 'Check now');
    assert.strictEqual(p('skip_intro_diag_version').field.name + ': ' + p('skip_intro_diag_version').field.description, 'Plugin version: Skip Intro ' + PKG.version);
    assert.strictEqual(p('skip_intro_button_timeout').param.values['10'], '10 seconds');
    assert.strictEqual(p('skip_intro_button_timeout').param.values['0'], 'Never hide');
    const cyr = [];
    params.forEach((q) => {
        const f = q.field || {}, v = q.param.values && typeof q.param.values === 'object' ? Object.keys(q.param.values).map((k) => q.param.values[k]) : [];
        [f.name, f.description].concat(v).forEach((s) => { if (typeof s === 'string' && CYR.test(s)) cyr.push(q.param.name + ': ' + s); });
    });
    assert.deepStrictEqual(cyr, []);
    assert.ok(params.length >= 30, String(params.length));
});

test('английский в плеере: предупреждение, кнопка, подсказка, «Следующая серия», «Источники», статистика', async () => {
    const env = gotEnv({ settings: { language: 'en' } });
    await startGot(env);
    await env.playTo(430, 432.5);
    assert.strictEqual(env.warn().text, 'Intro in 5 s');
    await env.playTo(432.75, 437.5);
    let b = env.button();
    assert.ok(b && b.visible);
    assert.strictEqual(b.label, 'Skip intro');
    assert.strictEqual(b.hint, 'press OK');
    const d = env.S.Controller.describe();
    assert.match(d, /^Intro 7:17–8:51 \(TheIntroDB/);
    assert.match(d, /TheIntroDB: found/);
    assert.match(d, /\. Timeline marks: 2$/);
    assert.ok(!CYR.test(d), d);
    env.T.press(OK);
    assert.deepStrictEqual(env.log.seeks, [531]);
    assert.match(env.S.Stats.text(), /^Saved \d+ min \(1 skip\)$/);
    await env.playTo(3626, 3627);
    assert.strictEqual(env.warn().text, 'Credits in 5 s \u00b7 then S01E02 \u2014 The Kingsroad');
    await env.playTo(3631.5, 3632);
    b = env.button();
    assert.strictEqual(b.label, 'Next episode');
    assert.strictEqual(b.sub, 'S01E02 \u2014 The Kingsroad');
    assert.strictEqual(env.errors.length, 0, J(env.errors.map((e) => e.where + ' ' + e.e.message)));
});

test('английский: обратный отсчёт «press Back to cancel»; меню плеера', async () => {
    const env = gotEnv({ settings: { language: 'en' } });
    env.S.Smart.rememberSkip('1399', 'intro');
    await startGot(env);
    await env.playTo(437, 437.25);
    const b = env.button();
    assert.ok(b.countdown);
    assert.strictEqual(b.hint, 'press Back to cancel');
    const m = gotEnv({ settings: { language: 'en', skip_intro_key_menu: 'blue' }, tidb: { S1E1: { intro: [] } } });
    await startGot(m);
    await m.playTo(60, 60.25);
    m.T.press(406);
    const sel = m.lastSelect();
    assert.strictEqual(sel.title, 'Skip Intro');
    assert.deepStrictEqual(J(sel.items.slice(0, 5).map((i) => i.title)), ['This episode', 'Mark: intro', 'Mark: credits', 'Mark: recap', 'Mark: preview']);
    assert.deepStrictEqual(J(sel.items.filter((i) => CYR.test(i.title + ' ' + (i.subtitle || ''))).map((i) => i.title)), []);
    m.pick('Mark: intro');
    assert.match(m.noty().pop(), /^Start marked: 1:00\./);
});

// ---------- Отметки на шкале ----------
test('отметки: duration = Infinity — длина из video.seekable, 2 отметки; «Источники» и журнал', async () => {
    const env = gotEnv();
    play(env, [ep(1), ep(2), ep(3)], 0);
    await env.advance(300);
    seekable(env, 3700);
    env.T.loaded(Infinity);
    await env.advance(16000);           // длина неизвестна: базы спрашиваются после ожидания длины (до 15 с)
    await env.playTo(10, 10.5);
    const m = env.marks();
    assert.strictEqual(m.length, 2, J(m));
    assert.ok(Math.abs(m[0].left - 437 / 3700 * 100) < 1e-6);
    assert.ok(Math.abs(m[1].left + m[1].width - 100) < 1e-6);
    assert.match(env.S.Controller.describe(), /\. Отметки на шкале: 2$/);
    assert.ok(env.log.console.includes('[SkipIntro] Timeline marks: 2 drawn, duration 3700 s'), env.log.console.filter((l) => /marks/.test(l)).join(' | '));
});

test('отметки: длина неизвестна (NaN, без seekable) — «нет — длина видео неизвестна»; длина появилась — отметки есть', async () => {
    const env = gotEnv();
    play(env, [ep(1), ep(2), ep(3)], 0);
    await env.advance(300);
    env.T.loaded(NaN);
    await env.advance(16000);
    assert.strictEqual(env.marks().length, 0);
    assert.match(env.S.Controller.describe(), /\. Отметки на шкале: нет — длина видео неизвестна$/);
    assert.ok(env.log.console.includes('[SkipIntro] Timeline marks: noduration'));
    env.T.tick(20, 3700);
    await env.advance(300);
    assert.strictEqual(env.marks().length, 2);
    assert.match(env.S.Controller.describe(), /\. Отметки на шкале: 2$/);
});

test('отметки: нет шкалы плеера — «нет — шкала плеера не найдена» и запись в журнале', async () => {
    const env = gotEnv();
    const tl = env.W.document.querySelector('.player-panel__timeline');
    tl.parentNode.removeChild(tl);
    await startGot(env);
    await env.playTo(10, 10.5);
    assert.strictEqual(env.marks().length, 0);
    assert.match(env.S.Controller.describe(), /\. Отметки на шкале: нет — шкала плеера не найдена$/);
    assert.ok(env.log.console.includes('[SkipIntro] Timeline marks: nohost'));
    assert.strictEqual(env.errors.length, 0);
});

test('отметки: свой стиль .skip-intro-mark (как у Lampa 3.4.4) — видны и без стилей шкалы Lampa', async () => {
    const env = gotEnv();
    await startGot(env);
    const css = env.css('skip-intro-css');
    assert.match(css, /\.skip-intro-mark\{position:absolute;top:0;height:100%;-webkit-border-radius:5em;border-radius:5em;background-color:rgba\(110,219,255,\.5\)\}/);
});

test('передача таймкодов в Lampa: длина неизвестна на loadeddata — у Lampa отметки нулевой ширины, плагин рисует свои (без «до конца»)', async () => {
    const env = gotEnv({ settings: { skip_intro_native: 'true' } });
    await startGot(env);
    env.T.destroy();
    const list = env.clone([ep(1), ep(2), ep(3)]);
    list[0].card = env.clone(GOT);
    env.T.play(list[0], { playlist: list, position: 0 });
    await env.advance(300);
    seekable(env, 3700);
    env.T.loaded(Infinity);
    await env.advance(16000);
    const lampa = env.W.document.querySelectorAll('.player-panel__timeline-segments .player-panel__timeline-segment');
    assert.strictEqual(lampa.length, 1, 'Lampa получила заставку');
    assert.strictEqual(parseFloat(lampa[0].style.width) || 0, 0, 'Lampa 3.4.4: ширина 0, если video.duration не число');
    await env.playTo(20, 26);
    const m = env.marks();
    assert.strictEqual(m.length, 1, J(m));
    assert.ok(Math.abs(m[0].left - 437 / 3700 * 100) < 1e-6);
    assert.match(env.S.Controller.describe(), /переданы в Lampa\. Отметки на шкале: 1$/);
    // длина известна — Lampa рисует сама, наши убираются
    env.T.destroy();
    env.T.play(list[0], { playlist: list, position: 0 });
    await env.advance(300);
    env.T.loaded(3700);
    await env.advance(1500);
    await env.playTo(30, 36);
    assert.ok(parseFloat(env.W.document.querySelector('.player-panel__timeline-segment').style.width) > 0);
    assert.strictEqual(env.marks().length, 0);
    assert.match(env.S.Controller.describe(), /переданы в Lampa\. Отметки на шкале рисует Lampa$/);
    assert.ok(env.log.console.includes('[SkipIntro] Timeline marks: lampa'));
    // сборка Lampa без стилей сегментов: отметки Lampa есть, но не видны (position не absolute) — плагин рисует свои
    env.W.getComputedStyle = (el) => ({ position: /player-panel__timeline-segment/.test(el.className || '') ? 'static' : 'relative' });
    env.S.Controller._drawMarks(true);
    assert.strictEqual(env.marks().length, 1);
    assert.match(env.S.Controller.describe(), /переданы в Lampa\. Отметки на шкале: 1$/);
});

// Таймкоды передал источник видео (балансер), включена передача таймкодов в Lampa: пропускает Lampa, плагин в ожидании.
// На приставке с Android Lampa 3.4.4 нарисовала отметки нулевой ширины (длина видео на 'loadeddata' неизвестна) — плагин рисует их сам
const SOURCE_SEGS = { segments: { skip: [{ start: 437, end: 531 }], ad: [{ start: 1000, end: 1030 }] } };
const DESC_LAMPA = 'Таймкоды передал источник видео \u2014 работает встроенный пропуск Lampa';

test('таймкоды от источника видео: у Lampa отметки нулевой ширины (длина неизвестна на loadeddata) — плагин рисует их сам', async () => {
    const env = gotEnv({ settings: { skip_intro_native: 'true' } });
    assert.strictEqual(env.S.Diag.marksText(), 'Ещё не было просмотра с таймкодами');
    play(env, [ep(1), ep(2), ep(3)], 0, { data: SOURCE_SEGS });
    await env.advance(300);
    seekable(env, 3700);
    env.T.loaded(NaN);
    await env.advance(300);
    const lampa = env.W.document.querySelectorAll('.player-panel__timeline-segments .player-panel__timeline-segment');
    assert.strictEqual(lampa.length, 2);
    assert.strictEqual(parseFloat(lampa[0].style.width) || 0, 0, 'Lampa 3.4.4: ширина 0, если video.duration не число');
    const m = env.marks();
    assert.strictEqual(m.length, 2, J(m));
    assert.ok(Math.abs(m[0].left - 437 / 3700 * 100) < 1e-6 && Math.abs(m[0].width - 94 / 3700 * 100) < 1e-6, J(m[0]));
    assert.match(m[0].cls, /player-panel__timeline-segment--skip skip-intro-mark skip-intro-mark--skip/);
    assert.match(m[1].cls, /player-panel__timeline-segment--ad skip-intro-mark skip-intro-mark--ad/);
    assert.match(env.css('skip-intro-css'), /\.skip-intro-mark--ad\{background-color:rgba\(252,198,60,\.5\)\}/);
    assert.strictEqual(env.S.Controller.describe(), DESC_LAMPA + '. Отметки на шкале: 2');
    assert.ok(env.log.console.includes('[SkipIntro] Timeline marks: 2 drawn over Lampa\'s zero-width marks, duration 3700 s'),
        env.log.console.filter((l) => /marks/.test(l)).join(' | '));
    // пропуском занимается Lampa: плагин базы не спрашивает и кнопку не показывает
    assert.strictEqual(env.requests('theintrodb').length, 0);
    await env.playTo(434, 436.75);
    assert.strictEqual(env.button(), null);
    // вход в заставку, длина всё ещё NaN: пропуск Lampa 3.4.4 упадёт на currentTime = NaN — перематывает плагин
    env.T.tick(437);
    await env.advance(250);
    assert.strictEqual(env.T.video().currentTime, 531);
    await env.playTo(531.25, 532);
    assert.strictEqual(env.button(), null);
    assert.strictEqual(env.marks().length, 2);
    assert.deepStrictEqual(J(env.S.LastMarks.get()).st, 'drawn');
    assert.strictEqual(env.S.Diag.marksText(), 'Нарисовал плагин: 2 \u00b7 таймкоды от источника видео, длина видео 1:01:40, только что');
    // Lampa перерисовала с известной длиной — свои отметки плагин убирает, в «Источниках» ничего лишнего
    env.T.loaded(3700);
    await env.advance(300);
    assert.ok(parseFloat(env.W.document.querySelector('.player-panel__timeline-segments .player-panel__timeline-segment').style.width) > 0);
    assert.strictEqual(env.marks().length, 0);
    assert.strictEqual(env.S.Controller.describe(), DESC_LAMPA + '. Встроенный пропуск Lampa не сработал (длина видео ещё неизвестна) \u2014 пропустил плагин: 1');
    assert.ok(env.log.console.includes('[SkipIntro] Timeline marks: lampa'));
    assert.strictEqual(env.S.Diag.marksText(), 'Рисует Lampa \u00b7 таймкоды от источника видео, только что');
    assert.strictEqual(env.errors.length, 0);
});

test('таймкоды от источника видео: длины нет ни в duration, ни в seekable — «нет — длина видео неизвестна»; длина появилась — отметки есть', async () => {
    const env = gotEnv({ settings: { skip_intro_native: 'true' } });
    play(env, [ep(1), ep(2), ep(3)], 0, { data: SOURCE_SEGS });
    await env.advance(300);
    env.T.loaded(NaN);
    await env.advance(300);
    assert.strictEqual(env.marks().length, 0);
    assert.strictEqual(env.S.Controller.describe(), DESC_LAMPA + '. Отметки на шкале: нет \u2014 длина видео неизвестна');
    assert.ok(env.log.console.includes('[SkipIntro] Timeline marks: noduration'));
    // Lampa сама не перерисует (только на 'loadeddata'), плагин — на следующем timeupdate (не чаще раза в 5 с)
    env.T.tick(6, 1420);
    await env.advance(300);
    assert.strictEqual(env.marks().length, 0, 'ещё не прошло 5 с');
    await env.advance(5000);
    env.T.tick(11, 1420);
    await env.advance(300);
    assert.strictEqual(env.marks().length, 2);
    assert.strictEqual(env.S.Controller.describe(), DESC_LAMPA + '. Отметки на шкале: 2');
    env.setStorage('language', 'en');
    assert.strictEqual(env.S.Diag.marksText(), 'Drawn by the plugin: 2 \u00b7 timestamps from the video source, video length 23:40, just now');
});

test('таймкоды от источника видео по настройкам плагина — по-английски: «Skip ad», «Ad in 5 s», источник «video source», «Diagnostics»', async () => {
    const env = gotEnv({ settings: { language: 'en' } });
    play(env, [ep(1), ep(2), ep(3)], 0, { data: SOURCE_SEGS });
    await env.advance(300);
    env.T.loaded(3700);
    await env.advance(1500);
    await env.playTo(995, 995.5);
    assert.strictEqual(env.warn().text, 'Ad in 5 s');
    await env.playTo(1000, 1000.5);
    assert.strictEqual(env.button().label, 'Skip ad');
    assert.match(env.S.Controller.describe(), /^Intro 7:17\u20138:51 \(video source\); Ad 16:40\u201317:10 \(video source\); Credits 1:00:32\u20131:01:40 \(TheIntroDB\)\. TheIntroDB: found/);
    assert.strictEqual(env.S.Diag.marksText(), 'Drawn by the plugin: 3 \u00b7 timestamps from the video source, by plugin settings, video length 1:01:40, just now');
    env.setStorage('skip_intro_auto', 'true');
    await env.playTo(995, 995.25);
    assert.strictEqual(env.warn().text, 'Ad in 5 s \u2014 will be skipped');
});

run('t_i18n: язык интерфейса и отметки на шкале');
