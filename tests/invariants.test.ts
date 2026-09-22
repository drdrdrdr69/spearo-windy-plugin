// Гейт по docs/INVARIANTS.md: статусы зон, общий бандл, полночь, кэш/бэкофф, таймаут.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    CONDITIONS_TTL_MS,
    TimeoutError,
    __fireMidnightForTests,
    activeMidnightTimers,
    dayKeyInZone,
    msUntilMidnightInZone,
    backoffLeftS,
    clearConditionsCache,
    getConditions,
    getZones,
    normalizeZones,
    onConditionsInvalidated,
    setMockMode,
    toZoneStatus,
} from '../src/api.ts';
import { zonePopupModel, zoneStyle } from '../src/zonesLayer.ts';
import { strings } from '../src/i18n.ts';
import { corsHeaders, corsResponse } from './corsFetch.ts';

const BBOX = { south: 24.4, west: -81.95, north: 24.6, east: -81.7 };
const realFetch = globalThis.fetch;
const realNow = Date.now;
let calls: string[] = [];

/**
 * Ответ идёт через симуляцию CORS-фильтра: видны только safelisted-заголовки и то,
 * что сервер явно выставил в Access-Control-Expose-Headers.
 */
function httpResponse(status: number, body: unknown, headers: Record<string, string> = {}): unknown {
    return corsResponse({ status, body, headers: corsHeaders(headers) });
}

/** Тот же ответ, но БЕЗ Access-Control-Expose-Headers — Retry-After браузеру не виден. */
function httpResponseNoExpose(status: number, body: unknown, headers: Record<string, string> = {}): unknown {
    return corsResponse({ status, body, headers: { 'Access-Control-Allow-Origin': '*', ...headers } });
}

function mockFetch(reply: unknown | ((url: string) => unknown)): void {
    (globalThis as Record<string, unknown>).fetch = async (input: unknown) => {
        const url = String(input);
        calls.push(url);
        const value = typeof reply === 'function' ? (reply as (u: string) => unknown)(url) : reply;
        if (value instanceof Error) throw value;
        return value;
    };
}

beforeEach(() => {
    calls = [];
    setMockMode(false);
    clearConditionsCache();
});

afterEach(() => {
    (globalThis as Record<string, unknown>).fetch = realFetch;
    Date.now = realNow;
    setMockMode(null);
    clearConditionsCache();
});

// ── 1. Статусы зон: Western Dry Rocks, сентябрь ───────────────────────────────

const WESTERN_DRY_ROCKS = {
    type: 'FeatureCollection',
    ok: true,
    features: [
        {
            id: 'us-fl-western-dry-rocks-seasonal-closure',
            properties: {
                id: 'us-fl-western-dry-rocks-seasonal-closure',
                name: 'Western Dry Rocks seasonal closure',
                status: 'dormant',
                statusWhenInForce: 'banned',
                act: 'FAC 68B-6.004',
                sourceUrl: 'https://myfwc.example/68b-6.004',
                tier: 'a',
                cc: 'us',
                temporal: {
                    state: 'dormant',
                    season: [{ from: '04-01', to: '07-31' }],
                    hours: null,
                    timeZone: 'America/New_York',
                    inForce: '2027-04-01T00:00:00-04:00',
                    expires: null,
                },
            },
            geometry: { type: 'Polygon', coordinates: [] },
        },
    ],
};

