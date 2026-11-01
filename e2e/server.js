// Локальный статический сервер для E2E (только 127.0.0.1): веб-сборка Lampa (/ <- ref/lampa-built), плагин (/plugins/ <- dist/),
// тестовые видео (/video/ <- e2e/www/video), с поддержкой Range
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const ROOTS = { '/plugins/': path.join(ROOT, 'dist'), '/video/': path.join(__dirname, 'www/video'), '/subs/': path.join(__dirname, 'www/subs'), '/': path.join(ROOT, 'ref/lampa-built') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt', '.ass': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const port = +process.argv[2] || 8123;
// Эмуляция TorrServer под /ts/: поток (тот же webm), /ffp (ffprobe с главами и Dolby Vision), /torrents, журнал запросов
const TS_LOG = [];
const FFP = {
    format: { duration: '3700.000000', format_name: 'matroska,webm', tags: { title: 'Game of Thrones S01E01' } },
    streams: [
        { index: 0, codec_type: 'video', codec_name: 'hevc', codec_tag_string: '[0][0][0][0]', pix_fmt: 'yuv420p10le', color_space: 'bt2020nc', color_transfer: 'smpte2084', color_primaries: 'bt2020',
          side_data_list: [{ side_data_type: 'DOVI configuration record', dv_version_major: 1, dv_version_minor: 0, dv_profile: 8, dv_level: 6, rpu_present_flag: 1, el_present_flag: 0, bl_present_flag: 1, dv_bl_signal_compatibility_id: 1 }] },
        { index: 1, codec_type: 'audio', codec_name: 'eac3', tags: { language: 'rus' } },
        { index: 2, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'rus' } }
    ],
    chapters: [
        { id: 0, time_base: '1/1000000000', start_time: '0.000000', end_time: '437.000000', tags: { title: 'Пролог' } },
        { id: 1, time_base: '1/1000000000', start_time: '437.000000', end_time: '531.000000', tags: { title: 'Opening' } },
        { id: 2, time_base: '1/1000000000', start_time: '531.000000', end_time: '3631.500000', tags: { title: 'Episode' } },
        { id: 3, time_base: '1/1000000000', start_time: '3631.500000', end_time: '3700.000000', tags: { title: 'Ending Credits' } }
    ]
};
// Вторая раздача (аниме, 1420 с): без глав, SDR, внешний ASS с песнями OP/ED в /subs
const AOT = '0123456789abcdef0123456789abcdef01234567';
const FFP_AOT = {
    format: { duration: '1420.000000', format_name: 'matroska,webm' },
    streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', color_transfer: 'bt709', color_primaries: 'bt709' },
        { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { language: 'jpn' } }],
    chapters: []
};
function assText() {
    const t = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h + ':' + String(m).padStart(2, '0') + ':' + String(x.toFixed(2)).padStart(5, '0'); };
    const lines = ['[Script Info]', 'ScriptType: v4.00+', '', '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1',
        'Style: OP,Arial,20,&H00FFD0A0,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1',
        'Style: ED,Arial,20,&H00A0D0FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1', '',
        '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
    for (let s = 90; s < 180; s += 6) lines.push('Dialogue: 0,' + t(s) + ',' + t(s + 5) + ',OP,,0,0,0,,{\\k20}la {\\k30}la');
    for (let s = 200; s < 1250; s += 20) lines.push('Dialogue: 0,' + t(s) + ',' + t(s + 4) + ',Default,,0,0,0,,Реплика');
    for (let s = 1300; s < 1385; s += 5) lines.push('Dialogue: 0,' + t(s) + ',' + t(s + 4) + ',ED,,0,0,0,,ending');
    return lines.join('\r\n');
}
function ts(req, res, u) {
    TS_LOG.push(req.method + ' ' + req.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    const json = (o) => { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify(o)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (u === '/ts/__log') return json(TS_LOG.splice(0));
    if (u.startsWith('/ts/ffp/' + AOT)) return setTimeout(() => json(FFP_AOT), 200);
    if (u.startsWith('/ts/ffp/')) return setTimeout(() => json(FFP), 300);
    if (u.startsWith('/ts/subs/' + AOT)) {
        const q = new URL(req.url, 'http://x').searchParams;
        if (q.get('track') === null) return json([{ index: 0, name: 'Shingeki.no.Kyojin.ru.ass', title: 'Русские (надписи и песни)', lang: 'rus', format: 'ass', url: u.slice(3) + '?track=0' }]);
        res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, cors)); return res.end(assText());
    }
    if (u.startsWith('/ts/subs/')) return json([]);
    if (u === '/ts/torrents') return json({ title: 'Game.of.Thrones.S01.2160p.UHD.BluRay.DV.HDR10.HEVC', name: 'Game.of.Thrones.S01.2160p', hash: 'abcdef0123456789abcdef0123456789abcdef01', stat: 3 });
    if (u === '/ts/echo') { res.writeHead(200, cors); return res.end('MatriX.147'); }
    if (u.startsWith('/ts/stream/')) return null; // отдаём видео ниже
    res.writeHead(404, cors); res.end('not found');
    return true;
}
// Подставной api.introdb.app для e2e_proxy: туда ходит proxy/introdb_proxy.py (INTRODB_PROXY_UPSTREAM), журнал — /__introdb/__log
const INTRODB_LOG = [];
const INTRODB = {
    'imdb_id=tt0371746&is_movie=true': require('../tests/fixtures/introdb_ironman.json'),
    'imdb_id=tt0944947&season=1&episode=1': require('../tests/fixtures/introdb_got.json')
};
function introdb(req, res, u) {
    const h = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://introdb.app' }; // как настоящий: браузеру чужого сайта не отдаст
    if (u === '/__introdb/__log') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(INTRODB_LOG.splice(0))); }
    INTRODB_LOG.push(req.method + ' ' + req.url + ' ' + (req.headers['user-agent'] || ''));
    const body = u === '/__introdb/segments' ? INTRODB[req.url.split('?')[1] || ''] : null;
    res.writeHead(body ? 200 : 404, h); res.end(JSON.stringify(body || { error: 'not found' }));
}
http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u.startsWith('/__introdb/')) return introdb(req, res, u);
    if (u.startsWith('/ts/')) {
        if (ts(req, res, u) !== null) return;
        u = req.url.indexOf(AOT) !== -1 ? '/video/aot_s01e01.webm' : '/video/got_s01e01.webm';
    }
    let file = null;
    for (const pre of Object.keys(ROOTS)) {
        if (u.startsWith(pre)) { file = path.join(ROOTS[pre], u.slice(pre.length)); break; }
    }
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file || !fs.existsSync(file)) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); return res.end('not found'); }
    const st = fs.statSync(file), type = TYPES[path.extname(file)] || 'application/octet-stream';
    const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
        const start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : st.size - 1;
        res.writeHead(206, Object.assign(h, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size, 'Content-Length': end - start + 1 }));
        return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign(h, { 'Content-Length': st.size }));
    fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('serving on', port));
