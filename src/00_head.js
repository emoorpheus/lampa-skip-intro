/*!
 * Skip Intro for Lampa v@VERSION@ (MIT License)
 * Skip button and auto-skip for intros, recaps, credits and previews in TV shows, and for credits in movies.
 * Timestamps: TheIntroDB v4, IntroDB, IntroHater, Aniskip (anime: ARM -> MyAnimeList, AniList search as a fallback),
 * MKV chapters via TorrServer, your own marks. If no database knows the intro, a subtitle heuristic (SRT/VTT/ASS)
 * and, optionally, an audio heuristic are used; heuristic results are only offered as a button.
 * The interface follows the Lampa language: Russian or English (other languages use English). ES5 + Promise, no dependencies.
 */
(function () {
    'use strict';

    var VERSION = '@VERSION@';
    var MIN = 6e4;
    var HOUR = 36e5;
    var DAY = 864e5;
    var TTL = {
        ok: 7 * DAY,            // таймкоды из баз
        empty: DAY / 2,         // база честно ответила «ничего нет»
        det: 30 * DAY,          // результат эвристики
        chapOk: 30 * DAY,       // главы файла (свойство самого файла)
        chapEmpty: 7 * DAY,
        armOk: 30 * DAY,        // ARM: TMDB -> MAL
        armEmpty: 7 * DAY,
        alDone: 30 * DAY,       // AniList: вышедший тайтл
        alLive: DAY,            // AniList: выходит / анонс — число серий меняется
        rules: 30 * DAY,        // правила Aniskip
        rulesEmpty: 7 * DAY,
        map: 30 * DAY,          // запасной поиск AniList
        mapNull: 7 * DAY
    };
    var CACHE_LIMIT = 400;
    var CACHE_PREFIX = 'skip3_';
    var MERGE_GAP = 1;              // с: сегменты одного типа с таким зазором считаются одним
    var TAIL_SECONDS = 15;          // как в Lampa (player/skip.js): до конца файла < 15 с — конец серии
    var CONFIRM_SLACK = 10;         // с: насколько сегмент может выходить за подтверждающий сегмент другой базы
    var AUTO_SHIFT_MAX = 120;       // с: наибольшая разница длины файла и эталона, при которой титры подгоняются к концу
    var BUCKET = 5;                 // с: шаг «длины файла» в ключах кэша
    var BUCKET_NEAR = 10;           // с: допуск при поиске записи с другой длиной файла
    var PART_FORMATS = ['TV', 'TV_SHORT', 'ONA'];
    var SEGMENT_TYPES = ['intro', 'recap', 'credits', 'preview'];
    var ALL_TYPES = SEGMENT_TYPES.concat(['ad']);     // + реклама: бывает только в таймкодах источника видео
    var ANY_SEASON_MARK = /season\s*\d|part\s*\d|\d(?:st|nd|rd|th)\s+season|final\s+season|\u7b2c\s*\d+\s*\u671f/;
    // Ключи v2.11 — удаляются при первом запуске v3
    var OLD_KEY_RE = [
        /^skip_[A-Za-z0-9-]+_s\d+_e\d+_L\d+$/,
        /^aniskip_map_[A-Za-z0-9-]+_s\d+$/,
        /^skip_intro_det_[A-Za-z0-9-]+_s\d+_e\d+_L\d+$/
    ];

    function contains(list, value) {
        if (!list) return false;
        for (var i = 0; i < list.length; i++) if (list[i] === value) return true;
        return false;
    }

    function copyObject(obj) {
        var out = {};
        for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
        return out;
    }

    function toInt(value) {
        if (value === null || value === undefined || value === '') return null;
        var n = parseInt(value, 10);
        return isNaN(n) ? null : n;
    }

    function toNum(value) {
        if (value === null || value === undefined || value === '') return null;
        var n = typeof value === 'number' ? value : parseFloat(value);
        return isNaN(n) || !isFinite(n) ? null : n;
    }

    function clamp(v, a, b) {
        return v < a ? a : (v > b ? b : v);
    }

    function pad2(n) {
        n = toInt(n) || 0;
        return n < 10 ? '0' + n : String(n);
    }

    function round3(v) {
        return Math.round(v * 1000) / 1000;
    }

    // 1 пропуск, 2 пропуска, 5 пропусков
    function plural(n, one, few, many) {
        var a = Math.abs(n) % 100, b = a % 10;
        if (a > 10 && a < 20) return many;
        if (b === 1) return one;
        if (b >= 2 && b <= 4) return few;
        return many;
    }

    function isObj(v) {
        return !!v && typeof v === 'object' && !(v instanceof Array);
    }
