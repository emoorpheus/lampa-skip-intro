# Self-hosting the plugin (home server, Lampac, any web server)

Use this if you want Lampa to load the plugin from your own server instead of GitHub Pages or jsDelivr.

| Placeholder | Meaning |
|---|---|
| `<YOUR_SERVER_IP>` | LAN address of your server (for example from `ip -4 addr` on Linux) |
| `<PORT>` | port of the web server that serves the file (for example the port of your Lampac) |
| `<PLUGINS_DIR>` | directory that this web server publishes as `/plugins/` |

## 1. Download and verify

```sh
VERSION=v1.0.0
curl -fsSLO "https://cdn.jsdelivr.net/gh/emoorpheus/lampa-skip-intro@$VERSION/dist/autoskip.js"
curl -fsSLO "https://cdn.jsdelivr.net/gh/emoorpheus/lampa-skip-intro@$VERSION/dist/SHA256SUMS"
sha256sum -c SHA256SUMS          # macOS: shasum -a 256 -c SHA256SUMS
head -c 120 autoskip.js          # "Skip Intro for Lampa v1.0.0 …"
```

## 2. Install (keep a backup when updating)

```sh
cd <PLUGINS_DIR>
[ -f autoskip.js ] && sudo cp -a autoskip.js "autoskip.js.bak-$(date +%F)"
sudo install -m 644 /path/to/downloaded/autoskip.js autoskip.js
```

Check from another device in the same network:

```sh
curl -s "http://<YOUR_SERVER_IP>:<PORT>/plugins/autoskip.js" | head -c 120
```

## 3. Add it to Lampa

**Настройки → Расширения → «Добавить плагин»**: `http://<YOUR_SERVER_IP>:<PORT>/plugins/autoskip.js?v=1.0.0`, then restart Lampa.

Keep the version in the URL and change it with every update (`?v=1.0.1`, …): for URLs with an IP address Lampa does not add
its own cache-busting parameter (see [Updating and cache](#updating-and-cache)).

If Lampa itself is opened over `https://`, the plugin URL must be `https://` too: browsers block `http://` scripts on
`https://` pages ([mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)).

## Updating and cache

Lampa adds parameters to plugin URLs — a random `reset=…` (to bypass caches), `logged`, `origin` and, if you are signed in to
your Lampa (CUB) account, `email` — **only if the URL contains no IPv4 address** (function `addPluginParams` in `app.min.js` of the
[Lampa web build](https://github.com/yumata/lampa), checked in version 3.4.4). With a URL like `http://<YOUR_SERVER_IP>/…` none of them
is sent (your account e-mail stays on the device), but the device may keep using an old cached copy.

After an update open **Настройки → Пропуск заставок → Диагностика** and check «Версия плагина». If it still shows the old version:

1. close Lampa completely and open it again;
2. if that does not help, change the plugin URL in the extension list to `…/plugins/autoskip.js?v=<new version>`.
   HTTP caches store responses per full URL including the query string ([RFC 9111, §2](https://www.rfc-editor.org/rfc/rfc9111#section-2)),
   and the plugin still recognizes its own entry in the list (it ignores query parameters when comparing).

If your server injects plugins through its own configuration instead of Lampa's extension list, check how it caches them — this is
outside of this project and has not been tested.

## Rollback

```sh
cd <PLUGINS_DIR>
sudo cp -a autoskip.js.bak-<DATE> autoskip.js
```
