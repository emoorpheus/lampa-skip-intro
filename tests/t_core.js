'use strict';
// Чистая логика autoskip: парсеры баз, объединение, доверие, сдвиг, кэш, аниме-цепочки, субтитры, подписи
const assert = require('assert');
const { createEnv, test, run, fixture, FILES, PKG } = require('./lib/harness');

const J = (x) => JSON.parse(JSON.stringify(x));
const eq = (a, b, m) => assert.deepStrictEqual(J(a), J(b), m);
const DAY = 864e5;

function core() {
    const env = createEnv();
    env.load('autoskip');
    return { env, S: env.S, L: env.S.Logic, C: env.S.core, P: env.clone };
}
const throwsKind = (fn, kind) => {
    let err = null;
    try { fn(); } catch (e) { err = e; }
    assert.ok(err, 'ожидалась ошибка ' + kind);
    assert.strictEqual(err.kind, kind);
};

test('сборка: в Node без window файл отдаёт AniskipCore (module.exports)', () => {
    delete require.cache[FILES.autoskip];
    const m = require(FILES.autoskip);
    assert.strictEqual(m.VERSION, PKG.version);
    assert.strictEqual(typeof m.Logic.combine, 'function');
    assert.strictEqual(typeof m.armPick, 'function');
});

// ---------- IntroDB ----------
test('IntroDB /segments: реальный ответ GoT S1E1 (intro 437–531, outro 3631.5–3699.5, no_recap)', () => {
    const { L, P } = core();
    const r = L.parseIntroDB(200, P(fixture('introdb_got.json')));
    assert.strictEqual(r.st, 'ok');
    eq(r.s, [
        { type: 'intro', start: 437, end: 531, src: 'introdb', conf: 1, n: 2 },
        { type: 'credits', start: 3631.5, end: 3699.5, src: 'introdb', conf: 1, n: 2 }
    ]);
    eq(r.x, { no: { recap: true } });
});

test('IntroDB: post_credits -> x.post; все null + флаги no_* -> «пусто» с флагами', () => {
    const { L, P } = core();
    const j = fixture('introdb_got.json');
    j.post_credits = { start_sec: 3705, end_sec: 3760, start_ms: 3705000, end_ms: 3760000 };
    eq(L.parseIntroDB(200, P(j)).x.post, { start: 3705, end: 3760 });
    const e = L.parseIntroDB(200, P({ intro: null, recap: null, outro: null, post_credits: null, no_intro: true, no_recap: false, no_outro: true }));
    assert.strictEqual(e.st, 'empty');
    eq(e.x, { no: { intro: true, credits: true } });
    // только миллисекунды
    eq(L.parseIntroDB(200, P({ intro: { start_ms: 60000, end_ms: 90500 } })).s, [{ type: 'intro', start: 60, end: 90.5, src: 'introdb' }]);
});

test('правдоподобие: заставка/рекап позже max(10 мин, 40% длины) — ошибка базы (живой ответ IntroDB для Iron Man)', () => {
    const { L, P } = core();
    const r = L.parseIntroDB(200, P(fixture('introdb_ironman.json')));
    eq(r.s.map((s) => [s.type, s.start, s.end]), [['intro', 7512, 7545], ['credits', 7038, 7540]], 'разбор без длины файла ничего не отбрасывает');
    eq(r.x.post, { start: 7540, end: 7580 });
    assert.strictEqual(L.plausible(r.s[0], 7600), false, '«заставка» за 88 с до конца фильма');
    assert.strictEqual(L.plausible(r.s[1], 7600), true, 'титры не проверяются по положению');
    assert.strictEqual(L.plausible({ type: 'intro', start: 437, end: 531, src: 'introdb' }, 3700), true);
    assert.strictEqual(L.plausible({ type: 'intro', start: 590, end: 680, src: 'aniskip' }, 1420), true, 'до 10 мин — всегда');
    assert.strictEqual(L.plausible({ type: 'intro', start: 610, end: 700, src: 'aniskip' }, 1420), false, '24-минутная серия: после 10 мин');
    assert.strictEqual(L.plausible({ type: 'recap', start: 1470, end: 1530, src: 'theintrodb' }, 3700), true, '40% от 3700 с = 1480 с');
    assert.strictEqual(L.plausible({ type: 'recap', start: 1490, end: 1550, src: 'theintrodb' }, 3700), false);
    assert.strictEqual(L.plausible({ type: 'intro', start: 7512, end: 7545, src: 'user' }, 7600), true, 'ручную отметку не трогаем');
    assert.strictEqual(L.plausible(r.s[0], 0), true, 'длина неизвестна — не судим');
});

test('IntroDB: 404 — честное «пусто», 400/500/429/403 и мусор — ошибки (в кэш не идут)', () => {
    const { L, P } = core();
    assert.strictEqual(L.parseIntroDB(404, P({ error: 'No segments found' })).st, 'empty');
    throwsKind(() => L.parseIntroDB(400, P({ error: 'Invalid query params.' })), 'http');
    throwsKind(() => L.parseIntroDB(500, null), 'http');
    throwsKind(() => L.parseIntroDB(429, null), 'limit');
    throwsKind(() => L.parseIntroDB(403, null), 'auth');
    throwsKind(() => L.parseIntroDB(200, null), 'format');
    throwsKind(() => L.parseIntroDB(200, P([1, 2])), 'format');
});

