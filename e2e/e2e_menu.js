// Меню плагина в настоящей Lampa 3.4.4: горячая клавиша в плеере (красная, 403), ручная отметка заставки
// «начало → конец», пропуск по своей отметке, пункт «Пропуск заставок» в меню «⋯» карточки и сдвиг таймкодов.
const { open, BASE } = require('./lib');
const assert = require('assert');
const GOT = { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8, source: 'tmdb',
    genre_ids: [10765, 18, 10759], origin_country: ['US'], original_language: 'en' };
const results = [];
function check(name, fn) { try { fn(); results.push('✓ ' + name); } catch (e) { results.push('✗ ' + name + ' — ' + e.message.split('\n')[0]); } }

(async () => {
    const env = await open({
        storage: { skip_intro_key_menu: 'red', skip_intro_button_timeout: '0' },
        mocks: [
            { match: 'api.theintrodb.org/v4/media', reply: { status: 404, body: { error: 'No submissions', code: 'no_submissions' } } },
            { match: 'api.introdb.app/segments', reply: { status: 404, body: { error: 'not found' } } },
            { match: 'introhater.com/api/segments/', reply: { body: [] } },
            { match: 'tv/1399/external_ids', reply: { body: { id: 1399, imdb_id: 'tt0944947' } } }
        ]
    });
    global.__env = env;
    const press = (code) => env.ev((code) => {
        for (const type of ['keydown', 'keyup']) {
            const e = new KeyboardEvent(type, { bubbles: true, cancelable: true });
            Object.defineProperty(e, 'keyCode', { get: () => code });
            Object.defineProperty(e, 'which', { get: () => code });
            window.dispatchEvent(e);
        }
    }, code);
    const select = () => env.ev(() => ({
        open: document.body.classList.contains('selectbox--open'),
        title: ($('.selectbox__title').text() || '').trim(),
        items: Array.from(document.querySelectorAll('.selectbox-item')).map((i) => i.textContent.replace(/\s+/g, ' ').trim())
    }));
    const choose = (text) => env.ev((text) => {
        const it = Array.from(document.querySelectorAll('.selectbox-item')).find((i) => i.textContent.includes(text));
        if (!it) return false;
        $(it).trigger('hover:enter');
        return true;
    }, text);
    const noty = () => env.ev(() => (document.querySelector('.noty') || {}).textContent || '');
    const T = () => env.ev(() => (document.querySelector('video') || {}).currentTime);

    await env.ev(({ BASE, GOT }) => Lampa.Player.play({ title: 'Game.of.Thrones.S01E01.1080p.WEB-DL.webm', season: 1, episode: 1, url: BASE + 'video/got_s01e01.webm', card: GOT }), { BASE, GOT });
    await env.wait(3500);
    await env.ev(() => Lampa.PlayerVideo.to(100));
    await env.wait(1200);
    const tOpen1 = await T();
    await press(403);
    await env.wait(600);
    const m1 = await select();
    console.log('menu1: ' + JSON.stringify(m1));
    check('красная кнопка (403) в плеере открывает меню «Пропуск заставок»', () => {
        assert.ok(m1.open, JSON.stringify(m1)); assert.strictEqual(m1.title, 'Пропуск заставок');
        assert.ok(m1.items.some((i) => i.startsWith('Отметить: заставка')), m1.items.join(' | '));
        assert.ok(m1.items.some((i) => i.startsWith('Режим:')) && m1.items.some((i) => i.startsWith('Сдвиг таймкодов')), 'пункты сериала');
    });
    assert.ok(await choose('Отметить: заставка'));
    await env.wait(500);
    const n1 = await noty();
    check('начало отметки сохранено (уведомление Lampa)', () => assert.ok(/^Начало отмечено: 1:4\d\./.test(n1), n1));
    // пункт выбран через ~0,6 с после открытия меню — видео шло дальше
    await env.ev(() => Lampa.PlayerVideo.to(190));
    await env.wait(1200);
    const tOpen2 = await T();
    await press(403);
    await env.wait(600);
    const m2 = await select();
    check('в меню появился пункт «Конец отметки: заставка»', () => assert.ok(m2.items.some((i) => i.startsWith('Конец отметки: заставка')), m2.items.join(' | ')));
    assert.ok(await choose('Конец отметки: заставка'));
    await env.wait(1500);
    const n2 = await noty();
    const d = await env.ev(() => window.__SKIP_INTRO_TEST__.Controller.describe());
    const marks = await env.ev(() => Array.from(document.querySelectorAll('.player-panel__timeline .skip-intro-mark')).length);
    console.log('после отметки: ' + n2 + ' | ' + d);
    check('отметка «Заставка 1:4x — 3:1x» сохранена, плагин перечитал таймкоды, метка на шкале', () => {
        assert.ok(/^Заставка отмечена: 1:4\d — 3:1\d$/.test(n2), n2);
        assert.ok(/Заставка 1:4\d–3:1\d \(ваша отметка/.test(d) || /Заставка 1:4\d–3:1\d \(мо/.test(d), d);
        assert.strictEqual(marks, 1);
    });
    // своя отметка работает как таймкод: кнопка и OK
    const mine = await env.ev(() => { const T = window.__SKIP_INTRO_TEST__; return T.UserMarks.get(T.Controller._ctx); });
    console.log('мои отметки: ' + JSON.stringify(mine) + ' | меню открыто в ' + tOpen1 + ' и ' + tOpen2);
    check('время отметки — момент нажатия кнопки меню (как в подписи), а не выбора пункта', () => {
        assert.ok(Math.abs(mine[0].start - tOpen1) < 0.5, mine[0].start + ' / ' + tOpen1);
        assert.ok(Math.abs(mine[0].end - tOpen2) < 0.5, mine[0].end + ' / ' + tOpen2);
    });
    await env.ev((t) => Lampa.PlayerVideo.to(t), Math.floor(mine[0].start) - 1);
    await env.wait(3000);
    const btn = await env.ev(() => { const b = document.querySelector('.skip-intro-button'); return b ? { vis: b.classList.contains('visible'), text: b.textContent } : null; });
    check('по своей отметке показана кнопка «Пропустить заставку»', () => assert.ok(btn && btn.vis && btn.text.includes('Пропустить заставку'), JSON.stringify(btn)));
    await press(13);
    await env.wait(1200);
    const t2 = await T();
    check('OK — перемотка в конец своей отметки', () => assert.ok(t2 >= mine[0].end && t2 < mine[0].end + 4, t2 + ' / ' + mine[0].end));
    // меню «⋯» карточки: настоящее событие Lampa.Listener 'full' / 'options'
    await env.ev(() => Lampa.Player.close());
    await env.wait(800);
    const opt = await env.ev((GOT) => {
        const options = [];
        Lampa.Listener.send('full', { type: 'options', link: { card: GOT }, options });
        const own = options.find((o) => o.title === 'Пропуск заставок');
        if (own) own.onSelect();
        return { titles: options.map((o) => o.title) };
    }, GOT);
    await env.wait(500);
    const m3 = await select();
    console.log('card menu: ' + JSON.stringify(m3));
    check('в меню «⋯» карточки есть «Пропуск заставок» с настройками сериала и «Удалить мои отметки (1)»', () => {
        assert.deepStrictEqual(opt.titles, ['Пропуск заставок']);
        assert.ok(m3.open && m3.title === 'Пропуск заставок', JSON.stringify(m3));
        assert.ok(m3.items.some((i) => i.startsWith('Удалить мои отметки (1)')), m3.items.join(' | '));
    });
    assert.ok(await choose('Сдвиг таймкодов'));
    await env.wait(500);
    assert.ok(await choose('+2 с'));
    await env.wait(600);
    const m4 = await select();
    const shift = await env.ev(() => window.__SKIP_INTRO_TEST__.Series.get('1399').shift);
    check('сдвиг «+2 с» сохранён для сериала, меню вернулось с новым значением', () => {
        assert.strictEqual(shift, 2);
        assert.ok(m4.items.some((i) => i.startsWith('Сдвиг таймкодов: +2 с')), m4.items.join(' | '));
    });
    check('ошибок JavaScript на странице нет', () => assert.deepStrictEqual(env.logs.filter((l) => l.startsWith('PAGEERROR')), []));
    console.log(results.join('\n'));
    await env.shot('e2e_menu');
    await env.close();
    process.exit(results.some((r) => r.startsWith('✗')) ? 1 : 0);
})().catch((e) => { console.error(e); console.log(results.join('\n')); if (global.__env) console.log(global.__env.logs.filter((l) => /PAGEERROR|SkipIntro/.test(l)).join('\n')); process.exit(2); });
