/**
 * src/api.ts — ЕДИНСТВЕННЫЙ слой доступа к данным spearo.
 *
 * Вся сеть плагина живёт здесь. UI (plugin.svelte / zonesController.ts) знает ТОЛЬКО
 * про нормализованные типы `Conditions` / `ZonesResult` и ничего не знает про форму
 * ответа сервера.
 *
 * Контракт сервера (docs/INVARIANTS.md):
 *   GET {base}/api/plugin/windy/conditions?lat=&lon=&days=3&lang=<locale>
 *     → { ok, point:{lat,lon}, nearest:{slug,name,cc,distanceKm,url},
 *         days:[{date, vizM, vizBand?, waveM, windKts|windMs, waterTempC?,
 *                safety:{verdict,label}, tide?:{rangeM,kind,events}}],
 *         zones:{insideNoTake, nearestZoneName?, actUrl?},
 *         attribution:{provider,url}, stale?, staleReason? }
 *   GET {base}/api/plugin/windy/zones?bbox=minLon,minLat,maxLon,maxLat&zoom=
 *     → GeoJSON FeatureCollection (кап 400 features; properties: name, status,
 *       kind, act, actUrl, sourceUrl, tier, approx, temporal{season,hours,expires}, source)
 *     → 413 / { ok:false, error:'bbox_too_large' } — слишком большая область
 *     → 429 (Retry-After) / 503 'zones_unavailable' — сервис временно недоступен
 *
 * ТРИ состояния зон (никогда не смешивать «нет зон» и «не смогли спросить»):
 *   ok        — ответ получен, зон может быть 0;
 *   zoom_in   — область слишком большая, нужно приблизить карту;
 *   unavailable — 429/503/сеть/битый ответ.
 *
 * Нормализаторы намеренно терпимы к вариациям имён полей: если сервер отъедет от
 * контракта, панель деградирует в «—», а не ломается.
 *
 * Режим мока: `?mock=1` в URL страницы (или setMockMode(true)).
 * Никакой аналитики/трекинга внутри плагина — только эти два GET-запроса.
 */

import { SPEARO_HOSTS, sanitizeUrl } from './links.ts';

/** Ключ дня панели. Сервер отдаёт days[] — day0/day1/day2. */
export type DayKey = 'today' | 'tomorrow' | 'day3';

export const DAY_INDEX: Record<DayKey, number> = { today: 0, tomorrow: 1, day3: 2 };

/** Сколько дней просим у сервера (контракт: days=3). */
export const DAYS_REQUESTED = 3;

/** Время жизни кеша ответов conditions. */
export const CONDITIONS_TTL_MS = 15 * 60 * 1000;

/** Юго-западный / северо-восточный угол видимой области карты. */
export interface BBox {
    south: number;
    west: number;
    north: number;
    east: number;
}

export type SafetyLevel = 'good' | 'fair' | 'poor' | 'unsafe' | 'unknown';

export interface SafetyVerdict {
    /** Машиночитаемый уровень (safety.verdict) — определяет цвет плашки в UI. */
    level: SafetyLevel;
    /** Человекочитаемая подпись (safety.label), уже локализованная сервером. */
    text: string;
}

export interface CityRef {
    slug: string;
    name: string;
    cc: string | null;
    distanceKm: number | null;
}

export interface Attribution {
    provider: string;
    url: string | null;
}

export interface TideEvent {
    /** HH:MM либо ISO — как отдал сервер. */
    time: string | null;
    /** high | low | … */
    type: string | null;
    heightM: number | null;
}

export interface TideInfo {
    /** Амплитуда прилива, м. */
    rangeM: number | null;
    /** spring | neap | … */
    kind: string | null;
    events: TideEvent[];
}

/** Нормализованные условия в точке на конкретный день. Ровно это ждёт UI. */
export interface Conditions {
    lat: number;
    lon: number;
    day: DayKey;
    /** days[i].date, YYYY-MM-DD (выбран по ДАТЕ, а не по индексу). */
    dateISO: string | null;
    /** days[i].vizM — видимость воды, м. */
    visibilityM: number | null;
    /** days[i].vizBand */
    visibilityLabel: string | null;
    waveM: number | null;
    wavePeriodS: number | null;
    /** Ветер в м/с (из windMs либо пересчитан из windKts). */
    windMs: number | null;
    /** Ветер в узлах. */
    windKts: number | null;
    windDirDeg: number | null;
    waterTempC: number | null;
    /** days[i].tide — структура. */
    tide: TideInfo | null;
    /** Компактная строка прилива для панели («↑ 06:10 · 1.8 м · spring»). */
    tideText: string | null;
    safety: SafetyVerdict;
    city: CityRef | null;
    /** nearest.url — https на spearo.app, уже с локалью и utm (иначе null). */
    ctaUrl: string | null;
    noTake: { inside: boolean; name: string | null; actUrl: string | null } | null;
    attribution: Attribution | null;
    /** Сервер отдал кешированные/устаревшие данные. */
    stale: boolean;
    /** Причина устаревания (текст сервера). */
    staleReason: string | null;
    updatedISO: string | null;
    source: string | null;
    /** false, если сервер ответил ok:false либо вернул ошибку — панель покажет ошибку. */
    ok: boolean;
    /** Код ошибки сервера/транспорта, если он был. */
    error: string | null;
    /** Через сколько секунд можно повторить (Retry-After при 429/503). */
    retryAfterS: number | null;
}

/**
 * Режим зоны (docs/INVARIANTS.md):
 *   banned      — запрет действует сейчас;
 *   dormant     — правило есть, но по календарю/часам сейчас не в силе
 *                 (тогда обязателен statusWhenInForce и заполнен temporal);
 *   conditional — движок не смог прочитать оговорку, отдан сырой текст;
 *   open        — запрета нет.
 * Неизвестное значение трактуется как `conditional` — НИКОГДА как `open`.
 */
export type ZoneStatus = 'banned' | 'dormant' | 'conditional' | 'open';

/** Диапазон сезона: 'MM-DD' → 'MM-DD' (как отдаёт движок). */
export interface ZoneSeasonRange {
    from: string | null;
    to: string | null;
}