test('IntroDB: неразумные отрезки отбрасываются (заставка 2 с, титры 20 мин)', () => {
    const { L, P } = core();
    const r = L.parseIntroDB(200, P({ intro: { start_sec: 10, end_sec: 12 }, outro: { start_sec: 100, end_sec: 1300 } }));
    assert.strictEqual(r.st, 'empty');
});

// ---------- IntroHater ----------
test('IntroHater: реальный ответ (Breaking Bad S1E1, verified 228–246)', () => {
    const { L, P } = core();
    const r = L.parseIntroHater(200, P(fixture('ih_bb.json')));
    assert.strictEqual(r.st, 'ok');
    eq(r.s, [{ type: 'intro', start: 228, end: 246, src: 'introhater', n: 1, verified: true }]);
});

test('IntroHater: из трёх «Intro» берётся подтверждённый; с жалобами и без голосов — нет', () => {
    const { L, P } = core();
    const got = [
        { start: 7, end: 16, label: 'Intro', votes: 2, verified: false, reportCount: 0 },
        { start: 437, end: 535, label: 'Intro', votes: 1, verified: true, reportCount: 0 },
        { start: 745, end: 1033, label: 'Intro', votes: 0, verified: false, reportCount: 0 }
    ];
    eq(L.parseIntroHater(200, P(got)).s.map((s) => [s.start, s.end]), [[437, 535]]);
    // без подтверждённых: нужен votes >= 2
    const r2 = L.parseIntroHater(200, P([{ start: 7, end: 16, label: 'Intro', votes: 2 }, { start: 30, end: 90, label: 'Intro', votes: 1 }]));
    eq(r2.s, [{ type: 'intro', start: 7, end: 16, src: 'introhater', n: 2, conf: 0.5 }]);
    // жалоб больше, чем голосов, — отбрасываем
    assert.strictEqual(L.parseIntroHater(200, P([{ start: 30, end: 90, label: 'Intro', votes: 2, reportCount: 3 }])).st, 'empty');
    // типы по label
    const r3 = L.parseIntroHater(200, P([{ start: 1300, end: 1380, label: 'Credits', verified: true }, { start: 0, end: 40, label: 'Recap', verified: true }]));
    eq(r3.s.map((s) => s.type).sort(), ['credits', 'recap']);
    assert.strictEqual(L.parseIntroHater(200, P([])).st, 'empty');
    assert.strictEqual(L.parseIntroHater(404, null).st, 'empty');
    throwsKind(() => L.parseIntroHater(200, P({ a: 1 })), 'format');
});

// ---------- TheIntroDB v4 ----------
test('TheIntroDB v4: пример «movie-media» из OpenAPI (start_ms null, end_ms null)', () => {
    const { L, P } = core();
    const r = L.parseTheIntroDB(200, P({
        tvdb_id: 169, type: 'movie',
        intro: [{ start_ms: null, end_ms: 23000 }],
        recap: [{ start_ms: 25000, end_ms: 134000 }],
        credits: [{ start_ms: 5801777, end_ms: 6371111 }, { start_ms: 6408000, end_ms: null }],
        preview: [{ start_ms: 1680000, end_ms: 1740000 }]
    }));
    assert.strictEqual(r.st, 'ok');
    eq(r.s.map((s) => [s.type, s.start, s.end, !!s.toEnd]), [
        ['intro', 0, 23, false], ['recap', 25, 134, false],
        ['credits', 5801.777, 6371.111, false], ['credits', 6408, L.END_SENTINEL, true],
        ['preview', 1680, 1740, false]
    ]);
});

test('TheIntroDB v4: details=true -> conf, n, ref (group_duration_ms)', () => {
    const { L, P } = core();
    const r = L.parseTheIntroDB(200, P({ tvdb_id: 71663, type: 'tv', season: 1, episode: 1, group_duration_ms: 1400000,
        intro: [{ start_ms: null, end_ms: 23000, confidence: 0.87, submission_count: 12 }] }));
    eq(r.s, [{ type: 'intro', src: 'theintrodb', start: 0, end: 23, conf: 0.87, n: 12, ref: 1400 }]);
    eq(r.x, { ref: 1400 });
});

test('TheIntroDB v4: 0 — «сегмента нет»; 404 с code — пусто; прочие коды — ошибки', () => {
    const { L, P } = core();
    const r = L.parseTheIntroDB(200, P({ intro: [{ start_ms: 0, end_ms: 0 }], credits: [{ start_ms: 0, end_ms: null }], recap: [{ start_ms: null, end_ms: 0 }] }));
    assert.strictEqual(r.st, 'empty');
    for (const code of ['no_submissions', 'episode_not_found', 'media_not_found']) {
        const e = L.parseTheIntroDB(404, P({ error: 'x', code }));
        assert.strictEqual(e.st, 'empty');
        assert.strictEqual(e.x.code, code);
    }
    throwsKind(() => L.parseTheIntroDB(404, P({ error: 'Not found' })), 'http');
    throwsKind(() => L.parseTheIntroDB(429, null), 'limit');
    throwsKind(() => L.parseTheIntroDB(403, null), 'auth');
    throwsKind(() => L.parseTheIntroDB(200, null), 'format');
    // запасной ответ «список серий» (нет отправок) — пусто
    assert.strictEqual(L.parseTheIntroDB(200, P({ tvdb_id: 71663, type: 'tv', episodes: [{ season: 1, episode: 1 }] })).st, 'empty');
});

