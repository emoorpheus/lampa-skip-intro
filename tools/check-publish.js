'use strict';
// Pre-publish scan of the files that would be committed (git ls-files, or a directory walk without git).
// Fails on data that should not be public:
//   - IPv4 addresses, except 127.0.0.1, 0.0.0.0 and the documentation ranges of RFC 5737 (192.0.2.x, 198.51.100.x, 203.0.113.x);
//   - e-mail addresses (except GitHub no-reply addresses and the test URL user:pass@api.introdb.app);
//   - tokens and keys: GitHub, AWS, Google, Slack, JWT, private keys, "api_key = '...'"-style assignments;
//   - home-directory paths (/home/<name>, /Users/<name>, C:\Users\<name>, /root/).
// Your own words (real name, nickname, host names, paths of your server): one per line in .publish-denylist
// (git-ignored) or in a file given by PUBLISH_DENY_FILE. Matching is case-insensitive.
// --strict: also fail on maintainer placeholders that must be replaced before the first push (<YOUR_USERNAME>, <YOUR_NAME>).
// Usage: node tools/check-publish.js [--strict]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SELF = path.relative(ROOT, __filename).split(path.sep).join('/');
const SKIP = [/^node_modules\//, /^ref\//, /^e2e\/www\//, /^\.git\//, /^tools\/vendor\//, /\.(png|jpe?g|gif|webm|mp4|zip|gz)$/i, /\.log$/];
const strict = process.argv.indexOf('--strict') !== -1;

function files() {
    const g = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' });
    if (g.status === 0 && g.stdout) return g.stdout.split('\0').filter(Boolean);
    const out = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = dir ? dir + '/' + e.name : e.name;
            if (SKIP.some((re) => re.test(rel + (e.isDirectory() ? '/' : '')))) continue;
            if (e.isDirectory()) walk(rel); else if (e.isFile()) out.push(rel);
        }
    })('');
    return out;
}

function denyWords() {
    const list = [path.join(ROOT, '.publish-denylist')];
    if (process.env.PUBLISH_DENY_FILE) list.push(process.env.PUBLISH_DENY_FILE);
    const words = [];
    for (const f of list) {
        if (!fs.existsSync(f)) continue;
        fs.readFileSync(f, 'utf8').split(/\r?\n/).map((w) => w.trim()).filter((w) => w && w[0] !== '#').forEach((w) => words.push(w));
    }
    return words;
}

const ALLOWED_IPS = /^(127\.0\.0\.1|0\.0\.0\.0|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;
const ALLOWED_EMAILS = /(@users\.noreply\.github\.com$|^pass@api\.introdb\.app$)/i;
const RULES = [
    { name: 'IPv4 address', re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
        ok: (m) => ALLOWED_IPS.test(m) || m.split('.').some((n) => +n > 255) },
    { name: 'e-mail address', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, ok: (m) => ALLOWED_EMAILS.test(m) },
    { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/g },
    { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
    { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
    { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { name: 'secret assignment', re: /\b(?:api[_-]?key|apikey|secret|token|passwd|password)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/gi },
    { name: 'home directory path', re: /(?:\/home\/[a-z_][\w.-]*|\/Users\/[A-Za-z][\w.-]*|[A-Za-z]:\\Users\\[A-Za-z][\w.-]*|\/root\/)/g }
];
const PLACEHOLDERS = /<YOUR_USERNAME>|<YOUR_NAME>/g;

const problems = [], placeholders = [];
const deny = denyWords();
for (const rel of files()) {
    if (rel === SELF || SKIP.some((re) => re.test(rel))) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const buf = fs.readFileSync(abs);
    if (buf.indexOf(0) !== -1) continue; // binary
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
        const at = rel + ':' + (i + 1);
        for (const r of RULES) {
            for (const m of line.match(r.re) || []) if (!r.ok || !r.ok(m)) problems.push(at + '  ' + r.name + ': ' + m);
        }
        const low = line.toLowerCase();
        for (const w of deny) if (low.indexOf(w.toLowerCase()) !== -1) problems.push(at + '  denylisted word: ' + w);
        const p = line.match(PLACEHOLDERS);
        if (p) placeholders.push(at + '  ' + p.join(', '));
    });
}
if (placeholders.length) {
    console.log((strict ? 'ERROR' : 'note') + ': maintainer placeholders left (replace before the first push):');
    placeholders.forEach((p) => console.log('  ' + p));
}
if (problems.length) {
    console.log('ERROR: possible private data:');
    problems.forEach((p) => console.log('  ' + p));
}
const failed = problems.length || (strict && placeholders.length);
console.log(failed ? 'check-publish: FAILED' : 'check-publish: OK (' + (deny.length ? deny.length + ' denylisted words, ' : '') + 'no private data found)');
process.exit(failed ? 1 : 0);
