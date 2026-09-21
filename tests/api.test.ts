// Юнит-тесты слоя данных под контракт docs/INVARIANTS.md.
// Запуск: npm test (node --test, strip-types).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CONDITIONS_PATH,
    ZONES_PATH,
    getConditions,
    getZones,
    normalizeConditions,
    normalizeZones,
    setMockMode,
    setBaseUrl,
    getBaseUrl,
    toSafetyLevel,
} from '../src/api.ts';

const CONTRACT_RESPONSE = {
    ok: true,
    point: { lat: 38.44, lon: -9.1 },
    nearest: {
        slug: 'sesimbra',
        name: 'Sesimbra',
        cc: 'PT',
        distanceKm: 3.2,
        url: 'https://spearo.app/ru/sesimbra?utm_source=windy&utm_medium=plugin&utm_campaign=windy-plugin',
    },
    days: [
        { date: '2026-09-20', vizM: 11, vizBand: 'рабочая', waveM: 0.4, windKts: 9.7, waterTempC: 19, safety: { verdict: 'good', label: 'Спокойно' } },
        { date: '2026-09-21', vizM: 6, waveM: 1.2, windMs: 8, safety: { verdict: 'poor', label: 'Плохо' }, tide: { rangeM: 1.2, kind: 'neap', events: [{ time: '14:20', type: 'low', heightM: 0.8 }] } },
        { date: '2026-09-22', vizM: null, waveM: null, windMs: null, safety: { verdict: 'кто-то ещё', label: '' } },
    ],
    zones: { insideNoTake: true, nearestZoneName: 'Reserva', actUrl: 'https://example.org/act' },
    attribution: { provider: 'spearo.app', url: 'https://spearo.app' },
};

test('пути эндпоинтов соответствуют контракту', () => {
    assert.equal(CONDITIONS_PATH, '/api/plugin/windy/conditions');
    assert.equal(ZONES_PATH, '/api/plugin/windy/zones');
});

test('normalizeConditions: day0 — узлы пересчитаны в м/с, nearest → city + ctaUrl', () => {
    const c = normalizeConditions(CONTRACT_RESPONSE, 38.44, -9.1, 'today');
    assert.equal(c.ok, true);
    assert.equal(c.dateISO, '2026-09-20');
    assert.equal(c.visibilityM, 11);
    assert.equal(c.visibilityLabel, 'рабочая');
    assert.equal(c.waveM, 0.4);
    assert.equal(c.windKts, 9.7);
    assert.equal(c.windMs, 5);
    assert.equal(c.waterTempC, 19);
    assert.equal(c.safety.level, 'good');
    assert.equal(c.safety.text, 'Спокойно');
    assert.equal(c.city?.slug, 'sesimbra');
    assert.equal(c.city?.cc, 'PT');
    assert.equal(c.city?.distanceKm, 3.2);
    assert.match(c.ctaUrl ?? '', /utm_source=windy/);
    assert.equal(c.noTake?.inside, true);
    assert.equal(c.noTake?.name, 'Reserva');
    assert.equal(c.attribution?.provider, 'spearo.app');
});

test('normalizeConditions: day1/day2 — м/с → узлы, tide, неизвестный verdict → unknown, null → null', () => {
    const d1 = normalizeConditions(CONTRACT_RESPONSE, 38.44, -9.1, 'tomorrow');
    assert.equal(d1.dateISO, '2026-09-21');
    assert.equal(d1.windMs, 8);
    assert.equal(d1.windKts, 15.6);
    assert.equal(d1.tide?.rangeM, 1.2);
    assert.equal(d1.tide?.events[0]?.time, '14:20');
    assert.equal(d1.tideText, '↓ 14:20 0.8 m · Δ 1.2 m · neap');

    const d2 = normalizeConditions(CONTRACT_RESPONSE, 38.44, -9.1, 'day3');
    assert.equal(d2.safety.level, 'unknown');
    assert.equal(d2.visibilityM, null);
    assert.equal(d2.waveM, null);
    assert.equal(d2.windMs, null);
});

test('normalizeConditions: ok:false → ok:false без падения', () => {
    const c = normalizeConditions({ ok: false, error: 'upstream_down' }, 1, 2, 'today');
    assert.equal(c.ok, false);
    assert.equal(c.visibilityM, null);
    assert.equal(c.safety.level, 'unknown');
});