test('[1] Western Dry Rocks в сентябре: dormant + серый пунктир + даты запрета', async () => {
    mockFetch(httpResponse(200, WESTERN_DRY_ROCKS));
    const result = await getZones(BBOX);
    assert.equal(result.state, 'ok');
    const zone = result.zones[0];
    assert.equal(zone.status, 'dormant');
    assert.equal(zone.statusWhenInForce, 'banned');
    assert.deepEqual(zone.temporal?.season, [{ from: '04-01', to: '07-31' }]);
    assert.equal(zone.temporal?.timeZone, 'America/New_York');
    assert.equal(zone.temporal?.inForce, '2027-04-01T00:00:00-04:00');

    const style = zoneStyle(result.featureCollection.features[0].properties);
    assert.equal(style.color, '#9aa0a6', 'dormant рисуется серым');
    assert.equal(style.dashArray, '6 4', 'dormant рисуется пунктиром');

    const t = strings('ru');
    const model = zonePopupModel(
        {
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
        t.zone,
    );
    assert.ok(
        model.lines.some(l => l === 'вне сезона: запрет с 01.04 по 31.07'),
        `нет строки про сезон: ${model.lines.join(' | ')}`,
    );
    assert.ok(model.lines.some(l => l.includes('в сезон: Запрет')), 'потеряно слово корпуса');
    assert.ok(
        model.lines.some(l => l === 'запрет снова с 01.04.2027'),
        `нет даты возобновления: ${model.lines.join(' | ')}`,
    );
});

test('[1] неизвестный статус → conditional (никогда open)', () => {
    assert.equal(toZoneStatus('whatever'), 'conditional');
    assert.equal(toZoneStatus(undefined), 'conditional');
    assert.equal(toZoneStatus(''), 'conditional');
    assert.equal(toZoneStatus('open'), 'open');
    assert.equal(toZoneStatus('dormant'), 'dormant');
    assert.equal(zoneStyle({ status: undefined }).color, '#ffd60a');
});

test('[1] conditional: сырой текст оговорки доходит до popup', () => {
    const result = normalizeZones({
        type: 'FeatureCollection',
        features: [
            {
                id: 'hr-aqua-1',
                properties: {
                    name: 'Aquaculture',
                    status: 'conditional',
                    temporal: { state: 'unknown', seasonRaw: 'permit_expiry 2027-04-01' },
                },
                geometry: { type: 'Polygon', coordinates: [] },
            },
        ],
    });
    const model = zonePopupModel(
        { name: 'Aquaculture', status: result.zones[0].status, temporal: result.zones[0].temporal },
        strings('ru').zone,
    );
    assert.ok(model.lines.includes('permit_expiry 2027-04-01'));
});

// ── 2. Смена дня не рвёт общий бандл ──────────────────────────────────────────

const BUNDLE = {
    ok: true,
    point: { lat: 24.5, lon: -81.8 },
    days: [
        { date: '2026-09-20', vizM: 9, safety: { verdict: 'green', label: 'ок' } },
        { date: '2026-09-21', vizM: 5, safety: { verdict: 'yellow', label: 'на грани' } },
    ],
    stale: false,
};

test('[2] смена дня ждёт ТОТ ЖЕ промис и не отменяет запрос', async () => {
    let resolveFetch: ((v: unknown) => void) | null = null;
    (globalThis as Record<string, unknown>).fetch = async (input: unknown, init?: { signal?: AbortSignal }) => {
        calls.push(String(input));
        return new Promise((resolve, reject) => {
            resolveFetch = resolve;
            init?.signal?.addEventListener('abort', () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
            });
        });
    };

    // Панель держит ОДИН AbortController на точку: смена дня его не трогает.
    const abort = new AbortController();
    const today = getConditions(24.5, -81.8, 0, { locale: 'ru', signal: abort.signal });
    const tomorrow = getConditions(24.5, -81.8, 1, { locale: 'ru', signal: abort.signal });
    resolveFetch!(httpResponse(200, BUNDLE));

    const [a, b] = await Promise.all([today, tomorrow]);
    assert.equal(calls.length, 1, 'на два дня — один сетевой запрос');
    assert.equal(a.dateISO, '2026-09-20');
    assert.equal(b.dateISO, '2026-09-21');
});

