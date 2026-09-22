/**
 * src/i18n.ts — надписи панели. Минимум строк: RU для ru-локали, EN для остальных
 * (аудитория Windy международная). Серверные тексты (вердикт безопасности, имя зоны)
 * приходят из api.ts уже локализованными — здесь только chrome панели.
 */
import type { Locale } from './links';

/**
 * Карточка «Приложение spearo» — единственный блок, переведённый на ВСЕ девять
 * локалей сайта (остальной chrome панели живёт в en/ru): её читают люди, которые
 * ставят приложение, и на родном языке это решается заметно лучше.
 */
export interface AppCardStrings {
    title: string;
    line: string;
    appStore: string;
    googlePlay: string;
    /** Тизер в полоске дней: «+4 дня на spearo →» ({n} — сколько дней сверх панели). */
    moreDays: string;
}

const APP_CARD: Record<Locale, AppCardStrings> = {
    en: {
        title: 'spearo app',
        line: 'Full forecast for your own spots, dive log and zones offline',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        moreDays: '+{n} days on spearo →',
    },
    ru: {
        title: 'Приложение spearo',
        line: 'Полный прогноз по своим точкам, дневник заныров и зоны офлайн',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        moreDays: '+{n} дня на spearo →',
    },
    pt: {
        title: 'Aplicação spearo',
        line: 'Previsão completa nos teus pontos, diário de mergulhos e zonas offline',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        moreDays: '+{n} dias no spearo →',
    },
    es: {
        title: 'App spearo',
        line: 'Pronóstico completo de tus puntos, diario de inmersiones y zonas sin conexión',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        moreDays: '+{n} días en spearo →',
    },
    it: {
        title: 'App spearo',
        line: 'Previsioni complete sui tuoi spot, diario immersioni e zone offline',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        moreDays: '+{n} giorni su spearo →',
    },
    el: {
        title: 'Εφαρμογή spearo',
        line: 'Πλήρης πρόγνωση στα σημεία σου, ημερολόγιο καταδύσεων και ζώνες offline',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        moreDays: '+{n} ημέρες στο spearo →',
    },
    fr: {
        title: 'Application spearo',
        line: 'Prévisions complètes sur vos spots, carnet de plongée et zones hors ligne',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        moreDays: '+{n} jours sur spearo →',
    },
    tr: {
        title: 'spearo uygulaması',
        line: 'Kendi noktaların için tam tahmin, dalış günlüğü ve çevrimdışı bölgeler',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        moreDays: "spearo'da +{n} gün →",
    },
    hr: {
        title: 'spearo aplikacija',
        line: 'Potpuna prognoza za tvoje točke, dnevnik zarona i zone offline',
        appStore: 'App Store',
        googlePlay: 'Google Play',
        moreDays: '+{n} dana na spearo →',
    },
};

export function appCardStrings(locale: Locale): AppCardStrings {
    return APP_CARD[locale] ?? APP_CARD.en;
}

export interface Strings {
    today: string;
    tomorrow: string;
    visibility: string;
    wave: string;
    wind: string;
    waterTemp: string;
    safety: string;
    openOnSpearo: string;
    showZones: string;
    zonesLoading: string;
    zonesEmpty: string;
    zonesTruncated: string;
    zonesUnit: string;
    zonesBboxTooLarge: string;
    zonesUnavailable: string;
    zonesRetryIn: string;
    tide: string;
    loading: string;
    error: string;
    clickHint: string;
    noData: string;
    insideZone: string;
    actLink: string;
    mockBadge: string;
    stale: string;
    zone: {
        act: string;
        approx: string;
        season: string;
        hours: string;
        expires: string;
        source: string;
        tier: string;
        status: { banned: string; dormant: string; conditional: string; open: string };
        outOfSeason: string;
        seasonRange: string;
        whenInForce: string;
        inForceFrom: string;
    };
    unitM: string;
    unitMs: string;
}

const en: Strings = {
    today: 'Today',
    tomorrow: 'Tomorrow',
    visibility: 'Water visibility',
    wave: 'Wave',
    wind: 'Wind',
    waterTemp: 'Water',
    safety: 'Safety',
    openOnSpearo: 'Open forecast on spearo',
    showZones: 'Show no-take zones',
    zonesLoading: 'Loading zones…',
    zonesEmpty: 'No no-take zones in this area',
    zonesTruncated: 'Too many zones — zoom in',
    zonesUnit: 'zones on the map',
    zonesBboxTooLarge: 'Area too large — zoom in',
    zonesUnavailable: 'Zone data unavailable',
    zonesRetryIn: 'retry in',
    tide: 'Tide',
    loading: 'Loading…',
    error: 'spearo data unavailable',
    clickHint: 'Click on the map to move the point',
    noData: '—',
    insideZone: 'This point is inside a no-take zone',
    actLink: 'Legal act',
    mockBadge: 'mock data',
    stale: 'Data may be out of date',
    zone: {
        act: 'Legal act',
        approx: 'Boundaries are approximate',
        season: 'Season',
        hours: 'Hours',
        expires: 'Valid until',
        source: 'Source',
        tier: 'Tier',
        status: { banned: 'No-take', dormant: 'Out of season', conditional: 'Conditional', open: 'Open' },
        outOfSeason: 'Out of season: the ban applies {period}',
        seasonRange: 'from {from} to {to}',
        whenInForce: 'When in force',
        inForceFrom: 'Ban resumes on {date}',
    },
    unitM: 'm',
    unitMs: 'm/s',
};

const ru: Strings = {
    today: 'Сегодня',
    tomorrow: 'Завтра',
    visibility: 'Видимость',
    wave: 'Волна',
    wind: 'Ветер',
    waterTemp: 'Вода',
    safety: 'Безопасность',
    openOnSpearo: 'Открыть прогноз на spearo',
    showZones: 'Показать запретные зоны',
    zonesLoading: 'Загружаю зоны…',
    zonesEmpty: 'Запретных зон в этой области нет',
    zonesTruncated: 'Слишком много зон — приблизьте карту',
    zonesUnit: 'зон на карте',
    zonesBboxTooLarge: 'Слишком большая область — приблизьте карту',
    zonesUnavailable: 'Данные зон недоступны',
    zonesRetryIn: 'повтор через',
    tide: 'Прилив',
    loading: 'Загружаю…',
    error: 'Данные spearo недоступны',
    clickHint: 'Кликните по карте, чтобы перенести точку',
    noData: '—',
    insideZone: 'Точка внутри запретной зоны',
    actLink: 'Текст акта',
    mockBadge: 'мок-данные',
    stale: 'Данные могут быть устаревшими',
    zone: {
        act: 'Текст акта',
        approx: 'Границы приблизительные',
        season: 'Сезон',
        hours: 'Часы',
        expires: 'Действует до',
        source: 'Источник',
        tier: 'Уровень',
        status: { banned: 'Запрет', dormant: 'Вне сезона', conditional: 'Условно', open: 'Открыто' },
        outOfSeason: 'вне сезона: запрет {period}',
        seasonRange: 'с {from} по {to}',
        whenInForce: 'в сезон',
        inForceFrom: 'запрет снова с {date}',
    },
    unitM: 'м',
    unitMs: 'м/с',
};

export function strings(locale: Locale): Strings {
    return locale === 'ru' ? ru : en;
}
