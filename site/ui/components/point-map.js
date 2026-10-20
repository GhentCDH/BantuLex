// @ts-check
/**
 * Clustered point map on the self-hosted basemap of Pihka's point_map
 * extension, without its registry-bound views. The map is created once and
 * survives point changes; only the cluster sources get new data.
 */
import { h } from "preact";
import { useContext, useEffect, useMemo, useRef } from "preact/hooks";
import {
    addClusterLayers,
    clusterGroups,
    loadPinImages,
    setClusterData,
    whenClusterSource,
} from "../../extensions/point_map/js/map-layers.js";
import { categorize, categoryOf } from "../../extensions/point_map/js/categories.js";
import { DEFAULT_THEME } from "../../extensions/point_map/js/theme.js";
import { LangContext, useT } from "../i18n.js";
import { fitPoints, showPopup, useBaseMap, useMapTheme } from "./base-map.js";

/** Below this many points in total every reflex is its own pin. */
const CLUSTER_FROM = 1000;

/** Pins at one location spread over a disc of SPREAD_KM × √pins, at most SPREAD_MAX_KM. */
const SPREAD_KM = 8;
const SPREAD_MAX_KM = 50;
const KM_PER_DEGREE = 111.32;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Hash of a string for a fixed pseudo-random order: FNV-1a, then the
 * murmur3 finalizer, as FNV alone keeps ids that differ in one digit close.
 */
function hash(text) {
    const fnv = [...text].reduce((h, char) => Math.imul(h ^ char.charCodeAt(0), 16777619), 2166136261);
    const a = Math.imul(fnv ^ (fnv >>> 16), 0x85ebca6b);
    const b = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
    return (b ^ (b >>> 16)) >>> 0;
}

/**
 * Copies of `points` in which points at the same location are spread over a
 * disc around it (a sunflower pattern), so that each one has its own pin.
 * The order is kept, so cluster indices still match `points`. Within a disc
 * the pins are shuffled by a hash of the row id, so categories mix and the
 * same results always get the same layout.
 */
export function spreadPoints(points) {
    const spread = points.map((point) => ({ ...point }));
    [...Map.groupBy(spread, (point) => `${point.lat},${point.lon}`).values()]
        .filter((group) => group.length > 1)
        .forEach((group) => {
            const { lat, lon } = group[0];
            const radius = Math.min(SPREAD_MAX_KM, SPREAD_KM * Math.sqrt(group.length));
            const kmPerLon = KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
            group
                .map((point, i) => ({ point, rank: hash(String(point.row?.id ?? i)) }))
                .sort((a, b) => a.rank - b.rank)
                .forEach(({ point }, k) => {
                    const r = radius * Math.sqrt((k + 0.5) / group.length);
                    point.lat = lat + (r * Math.sin(k * GOLDEN_ANGLE)) / KM_PER_DEGREE;
                    point.lon = lon + (r * Math.cos(k * GOLDEN_ANGLE)) / kmPerLon;
                });
        });
    return spread;
}

// Clustering is a per-source option, so switching it needs no new layers.
// Pins may overlap: collision would hide reflexes that share a location.
function setClustering(map, cluster, theme) {
    for (const group of clusterGroups(theme)) {
        map.getSource(group.source)?.setClusterOptions({ cluster });
        map.setLayoutProperty(group.unclustered, "icon-allow-overlap", true);
    }
}

/**
 * @param {{ points: Array<{ lat: number, lon: number, color?: string, row: object }>,
 *   popup: (row: object) => any, legend?: Array<object> | null, class?: string,
 *   zones?: Record<string, string> | null }} props
 */
export function PointMap({ points, popup, legend = null, class: className = "", zones = null }) {
    const lang = useContext(LangContext);
    const theme = useMapTheme();
    const container = useRef(null);
    const popups = useRef(new Set());
    const pins = useMemo(() => spreadPoints(points), [points]);
    const current = useRef({ pins, popup, lang });
    current.current = { pins, popup, lang };

    const ready = useBaseMap(container, {
        zones,
        prepare: () => loadPinImages(theme),
        setup(map, maplibregl, pinImages, isActive) {
            map.on("load", () =>
                addClusterLayers(map, pinImages, {
                    theme,
                    isActive,
                    onPointClick: (index) => {
                        const point = current.current.pins[index];
                        if (!point) return;
                        const { popup: content, lang: language } = current.current;
                        showPopup(map, maplibregl, [point.lon, point.lat], content(point.row), language, popups.current);
                    },
                }),
            );
            return () => [...popups.current].forEach((instance) => instance.remove());
        },
    });

    useEffect(() => {
        let stale = false;
        ready.current?.then((result) => {
            if (stale || !result) return;
            const { map, maplibregl } = result;
            // Open popups may belong to rows the new filters removed.
            [...popups.current].forEach((instance) => instance.remove());
            whenClusterSource(map, () => {
                if (stale) return;
                setClustering(map, pins.length >= CLUSTER_FROM, theme);
                setClusterData(map, pins, theme);
            });
            fitPoints(map, maplibregl, pins);
        });
        return () => {
            stale = true;
        };
    }, [pins]);

    return h("div", { class: `map-host ${className}` },
        h("div", { class: "map-canvas", ref: container }),
        legend && points.length > 0 && h(Legend, { legend }));
}

export function Legend({ legend }) {
    const t = useT();
    return h("div", { class: "map-legend" },
        h("ul", null,
            legend.map((item) =>
                h("li", { key: item.value ?? "\u0000other" },
                    h("span", { class: "swatch", style: `background:${item.color}` }),
                    h("span", { class: "legend-label" }, item.value ?? t("other", item.types)),
                    h("span", { class: "legend-count" }, item.count.toLocaleString(t.lang))))));
}

export const validCoordinates = (row) =>
    Number.isFinite(row.latitude) && Number.isFinite(row.longitude) &&
    Math.abs(row.latitude) <= 90 && Math.abs(row.longitude) <= 180;

/**
 * Points for rows with valid coordinates, coloured by `column` with the
 * `theme` palette when given. Rows with impossible coordinates (data entry
 * errors) are left out.
 */
export function toPoints(rows, column = null, { neutral = [], theme = DEFAULT_THEME } = {}) {
    const points = rows
        .filter(validCoordinates)
        .map((row) => ({ lat: row.latitude, lon: row.longitude, row, color: undefined }));
    if (!column) return { points, legend: null };
    const { legend, colorOf } = categorize(points, column, { neutral, palette: theme.palette, other: theme.other });
    points.forEach((point) => (point.color = colorOf(categoryOf(point, column))));
    return { points, legend };
}