test('[2] отменённый бандл не переиспользуется', async () => {
    (globalThis as Record<string, unknown>).fetch = async (input: unknown, init?: { signal?: AbortSignal }) => {
        calls.push(String(input));
        return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
            });
        });
    };
    const abort = new AbortController();
    const pending = getConditions(24.5, -81.8, 0, { signal: abort.signal });
    abort.abort();
    await assert.rejects(() => pending);

    mockFetch(httpResponse(200, BUNDLE));
    const fresh = await getConditions(24.5, -81.8, 0);
    assert.equal(fresh.ok, true);
    assert.equal(calls.length, 2, 'после отмены делается НОВЫЙ запрос');
});

// ── 3. Переход через полночь ──────────────────────────────────────────────────

test('[3] 23:59 → 00:01: бандл считается устаревшим и перезапрашивается', async () => {
    mockFetch(httpResponse(200, BUNDLE));
    const beforeMidnight = new Date(2026, 8, 20, 23, 59, 0).getTime();
    let now = beforeMidnight;
    Date.now = () => now;

    await getConditions(24.5, -81.8, 0);
    await getConditions(24.5, -81.8, 1);
    assert.equal(calls.length, 1);

    now = new Date(2026, 8, 21, 0, 1, 0).getTime(); // TTL ещё не вышел, но день уже другой
    assert.ok(now - beforeMidnight < CONDITIONS_TTL_MS);
    await getConditions(24.5, -81.8, 0);
    assert.equal(calls.length, 2, 'после полуночи бандл перезапрашивается');
});

// ── 4. Кэш только ok && !stale; 429/503 и бэкофф ──────────────────────────────

test('[4] stale-ответ не кэшируется', async () => {
    mockFetch(httpResponse(200, { ...BUNDLE, stale: true, staleReason: 'no-data' }));
    const first = await getConditions(24.5, -81.8, 0);
    assert.equal(first.stale, true);
    await getConditions(24.5, -81.8, 0);
    assert.equal(calls.length, 2, 'stale в кэш не кладётся');
});

test('[4] 429 не кэшируется и уважает Retry-After', async () => {
    mockFetch(httpResponse(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '25' }));
    let now = 5_000_000;
    Date.now = () => now;

    const limited = await getConditions(24.5, -81.8, 0);
    assert.equal(limited.ok, false);
    assert.equal(limited.error, 'rate_limited');
    assert.equal(limited.retryAfterS, 25);

    // Пока бэкофф жив — в сеть не ходим.
    const again = await getConditions(24.5, -81.8, 0);
    assert.equal(calls.length, 1, 'во время бэкоффа сетевых запросов нет');
    assert.equal(again.error, 'rate_limited');
    assert.ok((again.retryAfterS ?? 0) > 0);

    now += 26_000;
    mockFetch(httpResponse(200, BUNDLE));
    const ok = await getConditions(24.5, -81.8, 0);
    assert.equal(ok.ok, true);
    assert.equal(calls.length, 2, 'после Retry-After запрос повторяется');
});

test('[4] зоны: 503 включает бэкофф, следующий вызов не ходит в сеть', async () => {
    mockFetch(httpResponse(503, { ok: false, error: 'zones_unavailable' }, { 'Retry-After': '15' }));
    let now = 9_000_000;
    Date.now = () => now;

    const down = await getZones(BBOX);
    assert.equal(down.state, 'unavailable');
    assert.equal(down.retryAfterS, 15);

    const throttled = await getZones(BBOX);
    assert.equal(calls.length, 1);
    assert.equal(throttled.state, 'unavailable');
    assert.ok(backoffLeftS('/api/plugin/windy/zones', now) > 0);

    now += 16_000;
    assert.equal(backoffLeftS('/api/plugin/windy/zones', now), 0);
});

// ── 5. Таймаут ≠ отмена ───────────────────────────────────────────────────────