// ---------- Aniskip ----------
test('Aniskip: типы op/mixed-op/ed/mixed-ed/recap, skipId и episodeLength; объединение точной и «любой» длины', () => {
    const { C, L, P } = core();
    const res = C.mapAniskipTypes(P([
        { interval: { startTime: 208, endTime: 298.556 }, skipType: 'op', skipId: 'a1', episodeLength: 1435 },
        { interval: { startTime: 1377, endTime: 1420.25 }, skipType: 'ed', skipId: 'a2', episodeLength: 1435 },
        { interval: { startTime: 1400, endTime: 1430 }, skipType: 'mixed-ed', skipId: 'a3', episodeLength: 1435 },
        { interval: { startTime: 0, endTime: 60 }, skipType: 'recap' },
        { interval: { startTime: 5, endTime: 3 }, skipType: 'op' },
        { interval: { startTime: 5, endTime: 30 }, skipType: 'unknown' }
    ]));
    eq(res.map((s) => [s.type, s.kind, s.id || null, s.ref || null]), [
        ['intro', 'op', 'a1', 1435], ['credits', 'ed', 'a2', 1435], ['credits', 'mixed-ed', 'a3', 1435], ['recap', 'recap', null, null]
    ]);
    const exact = res.filter((s) => s.type === 'intro');
    const merged = L.combineAniskip(P(exact), P(res));
    // ed и mixed-ed пересекаются -> один отрезок 1377–1430 с пометкой approx (взят из «любой длины»)
    eq(merged.map((s) => [s.type, s.start, s.end, !!s.approx]), [['recap', 0, 60, true], ['intro', 208, 298.556, false], ['credits', 1377, 1430, true]]);
});

// ---------- Главы MKV ----------
test('Главы MKV (ffprobe TorrServer): Opening/Ending/Preview, номера и кавычки в названиях', () => {
    const { L, P } = core();
    const ff = { format: { duration: '1440.5' }, chapters: [
        { start_time: '0.000000', end_time: '95.000000', tags: { title: 'Prologue' } },
        { start_time: '95.000000', end_time: '185.000000', tags: { title: '02. Opening' } },
        { start_time: '185.000000', end_time: '1300.000000', tags: { title: 'Part A' } },
        { start_time: '1300.000000', end_time: '1390.000000', tags: { title: '"Ending"' } },
        { start_time: '1390.000000', end_time: '1420.000000', tags: { title: 'Preview' } }
    ] };
    const r = L.parseChapters(P(ff), false);
    assert.strictEqual(r.st, 'ok');
    eq(r.s.map((s) => [s.type, s.start, s.end]), [['intro', 95, 185], ['credits', 1300, 1390], ['preview', 1390, 1420]]);
    eq(r.x, { count: 5 });
    // распознавание названий
    const cases = { 'OP': 'intro', 'Opening Credits': 'intro', 'Intro': 'intro', 'Заставка': 'intro', 'Опенинг 2': 'intro',
        'ED': 'credits', 'End Credits': 'credits', 'Титры': 'credits', 'Ending Theme': 'credits', 'Recap': 'recap', 'Previously on Lost': 'recap',
        'Next Episode Preview': 'preview', 'Превью': 'preview', 'Chapter 5': null, 'Part B': null, 'Epilogue': null, 'Edit': null };
    for (const t of Object.keys(cases)) assert.strictEqual(L.chapterType(t), cases[t], t);
});

test('Главы MKV: заставка в конце файла и «титры» в середине — отбрасываются; у фильма титры до 30 мин', () => {
    const { L, P } = core();
    const r = L.parseChapters(P({ format: { duration: 1440 }, chapters: [
        { start_time: 700, end_time: 790, tags: { title: 'Opening' } },
        { start_time: 300, end_time: 400, tags: { title: 'Credits' } }
    ] }), false);
    assert.strictEqual(r.st, 'empty');
    const m = L.parseChapters(P({ format: { duration: 8000 }, chapters: [{ start_time: 6800, end_time: 7900, tags: { title: 'End Credits' } }] }), true);
    eq(m.s.map((s) => [s.type, s.start, s.end]), [['credits', 6800, 7900]]);
    assert.strictEqual(L.parseChapters(P({ format: {}, chapters: [] }), false).st, 'empty');
    throwsKind(() => L.parseChapters(null), 'format');
});

// ---------- Объединение ----------
test('combine: приоритет источников по типу; аниме — Aniskip раньше TheIntroDB; флаги no и post', () => {
    const { L, P } = core();
    const records = P({
        theintrodb: { st: 'ok', s: [{ type: 'intro', start: 10, end: 70, src: 'theintrodb' }, { type: 'credits', start: 1300, end: 1380, src: 'theintrodb' }] },
        introdb: { st: 'ok', s: [{ type: 'intro', start: 12, end: 72, src: 'introdb' }, { type: 'recap', start: 0, end: 9, src: 'introdb' }], x: { no: { preview: true }, post: { start: 1390, end: 1420 } } },
        aniskip: { st: 'ok', s: [{ type: 'intro', start: 20, end: 110, src: 'aniskip' }] },
        user: { st: 'ok', s: [{ type: 'credits', start: 1290, end: 1385, src: 'user' }] },
        introhater: { st: 'error', s: [{ type: 'preview', start: 1, end: 20, src: 'introhater' }] }
    });
    const c = L.combine(records, L.ORDER_OTHER);
    eq(c.segments.map((s) => [s.type, s.src]), [['recap', 'introdb'], ['intro', 'theintrodb'], ['credits', 'user']]);
    eq(c.no, { preview: true });
    eq(c.post, { start: 1390, end: 1420 });
    const a = L.combine(records, L.ORDER_ANIME);
    assert.strictEqual(a.srcByType.intro, 'aniskip');
});

