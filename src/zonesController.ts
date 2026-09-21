/**
 * src/zonesController.ts — жизненный цикл слоя зон.
 *
 * Вынесено из plugin.svelte, потому что здесь вся гонка: запросы инициируются
 * ТОЛЬКО событиями (тумблер панели и `moveend` карты), дебаунсятся 400 мс, каждый
 * ответ проверяется по request-id, а уничтожение контроллера (закрытие панели)
 * отменяет запрос и гарантирует, что опоздавший ответ уже ничего не нарисует.
 *
 * Никаких реактивных «само-триггеров»: раньше svelte-блок читал и увеличивал один
 * и тот же счётчик и уходил в бесконечный цикл запросов каждые 400 мс.
 */
import { getZones, isAbortError, isTimeoutError, type BBox, type ZonesResult, type ZonesState } from './api.ts';
import { bboxFromMap, createZonesLayer, type ZoneLabels } from './zonesLayer.ts';
import type { ZoneFeatureCollection } from './api.ts';

export type ZonesUiState = 'idle' | 'loading' | ZonesState;

export interface ZonesSnapshot {
    state: ZonesUiState;
    count: number;
    truncated: boolean;
    retryAfterS: number | null;
}

export interface LayerLike {
    remove(): void;
}

export interface MapLike {
    getBounds(): L.LatLngBounds;
    getZoom?(): number;
    addLayer(layer: unknown): void;
    on(event: string, handler: () => void): void;
    off(event: string, handler: () => void): void;
}

export interface ZonesControllerDeps {
    map: MapLike;
    labels: ZoneLabels;
    locale?: string;
    debounceMs?: number;
    onChange: (snapshot: ZonesSnapshot) => void;
    /** Подменяется в тестах. */
    fetchZones?: (bbox: BBox, options: { locale?: string; zoom?: number; signal?: AbortSignal }) => Promise<ZonesResult>;
    /** Подменяется в тестах. */
    createLayer?: (collection: ZoneFeatureCollection, labels: ZoneLabels) => LayerLike;
}

export interface ZonesController {
    setEnabled(enabled: boolean): void;
    isEnabled(): boolean;
    /** Принудительно перезапросить (с дебаунсом). */
    reload(): void;
    destroy(): void;
    getSnapshot(): ZonesSnapshot;
}

export function createZonesController(deps: ZonesControllerDeps): ZonesController {
    const {
        map,
        labels,
        locale,
        debounceMs = 400,
        onChange,
        fetchZones = getZones,
        createLayer = (collection, zoneLabels) => createZonesLayer(collection, zoneLabels) as unknown as LayerLike,
    } = deps;

    let enabled = false;
    let destroyed = false;
    let listening = false;
    let requestId = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let layer: LayerLike | null = null;
    let snapshot: ZonesSnapshot = { state: 'idle', count: 0, truncated: false, retryAfterS: null };

    const emit = (next: Partial<ZonesSnapshot>): void => {
        snapshot = { ...snapshot, ...next };
        if (!destroyed) {
            onChange(snapshot);
        }
    };

    const removeLayer = (): void => {
        if (layer) {
            layer.remove();
            layer = null;
        }
    };

    const cancelPending = (): void => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (controller) {
            controller.abort();
            controller = null;
        }
        // Любой ответ с прежним id теперь считается опоздавшим.
        requestId++;
    };

    const onMapMove = (): void => {
        if (enabled && !destroyed) {
            schedule(debounceMs);
        }
    };

    const load = async (): Promise<void> => {
        if (destroyed || !enabled) return;
        const id = ++requestId;
        const abort = new AbortController();
        controller = abort;
        emit({ state: 'loading' });
        try {
            const result = await fetchZones(bboxFromMap(map), {
                locale,
                zoom: typeof map.getZoom === 'function' ? map.getZoom() : undefined,
                signal: abort.signal,
            });
            // Опоздавший / отменённый ответ ничего не рисует.
            if (destroyed || !enabled || id !== requestId) return;
            removeLayer();
            if (result.state === 'ok' && result.featureCollection.features.length > 0) {
                layer = createLayer(result.featureCollection, labels);
                map.addLayer(layer);
            }
            emit({
                state: result.state,
                count: result.zones.length,
                truncated: result.truncated,
                retryAfterS: result.retryAfterS,
            });
        } catch (e) {
            // Отмена по решению пользователя (закрыли панель, дёрнули карту) — молча.
            if (isAbortError(e)) return;
            if (destroyed || !enabled || id !== requestId) return;
            // Таймаут — это «данные недоступны», и это надо показать.
            if (isTimeoutError(e)) {
                removeLayer();
                emit({ state: 'unavailable', count: 0, truncated: false, retryAfterS: null });
                return;
            }
            removeLayer();
            emit({ state: 'unavailable', count: 0, truncated: false, retryAfterS: null });
        } finally {
            if (controller === abort) {
                controller = null;
            }
        }
    };

    function schedule(delayMs: number): void {
        if (destroyed || !enabled) return;
        if (timer) {
            clearTimeout(timer);
        }
        // Новый запрос обесценивает предыдущий — и таймер, и уже летящий fetch.
        if (controller) {
            controller.abort();
            controller = null;
        }
        requestId++;
        timer = setTimeout(() => {
            timer = null;
            void load();
        }, delayMs);
    }

    return {
        setEnabled(next: boolean): void {
            if (destroyed || next === enabled) return;
            enabled = next;
            if (enabled) {
                if (!listening) {
                    map.on('moveend', onMapMove);
                    listening = true;
                }
                // Тумблер включили — грузим сразу, без дебаунса.
                schedule(0);
            } else {
                cancelPending();
                removeLayer();
                emit({ state: 'idle', count: 0, truncated: false, retryAfterS: null });
            }
        },
        isEnabled(): boolean {
            return enabled;
        },
        reload(): void {
            schedule(debounceMs);
        },
        destroy(): void {
            if (destroyed) return;
            destroyed = true;
            enabled = false;
            cancelPending();
            removeLayer();
            if (listening) {
                map.off('moveend', onMapMove);
                listening = false;
            }
        },
        getSnapshot(): ZonesSnapshot {
            return snapshot;
        },
    };
}
