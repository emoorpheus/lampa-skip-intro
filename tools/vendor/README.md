# Third-party code (build and tests only, not part of the plugin)

| File | What | Version | License | Source |
|---|---|---|---|---|
| `acorn.js` | JavaScript parser (UMD build `dist/acorn.js`, unmodified) | 8.19.0 | MIT, see `acorn.LICENSE` | https://github.com/acornjs/acorn |

Used by `build.js` (the plugin must be plain ES5) and `tests/t_compat.js` (APIs that old TV browsers lack).
Vendored so that the build and the unit tests work without `npm install`.
