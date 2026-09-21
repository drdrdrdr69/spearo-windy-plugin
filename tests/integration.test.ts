// Интеграционные тесты слоя данных: fetch подменён на HTTP-уровне.
// Проверяем три состояния зон, TTL-кеш, выбор дня по ДАТЕ и stale.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    CONDITIONS_TTL_MS,
    clearConditionsCache,
    getConditions,
    getZones,
    setMockMode,
} from '../src/api.ts';

const BBOX = { south: 38.3, west: -9.3, north: 38.6, east: -8.9 };

interface Call {
    url: string;
}

let calls: Call[] = [];
const realFetch = globalThis.fetch;
const realNow = Date.now;

function httpResponse(status: number, body: unknown, headers: Record<string, string> = {}): unknown {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
        json: async () => {
            if (body === undefined) throw new Error('no body');
            return body;
        },
    };
}

/** Подменить fetch одним ответом (или функцией url → ответ). */
function mockFetch(reply: unknown | ((url: string) => unknown)): void {
    (globalThis as Record<string, unknown>).fetch = async (input: unknown) => {
        const url = String(input);
        calls.push({ url });
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

// ── 1. Три состояния зон ──────────────────────────────────────────────────────

test('зоны: 413 bbox_too_large → zoom_in (а не «зон нет»)', async () => {
    mockFetch(httpResponse(413, { ok: false, error: 'bbox_too_large' }));
    const result = await getZones(BBOX);
    assert.equal(result.state, 'zoom_in');
    assert.equal(result.bboxTooLarge, true);
    assert.equal(result.zones.length, 0);
});

test('зоны: 200 + {ok:false,bbox_too_large} → zoom_in', async () => {
    mockFetch(httpResponse(200, { ok: false, error: 'bbox_too_large' }));
    assert.equal((await getZones(BBOX)).state, 'zoom_in');
});

test('зоны: 429 c Retry-After → unavailable + retryAfterS', async () => {
    mockFetch(httpResponse(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '30' }));
    const result = await getZones(BBOX);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.retryAfterS, 30);
    assert.equal(result.error, 'rate_limited');
});

test('зоны: 503 zones_unavailable → unavailable', async () => {
    mockFetch(httpResponse(503, { ok: false, error: 'zones_unavailable' }));
    const result = await getZones(BBOX);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.error, 'zones_unavailable');
});

test('зоны: сетевая ошибка → unavailable, НЕ «зон нет»', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    const result = await getZones(BBOX);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.error, 'network_error');
    assert.equal(result.zones.length, 0);
});

test('зоны: 200 FeatureCollection → ok, zoom уходит в запрос', async () => {
    mockFetch(
        httpResponse(200, {
            type: 'FeatureCollection',
            features: [
                {
                    id: 'z1',
                    properties: {
                        name: 'Reserva',
                        status: 'conditional',
                        act: 'Portaria 55/2021',
                        sourceUrl: 'https://icnf.example/zone',
                        tier: 'a',
                        approx: true,
                        temporal: { season: '01.05 — 31.08', hours: '06:00 — 20:00', expires: '2027-01-01' },
                        statusWhenInForce: 'banned',
                    },
                    geometry: { type: 'Polygon', coordinates: [] },
                },
            ],
        }),
    );
    const result = await getZones(BBOX, { zoom: 9.6, locale: 'ru' });
    assert.equal(result.state, 'ok');
    assert.equal(result.zones.length, 1);
    const zone = result.zones[0];
    assert.equal(zone.status, 'conditional');
    assert.equal(zone.actLabel, 'Portaria 55/2021'); // скалярный act
    assert.equal(zone.actUrl, 'https://icnf.example/zone'); // фолбэк на sourceUrl
    assert.equal(zone.tier, 'a');
    assert.equal(zone.approx, true);
    assert.deepEqual(zone.temporal?.season, []); // строковый сезон уезжает в seasonRaw
    assert.equal(zone.temporal?.seasonRaw, '01.05 — 31.08');
    assert.equal(zone.statusWhenInForce, 'banned');
    assert.equal(result.featureCollection.features[0].properties.temporal?.hours, '06:00 — 20:00');
    assert.match(calls[0].url, /zoom=10/);
    assert.match(calls[0].url, /bbox=-9\.3000%2C38\.3000%2C-8\.9000%2C38\.6000|bbox=-9\.3000,38\.3000,-8\.9000,38\.6000/);
});

