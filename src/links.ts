/**
 * src/links.ts — локаль и исходящие ссылки.
 *
 * ЛЮБАЯ исходящая ссылка плагина строится только здесь и обязательно несёт utm-метки
 * (это единственная «атрибуция» — никакой аналитики внутри плагина нет).
 */

/** 9 локалей spearo.app. */
export const LOCALES = ['en', 'pt', 'ru', 'es', 'it', 'el', 'fr', 'tr', 'hr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const SITE_ORIGIN = 'https://spearo.app';

/** Хосты, которым можно доверять ссылку «прогноз на spearo» (nearest.url). */
export const SPEARO_HOSTS = ['spearo.app', 'www.spearo.app'];

const UTM: Record<string, string> = {
    utm_source: 'windy',
    utm_medium: 'plugin',
    utm_campaign: 'windy-plugin',
};

// ── Ссылки на магазины приложений ────────────────────────────────────────────
// Семантика атрибуции повторяет сайт, чтобы установка из плагина попала в те же
// отчёты, что и установки с сайта:
//   Play  — `referrer=utm_source=<src>&utm_medium=web&utm_campaign=store_badge`
//           (значение кодируется ЦЕЛИКОМ, внутренние "=" и "&" переживают вложение);
//   Apple — `?ct=<src>` (кампания без provider token всё равно именует ссылку;
//           `mt` не шлём — Apple отвечает на него редиректом).
// Источник для ручной кампании на сайте — префикс `utm-` + слаг: Windy → `utm-windy`.

/** Идентификатор Android-приложения (applicationId). */
export const PLAY_PACKAGE = 'app.spearo';
/** Публичный листинг Play (без меток — метки навешивает playStoreUrl). */
export const PLAY_LISTING_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
/** Публичный листинг App Store. */
export const APP_STORE_LISTING_URL = 'https://apps.apple.com/app/id6787949200';

/** Токен источника для установок из плагина Windy. */
export const STORE_SOURCE = 'utm-windy';
/** Кампания бейджа — та же, что у бейджей сайта. */
export const STORE_CAMPAIGN = 'store_badge';
/** Канал: плагин — веб-поверхность. */
export const STORE_MEDIUM = 'web';

/** Сырой referrer для Play (`k=v&k=v`, кодируется вызывающим целиком). */
export function playReferrerValue(source: string = STORE_SOURCE): string {
    return `utm_source=${source}&utm_medium=${STORE_MEDIUM}&utm_campaign=${STORE_CAMPAIGN}`;
}

/** Ссылка на Play с referrer-атрибуцией. Только https, иначе null. */
export function playStoreUrl(source: string = STORE_SOURCE): string | null {
    const separator = PLAY_LISTING_URL.includes('?') ? '&' : '?';
    return sanitizeUrl(`${PLAY_LISTING_URL}${separator}referrer=${encodeURIComponent(playReferrerValue(source))}`);
}

/** Ссылка на App Store с кампанией `ct`. Только https, иначе null. */
export function appStoreUrl(source: string = STORE_SOURCE): string | null {
    try {
        const url = new URL(APP_STORE_LISTING_URL);
        url.searchParams.set('ct', source);
        return sanitizeUrl(url.toString());
    } catch {
        return null;
    }
}

/**
 * BCP-47-тег → локаль spearo. Зеркалит aliasLocale() сайта: region-insensitive,
 * "gr" читается как греческий. Неизвестный язык → en.
 */
export function toLocale(tag: string | null | undefined): Locale {
    return aliasLocale(tag) ?? DEFAULT_LOCALE;
}

/**
 * Локаль пользователя.
 *
 * Приоритет: язык, выбранный в самом Windy (`store.get('usedLang')` — его передаёт
 * plugin.svelte), затем navigator.language / navigator.languages, затем en.
 * Язык интерфейса Windy — осознанный выбор пользователя, он важнее настроек браузера.
 */
export function detectLocale(windyLang?: string | null): Locale {
    const fromWindy = aliasLocale(windyLang);
    if (fromWindy) {
        return fromWindy;
    }
    if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
    const candidates = [navigator.language, ...(navigator.languages ?? [])];
    for (const candidate of candidates) {
        const locale = aliasLocale(candidate);
        if (locale) {
            return locale;
        }
    }
    return DEFAULT_LOCALE;
}

/**
 * Как toLocale, но НЕ сваливает незнакомый язык в en: 'de-DE' → null.
 * Нужен, чтобы перебирать список кандидатов и брать первый поддерживаемый.
 */
export function aliasLocale(tag: string | null | undefined): Locale | null {
    if (!tag) return null;
    const s = tag.toLowerCase().trim();
    if (s.startsWith('pt')) return 'pt';
    if (s.startsWith('en')) return 'en';
    if (s.startsWith('ru')) return 'ru';
    if (s.startsWith('es')) return 'es';
    if (s.startsWith('it')) return 'it';
    if (s.startsWith('el') || s.startsWith('gr')) return 'el';
    if (s.startsWith('fr')) return 'fr';
    if (s.startsWith('tr')) return 'tr';
    if (s.startsWith('hr')) return 'hr';
    return null;
}

export interface SanitizeOptions {
    /** Разрешить http: (нужно для сайтов госорганов без TLS). По умолчанию только https:. */
    allowHttp?: boolean;
    /** Белый список хостов (регистр не важен). null = любой хост. */
    hosts?: string[] | null;
}

/**
 * Проверка URL, пришедшего ИЗ ДАННЫХ (nearest.url, actUrl, attribution.url).
 *
 * Пропускаем только абсолютные https: (и http:, если явно разрешено) — всё остальное
 * (`javascript:`, `data:`, `blob:`, `vbscript:`, относительные пути) отбрасываем в null,
 * чтобы скомпрометированный/ошибочный ответ API не превратился в XSS-ссылку в панели.
 */
export function sanitizeUrl(raw: unknown, options: SanitizeOptions = {}): string | null {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return null;
    }
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return null; // относительный или битый URL — не доверяем
    }
    const protocolOk = url.protocol === 'https:' || (options.allowHttp === true && url.protocol === 'http:');
    if (!protocolOk) {
        return null;
    }
    if (options.hosts && !options.hosts.some(host => host.toLowerCase() === url.hostname.toLowerCase())) {
        return null;
    }
    return url.toString();
}

