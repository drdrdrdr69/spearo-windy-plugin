# windy-plugin-spearo

Official [spearo.app](https://spearo.app) plugin for [Windy.com](https://www.windy.com):
**water visibility forecast, sea safety verdict and no-take zone polygons** for
spearfishing and freediving — right on the Windy map.

> Русская документация: [docs/README.ru.md](docs/README.ru.md).

## What it does

- Panel for any point on the map (`desktopUI: rhpane`, `mobileUI: fullscreen` — drag
  the sheet to half position to keep the map visible): **water visibility (m)** first,
  then **wave**, **wind**, **water temperature**, **tide** and a **safety verdict**.
- **7-day horizon**: a compact horizontally scrollable day strip; days missing from the
  response are disabled, never fabricated.
- The point comes from the map context menu (right-click / long-press), from the URL
  `https://www.windy.com/plugin/spearo/:lat/:lon`, or from the map centre. While the
  panel is open, a single click on the map moves the point.
- **Zone layer**: polygons for the visible bbox, coloured by legal status —
  `banned` (red), `dormant` (grey dashed, "out of season: ban applies from … to …"),
  `conditional` (yellow, raw clause text), `open` (green). An unknown status is
  treated as `conditional`, never as `open`. A click opens a popup with the zone
  name, season/hours, the legal act and the data source.
- Three distinct zone states that are never conflated: zones shown (including
  "no zones here"), "zoom in" (area too large) and "zone data unavailable"
  (rate limit / outage / network).
- UI language follows Windy's own language (`store.get('usedLang')`), falling back to
  `navigator.language`; 9 locales (en, pt, ru, es, it, el, fr, tr, hr).

## Data source and privacy

All data comes from the **public, read-only spearo.app API** (`/api/plugin/windy/*`),
called with a plain `fetch`, **no cookies, no credentials**:

- `GET https://spearo.app/api/plugin/windy/conditions?lat=&lon=&days=3&lang=`
- `GET https://spearo.app/api/plugin/windy/zones?bbox=minLon,minLat,maxLon,maxLat&zoom=`

The plugin contains **no analytics, no trackers and no third-party scripts**. Nothing
is stored except an in-memory cache of the last responses (15 minutes). Outbound links
to spearo.app carry only static campaign parameters
(`utm_source=windy&utm_medium=plugin&utm_campaign=windy-plugin`) so we can tell how
useful the plugin is — they identify the plugin, not the user.

The API contract (zone statuses, cache honesty, error semantics) is pinned in
[docs/INVARIANTS.md](docs/INVARIANTS.md); every change is checked against it.

## Build and run in Windy dev mode

```bash
npm install
npm start          # rollup in watch mode + HTTPS dev server on :9999
```

1. Open <https://localhost:9999/plugin.js> once and accept the self-signed certificate.
2. Go to <https://www.windy.com/developer-mode>.
3. Load the plugin from `https://localhost:9999/plugin.js`.

Useful URL flags: `?mock=1` — realistic mock data with no network calls;
`?spearoBase=https://plugin-dev.example.com` — alternate API base (**dev build only**; in a
published bundle the base is a compile-time constant and the override branch is removed).

Standalone panel preview without Windy: `npm run preview`.

## Checks

```bash
npm run check   # tsc --noEmit over src/
npm test        # node --test: contract, cache/midnight/backoff, zones, links
npm run build   # production bundle in dist/
```

## Publishing

Windy plugins are served from `windy-plugins.com`, so publishing means uploading the
build to Windy:

```bash
mkdir -p ~/.config/spearo
printf '%s' '<windy api key>' > ~/.config/spearo/windy_api_key
chmod 600 ~/.config/spearo/windy_api_key

npm run publish:local -- --dry-run   # everything except the upload
npm run publish:local                # build + upload, prints the plugin URL
```

The API key is read **only** from `~/.config/spearo/windy_api_key`, which lives
**outside this repository** — it is never passed as an argument, never printed (tracing
is disabled before the key is read) and never committed. Get a key at
<https://api.windy.com/keys>. Publishing is done locally on purpose: no CI secrets are
stored in this repository.

After publishing, the plugin is announced in the Windy gallery approval thread
(<https://community.windy.com/topic/31066>) together with a screenshot of the plugin
running inside Windy.

## License

[MIT](LICENSE) © 2026 spearo.app