// ---------- Порог доверия ----------
test('trustOk: уровни off/low/mid/high для разных источников', () => {
    const { L, P } = core();
    const seg = (o) => P(Object.assign({ type: 'intro', start: 0, end: 60 }, o));
    const table = [
        // [сегмент, off, low, mid, high]
        [seg({ src: 'introdb', conf: 1, n: 2 }), true, true, true, false],
        [seg({ src: 'introdb', conf: 0.4, n: 9 }), true, false, false, false],
        [seg({ src: 'theintrodb', conf: 0.87, n: 12 }), true, true, true, true],
        [seg({ src: 'theintrodb' }), true, true, false, false],
        [seg({ src: 'introhater', n: 1, verified: true }), true, true, true, true],
        [seg({ src: 'introhater', n: 2, conf: 0.5 }), true, true, false, false],
        [seg({ src: 'aniskip' }), true, true, true, true],
        [seg({ src: 'aniskip', approx: true }), true, true, false, false],
        [seg({ src: 'user' }), true, true, true, true],
        [seg({ src: 'chapters' }), true, true, true, true],
        [seg({ src: 'subs' }), false, false, false, false],
        [seg({ src: 'audio' }), false, false, false, false]
    ];
    for (const row of table) {
        ['off', 'low', 'mid', 'high'].forEach((lv, i) => assert.strictEqual(L.trustOk(row[0], lv), row[i + 1], J(row[0]).src + ' ' + lv));
    }
});

// ---------- Сдвиг ----------
test('applyShift: ручной сдвиг — только данные баз; авто — хвостовые титры к концу реального файла', () => {
    const { L, P } = core();
    const segs = P([
        { type: 'intro', start: 60, end: 150, src: 'introdb' },
        { type: 'intro', start: 60, end: 150, src: 'user' },
        { type: 'credits', start: 1377, end: 1420, src: 'aniskip', ref: 1435 },
        { type: 'credits', start: 1300, end: L.END_SENTINEL, toEnd: true, src: 'theintrodb', ref: 1400 }
    ]);
    const m = L.applyShift(segs, 0, 2, false);
    eq(m.map((s) => [s.src, s.start, s.end, s.shift || 0]), [['introdb', 62, 152, 2], ['user', 60, 150, 0], ['aniskip', 1379, 1422, 2], ['theintrodb', 1302, L.END_SENTINEL, 2]]);
    // файл на 30 с длиннее эталона: титры, кончающиеся у конца эталона, едут вместе с концом
    const a = L.applyShift(segs, 1465, 0, true);
    eq(a.map((s) => [s.src, s.start, s.end]), [['introdb', 60, 150], ['user', 60, 150], ['aniskip', 1407, 1450], ['theintrodb', 1365, L.END_SENTINEL]]);
    // разница меньше 1.5 с или больше 90 с — не трогаем
    eq(L.applyShift(segs, 1436, 0, true)[2].start, 1377);
    eq(L.applyShift(segs, 1600, 0, true)[2].start, 1377);
    // отрицательный ручной сдвиг не уводит начало в минус
    assert.strictEqual(L.applyShift(P([{ type: 'intro', start: 1, end: 60, src: 'introdb' }]), 0, -5, false)[0].start, 0);
});

test('applyOffsets: «до конца» получает длину файла; выходящее за файл обрезается; хвост меньше 1 с — убирается', () => {
    const { C, L, P } = core();
    const r = C.applyOffsets(P([
        { type: 'intro', start: 0, end: 90 },
        { type: 'credits', start: 1300, end: L.END_SENTINEL, toEnd: true },
        { type: 'preview', start: 1419.5, end: 1500 },
        { type: 'credits', start: 1500, end: 1600 }
    ]), 1420);
    eq(r.map((s) => [s.type, s.start, s.end]), [['intro', 0, 90], ['credits', 1300, 1420]]);
});

test('Logic: findSegment, upcoming (5 с), isTail (15 с до конца), chainEnd (титры + превью)', () => {
    const { L, P } = core();
    const segs = P([{ type: 'intro', start: 60, end: 150 }, { type: 'credits', start: 1300, end: 1380 }, { type: 'preview', start: 1381, end: 1415 }]);
    assert.strictEqual(L.findSegment(segs, 60).start, 60);
    assert.strictEqual(L.findSegment(segs, 150), null);
    assert.strictEqual(L.upcoming(segs, 55, 5).start, 60);
    assert.strictEqual(L.upcoming(segs, 54.9, 5), null);
    assert.strictEqual(L.chainEnd(segs[1], segs, null), 1415);
    assert.strictEqual(L.chainEnd(segs[1], segs, (t) => t !== 'preview'), 1380);
    assert.strictEqual(L.isTail(segs[1], 1420, 1380), false);
    assert.strictEqual(L.isTail(segs[1], 1420, 1415), true);
    assert.strictEqual(L.isTail(segs[0], 160, 150), false, 'заставка — не хвост');
    assert.strictEqual(L.isTail(P({ type: 'credits', start: 1, end: 2, toEnd: true }), 0), true);
});

