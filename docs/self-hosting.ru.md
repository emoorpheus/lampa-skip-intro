# Плагин на своём сервере (домашний сервер, Lampac, любой веб-сервер)

[Версия на английском](self-hosting.md)

Подходит, если Lampa должна загружать плагин с вашего сервера, а не с GitHub Pages или jsDelivr.

| Обозначение | Что подставить |
|---|---|
| `<YOUR_SERVER_IP>` | адрес сервера в домашней сети (например, из `ip -4 addr` в Linux) |
| `<PORT>` | порт веб-сервера, который отдаёт файл (например, порт вашего Lampac) |
| `<PLUGINS_DIR>` | папка, которую этот веб-сервер публикует как `/plugins/` |

## 1. Скачать и проверить

```sh
VERSION=v1.1.1
curl -fsSLO "https://cdn.jsdelivr.net/gh/emoorpheus/lampa-skip-intro@$VERSION/dist/autoskip.js"
curl -fsSLO "https://cdn.jsdelivr.net/gh/emoorpheus/lampa-skip-intro@$VERSION/dist/SHA256SUMS"
sha256sum -c SHA256SUMS          # macOS: shasum -a 256 -c SHA256SUMS
head -c 120 autoskip.js          # "Skip Intro for Lampa v1.1.1 …"
```

## 2. Установить (при обновлении сохраните копию)

```sh
cd <PLUGINS_DIR>
[ -f autoskip.js ] && sudo cp -a autoskip.js "autoskip.js.bak-$(date +%F)"
sudo install -m 644 /path/to/downloaded/autoskip.js autoskip.js
```

Проверьте с другого устройства в той же сети:

```sh
curl -s "http://<YOUR_SERVER_IP>:<PORT>/plugins/autoskip.js" | head -c 120
```

## 3. Подключить в Lampa

**Настройки → Расширения → Добавить плагин**:
`http://<YOUR_SERVER_IP>:<PORT>/plugins/autoskip.js?v=1.1.1`, затем перезапустите Lampa. В `?v=` укажите скачанную версию.

Оставляйте версию в адресе и меняйте её при каждом обновлении (`?v=1.1.1`, …): для адресов с IP Lampa не добавляет
свой параметр против кэша (см. [Обновление и кэш](#обновление-и-кэш)).

Если сама Lampa открыта по `https://`, адрес плагина тоже должен быть `https://`: браузеры блокируют `http://`-скрипты на
`https://`-страницах ([смешанное содержимое](https://developer.mozilla.org/ru/docs/Web/Security/Mixed_content)).

## Обновление и кэш

Lampa добавляет к адресам плагинов параметры — случайный `reset=…` (чтобы обойти кэш), `logged`, `origin` и, если вы вошли
в аккаунт Lampa (CUB), `email` — **только если в адресе нет IPv4-адреса** (функция `addPluginParams` в `app.min.js`
[веб-сборки Lampa](https://github.com/yumata/lampa), проверено в версии 3.4.4). С адресом вида `http://<YOUR_SERVER_IP>/…`
ничего из этого не передаётся (e-mail аккаунта остаётся на устройстве), но устройство может продолжать брать старую копию из кэша.

После обновления откройте **Настройки → Пропуск заставок → Диагностика** и проверьте **Версия плагина**.
Если там всё ещё старая версия:

1. полностью закройте Lampa и откройте снова;
2. если не помогло, смените адрес плагина в списке расширений на `…/plugins/autoskip.js?v=<новая версия>`.
   HTTP-кэши хранят ответы по полному адресу вместе со строкой запроса ([RFC 9111, §2](https://www.rfc-editor.org/rfc/rfc9111#section-2)),
   а плагин всё равно узнаёт свою запись в списке (при сравнении он не учитывает параметры запроса).

Если ваш сервер подключает плагины через собственную конфигурацию, а не через список расширений Lampa, проверьте, как он их
кэширует, — это вне рамок проекта и не проверялось.

## Откат

```sh
cd <PLUGINS_DIR>
sudo cp -a autoskip.js.bak-<DATE> autoskip.js
```
