# windy-plugin-spearo (русская документация)

> English overview: [../README.md](../README.md).

Официальный плагин **spearo.app** для [Windy.com](https://www.windy.com): видимость воды
на сегодня/завтра, волна, ветер, вердикт по безопасности и полигоны запретных
(no-take) зон прямо на карте Windy.

**Контракт с сервером зафиксирован в `INVARIANTS.md` (в этом же каталоге)**:
статусы зон, честность условий, ошибки/CORS и правила клиентского кэша. Любая правка плагина сверяется с ним.

Собран из официального шаблона
[windycom/windy-plugin-template](https://github.com/windycom/windy-plugin-template)
(v5.0.1, коммит `94b4033` от 15.07.2026), стек — TypeScript + Svelte + Rollup,
карта — Leaflet GL через `@windy/map`.

---

## 1. Что умеет

- Панель (`desktopUI: rhpane`, `mobileUI: small` — на мобильных карта остаётся видна,
  см. docs → plugin-layouts) для точки на карте:
  **видимость (м)**, **волна (м + период)**, **ветер (м/с + направление)**,
  **температура воды**, **прилив** (компактной строкой), **вердикт безопасности**
  с цветовой плашкой и пометкой «данные могут быть устаревшими» при `stale`.
- Переключатель **Сегодня / Завтра**.
- Кнопка **«Открыть прогноз на spearo»** → `https://spearo.app/{locale}/{city}` с utm-метками.
- Точка берётся: из контекстного меню карты (ПКМ / долгий тап → пункт плагина),
  из URL `https://www.windy.com/plugin/spearo/:lat/:lon`, либо по центру карты.
  Пока панель открыта, одиночный клик по карте переносит точку (`listenToSingleclick`).
- Слой **зон**: полигоны для видимого bbox, цвет по `status`
  (`banned` — красный, `dormant` — серый пунктир + «вне сезона: запрет с … по …»,
  `conditional` — жёлтый с сырым текстом оговорки, `open` — зелёный; неизвестный
  статус трактуется как `conditional`, никогда как `open`), приблизительные
  границы — пунктиром; клик → popup с названием, сезоном/часами, ссылкой на акт и
  источником. Тумблер в панели, перезагрузка по `moveend` с дебаунсом 400 мс,
  ответы вне очереди отбрасываются по request-id, при закрытии панели запрос
  отменяется (`AbortController`) и слой снимается — см. `src/zonesController.ts`.
- Три РАЗНЫХ состояния зон, которые никогда не смешиваются: зоны показаны (в т.ч.
  «зон нет»), «приблизьте карту» (413 / `bbox_too_large`) и «временно недоступны»
  (429 с `Retry-After`, 503 `zones_unavailable`, сеть).
- Локаль UI и ссылок — сначала язык интерфейса Windy (`store.get('usedLang')`),
  затем `navigator.language`; маппинг на 9 локалей сайта
  (`en, pt, ru, es, it, el, fr, tr, hr`), фолбэк `en`.
- **Никакой аналитики внутри плагина.** Единственная атрибуция — utm-метки на
  исходящих ссылках: `utm_source=windy&utm_medium=plugin&utm_campaign=windy-plugin`.
- **Безопасность ссылок.** URL, пришедшие из данных (`nearest.url`, `actUrl`,
  `attribution.url`), проходят `sanitizeUrl()`: только `https:` (для ссылок на акты
  допускается ещё `http:` — сайты госорганов бывают без TLS), `javascript:`/`data:`/
  относительные пути отбрасываются; для `nearest.url` дополнительно требуется хост
  `spearo.app`. Ссылки рендерятся Svelte-атрибутами (никакого `{@html}`) с
  `target="_blank" rel="noopener noreferrer"`, а popup зоны собирается из DOM-узлов
  через `textContent`.

## 2. Как запустить локально (dev)

```bash
npm install
npm start          # rollup в watch-режиме + HTTPS-сервер на :9999
```

Плагин собирается и отдаётся по адресу **https://localhost:9999/plugin.js**.

Загрузка в Windy (dev-режим):

1. Открыть **https://localhost:9999/plugin.js** в браузере и **принять
   самоподписанный сертификат** («Дополнительно» → «Перейти на сайт»). Без этого
   Windy не сможет подтянуть плагин.
2. Открыть **https://www.windy.com/developer-mode** — это и есть dev-режим Windy
   (страница `https://www.windy.com/dev` — редирект на него).
3. В форме указать URL `https://localhost:9999/plugin.js` и загрузить плагин.
4. Открыть консоль браузера — Windy пишет туда подробный лог жизненного цикла плагина.
   Правки в `src/**` пересобираются автоматически, страницу нужно перезагрузить.

Полезные параметры URL:

- `?mock=1` — **режим мока**: реалистичные детерминированные данные, без единого
  сетевого запроса (сервер ещё не готов). Работает и в Windy, и в автономном предпросмотре.
- `?spearoBase=https://plugin-dev.example.com` — переопределить базовый URL API.
  Работает **только в dev-сборке** (`npm start`): в опубликованном бандле база —
  компайл-тайм константа `https://spearo.app`, и ветка подмены вырезается
  компилятором (флаг `__SPEARO_DEV_BUILD__`, см. `rollup.config.js`). Иначе любой,
  кто прислал бы ссылку на Windy с `?spearoBase=…`, увёл бы запросы плагина на чужой сервер.

### Автономный предпросмотр (без Windy)

```bash
npm run preview    # → http://127.0.0.1:8931/dev/preview/index.html?mock=1
```

Лицензия — MIT (`LICENSE`).

`dev/preview/index.html` заглушает клиентский API Windy (`W.map`, `W.singleclick`, …)
и монтирует панель в обычную страницу — удобно для вёрстки. Именно так сделан
`src/screenshot.jpg`.

## 3. Проверки

```bash
npm run check   # tsc --noEmit по src/ (skipLibCheck: .d.ts самого Windy шумят и в чистом шаблоне)
npm test        # node --test: контракт, кэш/полночь/бэкофф, зоны, локали, ссылки
                # (fetch в тестах проходит симуляцию CORS-фильтра: скрытый
                #  Retry-After не виден, как в браузере)
npm run build   # прод-сборка в dist/ (plugin.js, plugin.min.js, plugin.json, screenshot.jpg)
```

## 4. Структура

```
src/
  pluginConfig.ts   конфиг плагина для Windy (name/title/UI/contextmenu/routerPath/private)
  plugin.svelte     панель: метрики, дни, вердикт, CTA, тумблер зон
  api.ts            ЕДИНСТВЕННЫЙ слой данных: getConditions(lat, lon, day), getZones(bbox)
  links.ts          9 локалей, utm, сборка ссылок на spearo.app
  i18n.ts           надписи панели (ru / en)
  zonesLayer.ts     L.GeoJSON-слой зон: стиль по status, popup (DOM, textContent)
  zonesController.ts жизненный цикл слоя: дебаунс, request-id, abort, destroy
  coords.ts         разбор координат из роутера (строки → числа, валидация)
  screenshot.jpg    скриншот для галереи (см. §6)
scripts/publish.sh  публикация в Windy с локальной машины (ключ из файла вне репо)
dev/preview/        автономный предпросмотр панели
tests/              юнит-тесты чистых функций
```

### Контракт данных (`src/api.ts`)

Вся сеть изолирована в `api.ts`; UI работает только с нормализованными типами.
Плагин выровнен на публичный контракт API (`INVARIANTS.md` в этом же каталоге):

```
GET {base}/api/plugin/windy/conditions?lat=&lon=&days=3&lang=<locale>
  → { ok, point:{lat,lon},
      nearest:{slug,name,cc,distanceKm,url},
      days:[{date, vizM, vizBand?, waveM, windKts|windMs, waterTempC?,
             safety:{verdict,label}, tide?:{rangeM,kind,events}}],
      zones:{insideNoTake, nearestZoneName?, actUrl?},
      attribution:{provider,url}, stale?, staleReason? }

GET {base}/api/plugin/windy/zones?bbox=minLon,minLat,maxLon,maxLat&zoom=
  → GeoJSON FeatureCollection (кап 400 features; properties: name, status
     ("banned"|"conditional"|"open"), kind, act (строка), actUrl, sourceUrl,
     tier, approx, temporal{season,hours,expires}, source)
  → 413 либо { ok:false, error:"bbox_too_large" } — область слишком большая
  → 429 (Retry-After) / 503 "zones_unavailable" — сервис недоступен
```

Как это ложится на UI:

- `days=3` запрашивается одним запросом, «сырой» ответ кешируется по точке+локали
  с **TTL 15 минут** — переключение вкладки дня не ходит в сеть и **не отменяет**
  уже летящий бандл (отмена только при смене точки и закрытии панели).
- Кэшируются только честные ответы `ok && !stale`; 429/503 и `stale` не кэшируются,
  `Retry-After` соблюдается (бэкофф до следующей попытки).
- Бандл умирает по TTL **или** при наступлении нового дня **в таймзоне места**
  (`tz` из ответа, иначе tz ближайшего города; без них — день устройства + сравнение
  дат из ответа). Таймер до полуночи места не просто чистит кэш, а **будит панель**
  (`onConditionsInvalidated` → перезапрос и перерисовка).
- Кэш проверяется **до** бэкоффа: точка с валидным бандлом продолжает показывать
  «завтра», даже если по пути висит 429; `force` бэкофф не обходит.
- Обрыв/таймаут при чтении тела (`response.json()`) ведёт себя как обрыв fetch:
  запись выбрасывается, `null`-тело никогда не кэшируется как честный ответ.
- Отмена пользователем — молча; таймаут — отдельный класс ошибки и состояние
  «данные недоступны».
- День выбирается **по ДАТЕ**, а не по индексу: «сегодня» берётся из ответа
  (`today` / `localDate`, иначе дата первого дня), дальше ищется `дата + N`.
  Если нужного дня в выдаче нет — показываем пусто, а не чужой день.
- `vizM → visibilityM`, `vizBand → visibilityLabel`, `safety.verdict → safety.level`
  (незнакомые строки → `unknown`), `safety.label → safety.text`.
- Ветер: приходит `windKts` **или** `windMs` — второе значение досчитывается
  (1 м/с = 1.94384 узла), UI показывает м/с.
- `null`-поля рисуются как «—» (`t.noData`), панель не падает.
- `stale`/`staleReason` → жёлтая плашка «данные могут быть устаревшими».
- `tide:{rangeM,kind,events}` → компактная строка «↑ 06:10 3.1 m · Δ 1.8 m · spring».
- Свойства зоны (`status`, `statusWhenInForce`, `act`, `sourceUrl`, `tier`, `approx`,
  `temporal{state,season[],seasonRaw,hours,timeZone,inForce,expires}`) едут в popup:
  режим, «вне сезона: запрет с … по …», «запрет снова с ДД.ММ.ГГГГ» (`inForce` —
  ISO-дата, не булево), часы/срок, «границы приблизительные», ссылка на акт и источник.
- `nearest.url` уже содержит локаль и utm — CTA использует **его**; если поля нет,
  ссылка строится локально через `links.ts` (фолбэк `spearoForecastUrl`).
- `zones.insideNoTake` → красная плашка «точка внутри запретной зоны» + ссылка на акт.
- `attribution.provider/url` → подпись источника внизу панели.
- 413 / `bbox_too_large` → полигоны **не рисуются**, подсказка «приблизьте карту»;
  429/503/сеть → «зоны временно недоступны» (+ `Retry-After`); 400 features →
  пометка «слишком много зон». «Нет зон» показывается ТОЛЬКО при успешном ответе.
- Слой зон (`zonesLayer.ts`) ест **FeatureCollection напрямую** (`result.featureCollection`).

Нормализаторы остаются терпимыми: понимают и альтернативные имена
(`visibility_m` / `visibilityM`, вложенный `data.days[]`, `act.title` / `actTitle`),
неизвестные формы деградируют в `null`, а не ломают панель. Мок-режим `?mock=1`
повторяет форму контракта (включая `bbox_too_large` на слишком большом bbox).

Поля, которые UI ждёт от `getConditions()`:
`lat, lon, day, dateISO, visibilityM, visibilityLabel, waveM, wavePeriodS, windMs, windKts,
windDirDeg, waterTempC, tide, safety{level,text}, city{slug,name,cc,distanceKm}, ctaUrl,
noTake{inside,name,actUrl}, attribution{provider,url}, updatedISO, source, ok`.

От `getZones()`: `state` (`ok|zoom_in|unavailable`), `featureCollection`,
`zones[]{id,name,status,kind,actUrl,actLabel,sourceUrl,tier,approx,temporal,source,geometry}`,
`truncated`, `bboxTooLarge`, `retryAfterS`, `error`, `source`.

## 5. Публикация (делает ВЛАДЕЛЕЦ, ключи в репозиторий не коммитятся)

Плагины Windy обязаны раздаваться с домена `windy-plugins.com`, поэтому публикация —
это загрузка собранного `dist/` на сервер Windy: сборка, дозапись в `dist/plugin.json`
полей `repositoryName` / `repositoryOwner` / `commitSha`, упаковка каталога в
`plugin.tar` и `POST https://node.windy.com/plugins/v1.0/upload` с заголовком
`x-windy-api-key`.

Публикуем **только с локальной машины**: CI в репозитории нет и секретов в нём не
хранится. Ключ Windy Plugins API берётся на <https://api.windy.com/keys> и живёт в
файле вне репозитория.

### `npm run publish:local`

```bash
mkdir -p ~/.config/spearo
printf '%s' '<ключ>' > ~/.config/spearo/windy_api_key
chmod 600 ~/.config/spearo/windy_api_key

npm run publish:local -- --dry-run   # всё, кроме отправки: покажет содержимое архива
npm run publish:local                # сборка + загрузка, печатает URL плагина
```

`scripts/publish.sh`:

- читает ключ **только** из `~/.config/spearo/windy_api_key` — путь и адрес заливки
  зашиты в скрипт, переменных окружения для их подмены нет; падает, если файла нет
  или он пуст, ругается на права не `600`;
- ключ **никогда** не передаётся аргументом и не печатается: трассировка (`bash -x`)
  выключается до чтения ключа, заголовок уходит в curl через временный
  `--config`-файл с `umask 077`, который удаляется после запроса (ключ не виден
  ни в `ps`, ни в логе `bash -x` — проверено);
- делает всю цепочку сам: build → merge `plugin.json` → `tar` → upload;
- печатает только разобранные поля ответа и установочный URL вида
  `https://windy-plugins.com/<userId>/windy-plugin-spearo/<version>/plugin.min.js`.

Каждая новая публикация требует **увеличения `version`** в `src/pluginConfig.ts`
(и в `package.json`).

## 6. Заявка на одобрение (публичная галерея)

`private: false` (с версии 0.1.1) — плагин заявляется в публичную галерею; до
одобрения он доступен по прямой установочной ссылке.

Публикация делается командой `npm run publish:local` (см. §5), после чего
подаётся заявка в тему галереи. Чтобы попасть в публичную галерею Windy:

1. Положить в `src/` настоящий скриншот плагина **внутри интерфейса Windy**
   (`screenshot.jpg`/`.png`, сборка сама кладёт его в `dist/` и прописывает в `plugin.json`).
   Сейчас там автономный рендер панели — его нужно заменить перед заявкой.
2. Поднять `version` в `src/pluginConfig.ts` и `package.json`, пересобрать и
   опубликовать (`npm run publish:local`, §5). `private: false` уже выставлен.
3. Написать в тему одобрения на форуме Windy —
   <https://community.windy.com/topic/31066> (категория *Windy Plugins*): название
   плагина, установочный URL, что он делает, скриншот. Дальше Windy ревьюит и
   одобряет; после одобрения плагин доступен всем пользователям.

## 7. Ограничения и TODO

- Эндпоинты `/api/windy/*` ещё не реализованы на стороне spearo — до этого момента
  рабочий режим только `?mock=1`.
- Подпись пункта контекстного меню берётся Windy из `title` плагина; отдельного
  API для своего текста («spearo: conditions here») плагинам не дают.
- Единицы измерения — метрические; конвертация через `@windy/metric` (узлы, футы)
  пока не подключена.
- `repository` в `pluginConfig.ts` / `package.json` — плейсхолдер `spearo-app/spearo-windy-plugin`,
  заменить на реальный URL после создания репозитория владельцем.
- Третий день прогноза (`days[2]`, ключ `day3`) сервер уже отдаёт, в панели пока
  показаны две вкладки — добавить третью, когда это подтвердят по UX.