// ---------- Кэш ----------
test('кэш: ключи, варианты по длине (±10 с), TTL ok 7 дн / пусто 12 ч / эвристика 30 дн / главы 30 дн', () => {
    const { env, S, L, P } = core();
    const ctx = P({ tmdb: '1399', season: 1, episode: 1, movie: false });
    assert.strictEqual(L.episodeKey(ctx), 'skip3_1399_s1_e1');
    assert.strictEqual(L.episodeKey(P({ tmdb: '27205', movie: true })), 'skip3_m27205');
    assert.strictEqual(L.episodeKey(P({ tmdb: 'ivi-12', season: 2, episode: 3 })), 'skip3_ivi-12_s2_e3');
    S.Store.putRecord(ctx, 'theintrodb', 'L1420', P({ st: 'ok', s: [{ type: 'intro', start: 1, end: 60 }], x: { ref: 1420 } }));
    S.Store.putRecord(ctx, 'introdb', '', P({ st: 'empty', s: [] }));
    S.Store.putRecord(ctx, 'det', 'L1420', P({ st: 'ok', s: [{ type: 'intro', start: 1, end: 60, src: 'subs' }] }));
    assert.ok(S.Store.getRecord(ctx, 'theintrodb', 'L1430'), '±10 с — подходит');
    assert.strictEqual(S.Store.getRecord(ctx, 'theintrodb', 'L1435'), null, '15 с — уже другая версия файла');
    assert.strictEqual(S.Store.getRecord(ctx, 'theintrodb', ''), null, 'без длины — отдельный вариант');
    env.T.clock.now += DAY / 2 + 1000;
    assert.strictEqual(S.Store.getRecord(ctx, 'introdb', ''), null, '«пусто» живёт 12 ч');
    assert.ok(S.Store.getRecord(ctx, 'theintrodb', 'L1420'));
    env.T.clock.now += 7 * DAY;
    assert.strictEqual(S.Store.getRecord(ctx, 'theintrodb', 'L1420'), null, 'таймкоды живут 7 дней');
    assert.ok(S.Store.getRecord(ctx, 'det', 'L1420'), 'эвристика живёт 30 дней');
    assert.strictEqual(L.recordTtl('chapters', 'ok'), 30 * DAY);
    assert.strictEqual(L.recordTtl('chapters', 'empty'), 7 * DAY);
    // запись «из будущего» (часы ТВ сбились) не считается свежей
    assert.strictEqual(L.isFresh(P({ t: env.now + 2 * DAY, st: 'ok' }), 'introdb', env.now), false);
    // ошибки не бывают «свежими»
    assert.strictEqual(L.isFresh(P({ t: env.now, st: 'error' }), 'introdb', env.now), false);
});

test('кэш: очистка — ключи v2.11 удаляются, протухшие записи вычищаются, сверх лимита — самые старые', () => {
    const { env, S, L } = core();
    const ls = env.W.localStorage, now = env.now;
    ls.setItem('skip_1399_s1_e1_L1420', '{"t":1}');
    ls.setItem('aniskip_map_1429_s4', '{}');
    ls.setItem('skip_intro_det_1399_s1_e1_L1420', '{}');
    ls.setItem('skip_intro_detected', '{}');
    ls.setItem('skip_intro_series', '{"1":{"mode":"auto"}}');          // настройки — не трогаем
    ls.setItem('skip3_1_s1_e1', JSON.stringify({ v: 3, t: now, r: { 'introdb|': { t: now - 8 * DAY, st: 'ok', s: [] }, 'theintrodb|L100': { t: now, st: 'ok', s: [] } } }));
    ls.setItem('skip3_2_s1_e1', JSON.stringify({ v: 3, t: now - 9 * DAY, r: { 'introdb|': { t: now - 9 * DAY, st: 'ok', s: [] } } }));
    ls.setItem('skip3_arm_1429', JSON.stringify({ t: now - 31 * DAY, list: [{ m: 1 }] }));
    ls.setItem('skip3_arm_37854', JSON.stringify({ t: now - 2 * DAY, list: [{ m: 21 }] }));
    ls.setItem('skip3_al_21', JSON.stringify({ t: now - 2 * DAY, st: 'RELEASING' }));     // выходит — 1 день
    ls.setItem('skip3_al_40028', JSON.stringify({ t: now - 2 * DAY, st: 'FINISHED' }));   // вышел — 30 дней
    ls.setItem('skip3_rr_40028', 'not json');
    const removed = S.Store.cleanup();
    const left = [];
    for (let i = 0; i < ls.length; i++) left.push(ls.key(i));
    assert.deepStrictEqual(left.sort(), ['skip3_1_s1_e1', 'skip3_al_40028', 'skip3_arm_37854', 'skip_intro_series']);
    assert.strictEqual(removed, 8);
    assert.deepStrictEqual(Object.keys(JSON.parse(ls.getItem('skip3_1_s1_e1')).r), ['theintrodb|L100']);
    // лимит
    for (let i = 0; i < 12; i++) ls.setItem('skip3_' + (100 + i) + '_s1_e1', JSON.stringify({ v: 3, t: now - i * 1000, r: { 'introdb|': { t: now - i * 1000, st: 'ok', s: [] } } }));
    const plan = L.cleanupPlan(Array.from({ length: ls.length }, (_, i) => ({ key: ls.key(i), value: ls.getItem(ls.key(i)) })), now, 5);
    assert.strictEqual(plan.drop.length, 10);
    assert.ok(plan.drop.indexOf('skip3_100_s1_e1') === -1, 'самая свежая запись остаётся');
});

