import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DAYS_TEASER_CAMPAIGN,
    LOCALES,
    SPEARO_HOSTS,
    appStoreUrl,
    playStoreUrl,
    sanitizeUrl,
    spearoForecastUrl,
    toLocale,
    withCampaign,
    withUtm,
} from '../src/links.ts';
import { DAYS_REQUESTED, FULL_HORIZON_DAYS } from '../src/api.ts';
import { appCardStrings } from '../src/i18n.ts';

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

test('ссылки на магазины: атрибуция как у бейджей сайта, только https', () => {
    const play = playStoreUrl();
    assert.ok(play);
    const playUrl = new URL(play as string);
    assert.equal(playUrl.protocol, 'https:');
    assert.equal(playUrl.hostname, 'play.google.com');
    assert.equal(playUrl.searchParams.get('id'), 'app.spearo');
    // referrer кодируется ЦЕЛИКОМ — внутренние "=" и "&" переживают вложение.
    assert.equal(
        playUrl.searchParams.get('referrer'),
        'utm_source=utm-windy&utm_medium=web&utm_campaign=store_badge',
    );
    assert.ok((play as string).includes('referrer=utm_source%3Dutm-windy%26utm_medium%3Dweb'));

    const apple = appStoreUrl();
    assert.ok(apple);
    const appleUrl = new URL(apple as string);
    assert.equal(appleUrl.protocol, 'https:');
    assert.equal(appleUrl.hostname, 'apps.apple.com');
    assert.equal(appleUrl.pathname, '/app/id6787949200');
    assert.equal(appleUrl.searchParams.get('ct'), 'utm-windy');
    assert.equal(appleUrl.searchParams.get('mt'), null, 'mt не шлём — Apple отвечает редиректом');
});

test('ссылки на магазины проходят ту же санитизацию и не несут utm-меток плагина', () => {
    const play = playStoreUrl() as string;
    const apple = appStoreUrl() as string;
    // Санитайзер пропускает их как https; utm_source плагина (windy) в них не подмешивается.
    assert.equal(sanitizeUrl(play), play);
    assert.equal(sanitizeUrl(apple), apple);
    assert.ok(!play.includes('utm_medium=plugin'));
    assert.ok(!apple.includes('utm_medium=plugin'));
    // Кастомный источник тоже собирается и остаётся валидным https.
    const custom = playStoreUrl('utm-newsletter') as string;
    assert.match(custom, /referrer=utm_source%3Dutm-newsletter/);
    assert.equal(sanitizeUrl(custom), custom);
});

test('карточка приложения переведена на все девять локалей', () => {
    for (const locale of LOCALES) {
        const card = appCardStrings(locale);
        assert.ok(card.title.trim().length > 0, `нет title для ${locale}`);
        assert.ok(card.line.trim().length > 0, `нет строки для ${locale}`);
        assert.equal(card.appStore, 'App Store');
        assert.equal(card.googlePlay, 'Google Play');
    }
    assert.equal(appCardStrings('ru').title, 'Приложение spearo');
    assert.equal(appCardStrings('en').title, 'spearo app');
});

test('тизер дней: своя кампания поверх готовой ссылки города, https и санитизация', () => {
    const fromServer = 'https://spearo.app/ru/sesimbra?utm_source=windy&utm_medium=plugin&utm_campaign=windy-plugin';
    const teaser = withCampaign(fromServer, DAYS_TEASER_CAMPAIGN);
    const url = new URL(teaser);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'spearo.app');
    assert.equal(url.pathname, '/ru/sesimbra');
    assert.equal(url.searchParams.get('utm_source'), 'windy');
    assert.equal(url.searchParams.get('utm_medium'), 'plugin');
    assert.equal(url.searchParams.get('utm_campaign'), 'windy-plugin-days', 'кампания перезаписана');
    assert.equal(sanitizeUrl(teaser, { hosts: SPEARO_HOSTS }), teaser);

    // Фолбэк без города — та же кампания на локализованной главной.
    const fallback = withCampaign(spearoForecastUrl(null, 'en'), DAYS_TEASER_CAMPAIGN);
    assert.equal(new URL(fallback).searchParams.get('utm_campaign'), 'windy-plugin-days');
    assert.equal(sanitizeUrl(fallback, { hosts: SPEARO_HOSTS }), fallback);
});

test('тизер обещает ровно недостающие дни', () => {
    assert.equal(DAYS_REQUESTED, 3);
    assert.equal(FULL_HORIZON_DAYS - DAYS_REQUESTED, 4);
    assert.equal(appCardStrings('en').moreDays.replace('{n}', '4'), '+4 days on spearo →');
    assert.equal(appCardStrings('ru').moreDays.replace('{n}', '4'), '+4 дня на spearo →');
});
