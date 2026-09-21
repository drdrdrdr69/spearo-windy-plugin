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

    <div class="spearo__coords size-xs">
        {#if conditions?.city}
            <b>{ conditions.city.name }</b> ·
        {/if}
        { lat.toFixed(3) }, { lon.toFixed(3) }
        {#if mock}<span class="badge bg-red fg-white size-xs">{ t.mockBadge }</span>{/if}
    </div>
    <div class="spearo__hint size-xs">{ t.clickHint }</div>

    <div class="spearo__days">
        {#each dayKeys as key}
            <button
                type="button"
                class="spearo__day"
                class:spearo__day--active={ day === key }
                on:click={ () => (day = key) }
            >
                { key === 'today' ? t.today : t.tomorrow }
            </button>
        {/each}
    </div>

    {#if loading}
        <div class="spearo__row size-s">{ t.loading }</div>
    {:else if error || conditions?.ok === false}
        <div class="rounded-box bg-red fg-white size-s">
            { t.error }{ conditions?.retryAfterS ? ` (${t.zonesRetryIn} ${conditions.retryAfterS} s)` : '' }
        </div>
    {:else if conditions}
        {#if conditions.stale}
            <div class="rounded-box spearo__stale size-xs">
                { t.stale }{ conditions.staleReason ? `: ${conditions.staleReason}` : '' }
            </div>
        {/if}
        <div class="spearo__grid">
            <div class="spearo__metric">
                <div class="spearo__metric-label size-xs">{ t.visibility }</div>
                <div class="spearo__metric-value">{ fmt(conditions.visibilityM, t.unitM) }</div>
                {#if conditions.visibilityLabel}
                    <div class="size-xs">{ conditions.visibilityLabel }</div>
                {/if}
            </div>
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
        </div>

        {#if conditions.tideText}
            <div class="spearo__tide size-xs">{ t.tide }: { conditions.tideText }</div>
        {/if}

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
        type Conditions,
        type DayKey,
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
    const dayKeys: DayKey[] = ['today', 'tomorrow'];
    const zoneLabels: ZoneLabels = t.zone;

    let lat = 38.44;
    let lon = -9.1;
    let day: DayKey = 'today';

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
    async function loadConditions(nextLat: number, nextLon: number, nextDay: DayKey): Promise<void> {
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
        // Мобильный режим — маленькая панель снизу: карта должна оставаться видимой,
        // поэтому содержимое скроллится внутри панели, а не растягивает её.
        max-height: 100%;
        overflow-y: auto;

        &__coords {
            margin-top: 6px;
            opacity: 0.9;
        }

        &__hint {
            margin-top: 2px;
            opacity: 0.6;
        }

        &__days {
            display: flex;
            gap: 6px;
            margin: 12px 0 10px;
        }

        &__day {
            flex: 1;
            padding: 6px 4px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 6px;
            background: transparent;
            color: inherit;
            cursor: pointer;

            &--active {
                background: rgba(255, 255, 255, 0.18);
                border-color: rgba(255, 255, 255, 0.55);
            }
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

        &__tide {
            margin-top: 8px;
            opacity: 0.85;
        }

        &__stale {
            margin-bottom: 8px;
            padding: 6px 10px;
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

        &__credit {
            margin-top: 14px;
            opacity: 0.6;
        }
    }
</style>