test('кэш: переполнение localStorage — чистка вдвое строже и повторная запись', () => {
    const { env, S, P } = core();
    const ls = env.W.localStorage, now = env.now;
    for (let i = 0; i < 300; i++) ls.setItem('skip3_' + i + '_s1_e1', JSON.stringify({ v: 3, t: now - (300 - i) * 1000, r: { 'introdb|': { t: now - (300 - i) * 1000, st: 'ok', s: [] } } }));
    let fails = 1;
    ls.fail = () => fails-- > 0;          // первая запись — QuotaExceededError
    S.Store.putRecord(P({ tmdb: '999', season: 1, episode: 1 }), 'introdb', '', P({ st: 'ok', s: [] }));
    assert.ok(ls.getItem('skip3_999_s1_e1'), 'запись сохранена после чистки');
    assert.strictEqual(S.Store.count(), 201);
});

// ---------- Аниме ----------
test('ARM -> MAL: Attack on Titan S4 — три части; S4E17 -> MAL 48583 серия 1 (реальные ARM и AniList)', () => {
    const { C, P } = core();
    const list = C.reduceArm(P(fixture('arm_1429.json')));
    const pick = C.armPick(list, 4);
    eq(pick, { mode: 'season', ids: [40028, 48583, 51535] });
    const info = {};
    fixture('anilist_ids.json').data.Page.media.forEach((m) => {
        info[m.idMal] = { eps: m.episodes, fmt: m.format, st: m.status, y: m.startDate.year, mo: m.startDate.month, d: m.startDate.day, next: m.nextAiringEpisode && m.nextAiringEpisode.episode };
    });
    const chain = C.buildChain(P(pick.ids), P(info));
    eq(chain, [{ mal: 40028, eps: 16 }, { mal: 48583, eps: 12 }, { mal: 51535, eps: 1 }]);
    eq(C.locateInChain(P(chain), 1), { mal: 40028, ep: 1, over: false });
    eq(C.locateInChain(P(chain), 16), { mal: 40028, ep: 16, over: false });
    eq(C.locateInChain(P(chain), 17), { mal: 48583, ep: 1, over: false });
    eq(C.locateInChain(P(chain), 28), { mal: 48583, ep: 12, over: false });
    eq(C.locateInChain(P(chain), 29), { mal: 51535, ep: 1, over: false });
    eq(C.locateInChain(P(chain), 30), { mal: 51535, ep: 2, over: true });
    eq(C.armPick(list, 3), { mode: 'season', ids: [35760, 38524] });
    assert.strictEqual(C.armPick(list, 9), null, 'сезона нет — сопоставления нет');
});

test('ARM -> MAL: Frieren S1E30 -> MAL 59978 серия 2 (анонс 63816 не участвует)', () => {
    const { C, P } = core();
    const pick = C.armPick(C.reduceArm(P(fixture('arm_209867.json'))), 1);
    eq(pick, { mode: 'season', ids: [52991, 59978, 63816] });
    const info = { 52991: { eps: 28, fmt: 'TV', st: 'FINISHED', y: 2023, mo: 9, d: 29 }, 59978: { eps: 10, fmt: 'TV', st: 'FINISHED', y: 2026, mo: 1, d: 16 }, 63816: { eps: null, fmt: 'TV', st: 'NOT_YET_RELEASED', y: 2027, mo: 10 } };
    const chain = C.buildChain(P(pick.ids), P(info));
    eq(C.locateInChain(chain, 30), { mal: 59978, ep: 2, over: false });
    // выходящая часть без числа серий: берётся nextAiringEpisode - 1
    eq(C.buildChain(P([21]), P({ 21: { eps: null, st: 'RELEASING', next: 1181, y: 1999 } })), [{ mal: 21, eps: 1180 }]);
});

test('сквозная нумерация: One Piece (ARM знает только сериал) S2E5 -> 66, S2E62 -> 62', () => {
    const { C, P } = core();
    const pick = C.armPick(C.reduceArm(P(fixture('arm_37854.json'))), 2);
    eq(pick, { mode: 'show', mal: 21 });
    const card = P(fixture('tmdb_op_card.json'));
    assert.strictEqual(C.absoluteEpisode(card, 1, 7), 7);
    assert.strictEqual(C.absoluteEpisode(card, 2, 5), 66);
    assert.strictEqual(C.absoluteEpisode(card, 2, 62), 62, 'номер больше числа серий сезона — TMDB уже нумерует сквозь');
    assert.strictEqual(C.absoluteEpisode(card, 3, 1), 61 + 16 + 1);
    assert.strictEqual(C.absoluteEpisode(P({ seasons: [{ season_number: 1, episode_count: 10 }] }), 3, 1), null, 'нет сведений о сезоне 2');
    // Demon Slayer (TMDB 85937): у ARM сезоны есть -> по сезону
    eq(C.armPick(C.reduceArm(P(fixture('arm_85937.json'))), 2), { mode: 'season', ids: [49926] });
});

