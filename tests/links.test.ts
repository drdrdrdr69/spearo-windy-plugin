import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SPEARO_HOSTS, sanitizeUrl, toLocale, withUtm, spearoForecastUrl } from '../src/links.ts';

test('toLocale маппит 9 локалей и падает в en', () => {
    assert.equal(toLocale('ru-RU'), 'ru');
    assert.equal(toLocale('pt-BR'), 'pt');
    assert.equal(toLocale('es-419'), 'es');
    assert.equal(toLocale('el-GR'), 'el');
    assert.equal(toLocale('gr'), 'el');
    assert.equal(toLocale('hr-HR'), 'hr');
    assert.equal(toLocale('tr'), 'tr');
    assert.equal(toLocale('fr-CA'), 'fr');
    assert.equal(toLocale('it-CH'), 'it');
    assert.equal(toLocale('de-DE'), 'en');
    assert.equal(toLocale(null), 'en');
});

test('withUtm добавляет метки и не перетирает существующие', () => {
    const url = new URL(withUtm('https://example.org/act'));
    assert.equal(url.searchParams.get('utm_source'), 'windy');
    assert.equal(url.searchParams.get('utm_medium'), 'plugin');
    assert.equal(url.searchParams.get('utm_campaign'), 'windy-plugin');
    const kept = new URL(withUtm('https://example.org/act?utm_source=other'));
    assert.equal(kept.searchParams.get('utm_source'), 'other');
});

test('ссылка на прогноз: /{locale}/{city} + utm', () => {
    assert.equal(
        spearoForecastUrl('sesimbra', 'ru'),
        'https://spearo.app/ru/sesimbra?utm_source=windy&utm_medium=plugin&utm_campaign=windy-plugin',
    );
    assert.equal(
        spearoForecastUrl(null, 'en'),
        'https://spearo.app/en?utm_source=windy&utm_medium=plugin&utm_campaign=windy-plugin',
    );
});

test('sanitizeUrl режет опасные схемы и чужие хосты', () => {
    assert.equal(sanitizeUrl('javascript:alert(1)'), null);
    assert.equal(sanitizeUrl('JavaScript:alert(1)'), null);
    assert.equal(sanitizeUrl('data:text/html,<script>x</script>'), null);
    assert.equal(sanitizeUrl('blob:https://evil.example/x'), null);
    assert.equal(sanitizeUrl('/relative/path'), null);
    assert.equal(sanitizeUrl(''), null);
    assert.equal(sanitizeUrl(null), null);

    assert.equal(sanitizeUrl('http://gov.example/act'), null); // по умолчанию только https
    assert.equal(sanitizeUrl('http://gov.example/act', { allowHttp: true }), 'http://gov.example/act');
    assert.equal(sanitizeUrl('https://gov.example/act'), 'https://gov.example/act');

    assert.equal(sanitizeUrl('https://evil.example/x', { hosts: SPEARO_HOSTS }), null);
    assert.equal(sanitizeUrl('https://spearo.app/en/sesimbra', { hosts: SPEARO_HOSTS }), 'https://spearo.app/en/sesimbra');
});
