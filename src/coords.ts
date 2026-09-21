/**
 * src/coords.ts — разбор координат.
 *
 * Windy отдаёт параметры роутера (`/plugin/spearo/:lat/:lon`) СТРОКАМИ, а
 * контекстное меню — числами. Панель обязана пережить и то, и другое, и мусор:
 * невалидное значение → null, а вызывающий падает на центр карты.
 */

export interface LatLonLike {
    lat?: unknown;
    lon?: unknown;
}

/** Строка/число → координата в допустимом диапазоне, иначе null. */
export function toCoord(value: unknown, limit: number): number | null {
    if (typeof value === 'boolean' || value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
        return null;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) {
        return null;
    }
    return parsed;
}

/** {lat, lon} из любых входных данных; null, если хоть одно значение невалидно. */
export function parseLatLon(params: LatLonLike | null | undefined): { lat: number; lon: number } | null {
    const lat = toCoord(params?.lat, 90);
    const lon = toCoord(params?.lon, 180);
    if (lat === null || lon === null) {
        return null;
    }
    return { lat, lon };
}
