'use strict';
// Модульные тесты: логика и сценарии плагина (Node vm + фейковая Lampa), статическая совместимость со старыми ТВ,
// прокси IntroDB (нужен Python 3.7+, иначе пропуск). Без npm install: acorn лежит в tools/vendor.
const { spawnSync } = require('child_process');
const path = require('path');
const SUITES = ['t_core', 't_runtime', 't_compat', 't_proxy'];
let fail = 0;
for (const t of SUITES) {
    const r = spawnSync(process.execPath, [path.join(__dirname, t + '.js')], { encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    const total = (out.match(/итого:.*$/m) || ['итого: нет итога'])[0];
    console.log(t + ': ' + total + ' (код ' + r.status + ')');
    const lines = out.split('\n');
    lines.forEach((l, i) => { if (/✗/.test(l)) console.log(lines.slice(i, i + 5).join('\n')); });
    if (r.status !== 0 || !/итого:/.test(out)) { fail = 1; if (!/итого:/.test(out)) console.log(out.slice(-2000)); }
}
process.exit(fail);
