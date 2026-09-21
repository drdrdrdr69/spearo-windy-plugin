/**
 * src/zonesLayer.ts — слой зон на карте Windy (Leaflet GL, @windy/map).
 *
 * На вход — готовая GeoJSON FeatureCollection из api.ts. Цвет контура зависит от
 * `status` (banned / conditional / open), приблизительные границы (`approx`)
 * рисуются пунктиром. Клик по полигону → popup с названием, режимом, сезоном/часами,
 * ссылкой на акт и источником.
 *
 * БЕЗОПАСНОСТЬ: popup собирается из DOM-узлов, весь текст кладётся через textContent
 * (никакого HTML-склеивания), href — только просанированный http/https URL.
 */
import type { BBox, ZoneFeatureCollection, ZoneProperties, ZoneStatus, ZoneTemporal } from './api.ts';
import { sanitizeUrl, withUtm } from './links.ts';

export interface ZoneStyle {
    color: string;
    weight: number;
    opacity: number;
    fillColor: string;
    fillOpacity: number;
    dashArray?: string;
}

const STATUS_COLOR: Record<ZoneStatus, string> = {
    banned: '#ff3b30',
    // dormant — правило есть, но сейчас не в силе: серый, чтобы не кричать «запрет»,
    // и пунктир, чтобы не читалось как «здесь можно» (docs/INVARIANTS.md).
    dormant: '#9aa0a6',
    conditional: '#ffd60a',
    open: '#34c759',
};

/** Стиль полигона по свойствам зоны. */
export function zoneStyle(props: Partial<ZoneProperties>): ZoneStyle {
    // Неизвестный статус трактуется как conditional — никогда как open.
    const status: ZoneStatus = props.status && STATUS_COLOR[props.status] ? props.status : 'conditional';
    const color = STATUS_COLOR[status];
    const dashed = status === 'dormant' || props.approx === true;
    return {
        color,
        weight: 2,
        opacity: status === 'dormant' ? 0.8 : 0.9,
        fillColor: color,
        fillOpacity: status === 'open' ? 0.06 : status === 'dormant' ? 0.05 : 0.12,
        // Пунктир: спящее правило и приблизительные границы.
        ...(dashed ? { dashArray: '6 4' } : {}),
    };
}

/** Подписи popup'а (локализуются в i18n.ts). */
export interface ZoneLabels {
    act: string;
    approx: string;
    season: string;
    hours: string;
    expires: string;
    source: string;
    tier: string;
    status: Record<ZoneStatus, string>;
    /** «вне сезона: запрет {period}» — шаблон для dormant. */
    outOfSeason: string;
    /** «с {from} по {to}» — как склеивать диапазон сезона. */
    seasonRange: string;
    /** «в сезон» — подпись statusWhenInForce. */
    whenInForce: string;
    /** «запрет снова с {date}» — дата вступления в силу (temporal.inForce). */
    inForceFrom: string;
}

export interface ZonePopupData {
    name: string;
    status?: ZoneStatus;
    statusWhenInForce?: ZoneStatus | null;
    kind?: string | null;
    actUrl?: string | null;
    actLabel?: string | null;
    sourceUrl?: string | null;
    tier?: string | null;
    approx?: boolean;
    temporal?: ZoneTemporal | null;
    source?: string | null;
}

/** 'MM-DD' → 'DD.MM' (человеческий вид дат сезона). */
export function formatSeasonDate(value: string | null): string | null {
    if (!value) return null;
    const md = /^(\d{2})-(\d{2})$/.exec(value);
    if (md) return `${md[2]}.${md[1]}`;
    // ISO-дата или датавремя с зоной (NZ: 2026-12-01T00:00:00+13:00) — берём дату.
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (ymd) return `${ymd[3]}.${ymd[2]}.${ymd[1]}`;
    return value;
}

export interface ZonePopupLink {
    href: string;
    text: string;
    small: boolean;
}

export interface ZonePopupModel {
    title: string;
    lines: string[];
    links: ZonePopupLink[];
}

/**
 * Модель popup'а — чистая функция без DOM (её и проверяют тесты).
 * dormant обязан объяснить «вне сезона: запрет с … по …», иначе серый полигон
 * прочитают как «здесь можно».
 */
