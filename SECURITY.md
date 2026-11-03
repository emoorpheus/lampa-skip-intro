# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.1.x | yes |
| 1.0.x | no — update to 1.1.x |
| pre-releases (1.1.0-beta.x) | no — update to 1.1.x |
| internal builds (3.x / 4.0) | no — update to 1.1.x |

Only the latest release receives fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting:
the **Report a vulnerability** button on the repository's **Security → Advisories** page.

Include the plugin version (Settings → Skip Intro → Diagnostics → Plugin version), your platform and the steps to reproduce.
Do not include your IP addresses, server URLs, TorrServer credentials or Lampa/CUB account data.

## Scope

- `dist/autoskip.js` — runs inside Lampa on your device. It only sends the requests listed in the README ("Privacy").
- `proxy/introdb_proxy.py` — optional, runs on your server. It is meant for a **home network**: it forwards only
  `GET https://api.introdb.app/segments` with whitelisted parameters and has no authentication. Do not expose its port to the internet.