test('правила Aniskip (relation-rules 40028, реальный ответ): первое совпавшее правило', () => {
    const { C, P } = core();
    const rules = P(fixture('aniskip_rr.json').rules);
    eq(C.applyRules(rules, 17), { mal: 48583, ep: 1 });
    eq(C.applyRules(rules, 20), { mal: 48583, ep: 4 });
    eq(C.applyRules(rules, 60), { mal: 40028, ep: 1 });
    eq(C.applyRules(rules, 80), { mal: 48583, ep: 5 });
    assert.strictEqual(C.applyRules(rules, 5), null);
    assert.strictEqual(C.applyRules(P([{ from: { start: 1, end: 5 }, to: { malId: 7, start: 1, end: 3 } }]), 4), null, 'за пределами to.end');
});

test('isAnime: жанр «анимация» + Япония/японский; без сведений — неизвестно (null)', () => {
    const { C, P } = core();
    assert.strictEqual(C.isAnime(P({ genre_ids: [16, 10759], original_language: 'ja' })), true);
    assert.strictEqual(C.isAnime(P({ genres: [{ id: 16 }], origin_country: ['JP'], original_language: 'en' })), true);
    assert.strictEqual(C.isAnime(P({ genres: [{ id: 16 }], origin_country: ['US'], original_language: 'en' })), false);
    assert.strictEqual(C.isAnime(P({ genres: [{ id: 18 }], original_language: 'ja' })), false);
    assert.strictEqual(C.isAnime(P({ id: 1 })), null);
    assert.strictEqual(C.isAnime(P(fixture('tmdb_op_card.json'))), true);
});

