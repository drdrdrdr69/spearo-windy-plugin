// Безопасность: база API не подменяется в прод-сборке, URL из данных проверяются по схеме.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getBaseUrl, setBaseUrl, normalizeConditions, normalizeZones } from '../src/api.ts';

/** Подсунуть window.location.search, как если бы Windy открыли с ?spearoBase=… */
function withQuery(search: string, fn: () => void): void {
    const prev = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = { location: { search, hash: '' } };
    try {
        fn();
    } finally {
        if (prev === undefined) {
            delete (globalThis as Record<string, unknown>).window;
        } else {
            (globalThis as Record<string, unknown>).window = prev;
        }
    }
}

function withDevBuild(value: boolean | undefined, fn: () => void): void {
    const key = '__SPEARO_DEV_BUILD__';
    const prev = (globalThis as Record<string, unknown>)[key];
    if (value === undefined) {
        delete (globalThis as Record<string, unknown>)[key];
    } else {
        (globalThis as Record<string, unknown>)[key] = value;
    }
    try {
        fn();
    } finally {
        if (prev === undefined) {
            delete (globalThis as Record<string, unknown>)[key];
        } else {
            (globalThis as Record<string, unknown>)[key] = prev;
        }
    }
}

test('прод-сборка: ?spearoBase= игнорируется, база — константа', () => {
    withDevBuild(undefined, () => {
        withQuery('?spearoBase=https://evil.example', () => {
            assert.equal(getBaseUrl(), 'https://spearo.app');
        });
        // и программная подмена в прод-сборке тоже не проходит
        setBaseUrl('https://evil.example');
        assert.equal(getBaseUrl(), 'https://spearo.app');
    });
});

test('dev-сборка: ?spearoBase= работает, но только http(s)', () => {
    withDevBuild(true, () => {
        withQuery('?spearoBase=https://plugin-dev.example.com', () => {
            assert.equal(getBaseUrl(), 'https://plugin-dev.example.com');
        });
        withQuery('?spearoBase=javascript:alert(1)', () => {
            assert.equal(getBaseUrl(), 'https://spearo.app');
        });
        setBaseUrl('https://spearo.app');
    });
});

test('nearest.url: только https на spearo.app, иначе null', () => {
    const evil = normalizeConditions(
        { days: [{}], nearest: { slug: 'x', name: 'X', url: 'javascript:alert(1)' } },
        0,
        0,
        'today',
    );
    assert.equal(evil.ctaUrl, null);

    const foreign = normalizeConditions(
        { days: [{}], nearest: { slug: 'x', name: 'X', url: 'https://evil.example/x' } },
        0,
        0,
        'today',
    );
    assert.equal(foreign.ctaUrl, null);

    const good = normalizeConditions(
        { days: [{}], nearest: { slug: 'x', name: 'X', url: 'https://spearo.app/en/x?utm_source=windy' } },
        0,
        0,
        'today',
    );
    assert.equal(good.ctaUrl, 'https://spearo.app/en/x?utm_source=windy');
});

test('attribution.url и zones.actUrl чистятся по схеме', () => {
    const c = normalizeConditions(
        {
            days: [{}],
            attribution: { provider: 'spearo.app', url: 'javascript:alert(1)' },
            zones: { insideNoTake: true, actUrl: 'http://gov.example/act' },
        },
        0,
        0,
        'today',
    );
    assert.equal(c.attribution?.url, null);
    assert.equal(c.noTake?.actUrl, 'http://gov.example/act'); // http для госсайтов допустим
});

test('actUrl зоны: javascript:/data: выбрасываются', () => {
    const result = normalizeZones({
        type: 'FeatureCollection',
        features: [
            { id: 'a', properties: { name: 'A', actUrl: 'javascript:alert(1)' }, geometry: { type: 'Polygon', coordinates: [] } },
            { id: 'b', properties: { name: 'B', actUrl: 'data:text/html,x' }, geometry: { type: 'Polygon', coordinates: [] } },
            { id: 'c', properties: { name: 'C', actUrl: 'https://gov.example/act' }, geometry: { type: 'Polygon', coordinates: [] } },
        ],
    });
    assert.equal(result.zones[0].actUrl, null);
    assert.equal(result.zones[1].actUrl, null);
    assert.equal(result.zones[2].actUrl, 'https://gov.example/act');
    assert.equal(result.featureCollection.features[0].properties.actUrl, null);
});
