// Жизненный цикл слоя зон: дебаунс, отмена, порядок ответов, уничтожение панели.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createZonesController } from '../src/zonesController.ts';
import type { ZonesResult } from '../src/api.ts';
import type { ZoneLabels } from '../src/zonesLayer.ts';

const labels: ZoneLabels = {
    act: 'act',
    approx: 'approx',
    season: 'season',
    hours: 'hours',
    expires: 'expires',
    source: 'source',
    tier: 'tier',
    status: { banned: 'banned', conditional: 'conditional', open: 'open', unknown: 'unknown' },
};

function okResult(count: number): ZonesResult {
    const features = Array.from({ length: count }, (_, i) => ({
        type: 'Feature' as const,
        id: `z${i}`,
        properties: {
            name: `Z${i}`,
            status: 'banned' as const,
            kind: null,
            actUrl: null,
            actLabel: null,
            sourceUrl: null,
            tier: null,
            approx: false,
            temporal: null,
            source: null,
        },
        geometry: { type: 'Polygon' as const, coordinates: [] },
    }));
    return {
        state: 'ok',
        featureCollection: { type: 'FeatureCollection', features },
        zones: features.map(f => ({
            id: String(f.id),
            name: f.properties.name,
            status: 'banned' as const,
            kind: null,
            actUrl: null,
            actLabel: null,
            sourceUrl: null,
            tier: null,
            approx: false,
            temporal: null,
            source: null,
            geometry: f.geometry,
        })),
        truncated: false,
        bboxTooLarge: false,
        retryAfterS: null,
        error: null,
        source: null,
    };
}

function makeHarness() {
    const listeners: Record<string, (() => void)[]> = {};
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const map = {
        getBounds: () => ({
            getSouth: () => 38.3,
            getWest: () => -9.3,
            getNorth: () => 38.6,
            getEast: () => -8.9,
        }),
        getZoom: () => 9,
        addLayer: (layer: unknown) => added.push(layer),
        on: (event: string, handler: () => void) => {
            (listeners[event] ??= []).push(handler);
        },
        off: (event: string, handler: () => void) => {
            listeners[event] = (listeners[event] ?? []).filter(h => h !== handler);
        },
    };
    const createLayer = () => {
        const layer = { remove: () => removed.push(layer) };
        return layer;
    };
    return { listeners, added, removed, map, createLayer };
}

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('включение тумблера грузит зоны сразу и рисует слой', async () => {
    const h = makeHarness();
    const snapshots: string[] = [];
    const controller = createZonesController({
        map: h.map as never,
        labels,
        debounceMs: 20,
        onChange: s => snapshots.push(s.state),
        fetchZones: async () => okResult(2),
        createLayer: h.createLayer,
    });
    controller.setEnabled(true);
    await tick(30);
    assert.deepEqual(snapshots, ['loading', 'ok']);
    assert.equal(h.added.length, 1);
    assert.equal(controller.getSnapshot().count, 2);
    controller.destroy();
});

test('moveend дебаунсится: серия движений = один запрос', async () => {
    const h = makeHarness();
    let requests = 0;
    const controller = createZonesController({
        map: h.map as never,
        labels,
        debounceMs: 40,
        onChange: () => {},
        fetchZones: async () => {
            requests++;
            return okResult(1);
        },
        createLayer: h.createLayer,
    });
    controller.setEnabled(true);
    await tick(60);
    assert.equal(requests, 1);

    for (let i = 0; i < 5; i++) {
        h.listeners.moveend.forEach(fn => fn());
        await tick(5);
    }
    await tick(80);
    assert.equal(requests, 2, 'пять moveend подряд → один дополнительный запрос');
    controller.destroy();
});

test('нет цикла запросов: без событий повторных обращений не происходит', async () => {
    const h = makeHarness();
    let requests = 0;
    const controller = createZonesController({
        map: h.map as never,
        labels,
        debounceMs: 20,
        onChange: () => {},
        fetchZones: async () => {
            requests++;
            return okResult(0);
        },
        createLayer: h.createLayer,
    });
    controller.setEnabled(true);
    await tick(300);
    assert.equal(requests, 1);
    controller.destroy();
});

test('опоздавший ответ после destroy ничего не рисует', async () => {
    const h = makeHarness();
    let release: (() => void) | null = null;
    const snapshots: string[] = [];
    const controller = createZonesController({
        map: h.map as never,
        labels,
        debounceMs: 0,
        onChange: s => snapshots.push(s.state),
        fetchZones: async () => {
            await new Promise<void>(resolve => {
                release = resolve;
            });
            return okResult(3);
        },
        createLayer: h.createLayer,
    });
    controller.setEnabled(true);
    await tick(10);
    controller.destroy();
    release?.();
    await tick(20);

    assert.equal(h.added.length, 0, 'после закрытия панели полигоны не добавляются');
    assert.equal(h.listeners.moveend.length, 0, 'слушатель moveend снят');
    assert.ok(!snapshots.includes('ok'), 'состояние после destroy не обновляется');
});

test('ответ не по порядку отбрасывается (побеждает последний запрос)', async () => {
    const h = makeHarness();
    const counts: number[] = [];
    let call = 0;
    const controller = createZonesController({
        map: h.map as never,
        labels,
        debounceMs: 0,
        onChange: s => {
            if (s.state === 'ok') counts.push(s.count);
        },
        fetchZones: async () => {
            call++;
            if (call === 1) {
                await tick(60); // медленный первый ответ
                return okResult(9);
            }
            return okResult(1);
        },
        createLayer: h.createLayer,
    });
    controller.setEnabled(true);
    await tick(5);
    h.listeners.moveend.forEach(fn => fn()); // второй запрос обгоняет первый
    await tick(120);

    assert.deepEqual(counts, [1], 'применён только последний ответ');
    assert.equal(h.added.length, 1);
    controller.destroy();
});

test('выключение тумблера снимает слой и запрос', async () => {
    const h = makeHarness();
    const controller = createZonesController({
        map: h.map as never,
        labels,
        debounceMs: 0,
        onChange: () => {},
        fetchZones: async () => okResult(2),
        createLayer: h.createLayer,
    });
    controller.setEnabled(true);
    await tick(20);
    assert.equal(h.added.length, 1);
    controller.setEnabled(false);
    assert.equal(h.removed.length, 1);
    assert.equal(controller.getSnapshot().state, 'idle');
    controller.destroy();
});

test('ошибка сети переводит в unavailable и убирает старый слой', async () => {
    const h = makeHarness();
    let fail = false;
    const controller = createZonesController({
        map: h.map as never,
        labels,
        debounceMs: 0,
        onChange: () => {},
        fetchZones: async () => {
            if (fail) throw new TypeError('boom');
            return okResult(2);
        },
        createLayer: h.createLayer,
    });
    controller.setEnabled(true);
    await tick(20);
    fail = true;
    h.listeners.moveend.forEach(fn => fn());
    await tick(30);
    assert.equal(controller.getSnapshot().state, 'unavailable');
    assert.equal(h.removed.length, 1);
    controller.destroy();
});
