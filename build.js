'use strict';
// Build: src/NN_*.js -> dist/autoskip.js + dist/SHA256SUMS.
// - The version comes from package.json ("version"); the optional author shown in Lampa's extension list
//   comes from package.json ("config.pluginAuthor", empty = not shown).
// - The result must be plain ES5 (old TV browsers): checked with the vendored acorn parser, no npm install needed.
// Usage: node build.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const acorn = require('./tools/vendor/acorn.js');

const OUT = 'autoskip.js';
const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function fail(msg) { console.error('build: ' + msg); process.exit(1); }

const version = String(pkg.version || '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail('package.json "version" is not a semver version: ' + version);
const author = String((pkg.config && pkg.config.pluginAuthor) || '');

const parts = fs.readdirSync(SRC).filter((f) => /^\d\d_.*\.js$/.test(f)).sort();
if (!parts.length) fail('no src/NN_*.js parts found');
let code = parts.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\s+$/, '') + '\n').join('\n');
// Placeholders: quoted ones become JS string literals, the rest (header comment) plain text
code = code.split("'@VERSION@'").join(JSON.stringify(version))
    .split("'@PLUGIN_AUTHOR@'").join(JSON.stringify(author))
    .split('@VERSION@').join(version);
if (/@(VERSION|PLUGIN_AUTHOR)@/.test(code)) fail('unreplaced placeholder');
code = code.replace(/\r\n/g, '\n');

try {
    acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' });
} catch (e) {
    const line = e.loc ? e.loc.line : 0;
    console.error('ES5 syntax error in ' + OUT + ': ' + e.message);
    console.error(code.split('\n').slice(Math.max(0, line - 3), line + 2).join('\n'));
    process.exit(1);
}

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, OUT), code);
const sha = crypto.createHash('sha256').update(code).digest('hex');
fs.writeFileSync(path.join(DIST, 'SHA256SUMS'), sha + '  ' + OUT + '\n');
console.log('built dist/' + OUT + ' v' + version + ' (' + parts.length + ' parts, ' + Buffer.byteLength(code) + ' bytes, sha256 ' + sha + ')');