test('[5] таймаут зон → unavailable, отмена пользователем → проброс AbortError', async () => {
    (globalThis as Record<string, unknown>).fetch = async () => {
        throw new TimeoutError();
    };
    const timedOut = await getZones(BBOX);
    assert.equal(timedOut.state, 'unavailable');
    assert.equal(timedOut.error, 'timeout');

    (globalThis as Record<string, unknown>).fetch = async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
    };
    await assert.rejects(() => getZones(BBOX), (e: Error) => e.name === 'AbortError');
});

test('[5] реальный таймаут транспорта поднимается как TimeoutError', async () => {
    (globalThis as Record<string, unknown>).fetch = (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
            });
        });
    const result = await getZones(BBOX, { timeoutMs: 20 });
    assert.equal(result.state, 'unavailable');
    assert.equal(result.error, 'timeout');
});

// ── Финальный гейт ────────────────────────────────────────────────────────────

const NZ_BUNDLE = {
    ok: true,
    point: { lat: -36.85, lon: 174.76 },
    tz: 'Pacific/Auckland',
    nearest: { slug: 'auckland', name: 'Auckland', url: 'https://spearo.app/en/auckland' },
    days: [
        { date: '2026-09-21', vizM: 6, safety: { verdict: 'green', label: 'ok' } },
        { date: '2026-09-22', vizM: 4, safety: { verdict: 'yellow', label: 'edge' } },
    ],
    stale: false,
};

test('[F1] полночь считается по таймзоне МЕСТА, а не устройства', async () => {
    mockFetch(httpResponse(200, NZ_BUNDLE));
    // Берём момент за 5 минут до полуночи УСТРОЙСТВА и через 5 минут после неё:
    // день устройства меняется, день Окленда — нет, TTL не при чём (10 минут).
    const d = new Date();
    const deviceMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const before = deviceMidnight - 5 * 60_000;
    const after = deviceMidnight + 5 * 60_000;
    assert.notEqual(dayKeyInZone(before, null), dayKeyInZone(after, null), 'проба должна пересекать полночь устройства');
    assert.equal(
        dayKeyInZone(before, 'Pacific/Auckland'),
        dayKeyInZone(after, 'Pacific/Auckland'),
        'в Окленде это один и тот же день — проба валидна',
    );

    let now = before;
    Date.now = () => now;
    await getConditions(-36.85, 174.76, 0, { locale: 'en' });
    assert.equal(calls.length, 1);

    now = after;
    await getConditions(-36.85, 174.76, 1, { locale: 'en' });
    assert.equal(calls.length, 1, 'полночь устройства не роняет бандл места');

    // А вот полночь САМОГО Окленда роняет.
    now = before + msUntilMidnightInZone(before, 'Pacific/Auckland') + 60_000;
    clearConditionsCache();
    await getConditions(-36.85, 174.76, 0, { locale: 'en' });
    const atNzMidnight = calls.length;
    now += 60_000;
    await getConditions(-36.85, 174.76, 0, { locale: 'en' });
    assert.equal(calls.length, atNzMidnight, 'сразу после полуночи места бандл свежий');
    assert.ok(msUntilMidnightInZone(now, 'Pacific/Auckland') > 20 * 3600_000, 'следующая полночь — почти через сутки');
});

test('[F1] таймер полуночи будит панель (перерисовка + перезапрос)', async () => {
    mockFetch(httpResponse(200, BUNDLE));
    let woken = 0;
    const unsubscribe = onConditionsInvalidated(() => {
        woken++;
    });
    try {
        await getConditions(24.5, -81.8, 0);
        assert.equal(activeMidnightTimers(), 1);
        // Вместо ожидания суток дёргаем тот же путь, что и таймер.
        __fireMidnightForTests();
        assert.equal(woken, 1, 'подписчик разбужен');
        assert.equal(activeMidnightTimers(), 0, 'запись выброшена вместе с таймером');

        await getConditions(24.5, -81.8, 0);
        assert.equal(calls.length, 2, 'после пробуждения данные перезапрашиваются');
    } finally {
        unsubscribe();
    }
});