export interface ZoneTemporal {
    /** in-force | dormant | … — состояние правила на момент запроса. */
    state: string | null;
    /** Машинный сезон; допускается несколько диапазонов. */
    season: ZoneSeasonRange[];
    /** Сырой текст сезона/оговорки (когда машинного формата нет). */
    seasonRaw: string | null;
    hours: string | null;
    /** Пояс самого акта. */
    timeZone: string | null;
    /**
     * ISO-дата/датавремя начала действия правила (или null) — это НЕ булево:
     * для спящей зоны здесь дата, с которой запрет снова вступит в силу.
     */
    inForce: string | null;
    expires: string | null;
}

/** Полигон зоны (нормализованный — для счётчика, стилей и тестов). */
export interface Zone {
    id: string;
    name: string;
    /** properties.status — состояние на момент запроса. */
    status: ZoneStatus;
    /** Слово корпуса, когда правило сейчас не в силе (dormant/conditional). */
    statusWhenInForce: ZoneStatus | null;
    /** properties.kind — тип зоны (reserve, park…). */
    kind: string | null;
    /** Ссылка на акт (actUrl либо sourceUrl), https (http допустим для госсайтов). */
    actUrl: string | null;
    /** Подпись акта: скалярный properties.act либо act.title. */
    actLabel: string | null;
    /** properties.sourceUrl — первоисточник данных. */
    sourceUrl: string | null;
    /** properties.tier — уровень достоверности/важности. */
    tier: string | null;
    /** properties.approx — границы приблизительные. */
    approx: boolean;
    /** properties.temporal — сезон/часы/срок действия. */
    temporal: ZoneTemporal | null;
    source: string | null;
    geometry: GeoJsonGeometry;
}

export interface GeoJsonGeometry {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: unknown;
}

export interface ZoneProperties {
    name: string;
    status: ZoneStatus;
    statusWhenInForce: ZoneStatus | null;
    kind: string | null;
    actUrl: string | null;
    actLabel: string | null;
    sourceUrl: string | null;
    tier: string | null;
    approx: boolean;
    temporal: ZoneTemporal | null;
    source: string | null;
}

export interface ZoneFeature {
    type: 'Feature';
    id: string;
    properties: ZoneProperties;
    geometry: GeoJsonGeometry;
}

export interface ZoneFeatureCollection {
    type: 'FeatureCollection';
    features: ZoneFeature[];
}

/** Три состояния слоя зон (см. шапку файла). */
export type ZonesState = 'ok' | 'zoom_in' | 'unavailable';

export interface ZonesResult {
    state: ZonesState;
    /** Готовая FeatureCollection — её напрямую ест zonesLayer.ts. */
    featureCollection: ZoneFeatureCollection;
    /** Те же зоны в плоском виде (счётчик в панели, тесты). */
    zones: Zone[];
    /** true, если сервер упёрся в кап (400 features). */
    truncated: boolean;
    /** Синоним state === 'zoom_in' (оставлен для читаемости в UI). */
    bboxTooLarge: boolean;
    /** Через сколько секунд можно повторить (Retry-After при 429). */
    retryAfterS: number | null;
    /** Код ошибки сервера/транспорта, если он был. */
    error: string | null;
    source: string | null;
}

export interface RequestOptions {
    /** Локаль ответа (ru/en/…) — сервер вернёт уже локализованные тексты (`lang`). */
    locale?: string;
    /** Текущий зум карты — сервер по нему решает, отдавать ли детальные полигоны. */
    zoom?: number;
    signal?: AbortSignal;
    /** Таймаут запроса, мс (по умолчанию 8000). */
    timeoutMs?: number;
    /** Игнорировать кеш conditions (принудительное обновление). */
    force?: boolean;
}

// ── Конфигурация ──────────────────────────────────────────────────────────────

/**
 * ПРОД: база — компайл-тайм константа. Подменить её из URL страницы нельзя,
 * иначе любой, кто пришлёт ссылку на Windy с `?spearoBase=…`, увёл бы запросы
 * плагина (и координаты пользователя) на чужой сервер.
 */
const DEFAULT_BASE_URL = 'https://spearo.app';
const DEFAULT_TIMEOUT_MS = 8000;
/** Кап сервера на число полигонов в ответе. */
export const ZONES_FEATURE_CAP = 400;
const KTS_PER_MS = 1.94384;

let baseUrl = DEFAULT_BASE_URL;
let mockForced: boolean | null = null;

/**
 * Флаг dev-сборки. Подставляется компилятором (swc globals) в rollup.config.js:
 * `npm start` → true, `npm run build` (SERVE=false) → false, в опубликованном
 * бандле ветка с подменой базы вырезается.
 */
function isDevBuild(): boolean {
    return typeof __SPEARO_DEV_BUILD__ !== 'undefined' && __SPEARO_DEV_BUILD__ === true;
}

/** Прочитать query-параметр страницы Windy (плагин живёт внутри windy.com). */
function queryParam(name: string): string | null {
    try {
        const search = typeof window === 'undefined' ? '' : window.location.search || '';
        const hash = typeof window === 'undefined' ? '' : window.location.hash || '';
        const fromSearch = new URLSearchParams(search).get(name);
        if (fromSearch !== null) {
            return fromSearch;
        }
        const qIndex = hash.indexOf('?');
        if (qIndex >= 0) {
            return new URLSearchParams(hash.slice(qIndex + 1)).get(name);
        }
    } catch {
        /* нестандартное окружение — молча игнорируем */
    }
    return null;
}

/**
 * Базовый URL API.
 *
 * В прод-сборке — всегда константа `https://spearo.app`.
 * `?spearoBase=…` и setBaseUrl() работают ТОЛЬКО в dev-сборке (`npm start`).
 */
export function getBaseUrl(): string {
    if (!isDevBuild()) {
        return DEFAULT_BASE_URL;
    }
    const fromUrl = sanitizeUrl(queryParam('spearoBase'), { allowHttp: true });
    if (fromUrl) {
        return fromUrl.replace(/\/+$/, '');
    }
    return baseUrl;
}