test('normalizeConditions: терпит альтернативные имена полей', () => {
    const c = normalizeConditions({ data: { days: [{ visibility_m: '7', wind_ms: 3 }] } }, 0, 0, 'today');
    assert.equal(c.visibilityM, 7);
    assert.equal(c.windMs, 3);
    assert.equal(c.city, null);
    assert.equal(c.ctaUrl, null);
});

test('toSafetyLevel маппит синонимы и мусор', () => {
    assert.equal(toSafetyLevel('no-go'), 'unsafe');
    assert.equal(toSafetyLevel('CAUTION'), 'fair');
    assert.equal(toSafetyLevel('whatever'), 'unknown');
    assert.equal(toSafetyLevel(undefined), 'unknown');
});

test('normalizeZones: FeatureCollection → featureCollection + zones, не-полигоны отброшены', () => {
    const result = normalizeZones({
        type: 'FeatureCollection',
        features: [
            {
                id: 'a',
                properties: { name: 'A', status: 'no-take', actTitle: 'Decreto 5/2020', actUrl: 'https://x/act', source: 'ICNF' },
                geometry: { type: 'Polygon', coordinates: [] },
            },
            { id: 'b', properties: { name: 'B' }, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
    });
    assert.equal(result.zones.length, 1);
    assert.equal(result.featureCollection.type, 'FeatureCollection');
    assert.equal(result.featureCollection.features.length, 1);
    assert.equal(result.featureCollection.features[0].properties.actLabel, 'Decreto 5/2020');
    assert.equal(result.zones[0].status, 'banned'); // status разбирается отдельно от kind
    assert.equal(result.zones[0].source, 'ICNF');
    assert.equal(result.bboxTooLarge, false);
    assert.equal(result.truncated, false);
});

test('normalizeZones: bbox_too_large → пустой результат с флагом', () => {
    const result = normalizeZones({ ok: false, error: 'bbox_too_large' });
    assert.equal(result.bboxTooLarge, true);
    assert.equal(result.error, 'bbox_too_large');
    assert.equal(result.featureCollection.features.length, 0);
});

test('normalizeZones: кап 400 features → truncated', () => {
    const features = Array.from({ length: 400 }, (_, i) => ({
        id: `z${i}`,
        properties: { name: `Z${i}` },
        geometry: { type: 'Polygon', coordinates: [] },
    }));
    assert.equal(normalizeZones({ type: 'FeatureCollection', features }).truncated, true);
});

test('мок-режим отдаёт правдоподобные данные без сети', async () => {
    setMockMode(true);
    const c = await getConditions(38.44, -9.1, 'today', { locale: 'ru' });
    assert.equal(c.source, 'mock');
    assert.ok(c.visibilityM !== null && c.visibilityM > 0);
    assert.ok(c.windKts !== null && c.windMs !== null);
    assert.match(c.ctaUrl ?? '', /^https:\/\/spearo\.app\/ru\/sesimbra\?utm_source=windy/);
    const again = await getConditions(38.44, -9.1, 'today', { locale: 'ru' });
    assert.equal(again.visibilityM, c.visibilityM); // детерминированность

    const zones = await getZones({ south: 38.3, west: -9.3, north: 38.6, east: -8.9 });
    assert.equal(zones.zones.length, 2);
    assert.equal(zones.featureCollection.features[0].geometry.type, 'Polygon');

    const huge = await getZones({ south: -40, west: -60, north: 40, east: 60 });
    assert.equal(huge.bboxTooLarge, true);
    setMockMode(null);
});

test('базовый URL: константа в проде, настраивается в dev-сборке', () => {
    assert.equal(getBaseUrl(), 'https://spearo.app');

    const key = '__SPEARO_DEV_BUILD__';
    (globalThis as Record<string, unknown>)[key] = true;
    try {
        setBaseUrl('https://plugin-dev.example.com/');
        assert.equal(getBaseUrl(), 'https://plugin-dev.example.com');
        setBaseUrl('https://spearo.app');
    } finally {
        delete (globalThis as Record<string, unknown>)[key];
    }
    assert.equal(getBaseUrl(), 'https://spearo.app');
});
