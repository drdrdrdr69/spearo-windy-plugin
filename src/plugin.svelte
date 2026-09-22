<div class="plugin__mobile-header">
    { title }
</div>
<section class="plugin__content spearo">
    <div
        class="plugin__title plugin__title--chevron-back"
        on:click={ () => bcast.emit('rqstOpen', 'menu') }
    >
        { title }
    </div>

    <!-- Видимость — первое, что видно на телефоне: ради неё плагин и открывают. -->
    <div class="spearo__lead" class:spearo__lead--muted={ loading || hasError }>
        <div class="spearo__lead-label size-xs">{ t.visibility }</div>
        <div class="spearo__lead-value">
            {#if loading}
                { t.loading }
            {:else if hasError}
                { t.noData }
            {:else}
                { fmt(conditions?.visibilityM ?? null, t.unitM) }
            {/if}
        </div>
        {#if !loading && !hasError && conditions?.visibilityLabel}
            <div class="spearo__lead-band size-s">{ conditions.visibilityLabel }</div>
        {/if}
        {#if !loading && !hasError && conditions?.stale}
            <div class="spearo__stale size-xxs">
                { t.stale }{ conditions.staleReason ? `: ${conditions.staleReason}` : '' }
            </div>
        {/if}
    </div>

    <!-- Полоска дней: 7 чипов, горизонтальный скролл; день без данных отключён. -->
    <div class="spearo__days">
        {#each dayChips as chip}
            <button
                type="button"
                class="spearo__day"
                class:spearo__day--active={ day === chip.offset }
                class:spearo__day--today={ chip.offset === 0 }
                disabled={ !chip.available }
                title={ chip.dateISO ?? '' }
                on:click={ () => chip.available && (day = chip.offset) }
            >
                <span class="spearo__day-name size-xxs">{ chip.weekday }</span>
                <span class="spearo__day-date size-xs">{ chip.dayMonth }</span>
            </button>
        {/each}
    </div>

    {#if hasError}
        <div class="rounded-box bg-red fg-white size-s">
            { t.error }{ conditions?.retryAfterS ? ` (${t.zonesRetryIn} ${conditions.retryAfterS} s)` : '' }
        </div>
    {:else if conditions && !loading}
        <div class="spearo__grid">
            <div class="spearo__metric">
                <div class="spearo__metric-label size-xs">{ t.wave }</div>
                <div class="spearo__metric-value">{ fmt(conditions.waveM, t.unitM) }</div>
                {#if conditions.wavePeriodS}
                    <div class="size-xs">{ conditions.wavePeriodS } s</div>
                {/if}
            </div>
            <div class="spearo__metric">
                <div class="spearo__metric-label size-xs">{ t.wind }</div>
                <div class="spearo__metric-value">{ fmt(conditions.windMs, t.unitMs) }</div>
                {#if conditions.windDirDeg !== null}
                    <div class="size-xs">{ conditions.windDirDeg }°</div>
                {/if}
            </div>
            <div class="spearo__metric">
                <div class="spearo__metric-label size-xs">{ t.waterTemp }</div>
                <div class="spearo__metric-value">{ fmt(conditions.waterTempC, '°C') }</div>
            </div>
            {#if conditions.tideText}
                <div class="spearo__metric">
                    <div class="spearo__metric-label size-xs">{ t.tide }</div>
                    <div class="spearo__metric-tide size-s">{ conditions.tideText }</div>
                </div>
            {/if}
        </div>

        <div
            class="rounded-box spearo__safety size-s"
            class:spearo__safety--good={ conditions.safety.level === 'good' }
            class:spearo__safety--fair={ conditions.safety.level === 'fair' }
            class:spearo__safety--poor={ conditions.safety.level === 'poor' }
            class:spearo__safety--unsafe={ conditions.safety.level === 'unsafe' }
        >
            <b>{ t.safety }:</b> { conditions.safety.text || t.noData }
        </div>

        {#if conditions.noTake?.inside}
            <div class="rounded-box spearo__safety spearo__safety--unsafe size-s">
                { t.insideZone }
                {#if conditions.noTake.actUrl}
                    · <a class="clickable dotted" target="_blank" rel="noopener noreferrer"
                        href={ withUtm(conditions.noTake.actUrl) }>{ t.actLink }</a>
                {/if}
            </div>
        {/if}
    {/if}

    <a class="button button--variant spearo__cta" target="_blank" rel="noopener noreferrer" href={ forecastUrl }>
        { t.openOnSpearo }
    </a>

    <label class="spearo__toggle size-s">
        <input type="checkbox" checked={ showZones } on:change={ onZonesToggle } />
        <span>{ t.showZones }</span>
    </label>
    {#if showZones}
        {#if zones.state === 'loading'}
            <div class="size-xs">{ t.zonesLoading }</div>
        {:else if zones.state === 'zoom_in'}
            <div class="size-xs">{ t.zonesBboxTooLarge }</div>
        {:else if zones.state === 'unavailable'}
            <div class="size-xs">
                { t.zonesUnavailable }{ zones.retryAfterS ? ` (${t.zonesRetryIn} ${zones.retryAfterS} s)` : '' }
            </div>
        {:else if zones.truncated}
            <div class="size-xs">{ t.zonesTruncated }</div>
        {:else if zones.count === 0}
            <div class="size-xs">{ t.zonesEmpty }</div>
        {:else}
            <div class="size-xs">{ zones.count } { t.zonesUnit }</div>
        {/if}
    {/if}

    <div class="spearo__coords size-xxs">
        {#if conditions?.city}
            <b>{ conditions.city.name }</b> ·
        {/if}
        { lat.toFixed(3) }, { lon.toFixed(3) } · { t.clickHint }
        {#if mock}<span class="badge bg-red fg-white size-xxs">{ t.mockBadge }</span>{/if}
    </div>

    <div class="spearo__credit size-xxs">
        Data by <a class="clickable dotted" target="_blank" rel="noopener noreferrer"
            href={ attributionUrl }>{ conditions?.attribution?.provider ?? 'spearo.app' }</a>
    </div>
</section>

<script lang="ts">
    import bcast from '@windy/broadcast';
    import store from '@windy/store';
    import { map } from '@windy/map';
    import { singleclick } from '@windy/singleclick';
    import { setUrl } from '@windy/location';
    import { getMyLatestPos } from '@windy/geolocation';
    import { onDestroy, onMount } from 'svelte';

    import type { LatLon } from '@windy/interfaces';

    import config from './pluginConfig';
    import {
        clearConditionsCache,
        getConditions,
        isAbortError,
        isMockMode,
        isTimeoutError,
        onConditionsInvalidated,
        DAYS_REQUESTED,
        addDaysISO,
        type Conditions,
        type DayOffset,
    } from './api';
    import { detectLocale, spearoForecastUrl, withUtm } from './links';
    import { strings } from './i18n';
    import { createZonesController, type ZonesSnapshot } from './zonesController';
    import { parseLatLon } from './coords';
    import type { ZoneLabels } from './zonesLayer';

    const { name, title } = config;

    // Язык интерфейса Windy важнее настроек браузера (store.usedLang, см. links.ts).
    const windyLang = (() => {
        try {
            return (store.get('usedLang') as string | undefined) ?? null;
        } catch {
            return null;
        }
    })();
    const locale = detectLocale(windyLang);
    const t = strings(locale);
    const mock = isMockMode();

    const zoneLabels: ZoneLabels = t.zone;

    let lat = 38.44;
    let lon = -9.1;
    let day: DayOffset = 0;

    let conditions: Conditions | null = null;
    let loading = false;
    let error = false;

    let showZones = true;
    let zones: ZonesSnapshot & { state: string } = {
        state: 'idle',
        count: 0,
        truncated: false,
        retryAfterS: null,
    };

    let conditionsToken = 0;
    let conditionsAbort: AbortController | null = null;
    /** Ключ точки, для которой живёт текущий AbortController. */
    let conditionsKey = '';
    let destroyed = false;
    let zonesController: ReturnType<typeof createZonesController> | null = null;
    let unsubscribeInvalidation: (() => void) | null = null;

    const fmt = (value: number | null, unit: string): string =>
        value === null ? t.noData : `${value} ${unit}`;

    $: hasError = error || conditions?.ok === false;

    /** Даты из последнего ответа — чип без даты в ответе отключается, а не выдумывается. */
    interface DayChip {
        offset: DayOffset;
        dateISO: string | null;
        weekday: string;
        dayMonth: string;
        available: boolean;
    }

    const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    const dayMonthFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

    function deviceTodayISO(): string {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function buildChips(current: Conditions | null): DayChip[] {
        const base = current?.locationToday ?? deviceTodayISO();
        const available = new Set(current?.availableDates ?? []);
        const known = available.size > 0;
        return Array.from({ length: DAYS_REQUESTED }, (_, offset) => {
            const dateISO = addDaysISO(base, offset);
            // Дата в UTC-полдень: подпись не «переедет» на соседний день при форматировании.
            const stamp = dateISO ? new Date(`${dateISO}T12:00:00Z`) : null;
            return {
                offset,
                dateISO,
                weekday: stamp ? weekdayFmt.format(stamp) : '—',
                dayMonth: stamp ? dayMonthFmt.format(stamp) : '—',
                available: known ? Boolean(dateISO && available.has(dateISO)) : offset === 0,
            };
        });
    }

    $: dayChips = buildChips(conditions);

    // Точка сменилась и нужного дня больше нет → откатываемся на «сегодня».
    $: if (conditions?.availableDates?.length && day > 0) {
        const selected = addDaysISO(conditions.locationToday ?? deviceTodayISO(), day);
        if (!selected || !conditions.availableDates.includes(selected)) {
            day = 0;
        }
    }

    // CTA: сервер отдаёт готовый nearest.url (там уже локаль + utm). Нет его — строим сами.
    $: forecastUrl = conditions?.ctaUrl
        ? withUtm(conditions.ctaUrl)
        : spearoForecastUrl(conditions?.city?.slug ?? null, locale);
    const spearoHomeUrl = spearoForecastUrl(null, locale);
    $: attributionUrl = conditions?.attribution?.url ? withUtm(conditions.attribution.url) : spearoHomeUrl;

    // Точка сменилась/переключили день → перезапрашиваем условия (последний ответ побеждает).
    $: void loadConditions(lat, lon, day);

    // URL панели должен переживать перезагрузку страницы.
    $: setUrl(name, { lat, lon });

    /**
     * Загрузка условий.
     *
     * ВАЖНО: смена дня НЕ отменяет уже летящий бандл — он общий на все три дня
     * (docs/INVARIANTS.md). Прерываем запрос только при смене точки и при закрытии
     * панели, иначе переключение вкладки убивало бы собственные же данные.
     */
    async function loadConditions(nextLat: number, nextLon: number, nextDay: DayOffset): Promise<void> {
        if (destroyed) return;
        const key = `${nextLat.toFixed(4)}|${nextLon.toFixed(4)}`;
        if (key !== conditionsKey) {
            conditionsAbort?.abort();
            conditionsAbort = new AbortController();
            conditionsKey = key;
        }
        const abort = conditionsAbort ?? (conditionsAbort = new AbortController());
        const token = ++conditionsToken;
        loading = true;
        error = false;
        try {
            const result = await getConditions(nextLat, nextLon, nextDay, { locale, signal: abort.signal });
            if (destroyed || token !== conditionsToken) return;
            conditions = result;
        } catch (e) {
            // Отмена — молча (это мы сами ушли с точки/закрыли панель).
            if (isAbortError(e) && !isTimeoutError(e)) return;
            if (destroyed || token !== conditionsToken) return;
            conditions = null;
            error = true;
        } finally {
            if (!destroyed && token === conditionsToken) {
                loading = false;
            }
        }
    }

    // Тумблер зон — ЕДИНСТВЕННЫЙ ручной триггер загрузки (плюс moveend внутри контроллера).
    function onZonesToggle(event: Event): void {
        showZones = (event.currentTarget as HTMLInputElement).checked;
        zonesController?.setEnabled(showZones);
    }

    // Координаты из URL приходят строками — parseLatLon приводит и валидирует (coords.ts).
    const setLocation = (latLon: { lat: unknown; lon: unknown } | null | undefined): boolean => {
        const parsed = parseLatLon(latLon);
        if (!parsed) {
            return false;
        }
        lat = parsed.lat;
        lon = parsed.lon;
        return true;
    };

    const onSingleclick = (latLon: LatLon) => setLocation(latLon);

    /**
     * Плагин открыт: из контекстного меню карты / из URL (там lat, lon — СТРОКИ),
     * иначе — центр карты, иначе — последняя известная позиция пользователя.
     */
    export const onopen = (params?: Partial<Record<'lat' | 'lon', unknown>>) => {
        if (params && setLocation({ lat: params.lat, lon: params.lon })) {
            return;
        }
        try {
            const center = map.getCenter();
            if (setLocation({ lat: center.lat, lon: center.lng })) {
                return;
            }
        } catch {
            /* карта ещё не готова — падаем в геолокацию */
        }
        setLocation(getMyLatestPos());
    };

    onMount(() => {
        singleclick.on(name, onSingleclick);
        // Полночь в МЕСТЕ: кеш сбросился — панель обязана перезапроситься и перерисоваться,
        // иначе «сегодня» осталось бы вчерашним днём.
        unsubscribeInvalidation = onConditionsInvalidated(() => {
            if (!destroyed) {
                void loadConditions(lat, lon, day);
            }
        });
        zonesController = createZonesController({
            map,
            labels: zoneLabels,
            locale,
            onChange: snapshot => {
                if (!destroyed) {
                    zones = snapshot;
                }
            },
        });
        zonesController.setEnabled(showZones);
    });

    onDestroy(() => {
        destroyed = true;
        conditionsToken++;
        conditionsAbort?.abort();
        conditionsAbort = null;
        conditionsKey = '';
        singleclick.off(name, onSingleclick);
        unsubscribeInvalidation?.();
        unsubscribeInvalidation = null;
        zonesController?.destroy();
        zonesController = null;
        clearConditionsCache();
    });
</script>

<style lang="less">
    .spearo {
        // Панель скроллится внутри своей области: на мобильном пользователь
        // подтягивает лист до половины и видит карту под ним.
        max-height: 100%;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;

        &__lead {
            margin-top: 8px;
            padding: 10px 12px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.1);

            &--muted {
                opacity: 0.75;
            }
        }

        &__lead-label {
            opacity: 0.7;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }

        &__lead-value {
            font-size: 30px;
            line-height: 1.2;
            font-weight: 600;
        }

        &__lead-band {
            opacity: 0.85;
        }

        &__days {
            display: flex;
            gap: 6px;
            margin: 10px 0;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;

            &::-webkit-scrollbar {
                display: none;
            }
        }

        &__day {
            flex: 0 0 auto;
            min-width: 52px;
            padding: 5px 8px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 8px;
            background: transparent;
            color: inherit;
            cursor: pointer;
            text-align: center;
            line-height: 1.25;

            &--active {
                background: rgba(255, 255, 255, 0.18);
                border-color: rgba(255, 255, 255, 0.55);
            }

            &--today {
                border-color: rgba(126, 212, 255, 0.7);
            }

            &[disabled] {
                opacity: 0.35;
                cursor: default;
            }
        }

        &__day-name {
            display: block;
            opacity: 0.75;
            text-transform: capitalize;
        }

        &__day-date {
            display: block;
        }

        &__grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }

        &__metric {
            padding: 8px 10px;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.08);
        }

        &__metric-label {
            opacity: 0.7;
        }

        &__metric-value {
            font-size: 18px;
            line-height: 1.3;
        }

        &__metric-tide {
            line-height: 1.35;
        }

        &__stale {
            margin-top: 6px;
            padding: 4px 8px;
            border-radius: 6px;
            background: rgba(255, 214, 10, 0.2);
        }

        &__safety {
            margin-top: 10px;
            padding: 8px 10px;
            background: rgba(255, 255, 255, 0.08);

            &--good {
                background: rgba(52, 199, 89, 0.25);
            }

            &--fair {
                background: rgba(255, 214, 10, 0.25);
            }

            &--poor {
                background: rgba(255, 149, 0, 0.3);
            }

            &--unsafe {
                background: rgba(255, 59, 48, 0.35);
            }
        }

        &__cta {
            display: block;
            margin: 14px 0 10px;
            text-align: center;
        }

        &__toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 6px;
            cursor: pointer;
        }

        &__coords {
            margin-top: 12px;
            opacity: 0.65;
        }

        &__credit {
            margin-top: 8px;
            opacity: 0.6;
        }
    }
</style>