test('[F2] обрыв при чтении тела: два вызова, один fetch, null не кэшируется', async () => {
    let bodyReads = 0;
    (globalThis as Record<string, unknown>).fetch = async (input: unknown) => {
        calls.push(String(input));
        return corsResponse({
            status: 200,
            headers: corsHeaders(),
            body: () => {
                bodyReads++;
                const err = new Error('aborted');
                err.name = 'AbortError';
                throw err;
            },
        });
    };

    const a = getConditions(24.5, -81.8, 0);
    const b = getConditions(24.5, -81.8, 1);
    await assert.rejects(() => a, (e: Error) => e.name === 'AbortError');
    await assert.rejects(() => b, (e: Error) => e.name === 'AbortError');
    assert.equal(calls.length, 1, 'на два дня — один fetch');
    assert.equal(bodyReads, 1);
    assert.equal(activeMidnightTimers(), 0, 'битая запись не осталась в кэше');

    mockFetch(httpResponse(200, BUNDLE));
    const fresh = await getConditions(24.5, -81.8, 0);
    assert.equal(fresh.ok, true);
    assert.equal(fresh.dateISO, '2026-09-20', 'null-тело не подменило собой честный ответ');
    assert.equal(calls.length, 2);
});

test('[F3] бэкофф душит только сеть: валидный кэш точки A продолжает отвечать', async () => {
    let now = 7_000_000;
    Date.now = () => now;
    mockFetch(httpResponse(200, BUNDLE));
    const a = await getConditions(24.5, -81.8, 0);
    assert.equal(a.ok, true);

    // Точка B ловит 429 и включает бэкофф пути.
    mockFetch(httpResponse(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '40' }));
    const b = await getConditions(10, 10, 0);
    assert.equal(b.error, 'rate_limited');
    assert.equal(b.retryAfterS, 40);

    // A по-прежнему отдаёт свой закэшированный бандл — в том числе «завтра».
    const aTomorrow = await getConditions(24.5, -81.8, 1);
    assert.equal(aTomorrow.ok, true);
    assert.equal(aTomorrow.dateISO, '2026-09-21');
    assert.equal(calls.length, 2, 'кэш обслужен без сети');

    // force НЕ обходит бэкофф.
    const forced = await getConditions(24.5, -81.8, 0, { force: true });
    assert.equal(forced.ok, false);
    assert.equal(forced.error, 'rate_limited');
    assert.equal(calls.length, 2, 'force во время бэкоффа в сеть не идёт');

    now += 41_000;
    mockFetch(httpResponse(200, BUNDLE));
    const after = await getConditions(24.5, -81.8, 0, { force: true });
    assert.equal(after.ok, true);
    assert.equal(calls.length, 3);
});

test('[F5] force заменяет запись вместе с таймером; cleanup не оставляет таймеров', async () => {
    mockFetch(httpResponse(200, BUNDLE));
    await getConditions(24.5, -81.8, 0);
    assert.equal(activeMidnightTimers(), 1);

    await getConditions(24.5, -81.8, 0, { force: true });
    assert.equal(activeMidnightTimers(), 1, 'старый таймер снят, живёт только новый');

    await getConditions(10, 20, 0);
    assert.equal(activeMidnightTimers(), 2);

    clearConditionsCache();
    assert.equal(activeMidnightTimers(), 0, 'после очистки таймеров не остаётся');
});

test('[F6] Retry-After невидим без Access-Control-Expose-Headers → мягкий бэкофф', async () => {
    let now = 11_000_000;
    Date.now = () => now;
    mockFetch(httpResponseNoExpose(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '5' }));
    const limited = await getConditions(24.5, -81.8, 0);
    assert.equal(limited.ok, false);
    assert.equal(limited.retryAfterS, null, 'браузер не отдал скрытый Retry-After');
    // Без заголовка держим свою паузу — сервер всё равно не долбим.
    assert.ok(backoffLeftS('/api/plugin/windy/conditions', now) > 0);
});