/** Дописать utm-метки к любому исходящему URL (существующие utm не перетираем). */
export function withUtm(rawUrl: string): string {
    try {
        const url = new URL(rawUrl, SITE_ORIGIN);
        for (const [key, value] of Object.entries(UTM)) {
            if (!url.searchParams.has(key)) {
                url.searchParams.set(key, value);
            }
        }
        return url.toString();
    } catch {
        return rawUrl;
    }
}

/**
 * Та же ссылка, но с ЯВНОЙ кампанией: у отдельных мест в панели своя метка, иначе
 * они сольются в одну строку отчёта. Кампания перезаписывается (в nearest.url она
 * уже стоит), source/medium остаются плагинными.
 */
export function withCampaign(rawUrl: string, campaign: string): string {
    try {
        const url = new URL(rawUrl, SITE_ORIGIN);
        url.searchParams.set('utm_source', UTM.utm_source);
        url.searchParams.set('utm_medium', UTM.utm_medium);
        url.searchParams.set('utm_campaign', campaign);
        return url.toString();
    } catch {
        return rawUrl;
    }
}

/** Кампания тизера «ещё дни на spearo». */
export const DAYS_TEASER_CAMPAIGN = 'windy-plugin-days';

/**
 * Ссылка на прогноз spearo: https://spearo.app/{locale}/{city}?utm_…
 * Без известного города — на локализованную главную (там сработает гео-редирект).
 */
export function spearoForecastUrl(citySlug: string | null | undefined, locale: Locale = detectLocale()): string {
    const path = citySlug ? `/${locale}/${encodeURIComponent(citySlug)}` : `/${locale}`;
    return withUtm(`${SITE_ORIGIN}${path}`);
}