/** Только для dev/тестов: в прод-сборке вызов игнорируется. */
export function setBaseUrl(url: string): void {
    if (!isDevBuild()) {
        return;
    }
    baseUrl = url.replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

/** Режим мока: `?mock=1` в URL или принудительно через setMockMode(). */
export function isMockMode(): boolean {
    if (mockForced !== null) {
        return mockForced;
    }
    const raw = queryParam('mock');
    return raw === '1' || raw === 'true';
}

export function setMockMode(on: boolean | null): void {
    mockForced = on;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

/**
 * Таймаут запроса — ОТДЕЛЬНЫЙ класс ошибки.
 * Отмена пользователем (закрыли панель, ушли с точки) — это не ошибка и не
 * состояние UI; таймаут — это «данные недоступны». Различать обязательно
 * (docs/INVARIANTS.md → «Клиентский кэш плагина»).
 */
export class TimeoutError extends Error {
    constructor(message = 'request timed out') {
        super(message);
        this.name = 'TimeoutError';
    }
}

/** Пользовательская отмена (AbortError), не таймаут. */
export function isAbortError(e: unknown): boolean {
    return (e as Error)?.name === 'AbortError';
}

export function isTimeoutError(e: unknown): boolean {
    return e instanceof TimeoutError || (e as Error)?.name === 'TimeoutError';
}

export interface HttpResult {
    status: number;
    /** Разобранное тело (null, если тело пустое/не JSON). */
    body: unknown;
    /** Retry-After в секундах (429/503). */
    retryAfterS: number | null;
}

function parseRetryAfter(raw: string | null): number | null {
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) {
        return Math.max(0, Math.round((date - Date.now()) / 1000));
    }
    return null;
}

/**
 * GET + разбор JSON. НЕ бросает на HTTP-ошибке: тело 4xx/5xx тоже разбирается
 * (сервер кладёт туда `{ok:false,error}`), решение принимает вызывающий.
 * Бросает только на сетевой ошибке / таймауте / abort.
 */
export async function requestJson(url: string, options: RequestOptions = {}): Promise<HttpResult> {
    const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const onOuterAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', onOuterAbort);
        }
    }
    try {
        let response: Response;
        try {
            response = await fetch(url, {
                signal: controller.signal,
                credentials: 'omit',
                headers: { accept: 'application/json' },
            });
        } catch (e) {
            // Наш же таймаут прилетает как AbortError — переименовываем, чтобы UI
            // не спутал его с отменой по воле пользователя.
            if (timedOut && isAbortError(e)) {
                throw new TimeoutError();
            }
            throw e;
        }
        let body: unknown = null;
        try {
            body = await response.json();
        } catch (e) {
            // Чтение тела тоже можно отменить/оборвать по таймауту. Такой обрыв — НЕ
            // «пустое тело»: иначе мы закэшировали бы null как честный ok:true ответ.
            if (timedOut && isAbortError(e)) {
                throw new TimeoutError();
            }
            if (isAbortError(e) || isTimeoutError(e)) {
                throw e;
            }
            body = null; // пустое или не-JSON тело — не повод падать
        }
        const retryHeader =
            typeof response.headers?.get === 'function' ? response.headers.get('Retry-After') : null;
        return { status: response.status, body, retryAfterS: parseRetryAfter(retryHeader) };
    } finally {
        clearTimeout(timer);
        if (signal) {
            signal.removeEventListener('abort', onOuterAbort);
        }
    }
}

// ── Хелперы нормализации ──────────────────────────────────────────────────────

function num(...candidates: unknown[]): number | null {
    for (const candidate of candidates) {
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            return candidate;
        }
        if (typeof candidate === 'string' && candidate.trim() !== '') {
            const parsed = Number(candidate);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return null;
}

function str(...candidates: unknown[]): string | null {
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim() !== '') {
            return candidate;
        }
    }
    return null;
}

function obj(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

/** safety.verdict → наш enum. Незнакомые строки → 'unknown'. */
export function toSafetyLevel(raw: unknown): SafetyLevel {
    const value = (typeof raw === 'string' ? raw : '').toLowerCase().trim();
    if (['good', 'ok', 'safe', 'green', 'go'].includes(value)) return 'good';
    if (['fair', 'moderate', 'caution', 'yellow', 'marginal'].includes(value)) return 'fair';
    if (['poor', 'bad', 'orange', 'rough'].includes(value)) return 'poor';
    if (['unsafe', 'danger', 'dangerous', 'red', 'no-go', 'nogo', 'storm'].includes(value)) return 'unsafe';
    return 'unknown';
}

/**
 * properties.status → enum зоны.
 * Всё непонятное — `conditional`: показать «возможно нельзя» безопаснее, чем «открыто».
 */
export function toZoneStatus(raw: unknown): ZoneStatus {
    const value = (typeof raw === 'string' ? raw : '').toLowerCase().trim();
    if (['banned', 'no-take', 'notake', 'prohibited', 'closed'].includes(value)) return 'banned';
    if (['dormant', 'out-of-season', 'inactive'].includes(value)) return 'dormant';
    if (['open', 'allowed', 'permitted'].includes(value)) return 'open';
    return 'conditional';
}

/** statusWhenInForce: то же приведение, но отсутствие поля — это null, а не conditional. */
export function toStatusWhenInForce(raw: unknown): ZoneStatus | null {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    return toZoneStatus(raw);
}

/** season: массив {from,to} | строка | массив строк → массив диапазонов. */
export function normalizeSeason(raw: unknown): { season: ZoneSeasonRange[]; raw: string | null } {
    if (typeof raw === 'string' && raw.trim() !== '') {
        return { season: [], raw: raw.trim() };
    }
    const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
    const season: ZoneSeasonRange[] = [];
    const rawParts: string[] = [];
    for (const item of items) {
        if (typeof item === 'string' && item.trim() !== '') {
            rawParts.push(item.trim());
            continue;
        }
        const node = obj(item);
        const from = str(node.from, node.start);
        const to = str(node.to, node.end);
        if (from || to) {
            season.push({ from, to });
        }
    }
    return { season, raw: rawParts.length > 0 ? rawParts.join('; ') : null };
}

/** properties.temporal → структура (или null, если её нет). */
export function normalizeTemporal(raw: unknown): ZoneTemporal | null {
    const node = obj(raw);
    if (Object.keys(node).length === 0) {
        return null;
    }
    const { season, raw: seasonRawFromList } = normalizeSeason(node.season);
    return {
        state: str(node.state),
        season,
        seasonRaw: str(node.seasonRaw, node.season_raw, seasonRawFromList),
        hours: typeof node.hours === 'string' ? node.hours : Array.isArray(node.hours) ? node.hours.filter(h => typeof h === 'string').join('; ') || null : null,
        timeZone: str(node.timeZone, node.time_zone, node.tz),
        // inForce по контракту — ISO-строка; булевы значения прошлых черновиков игнорируем.
        inForce: str(node.inForce, node.in_force, node.inForceFrom, node.from),
        expires: str(node.expires, node.expiry, node.permit_expiry),
    };
}

/** YYYY-MM-DD + n дней (UTC-арифметика, без таймзонных сюрпризов). */
export function addDaysISO(iso: string, days: number): string | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!match) return null;
    const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