export function zonePopupModel(zone: ZonePopupData, labels: ZoneLabels): ZonePopupModel {
    const status: ZoneStatus = zone.status && labels.status[zone.status] ? zone.status : 'conditional';
    const lines: string[] = [];
    const links: ZonePopupLink[] = [];

    const head = [labels.status[status], zone.kind].filter(Boolean).join(' · ');
    if (head) lines.push(head);

    if (status === 'dormant') {
        const ranges = (zone.temporal?.season ?? [])
            .map(range => {
                const from = formatSeasonDate(range.from);
                const to = formatSeasonDate(range.to);
                if (from && to) return labels.seasonRange.replace('{from}', from).replace('{to}', to);
                return from ?? to ?? null;
            })
            .filter((v): v is string => Boolean(v));
        const period = ranges.length > 0 ? ranges.join(', ') : zone.temporal?.seasonRaw;
        if (period) {
            lines.push(labels.outOfSeason.replace('{period}', period));
        } else {
            lines.push(labels.outOfSeason.replace('{period}', '—'));
        }
        if (zone.statusWhenInForce) {
            lines.push(`${labels.whenInForce}: ${labels.status[zone.statusWhenInForce]}`);
        }
        // Дата, с которой запрет снова заработает (NZ и прочие сезонные закрытия).
        const startsAt = formatSeasonDate(zone.temporal?.inForce ?? null);
        if (startsAt) {
            lines.push(labels.inForceFrom.replace('{date}', startsAt));
        }
    } else if (status === 'conditional' && zone.temporal?.seasonRaw) {
        // Движок не прочитал оговорку — показываем её сырой текст, не выдумываем.
        lines.push(zone.temporal.seasonRaw);
    }

    if (zone.temporal?.hours) lines.push(`${labels.hours}: ${zone.temporal.hours}`);
    if (zone.temporal?.expires) lines.push(`${labels.expires}: ${formatSeasonDate(zone.temporal.expires)}`);
    if (zone.approx === true) lines.push(labels.approx);

    const safeActUrl = sanitizeUrl(zone.actUrl, { allowHttp: true });
    if (safeActUrl) {
        links.push({ href: withUtm(safeActUrl), text: zone.actLabel ?? labels.act, small: false });
    } else if (zone.actLabel) {
        lines.push(zone.actLabel);
    }

    const safeSourceUrl = sanitizeUrl(zone.sourceUrl, { allowHttp: true });
    if (safeSourceUrl && safeSourceUrl !== safeActUrl) {
        links.push({ href: withUtm(safeSourceUrl), text: labels.source, small: true });
    } else if (zone.source) {
        lines.push(`${labels.source}: ${zone.source}`);
    }

    if (zone.tier) lines.push(`${labels.tier}: ${zone.tier}`);

    return { title: zone.name, lines, links };
}

function line(parent: HTMLElement, className: string, text: string): void {
    const node = document.createElement('div');
    node.className = className;
    node.textContent = text;
    parent.appendChild(node);
}

/** DOM-узел popup'а зоны: только текстовые узлы + проверенные href. */
export function zonePopupElement(zone: ZonePopupData, labels: ZoneLabels): HTMLElement {
    const model = zonePopupModel(zone, labels);
    const root = document.createElement('div');
    root.className = 'spearo-zone-popup';

    const title = document.createElement('b');
    title.textContent = model.title;
    root.appendChild(title);

    for (const text of model.lines) {
        line(root, 'size-xs', text);
    }

    for (const link of model.links) {
        const wrap = document.createElement('div');
        wrap.className = link.small ? 'size-xxs' : 'size-xs';
        const anchor = document.createElement('a');
        anchor.className = 'clickable dotted';
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.href = link.href;
        anchor.textContent = link.text;
        wrap.appendChild(anchor);
        root.appendChild(wrap);
    }

    return root;
}

/** Видимый bbox карты Windy. */
export function bboxFromMap(map: { getBounds: () => L.LatLngBounds }): BBox {
    const bounds = map.getBounds();
    return {
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
    };
}

/** Создать (но не добавить на карту) слой зон из FeatureCollection. */
export function createZonesLayer(collection: ZoneFeatureCollection, labels: ZoneLabels): L.GeoJSON {
    return new L.GeoJSON(collection as never, {
        style: (feature: { properties?: Partial<ZoneProperties> }) => zoneStyle(feature?.properties ?? {}),
        onEachFeature: (feature: { properties?: Record<string, unknown> }, layer: L.Layer) => {
            const props = (feature.properties ?? {}) as Partial<ZoneProperties>;
            layer.bindPopup(
                zonePopupElement(
                    {
                        name: typeof props.name === 'string' ? props.name : 'No-take zone',
                        status: props.status,
                        statusWhenInForce: props.statusWhenInForce ?? null,
                        kind: props.kind ?? null,
                        actUrl: props.actUrl ?? null,
                        actLabel: props.actLabel ?? null,
                        sourceUrl: props.sourceUrl ?? null,
                        tier: props.tier ?? null,
                        approx: props.approx === true,
                        temporal: props.temporal ?? null,
                        source: props.source ?? null,
                    },
                    labels,
                ),
            );
        },
    } as never);
}
