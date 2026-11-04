# Прокси для IntroDB (необязательно)

[Версия на английском](introdb-proxy.md)

## Зачем

IntroDB отвечает браузерам только для своего сайта: в ответах стоит `Access-Control-Allow-Origin: https://introdb.app`
(проверено 2026-11-01). Поэтому Lampa в браузере — LG webOS, Samsung Tizen, ПК — не может их прочитать.
Остальные источники (TheIntroDB, IntroHater, Aniskip) запрашиваются напрямую, прокси им не нужен.
В Android-приложении плагин отправляет запросы к IntroDB через само приложение, поэтому прокси там не нужен.

Автор пользуется этим прокси с Lampa на телевизоре LG OLED (webOS 25); на Android TV-приставке тот же плагин работает без него.

## Что это

`proxy/introdb_proxy.py` — Python 3.7+, только стандартная библиотека. Пропускает **только** чтение таймкодов —
`GET https://api.introdb.app/segments` с параметрами `imdb_id`, `season`, `episode`, `is_movie`; всё остальное отклоняется
(это не открытый прокси). Ответы кэшируются в памяти (найдено — 6 ч, не найдено — 30 мин), не больше 30 запросов к IntroDB
в минуту (`--rate`), после ответа HTTP 429 от IntroDB прокси делает паузу.

Условия IntroDB разрешают встраивание в медиаплееры и личные некоммерческие проекты и запрещают массовое скачивание и
превышение разумных лимитов: [introdb.app/docs/terms](https://introdb.app/docs/terms). API: [introdb.app/docs/api](https://introdb.app/docs/api).

| Обозначение | Что подставить |
|---|---|
| `<YOUR_SERVER_IP>` | адрес в домашней сети сервера, на котором работает прокси |
| `8790` | порт по умолчанию; подойдёт любой свободный (поменяйте `--port` в unit-файле и в настройке плагина) |

## Установка через systemd

```sh
python3 --version     # нужен 3.7+ (http.server.ThreadingHTTPServer)
VERSION=v1.1.1
curl -fsSLO "https://cdn.jsdelivr.net/gh/emoorpheus/lampa-skip-intro@$VERSION/proxy/introdb_proxy.py"
curl -fsSLO "https://cdn.jsdelivr.net/gh/emoorpheus/lampa-skip-intro@$VERSION/proxy/introdb-proxy.service"
sudo install -d -m 755 /opt/introdb-proxy
sudo install -m 644 introdb_proxy.py /opt/introdb-proxy/
sudo install -m 644 introdb-proxy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now introdb-proxy
systemctl status introdb-proxy --no-pager
curl "http://<YOUR_SERVER_IP>:8790/health"
curl "http://<YOUR_SERVER_IP>:8790/https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1"
```

- Если `python3` лежит не в `/usr/bin/python3` (`command -v python3`), исправьте `ExecStart` в unit-файле.
- Unit запускает скрипт от временного непривилегированного пользователя (`DynamicUser=yes`) с системой только для чтения (`ProtectSystem=strict`).
- Логи: `journalctl -u introdb-proxy -f`.
- Без systemd: `python3 introdb_proxy.py --port 8790` (например, в tmux).

**Файрвол:** откройте порт только для домашней сети. У прокси нет авторизации — не пробрасывайте его в интернет.

## Настройка плагина

**Настройки → Пропуск заставок → Источники → IntroDB: прокси** = `http://<YOUR_SERVER_IP>:8790/{url}`

Затем **Диагностика → Проверить сейчас**: у IntroDB должно быть «Работает … · через прокси».
Если Lampa открыта по `https://`, браузер блокирует запросы к `http://`-прокси
([смешанное содержимое](https://developer.mozilla.org/ru/docs/Web/Security/Mixed_content)).

## Удаление

```sh
sudo systemctl disable --now introdb-proxy
sudo rm /etc/systemd/system/introdb-proxy.service && sudo systemctl daemon-reload
sudo rm -r /opt/introdb-proxy
```

и очистите **IntroDB: прокси** в настройках плагина.
