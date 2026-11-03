// Сверка Logic.lampaSkipAt / Logic.lampaList с настоящим модулем сегментов Lampa 3.4.4 (ref/lampa-built/app.min.js, Segments:
// set/adjust/get) без браузера: какой сегмент встроенный пропуск Lampa пропустит — пока длина видео неизвестна (adjust(NaN))
// и при известной длине (adjust(duration): пересчёт по duration_ms). По этим же сегментам пропускает плагин, когда таймкоды
// источника видео берёт себе. Случайные наборы сегментов (seed фиксирован), в том числе те, что Lampa отбрасывает как дубль заставки.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

const src = fs.readFileSync(path.join(__dirname, '..', 'ref', 'lampa-built', 'app.min.js'), 'utf8');
const end = src.indexOf('var Segments$1 = {');
const start = src.lastIndexOf('var listener$b = Subscribe$2();', end);
const close = src.indexOf('};', end);
if (end < 0 || start < 0 || close < 0) { console.error('модуль сегментов не найден в ref/lampa-built/app.min.js'); process.exit(2); }
const Arrays = { isObject: (o) => !!o && typeof o === 'object' && !Array.isArray(o), isArray: Array.isArray };
const Seg = new Function('Subscribe$2', 'Arrays', 'Player', src.slice(start, close + 2) + '\nreturn Segments$1;')(
    () => ({ send() {}, follow() {} }), Arrays, { listener: { follow() {} } });
const { Logic } = require('../dist/autoskip.js');

let seed = 20261102;
const rnd = (a, b) => { seed = (seed * 1103515245 + 12345) % 2147483648; return a + (seed / 2147483648) * (b - a); };
const r1 = (x) => Math.round(x * 10) / 10;
let checks = 0, hits = 0, dropped = 0;
const bad = [];
for (let i = 0; i < 5000; i++) {
    const mk = () => { const s = rnd(0, 1) < 0.35 ? rnd(0, 45) : rnd(0, 3000); return { start: r1(s), end: r1(s + rnd(1, 150)) }; };
    const raw = { skip: Array.from({ length: Math.floor(rnd(1, 5)) }, mk), ad: Array.from({ length: Math.floor(rnd(0, 3)) }, mk) };
    if (rnd(0, 1) < 0.5) raw.duration_ms = Math.round(rnd(600, 4000)) * 1000;
    Seg.set(JSON.parse(JSON.stringify(raw)));
    Seg.adjust(NaN);
    const all = raw.skip.concat(raw.ad);
    const times = [0, 0.3, 15, 29.9, 30, 30.5, 45, 60].concat(all.map((s) => r1((s.start + s.end) / 2)), Array.from({ length: 8 }, () => rnd(0, 3200)));
    for (const t of times) {
        checks++;
        const a = Seg.get(t), b = Logic.lampaSkipAt(raw, t);
        const x = a ? a.segment.start + '-' + a.segment.end : null, y = b ? b.start + '-' + b.end : null;
        if (a) hits++;
        if (x !== y && bad.length < 3) bad.push(JSON.stringify(raw) + ' t=' + t + ' lampa=' + x + ' plugin=' + y);
    }
    if (all.some((s) => !Seg.get((s.start + s.end) / 2))) dropped++;
}
console.log('checks: ' + checks + ', Lampa skips: ' + hits + ', sets with a segment Lampa ignores: ' + dropped);
check('Logic.lampaSkipAt = Segments.get Lampa 3.4.4 при неизвестной длине (' + checks + ' проверок)', () => assert.deepStrictEqual(bad, []));
check('в выборке есть и пропуски, и сегменты, которые Lampa отбрасывает', () => assert.ok(hits > 1000 && dropped > 100, hits + ' / ' + dropped));

// длина известна: Lampa на 'loadeddata' пересчитывает сегменты под неё (adjust), если у источника есть duration_ms
let checks2 = 0, hits2 = 0, moved = 0;
const bad2 = [];
for (let i = 0; i < 5000; i++) {
    const ref = Math.round(rnd(600, 4000));
    const mk = () => { const s = rnd(0, 1) < 0.3 ? rnd(0, 45) : rnd(0, ref); return { start: r1(s), end: r1(Math.min(ref, s + rnd(1, 150))) }; };
    const skip = Array.from({ length: Math.floor(rnd(1, 5)) }, mk);
    if (rnd(0, 1) < 0.5) { const len = r1(rnd(30, 150)); skip.push({ start: r1(ref - len - rnd(0, 20)), end: r1(ref - rnd(0, 10)) }); }   // титры у конца
    const raw = { skip, ad: Array.from({ length: Math.floor(rnd(0, 2)) }, mk) };
    if (rnd(0, 1) < 0.85) raw.duration_ms = ref * 1000;
    const pick = rnd(0, 1), dur = r1(pick < 0.15 ? ref + rnd(-2, 2) : pick < 0.3 ? ref - rnd(1, 300) : pick < 0.6 ? ref + rnd(2, 20) : ref + rnd(20, 600));
    Seg.set(JSON.parse(JSON.stringify(raw)));
    Seg.adjust(dur);
    const mapped = Seg.all(), list = Logic.lampaList(raw, dur);
    if (JSON.stringify(mapped.skip) !== JSON.stringify(raw.skip)) moved++;
    const pts = [].concat(mapped.skip, mapped.ad, list).map((s) => r1((s.start + s.end) / 2));
    const times = [0, 0.3, 29.9, 30, 45].concat(pts, Array.from({ length: 6 }, () => rnd(0, dur)));
    for (const t of times) {
        checks2++;
        const a = Seg.get(t), b = Logic.lampaSkipAt(raw, t, dur);
        const x = a ? a.segment.start + '-' + a.segment.end : null, y = b ? b.start + '-' + b.end : null;
        if (a) hits2++;
        if (x !== y && bad2.length < 3) bad2.push(JSON.stringify(raw) + ' dur=' + dur + ' t=' + t + ' lampa=' + x + ' plugin=' + y);
    }
}
console.log('checks with duration: ' + checks2 + ', Lampa skips: ' + hits2 + ', sets remapped by Lampa: ' + moved);
check('Logic.lampaSkipAt(…, длина) = Segments.get Lampa 3.4.4 после adjust(длина) (' + checks2 + ' проверок)', () => assert.deepStrictEqual(bad2, []));
check('в выборке есть сегменты, которые Lampa пересчитала под длину файла', () => assert.ok(hits2 > 1000 && moved > 1000, hits2 + ' / ' + moved));
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