// ── 2. Кеш с TTL и выбор дня по дате ──────────────────────────────────────────

function conditionsBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ok: true,
        point: { lat: 38.44, lon: -9.1 },
        today: '2026-09-20',
        nearest: { slug: 'sesimbra', name: 'Sesimbra', url: 'https://spearo.app/ru/sesimbra' },
        days: [
            { date: '2026-09-20', vizM: 11, waveM: 0.4, windMs: 4, safety: { verdict: 'good', label: 'ок' } },
            // Порядок НАМЕРЕННО перепутан: выбор должен идти по дате, а не по индексу.
            { date: '2026-09-22', vizM: 3, waveM: 2.2, windMs: 12, safety: { verdict: 'unsafe', label: 'шторм' } },
            {
                date: '2026-09-21',
                vizM: 7,
                waveM: 1,
                windMs: 6,
                safety: { verdict: 'fair', label: 'терпимо' },
                tide: { rangeM: 1.8, kind: 'spring', events: [{ time: '06:10', type: 'high', heightM: 3.1 }] },
            },
        ],
        attribution: { provider: 'spearo.app', url: 'https://spearo.app' },
        ...extra,
    };
}

test('conditions: день выбирается по ДАТЕ, а не по индексу массива', async () => {
    mockFetch(httpResponse(200, conditionsBody()));
    const tomorrow = await getConditions(38.44, -9.1, 'tomorrow', { locale: 'ru' });
    assert.equal(tomorrow.dateISO, '2026-09-21');
    assert.equal(tomorrow.visibilityM, 7);
    assert.equal(tomorrow.safety.level, 'fair');
    assert.equal(tomorrow.tideText, '↑ 06:10 3.1 m · Δ 1.8 m · spring');

    const day3 = await getConditions(38.44, -9.1, 'day3', { locale: 'ru' });
    assert.equal(day3.dateISO, '2026-09-22');
    assert.equal(day3.safety.level, 'unsafe');
});

test('conditions: нужной даты нет → пустой день, а не чужой', async () => {
    mockFetch(httpResponse(200, { ...conditionsBody(), days: [conditionsBody().days![0]] } as never));
    const tomorrow = await getConditions(38.44, -9.1, 'tomorrow');
    assert.equal(tomorrow.dateISO, null);
    assert.equal(tomorrow.visibilityM, null);
    assert.equal(tomorrow.ok, true);
});

test('conditions: кеш TTL 15 мин — один запрос на точку, после TTL новый', async () => {
    mockFetch(httpResponse(200, conditionsBody()));
    let now = 1_000_000;
    Date.now = () => now;

    await getConditions(38.44, -9.1, 'today', { locale: 'ru' });
    await getConditions(38.44, -9.1, 'tomorrow', { locale: 'ru' });
    assert.equal(calls.length, 1, 'переключение дня не должно ходить в сеть');

    now += CONDITIONS_TTL_MS - 1000;
    await getConditions(38.44, -9.1, 'today', { locale: 'ru' });
    assert.equal(calls.length, 1, 'внутри TTL берём из кеша');

    now += 2000;
    await getConditions(38.44, -9.1, 'today', { locale: 'ru' });
    assert.equal(calls.length, 2, 'после TTL — новый запрос');

    await getConditions(38.44, -9.1, 'today', { locale: 'ru', force: true });
    assert.equal(calls.length, 3, 'force обходит кеш');
});

test('conditions: stale/staleReason доходят до UI', async () => {
    mockFetch(httpResponse(200, conditionsBody({ stale: true, staleReason: 'кеш 6 ч' })));
    const c = await getConditions(38.44, -9.1, 'today');
    assert.equal(c.stale, true);
    assert.equal(c.staleReason, 'кеш 6 ч');
});

test('conditions: 429/503 → ok:false с кодом, сеть падает → исключение', async () => {
    mockFetch(httpResponse(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '10' }));
    const limited = await getConditions(38.44, -9.1, 'today');
    assert.equal(limited.ok, false);
    assert.equal(limited.error, 'rate_limited');

    clearConditionsCache();
    mockFetch(httpResponse(503, null));
    const down = await getConditions(38.44, -9.1, 'today');
    assert.equal(down.ok, false);
    assert.equal(down.error, 'http_503');

    clearConditionsCache();
    mockFetch(new TypeError('Failed to fetch'));
    await assert.rejects(() => getConditions(38.44, -9.1, 'today'));
});