function emptyConditions(lat: number, lon: number, day: DayKey, ok: boolean, error: string | null): Conditions {
    return {
        lat,
        lon,
        day,
        dateISO: null,
        visibilityM: null,
        visibilityLabel: null,
        waveM: null,
        wavePeriodS: null,
        windMs: null,
        windKts: null,
        windDirDeg: null,
        waterTempC: null,
        tide: null,
        tideText: null,
        safety: { level: 'unknown', text: '' },
        city: null,
        ctaUrl: null,
        noTake: null,
        attribution: null,
        stale: false,
        staleReason: null,
        updatedISO: null,
        source: null,
        ok,
        error,
        retryAfterS: null,
    };
}

/** tide:{rangeM,kind,events} → структура + компактная строка. */
export function normalizeTide(raw: unknown): { tide: TideInfo | null; text: string | null } {
    if (typeof raw === 'string' && raw.trim() !== '') {
        return { tide: { rangeM: null, kind: null, events: [] }, text: raw.trim() };
    }
    const node = obj(raw);
    if (Object.keys(node).length === 0) {
        return { tide: null, text: null };
    }
    const eventsRaw = Array.isArray(node.events) ? (node.events as unknown[]) : [];
    const events: TideEvent[] = eventsRaw.slice(0, 4).map(item => {
        const event = obj(item);
        return {
            time: str(event.time, event.at, event.timeISO),
            type: str(event.type, event.kind, event.state),
            heightM: num(event.heightM, event.height_m, event.height),
        };
    });
    const tide: TideInfo = {
        rangeM: num(node.rangeM, node.range_m, node.range),
        kind: str(node.kind, node.type, node.phase),
        events,
    };
    const parts: string[] = [];
    for (const event of events.slice(0, 2)) {
        const arrow = event.type ? (event.type.toLowerCase().startsWith('h') ? '↑' : '↓') : '•';
        const chunk = [arrow, event.time, event.heightM === null ? null : `${event.heightM} m`]
            .filter(Boolean)
            .join(' ');
        if (chunk.trim() !== '') parts.push(chunk);
    }
    if (tide.rangeM !== null) parts.push(`Δ ${tide.rangeM} m`);
    if (tide.kind) parts.push(tide.kind);
    return { tide, text: parts.length > 0 ? parts.join(' · ') : null };
}

/**
 * Выбор дня ПО ДАТЕ: берём «локальное сегодня» из ответа (body.today / localDate /
 * date, иначе дата первого дня) и ищем день с датой «сегодня + N». Индекс —
 * только аварийный фолбэк, если дат нет.
 */
export function pickDayNode(body: Record<string, unknown>, day: DayKey): Record<string, unknown> {
    const days = Array.isArray(body.days) ? (body.days as unknown[]) : [];
    const index = DAY_INDEX[day];
    const baseISO = str(body.today, body.localDate, body.localToday, body.date, obj(days[0]).date as string);
    if (baseISO) {
        const target = addDaysISO(baseISO, index);
        if (target) {
            const found = days.find(item => str(obj(item).date)?.slice(0, 10) === target);
            if (found) return obj(found);
            // Даты есть, но нужного дня в выдаче нет — это НЕ повод показывать чужой день.
            if (days.some(item => str(obj(item).date))) return {};
        }
    }
    if (days.length > 0) return obj(days[index]);
    return obj(body.day ?? body.point ?? body);
}

/** Нормализатор ответа /api/plugin/windy/conditions. */
export function normalizeConditions(raw: unknown, lat: number, lon: number, day: DayKey): Conditions {
    const root = obj(raw);
    const body = obj(root.data ?? root.result ?? root);
    if (root.ok === false || body.ok === false) {
        return emptyConditions(lat, lon, day, false, str(root.error, body.error) ?? 'server_error');
    }

    const dayNode = pickDayNode(body, day);
    const safetyNode = obj(dayNode.safety ?? body.safety);
    const nearestNode = obj(body.nearest ?? body.city ?? body.nearestCity);
    const zonesNode = obj(body.zones ?? body.noTake ?? body.noTakeZone);
    const attributionNode = obj(body.attribution);
    const { tide, text: tideText } = normalizeTide(dayNode.tide);

    const citySlug = str(nearestNode.slug, nearestNode.citySlug, body.citySlug);
    const windMsRaw = num(dayNode.windMs, dayNode.wind_ms, dayNode.windSpeedMs);
    const windKtsRaw = num(dayNode.windKts, dayNode.wind_kts, dayNode.windSpeedKts);
    const windMs = windMsRaw ?? (windKtsRaw === null ? null : round(windKtsRaw / KTS_PER_MS, 1));
    const windKts = windKtsRaw ?? (windMsRaw === null ? null : round(windMsRaw * KTS_PER_MS, 1));

    return {
        lat: num(obj(body.point).lat, body.lat) ?? lat,
        lon: num(obj(body.point).lon, body.lon) ?? lon,
        day,
        dateISO: str(dayNode.date, dayNode.dateISO),
        visibilityM: num(dayNode.vizM, dayNode.visibilityM, dayNode.visibility_m, dayNode.visibility),
        visibilityLabel: str(dayNode.vizBand, dayNode.visibilityLabel, dayNode.visibility_label),
        waveM: num(dayNode.waveM, dayNode.wave_m, dayNode.waveHeightM, dayNode.wave),
        wavePeriodS: num(dayNode.wavePeriodS, dayNode.wave_period_s, dayNode.period),
        windMs,
        windKts,
        windDirDeg: num(dayNode.windDirDeg, dayNode.wind_dir_deg, dayNode.windDirection),
        waterTempC: num(dayNode.waterTempC, dayNode.water_temp_c, dayNode.sstC),
        tide,
        tideText,
        safety: {
            level: toSafetyLevel(safetyNode.verdict ?? safetyNode.level ?? safetyNode.status),
            text: str(safetyNode.label, safetyNode.text, safetyNode.summary) ?? '',
        },
        city: citySlug
            ? {
                  slug: citySlug,
                  name: str(nearestNode.name, nearestNode.title) ?? citySlug,
                  cc: str(nearestNode.cc, nearestNode.countryCode),
                  distanceKm: num(nearestNode.distanceKm, nearestNode.distance_km),
              }
            : null,
        // nearest.url приходит из данных: пускаем только https на хост spearo.app.
        ctaUrl: sanitizeUrl(str(nearestNode.url, nearestNode.href), { hosts: SPEARO_HOSTS }),
        noTake:
            Object.keys(zonesNode).length > 0
                ? {
                      inside: zonesNode.insideNoTake === true || zonesNode.inside === true,
                      name: str(zonesNode.nearestZoneName, zonesNode.name, zonesNode.title),
                      // Акт может жить на сайте госоргана без TLS — http допускаем, javascript: нет.
                      actUrl: sanitizeUrl(str(zonesNode.actUrl, zonesNode.act_url, zonesNode.url), {
                          allowHttp: true,
                      }),
                  }
                : null,
        attribution: str(attributionNode.provider)
            ? { provider: str(attributionNode.provider) as string, url: sanitizeUrl(attributionNode.url) }
            : null,
        stale: body.stale === true || root.stale === true,
        staleReason: str(body.staleReason, root.staleReason, body.stale_reason),
        updatedISO: str(body.updated, body.updatedISO, root.updated),
        source: str(root.source, body.source),
        ok: true,
        error: null,
        retryAfterS: null,
    };
}

