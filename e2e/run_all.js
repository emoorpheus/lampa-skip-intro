'use strict';
// Runs the E2E scenarios in a real Lampa web build in Chromium (prepare once: sh e2e/setup.sh; npm install).
// Starts e2e/server.js on 127.0.0.1:8123 if nothing listens there and stops it at the end. External network is mocked.
// Usage: node e2e/run_all.js [scenario ...]   (Chromium: CHROMIUM_PATH=/path/to/chromium or npx playwright install chromium)
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const SCENARIOS = ['e2e_player', 'e2e_settings', 'e2e_menu', 'e2e_torrent', 'e2e_anime', 'e2e_movie', 'e2e_postcredits', 'e2e_proxy', 'e2e_i18n', 'e2e_native', 'e2e_source', 'e2e_source_settings', 'e2e_seek', 'e2e_segments', 'e2e_back'];
const PORT = 8123;

function alive() {
    return new Promise((res) => {
        const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 2000 }, (x) => { x.resume(); res(true); });
        r.on('error', () => res(false));
        r.on('timeout', () => { r.destroy(); res(false); });
    });
}

(async () => {
    if (!fs.existsSync(path.join(__dirname, '..', 'ref', 'lampa-built', 'app.min.js'))) {
        console.error('Lampa web build not found (ref/lampa-built): run "sh e2e/setup.sh" first');
        process.exit(2);
    }
    let server = null;
    if (!(await alive())) {
        server = spawn(process.execPath, [path.join(__dirname, 'server.js'), String(PORT)], { stdio: 'ignore' });
        for (let i = 0; i < 50 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 100));
    }
    const only = process.argv.slice(2);
    let fail = 0;
    for (const t of SCENARIOS) {
        if (only.length && only.indexOf(t) === -1) continue;
        const r = spawnSync(process.execPath, [path.join(__dirname, t + '.js')], { encoding: 'utf8', timeout: 170000, maxBuffer: 64 * 1024 * 1024 });
        const out = (r.stdout || '') + (r.stderr || '');
        fs.writeFileSync(path.join(__dirname, 'run_' + t + '.log'), out);
        const lines = out.split('\n');
        const ok = lines.filter((l) => l.indexOf('✓') === 0).length, bad = lines.filter((l) => l.indexOf('✗') === 0);
        console.log(t + ': ' + ok + ' passed, ' + bad.length + ' failed (exit ' + (r.status === null ? r.signal : r.status) + ')');
        bad.forEach((l) => console.log('  ' + l));
        if (r.status !== 0 && !bad.length) console.log(lines.slice(-15).map((l) => '  | ' + l).join('\n'));
        if (r.status !== 0) fail = 1;
    }
    if (server) server.kill();
    process.exit(fail);
})();