// ---------- Субтитры ----------
test('SRT/VTT: разбор времени и самая длинная пауза в первых 6 минутах', () => {
    const { L } = core();
    const srt = [];
    const cue = (a, b) => srt.push('00:' + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0') + ',000 --> 00:' + String(Math.floor(b / 60)).padStart(2, '0') + ':' + String(b % 60).padStart(2, '0') + ',500\nтекст\n');
    [[5, 8], [10, 14], [20, 25], [30, 40], [45, 50], [140, 145], [150, 160], [170, 175], [400, 410]].forEach(([a, b]) => cue(a, b));
    const cues = L.parseSrtVtt(srt.join('\n'));
    assert.strictEqual(cues.length, 9);
    assert.strictEqual(cues[0].end, 8.5);
    eq(L.gapIntro(cues, 360), { type: 'intro', start: 51, end: 140, src: 'subs' });
    // VTT: часы необязательны, точка вместо запятой
    eq(L.parseSrtVtt('WEBVTT\n\n01:02.500 --> 01:04.250\nx\n\n1:00:00.000 --> 1:00:01.000\ny'), [{ start: 62.5, end: 64.25 }, { start: 3600, end: 3601 }]);
    // реплики начинаются поздно — заставка с начала файла
    eq(L.gapIntro(L.parseSrtVtt(['00:01:30,000 --> 00:01:32,000', '00:01:33,000 --> 00:01:35,000', '00:01:36,000 --> 00:01:38,000', '00:01:39,000 --> 00:01:41,000', '00:01:42,000 --> 00:01:44,000'].join('\nx\n\n')), 360),
        { type: 'intro', start: 0, end: 90, src: 'subs' });
});

test('ASS: формат [Events], песни (стиль OP/ED, караоке \\k, ♪) -> заставка и титры', () => {
    const { L } = core();
    const lines = ['[Script Info]', 'Title: x', '', '[V4+ Styles]', 'Format: Name, Fontname', 'Style: Default,Arial', '', '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
    const t = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h + ':' + String(m).padStart(2, '0') + ':' + String(x.toFixed(2)).padStart(5, '0'); };
    for (let s = 90; s < 180; s += 6) lines.push('Dialogue: 0,' + t(s) + ',' + t(s + 5) + ',OP-Romaji,,0,0,0,,{\\k20}la {\\k30}la, la');
    for (let s = 200; s < 1250; s += 20) lines.push('Dialogue: 0,' + t(s) + ',' + t(s + 4) + ',Default,,0,0,0,,Реплика, с запятой');
    for (let s = 1300; s < 1385; s += 5) lines.push('Dialogue: 0,' + t(s) + ',' + t(s + 4) + ',Default,,0,0,0,,♪ ending song ♪');
    const ev = L.parseAss(lines.join('\r\n'));
    assert.ok(ev.length > 60);
    assert.strictEqual(ev.find((e) => e.style === 'Default' && e.text.indexOf('Реплика') === 0).text, 'Реплика, с запятой');
    eq(L.assSongs(ev, 1420), [{ type: 'intro', start: 89, end: 180, src: 'ass' }, { type: 'credits', start: 1299, end: 1385, src: 'ass' }]);
    // без длины файла титры не определяются (неизвестно, где «конец»)
    eq(L.assSongs(ev, 0).map((s) => s.type), ['intro']);
});

// ---------- Подписи и мелочи ----------
test('episodeLabel: «S01E02 — Название»; имена файлов и «Серия N» не показываются', () => {
    const { L, P } = core();
    assert.strictEqual(L.episodeLabel(P({ season: 1, episode: 2, title: 'Pilot' })), 'S01E02 \u2014 Pilot');
    assert.strictEqual(L.episodeLabel(P({ season: 1, episode: 2, title: 'Show.S01E02.1080p.WEB-DL.mkv' })), 'S01E02');
    assert.strictEqual(L.episodeLabel(P({ season: 3, episode: 10, title: 'Серия 10' })), 'S03E10');
    assert.strictEqual(L.episodeLabel(P({ episode: 5, title: '' })), 'Серия 5');
    assert.strictEqual(L.episodeLabel(P({ title: '/media/folder/Some Title' })), 'Some Title');
    const long = L.episodeLabel(P({ season: 1, episode: 1, title: 'Очень длинное название серии, которое не помещается в кнопку целиком' }));
    assert.ok(long.length <= 7 + 3 + 48 && long.endsWith('\u2026'), long);
    assert.strictEqual(L.episodeLabel(null), '');
});

test('toLampaSegments: формат Lampa {skip:[{start,end}], ad:[]}; без «до конца» и выключенных типов', () => {
    const { L, P } = core();
    const r = L.toLampaSegments(P([{ type: 'intro', start: 60.1234, end: 150 }, { type: 'credits', start: 1300, end: 1e7, toEnd: true }, { type: 'preview', start: 1390, end: 1420 }]), (t) => t !== 'preview');
    eq(r, { skip: [{ start: 60.123, end: 150 }], ad: [] });
    assert.strictEqual(L.toLampaSegments(P([]), null), null);
});

test('склонения и «сэкономлено»: 1 пропуск, 2 пропуска, 5/11/12 пропусков, 21 пропуск; минуты и часы', () => {
    const { S, L } = core();
    const add = (n) => { for (let i = 0; i < n; i++) S.Stats.add('intro', 60); };
    assert.strictEqual(S.Stats.text(), 'Пока ничего не пропущено');
    add(1); assert.strictEqual(S.Stats.text(), 'Сэкономлено 1 мин (1 пропуск)');
    add(1); assert.strictEqual(S.Stats.text(), 'Сэкономлено 2 мин (2 пропуска)');
    add(3); assert.strictEqual(S.Stats.text(), 'Сэкономлено 5 мин (5 пропусков)');
    add(6); assert.match(S.Stats.text(), /\(11 пропусков\)$/);
    add(1); assert.match(S.Stats.text(), /\(12 пропусков\)$/);
    add(9); assert.match(S.Stats.text(), /\(21 пропуск\)$/);
    add(2); assert.match(S.Stats.text(), /\(23 пропуска\)$/);
    add(100); assert.strictEqual(S.Stats.text(), 'Сэкономлено 2 ч 3 мин (123 пропуска)');
    assert.strictEqual(L.formatSaved(59), '59 с');
    S.Stats.add('intro', -5); S.Stats.add('intro', 4 * 3600);       // мусор не считается
    assert.match(S.Stats.text(), /\(123 пропуска\)$/);
    S.Stats.reset();
    assert.strictEqual(S.Stats.text(), 'Пока ничего не пропущено');
});

test('TorrServer: адрес потока -> base/hash/index (/stream ?link=&index=, /play/hash/id, префикс пути, torrent_hash)', () => {
    const { S, P } = core();
    const H = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    eq(S.Torr.target(P({ url: 'http://torrserver.test:8090/stream/Show.S01E01.mkv?link=' + H + '&index=3&play' })), { base: 'http://torrserver.test:8090', hash: H.toLowerCase(), index: 3 });
    eq(S.Torr.target(P({ url: 'https://ts.example/ts/stream/x.mkv?link=' + H + '&index=1&play' })), { base: 'https://ts.example/ts', hash: H.toLowerCase(), index: 1 });
    eq(S.Torr.target(P({ url: 'http://127.0.0.1:8090/play/' + H + '/7' })), { base: 'http://127.0.0.1:8090', hash: H.toLowerCase(), index: 7 });
    eq(S.Torr.target(P({ url: 'http://127.0.0.1:8090/stream/x.mkv?index=2&play', torrent_hash: H })), { base: 'http://127.0.0.1:8090', hash: H.toLowerCase(), index: 2 });
    assert.strictEqual(S.Torr.target(P({ url: 'http://127.0.0.1:8090/stream/x.mkv?link=' + H + '&play' })), null, 'без index — не знаем файл');
    assert.strictEqual(S.Torr.target(P({ url: 'https://cdn.example/video.m3u8' })), null);
    assert.strictEqual(S.Torr.target(P({ url: 'magnet:?xt=urn:btih:' + H })), null);
});

test('прокси IntroDB: {url}, {encoded} и префикс', () => {
    const { S } = core();
    const u = 'https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1';
    assert.strictEqual(S.Net.applyProxy('https://p.example/{url}', u), 'https://p.example/' + u);
    assert.strictEqual(S.Net.applyProxy('https://p.example/?u={encoded}', u), 'https://p.example/?u=' + encodeURIComponent(u));
    assert.strictEqual(S.Net.applyProxy('https://p.example/raw/', u), 'https://p.example/raw/' + u);
    assert.strictEqual(S.Net.applyProxy('', u), u);
});

test('normalizeUrl и seasonHint', () => {
    const { L, P } = core();
    assert.strictEqual(L.normalizeUrl('HTTPS://Example.com/Plugin.js?v=3#x'), 'example.com/plugin.js');
    assert.strictEqual(L.normalizeUrl('//example.com/plugin.js/'), 'example.com/plugin.js');
    eq(L.seasonHint(P({ seasons: [{ season_number: 2, air_date: '2019-04-29', episode_count: 10 }] }), 2), { year: 2019, month: 4, episodes: 10 });
    eq(L.seasonHint(P({ first_air_date: '2013-04-07' }), 1), { year: 2013, month: 4, episodes: null });
    assert.strictEqual(L.seasonHint(P({}), 2), null);
});

run('autoskip ' + PKG.version + ' — логика');