function emptyZones(state: ZonesState, error: string | null, retryAfterS: number | null = null): ZonesResult {
    return {
        state,
        featureCollection: { type: 'FeatureCollection', features: [] },
        zones: [],
        truncated: false,
        bboxTooLarge: state === 'zoom_in',
        retryAfterS,
        error,
        source: null,
    };
}

/** Нормализатор GeoJSON-ответа /api/plugin/windy/zones (только успешное тело). */
export function normalizeZones(raw: unknown): ZonesResult {
    const root = obj(raw);
    if (root.ok === false) {
        const error = str(root.error) ?? 'unknown_error';
        return emptyZones(error === 'bbox_too_large' ? 'zoom_in' : 'unavailable', error);
    }

    const list: unknown[] = Array.isArray(root.features)
        ? (root.features as unknown[])
        : Array.isArray(root.zones)
          ? (root.zones as unknown[])
          : Array.isArray(raw)
            ? (raw as unknown[])
            : [];

    const zones: Zone[] = [];
    list.forEach((item, index) => {
        const feature = obj(item);
        const props = obj(feature.properties ?? feature);
        const geometry = obj(feature.geometry ?? props.geometry);
        const type = geometry.type;
        if (type !== 'Polygon' && type !== 'MultiPolygon') {
            return;
        }
        // `act` по новому контракту — скаляр (строка), но переживём и объект {title,url}.
        const actScalar = typeof props.act === 'string' ? props.act : null;
        const actObj = obj(props.act);
        const temporal = normalizeTemporal(props.temporal);
        const sourceUrl = sanitizeUrl(str(props.sourceUrl, props.source_url), { allowHttp: true });

        zones.push({
            id: str(feature.id, props.id, props.zoneId) ?? `zone-${index}`,
            name: str(props.name, props.title, props.zoneName) ?? 'No-take zone',
            status: toZoneStatus(props.status),
            statusWhenInForce: toStatusWhenInForce(props.statusWhenInForce ?? props.status_when_in_force),
            kind: str(props.kind, props.type, props.category, props.article),
            actUrl:
                sanitizeUrl(str(props.actUrl, props.act_url, actObj.url, props.url, props.link), {
                    allowHttp: true,
                }) ?? sourceUrl,
            actLabel: str(actScalar, props.actTitle, props.act_title, props.actLabel, actObj.title, actObj.label),
            sourceUrl,
            tier: str(props.tier),
            approx: props.approx === true || props.approximate === true,
            temporal,
            source: str(props.source, props.dataSource),
            geometry: { type, coordinates: geometry.coordinates },
        });
    });

    return {
        state: 'ok',
        featureCollection: toFeatureCollection(zones),
        zones,
        truncated:
            root.truncated === true ||
            obj(root.meta).truncated === true ||
            zones.length >= ZONES_FEATURE_CAP,
        bboxTooLarge: false,
        retryAfterS: null,
        error: null,
        source: str(root.source, obj(root.meta).source, zones[0]?.source),
    };
}

/** Zone[] → FeatureCollection (её напрямую скармливаем L.GeoJSON). */
export function toFeatureCollection(zones: Zone[]): ZoneFeatureCollection {
    return {
        type: 'FeatureCollection',
        features: zones.map(zone => ({
            type: 'Feature' as const,
            id: zone.id,
            properties: {
                name: zone.name,
                status: zone.status,
                statusWhenInForce: zone.statusWhenInForce,
                kind: zone.kind,
                actUrl: zone.actUrl,
                actLabel: zone.actLabel,
                sourceUrl: zone.sourceUrl,
                tier: zone.tier,
                approx: zone.approx,
                temporal: zone.temporal,
                source: zone.source,
            },
            geometry: zone.geometry,
        })),
    };
}

// ── Публичное API ─────────────────────────────────────────────────────────────

/** Путь эндпоинта условий. */
export const CONDITIONS_PATH = '/api/plugin/windy/conditions';
/** Путь эндпоинта зон. */
export const ZONES_PATH = '/api/plugin/windy/zones';

