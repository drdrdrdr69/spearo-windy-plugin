// Координаты из роутера Windy приходят строками — проверяем приведение и границы.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseLatLon, toCoord } from '../src/coords.ts';
import { detectLocale } from '../src/links.ts';

test('toCoord: строки, числа, мусор, границы', () => {
    assert.equal(toCoord('38.44', 90), 38.44);
    assert.equal(toCoord(-9.1, 180), -9.1);
    assert.equal(toCoord('  12.5 ', 90), 12.5);
    assert.equal(toCoord('abc', 90), null);
    assert.equal(toCoord('', 90), null);
    assert.equal(toCoord(null, 90), null);
    assert.equal(toCoord(undefined, 90), null);
    assert.equal(toCoord(true, 90), null);
    assert.equal(toCoord('91', 90), null);
    assert.equal(toCoord('-181', 180), null);
    assert.equal(toCoord(NaN, 90), null);
});

test('parseLatLon: пара строк из URL → числа, иначе null', () => {
    assert.deepEqual(parseLatLon({ lat: '38.4406', lon: '-9.1005' }), { lat: 38.4406, lon: -9.1005 });
    assert.equal(parseLatLon({ lat: '38.44', lon: 'nope' }), null);
    assert.equal(parseLatLon({ lat: '100', lon: '0' }), null);
    assert.equal(parseLatLon(undefined), null);
    assert.equal(parseLatLon({}), null);
});

test('detectLocale: язык Windy важнее navigator.language', () => {
    // globalThis.navigator в node — только getter, поэтому подменяем дескриптором.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const setNavigator = (value: unknown) =>
        Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
    setNavigator({ language: 'de-DE', languages: ['de-DE', 'fr-FR'] });
    try {
        assert.equal(detectLocale('ru'), 'ru'); // usedLang из Windy
        assert.equal(detectLocale('zh'), 'fr'); // Windy на неподдерживаемом → navigator
        assert.equal(detectLocale(null), 'fr');
        setNavigator({ language: 'de-DE', languages: ['de-DE'] });
        assert.equal(detectLocale(null), 'en'); // ничего не подошло → en
    } finally {
        if (original) {
            Object.defineProperty(globalThis, 'navigator', original);
        } else {
            delete (globalThis as Record<string, unknown>).navigator;
        }
    }
});
