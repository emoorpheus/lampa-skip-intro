# IntroDB proxy (optional)

## Why

IntroDB answers browsers only for its own website: responses carry `Access-Control-Allow-Origin: https://introdb.app`
(checked on 2026-11-01). Lampa running in a browser — LG webOS, Samsung Tizen, a PC — therefore cannot read them.
The other sources (TheIntroDB, IntroHater, Aniskip) are requested directly and do not need the proxy.
In the Android app the plugin sends IntroDB requests through the app itself, so the proxy is not needed there.

The maintainer uses this proxy with Lampa on an LG OLED TV (webOS 25); on an Android TV box the same plugin works without it.

## What it is

`proxy/introdb_proxy.py` — Python 3.7+, standard library only. It forwards **only** timestamp reads,
`GET https://api.introdb.app/segments` with the parameters `imdb_id`, `season`, `episode`, `is_movie`; everything else is refused
(it is not an open proxy). Responses are cached in memory (found: 6 h, not found: 30 min), at most 30 upstream requests per minute
(`--rate`), and it pauses after an HTTP 429 from IntroDB.

IntroDB's terms allow integration into media players and personal non-commercial projects and prohibit bulk downloading and
exceeding reasonable limits: [introdb.app/docs/terms](https://introdb.app/docs/terms). API: [introdb.app/docs/api](https://introdb.app/docs/api).

| Placeholder | Meaning |
|---|---|
| `<YOUR_SERVER_IP>` | LAN address of the server that runs the proxy |
| `8790` | default port; any free port works (change `--port` in the unit file and in the plugin setting) |

## Install with systemd

```sh
python3 --version     # 3.7+ is required (http.server.ThreadingHTTPServer)
VERSION=v1.0.0
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

- If `python3` is not `/usr/bin/python3` (`command -v python3`), fix `ExecStart` in the unit file.
- The unit runs the script as a temporary unprivileged user (`DynamicUser=yes`) with a read-only system (`ProtectSystem=strict`).
- Logs: `journalctl -u introdb-proxy -f`.
- Without systemd: `python3 introdb_proxy.py --port 8790` (for example in tmux).

**Firewall:** allow the port only from your home network. The proxy has no authentication — do not forward it to the internet.

## Configure the plugin

**Settings → Skip Intro → Sources → IntroDB: proxy** («Настройки → Пропуск заставок → Источники → IntroDB: прокси») =
`http://<YOUR_SERVER_IP>:8790/{url}`

Then **Diagnostics → Check now** («Диагностика → Проверить сейчас»): IntroDB should show “Working … · via proxy”
(«Работает … · через прокси»).
If Lampa is opened over `https://`, the browser blocks requests to an `http://` proxy
([mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)).

## Remove

```sh
sudo systemctl disable --now introdb-proxy
sudo rm /etc/systemd/system/introdb-proxy.service && sudo systemctl daemon-reload
sudo rm -r /opt/introdb-proxy
```

and clear **IntroDB: proxy** («IntroDB: прокси») in the plugin settings.