interface CacheEntry {
    at: number;
    /** Ключ дня на момент запроса — в таймзоне МЕСТА, если она известна. */
    dayKeyLocal: string;
    /** Таймзона места из ответа (IANA) либо null. */
    timeZone: string | null;
    /** Дата места из ответа (days[0].date / today) — последний рубеж сравнения. */
    responseDate: string | null;
    promise: Promise<unknown>;
    /** Таймер до полуночи МЕСТА: бандл с «сегодня» не должен её пережить. */
    midnightTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Подписчики на инвалидацию бандла (полночь места).
 * Панель по этому событию не просто чистит кеш, а перезапрашивает и перерисовывается.
 */
const invalidationListeners = new Set<() => void>();

/** Подписаться на «бандл устарел, обновись». Возвращает отписку. */
export function onConditionsInvalidated(listener: () => void): () => void {
    invalidationListeners.add(listener);
    return () => invalidationListeners.delete(listener);
}

function notifyInvalidated(): void {
    for (const listener of [...invalidationListeners]) {
        try {
            listener();
        } catch {
            /* подписчик не должен ронять таймер */
        }
    }
}

/** Кеш «сырых» ответов conditions: ключ — точка+локаль, TTL 15 минут. */
const bundleCache = new Map<string, CacheEntry>();

/** Бэкофф после 429/503: путь → момент, раньше которого не стучимся. */
const backoffUntil = new Map<string, number>();

/**
 * Календарный день в таймзоне МЕСТА (YYYY-MM-DD).
 * Без таймзоны — день устройства: сервер всё равно отдаёт даты места, и последним
 * рубежом работает сравнение строк дат из ответа.
 */
export function dayKeyInZone(ts: number, timeZone: string | null): string {
    if (timeZone) {
        try {
            return new Intl.DateTimeFormat('en-CA', {
                timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(new Date(ts));
        } catch {
            /* кривая зона — падаем на устройство */
        }
    }
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Миллисекунды до ближайшей полуночи в таймзоне места (+1 с запаса). */
export function msUntilMidnightInZone(ts: number, timeZone: string | null): number {
    const today = dayKeyInZone(ts, timeZone);
    // Шагаем по часу — дёшево и не зависит от знания смещения/переходов на летнее время.
    const HOUR = 3600000;
    let probe = ts;
    for (let i = 0; i < 48; i++) {
        probe += HOUR;
        if (dayKeyInZone(probe, timeZone) !== today) {
            // Уточняем минутами внутри найденного часа.
            let minute = probe - HOUR;
            for (let j = 0; j < 60; j++) {
                minute += 60000;
                if (dayKeyInZone(minute, timeZone) !== today) {
                    return Math.max(1000, minute - ts + 1000);
                }
            }
            return Math.max(1000, probe - ts + 1000);
        }
    }
    return 24 * HOUR;
}

/** Таймзона и дата места из ответа сервера. */
export function locationDateInfo(raw: unknown): { timeZone: string | null; date: string | null } {
    const root = obj(raw);
    const body = obj(root.data ?? root.result ?? root);
    const days = Array.isArray(body.days) ? (body.days as unknown[]) : [];
    return {
        // `tz` ждём от контракта; пока его нет — таймзона ближайшего города/зоны.
        timeZone: str(body.tz, body.timeZone, body.timezone, obj(body.nearest).tz, obj(body.nearest).timeZone),
        date: str(body.today, body.localDate, body.localToday, obj(days[0]).date as string),
    };
}

function dropEntry(key: string): void {
    const entry = bundleCache.get(key);
    if (entry?.midnightTimer) {
        clearTimeout(entry.midnightTimer);
    }
    bundleCache.delete(key);
}

/** Сбросить кеш условий (смена base URL, тесты, закрытие панели). */
export function clearConditionsCache(): void {
    for (const key of [...bundleCache.keys()]) {
        dropEntry(key);
    }
    backoffUntil.clear();
}

/**
 * Запись протухла: вышел TTL ИЛИ в МЕСТЕ наступил новый день.
 * Сравниваем день в таймзоне места; если её нет — день устройства, а затем
 * отдельно проверяем, совпадает ли дата места из ответа с текущим днём.
 */
function isExpired(entry: CacheEntry, now: number): boolean {
    if (now - entry.at >= CONDITIONS_TTL_MS) return true;
    // Есть таймзона места (`tz` в ответе / tz ближайшего города) — считаем день по ней.
    // Нет её — считаем день устройства; сама дата места (`responseDate`) остаётся
    // рубежом при сравнении со следующим ответом (новая дата = новая запись).
    return entry.dayKeyLocal !== dayKeyInZone(now, entry.timeZone);
}

/** Дата места, на которой собран кэшированный бандл (для диагностики и тестов). */
export function cachedResponseDate(lat: number, lon: number, locale = ''): string | null {
    return bundleCache.get(`${lat.toFixed(4)}|${lon.toFixed(4)}|${locale}`)?.responseDate ?? null;
}

/**
 * ТОЛЬКО ДЛЯ ТЕСТОВ: выполнить то же, что делает таймер полуночи — выбросить записи
 * и разбудить панель. Ждать реальных суток в тестах, очевидно, нельзя.
 */
export function __fireMidnightForTests(): void {
    for (const key of [...bundleCache.keys()]) {
        dropEntry(key);
    }
    notifyInvalidated();
}

/** Сколько таймеров полуночи сейчас живёт (гвард на утечки в тестах). */
export function activeMidnightTimers(): number {
    let count = 0;
    for (const entry of bundleCache.values()) {
        if (entry.midnightTimer) count++;
    }
    return count;
}

function pruneCache(now: number): void {
    for (const [key, entry] of bundleCache) {
        if (isExpired(entry, now)) {
            dropEntry(key);
        }
    }
}

/** Сколько секунд ещё действует бэкофф по пути (0 — можно стучаться). */
export function backoffLeftS(path: string, now: number = Date.now()): number {
    const until = backoffUntil.get(path);
    if (!until || until <= now) {
        backoffUntil.delete(path);
        return 0;
    }
    return Math.ceil((until - now) / 1000);
}

function rememberBackoff(path: string, retryAfterS: number | null, now: number): void {
    // Нет Retry-After — всё равно придерживаем короткую паузу, чтобы не долбить 503.
    const seconds = retryAfterS && retryAfterS > 0 ? retryAfterS : 30;
    backoffUntil.set(path, now + seconds * 1000);
}

/**
 * Условия в точке на день `today` | `tomorrow` | `day3`.
 *
 * Порядок строгий (docs/INVARIANTS.md):
 *   1) валидная запись кэша отдаётся ВСЕГДА — бэкофф не должен ослеплять точку,
 *      для которой данные уже есть;
 *   2) только если идти в сеть — проверяется бэкофф (и `force` его тоже уважает);
 *   3) кэшируются только `ok && !stale`; 429/503/`stale`/отмена — нет.
 * Запись умирает по TTL 15 мин ИЛИ при наступлении нового дня В МЕСТЕ.
 * Смена дня переиспользует ТОТ ЖЕ промис — она не отменяет общий бандл.
 */
export async function getConditions(
    lat: number,
    lon: number,
    day: DayKey = 'today',
    options: RequestOptions = {},
): Promise<Conditions> {
    if (isMockMode()) {
        return mockConditions(lat, lon, day, options.locale);
    }
    const locale = options.locale ?? '';
    const cacheKey = `${lat.toFixed(4)}|${lon.toFixed(4)}|${locale}`;
    const now = Date.now();
    pruneCache(now);

    // 1) Кэш — вперёд бэкоффа.
    let entry = options.force ? undefined : bundleCache.get(cacheKey);
    if (entry && isExpired(entry, now)) {
        dropEntry(cacheKey);
        entry = undefined;
    }

    if (!entry) {
        // 2) Идём в сеть → бэкофф обязателен, и `force` его не обходит.
        const waitS = backoffLeftS(CONDITIONS_PATH, now);
        if (waitS > 0) {
            const throttled = emptyConditions(lat, lon, day, false, 'rate_limited');
            throttled.retryAfterS = waitS;
            return throttled;
        }
        // force заменяет запись — старый таймер полуночи обязан умереть вместе с ней.
        dropEntry(cacheKey);

        const url = new URL(CONDITIONS_PATH, getBaseUrl());
        url.searchParams.set('lat', lat.toFixed(4));
        url.searchParams.set('lon', lon.toFixed(4));
        url.searchParams.set('days', String(DAYS_REQUESTED));
        if (locale) {
            url.searchParams.set('lang', locale);
        }

        const promise = requestJson(url.toString(), options).then(result => {
            if (result.status === 429 || result.status === 503) {
                rememberBackoff(CONDITIONS_PATH, result.retryAfterS, Date.now());
            }
            if (result.status >= 400) {
                const body = obj(result.body);
                const error = str(body.error) ?? (result.status === 429 ? 'rate_limited' : `http_${result.status}`);
                dropEntry(cacheKey); // ошибку не кэшируем
                return { ok: false, error, retryAfterS: result.retryAfterS };
            }
            if (result.body === null) {
                // Пустое/нечитаемое тело — это не «успешный ответ без данных».
                dropEntry(cacheKey);
                return { ok: false, error: 'empty_body', retryAfterS: result.retryAfterS };
            }
            const body = obj(result.body);
            if (body.ok === false || body.stale === true) {
                dropEntry(cacheKey); // stale — шаблон движка, а не замер
                return result.body;
            }
            // Честный ответ: уточняем таймзону/дату места и перевешиваем таймер полуночи.
            const live = bundleCache.get(cacheKey);
            if (live) {
                const { timeZone, date } = locationDateInfo(result.body);
                live.timeZone = timeZone;
                live.responseDate = date;
                live.dayKeyLocal = dayKeyInZone(live.at, timeZone);
                if (live.midnightTimer) {
                    clearTimeout(live.midnightTimer);
                }
                live.midnightTimer = armMidnightTimer(cacheKey, Date.now(), timeZone);
            }
            return result.body;
        });

        entry = {
            at: now,
            dayKeyLocal: dayKeyInZone(now, null),
            timeZone: null,
            responseDate: null,
            promise,
            midnightTimer: armMidnightTimer(cacheKey, now, null),
        };
        bundleCache.set(cacheKey, entry);
        // Отменённый или упавший запрос НЕ переиспользуется.
        promise.catch(() => dropEntry(cacheKey));
        if (bundleCache.size > 16) {
            dropEntry(bundleCache.keys().next().value as string);
        }
    }

    const raw = await entry.promise;
    const conditions = normalizeConditions(raw, lat, lon, day);
    const retryAfterS = num(obj(raw).retryAfterS);
    if (retryAfterS !== null) {
        conditions.retryAfterS = retryAfterS;
    }
    return conditions;
}

/**
 * Таймер до полуночи В МЕСТЕ: выбрасывает запись И будит панель
 * (перерисовка + перезапрос), иначе «сегодня» осталось бы вчерашним.
 */
function armMidnightTimer(cacheKey: string, now: number, timeZone: string | null): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
        dropEntry(cacheKey);
        notifyInvalidated();
    }, msUntilMidnightInZone(now, timeZone));
    (timer as unknown as { unref?: () => void }).unref?.();
    return timer;
}

/**
 * Полигоны зон в видимом bbox. Никогда не путает «зон нет» и «не смогли спросить»:
 * возвращает state = ok | zoom_in | unavailable. Бросает только на abort.
 */
export async function getZones(bbox: BBox, options: RequestOptions = {}): Promise<ZonesResult> {
    if (isMockMode()) {
        return mockZones(bbox);
    }
    const url = new URL(ZONES_PATH, getBaseUrl());
    url.searchParams.set(
        'bbox',
        [bbox.west, bbox.south, bbox.east, bbox.north].map(v => v.toFixed(4)).join(','),
    );
    if (typeof options.zoom === 'number' && Number.isFinite(options.zoom)) {
        url.searchParams.set('zoom', String(Math.round(options.zoom)));
    }
    if (options.locale) {
        url.searchParams.set('lang', options.locale);
    }

    const waitS = backoffLeftS(ZONES_PATH);
    if (waitS > 0) {
        return emptyZones('unavailable', 'rate_limited', waitS);
    }

    let result: HttpResult;
    try {
        result = await requestJson(url.toString(), options);
    } catch (e) {
        // Отмена пользователем — не состояние UI, пробрасываем наверх.
        if (isAbortError(e)) {
            throw e;
        }
        // Таймаут — это «недоступно», а не «зон нет».
        return emptyZones('unavailable', isTimeoutError(e) ? 'timeout' : 'network_error');
    }

    const body = obj(result.body);
    const bodyError = str(body.error);

    if (result.status === 413 || bodyError === 'bbox_too_large') {
        return emptyZones('zoom_in', bodyError ?? 'bbox_too_large');
    }
    if (result.status === 429 || result.status === 503) {
        // Бэкофф: не долбим сервер до истечения Retry-After.
        rememberBackoff(ZONES_PATH, result.retryAfterS, Date.now());
        const code = bodyError ?? (result.status === 429 ? 'rate_limited' : 'zones_unavailable');
        return emptyZones('unavailable', code, result.retryAfterS);
    }
    if (result.status >= 400 || result.body === null) {
        return emptyZones('unavailable', bodyError ?? `http_${result.status}`, result.retryAfterS);
    }
    return normalizeZones(result.body);
}

// ── Мок-данные (?mock=1) ──────────────────────────────────────────────────────

/** Детерминированный псевдослучайный [0,1) по координате — мок не «мигает». */
function seeded(lat: number, lon: number, salt: number): number {
    const x = Math.sin(lat * 12.9898 + lon * 78.233 + salt * 37.719) * 43758.5453;
    return x - Math.floor(x);
}

function mockConditions(lat: number, lon: number, day: DayKey, locale?: string): Conditions {
    const salt = DAY_INDEX[day] + 1;
    const visibilityM = round(2 + seeded(lat, lon, salt) * 16, 1);
    const waveM = round(0.1 + seeded(lat, lon, salt + 10) * 2.2, 1);
    const windMs = round(1 + seeded(lat, lon, salt + 20) * 11, 1);
    const level: SafetyLevel =
        waveM > 1.5 || windMs > 10 ? 'unsafe' : waveM > 1 || windMs > 7 ? 'poor' : waveM > 0.6 ? 'fair' : 'good';
    const ru: Record<SafetyLevel, string> = {
        good: 'Спокойно: волна и ветер в норме для охоты с берега.',
        fair: 'Терпимо: волна поднимается, заходите с лодки или ищите подветренный берег.',
        poor: 'Плохо: заметная волна и ветер, видимость будет падать.',
        unsafe: 'Опасно: шторм, в воду не идти.',
        unknown: 'Нет данных.',
    };
    const en: Record<SafetyLevel, string> = {
        good: 'Calm: wave and wind are fine for a shore dive.',
        fair: 'Manageable: wave is building, go by boat or find a lee shore.',
        poor: 'Rough: noticeable wave and wind, visibility will drop.',
        unsafe: 'Dangerous: storm conditions, stay out of the water.',
        unknown: 'No data.',
    };
    const isRu = (locale ?? '').toLowerCase().startsWith('ru');
    const texts = isRu ? ru : en;
    const date = new Date();
    date.setDate(date.getDate() + DAY_INDEX[day]);
    const lang = isRu ? 'ru' : 'en';
    const { tide, text: tideText } = normalizeTide({
        rangeM: 1.8,
        kind: 'spring',
        events: [
            { time: '06:10', type: 'high', heightM: 3.1 },
            { time: '12:35', type: 'low', heightM: 1.3 },
        ],
    });

    return {
        lat,
        lon,
        day,
        dateISO: date.toISOString().slice(0, 10),
        visibilityM,
        visibilityLabel: isRu
            ? visibilityM > 12
                ? 'отличная'
                : visibilityM > 6
                  ? 'рабочая'
                  : 'мутно'
            : visibilityM > 12
              ? 'excellent'
              : visibilityM > 6
                ? 'workable'
                : 'murky',
        waveM,
        wavePeriodS: round(4 + seeded(lat, lon, salt + 30) * 6, 1),
        windMs,
        windKts: round(windMs * KTS_PER_MS, 1),
        windDirDeg: Math.round(seeded(lat, lon, salt + 40) * 360),
        waterTempC: round(14 + seeded(lat, lon, salt + 50) * 12, 1),
        tide,
        tideText,
        safety: { level, text: texts[level] },
        city: { slug: 'sesimbra', name: 'Sesimbra', cc: 'PT', distanceKm: round(seeded(lat, lon, 60) * 9, 1) },
        ctaUrl: `https://spearo.app/${lang}/sesimbra?utm_source=windy&utm_medium=plugin&utm_campaign=windy-plugin`,
        noTake: { inside: false, name: null, actUrl: null },
        attribution: { provider: 'spearo.app', url: 'https://spearo.app' },
        stale: false,
        staleReason: null,
        updatedISO: new Date().toISOString(),
        source: 'mock',
        ok: true,
        error: null,
        retryAfterS: null,
    };
}

function mockZones(bbox: BBox): ZonesResult {
    const latSpan = Math.max(bbox.north - bbox.south, 0.01);
    const lonSpan = Math.max(bbox.east - bbox.west, 0.01);
    // Слишком большой bbox мокаем как отказ сервера — чтобы проверить подсказку в UI.
    if (latSpan > 20 || lonSpan > 20) {
        return emptyZones('zoom_in', 'bbox_too_large');
    }
    const zones: Zone[] = [0, 1].map(index => {
        const cLat = bbox.south + latSpan * (0.3 + index * 0.35);
        const cLon = bbox.west + lonSpan * (0.3 + index * 0.3);
        const dLat = latSpan * 0.08;
        const dLon = lonSpan * 0.08;
        return {
            id: `mock-zone-${index}`,
            name: index === 0 ? 'Reserva Marinha (mock)' : 'Seasonal closure (mock)',
            status: index === 0 ? ('banned' as ZoneStatus) : ('dormant' as ZoneStatus),
            statusWhenInForce: index === 0 ? null : ('banned' as ZoneStatus),
            kind: index === 0 ? 'reserve' : 'seasonal',
            actUrl: 'https://spearo.app/en/zones',
            actLabel: index === 0 ? 'Decreto 10/2020' : 'Portaria 55/2021',
            sourceUrl: 'https://spearo.app/en/zones',
            tier: index === 0 ? 'a' : 'b',
            approx: index === 1,
            temporal:
                index === 1
                    ? {
                          state: 'dormant',
                          season: [{ from: '05-01', to: '08-31' }],
                          seasonRaw: null,
                          hours: 'sunrise — sunset',
                          timeZone: 'Europe/Lisbon',
                          inForce: '2027-05-01',
                          expires: null,
                      }
                    : null,
            source: 'mock',
            geometry: {
                type: 'Polygon',
                coordinates: [
                    [
                        [cLon - dLon, cLat - dLat],
                        [cLon + dLon, cLat - dLat],
                        [cLon + dLon, cLat + dLat],
                        [cLon - dLon, cLat + dLat],
                        [cLon - dLon, cLat - dLat],
                    ],
                ],
            },
        };
    });
    return {
        state: 'ok',
        featureCollection: toFeatureCollection(zones),
        zones,
        truncated: false,
        bboxTooLarge: false,
        retryAfterS: null,
        error: null,
        source: 'mock',
    };
}
