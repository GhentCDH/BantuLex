// @ts-check
/**
 * Clustered point map on the self-hosted basemap of Pihka's point_map
 * extension, without its registry-bound views. The map is created once and
 * survives point changes; only the cluster sources get new data.
 */
import { h } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";
import {
    CLUSTER_GROUPS,
    addClusterLayers,
    loadPinImages,
    setClusterData,
    whenClusterSource,
} from "../../extensions/point_map/js/map-layers.js";
import { categorize, categoryOf } from "../../extensions/point_map/js/categories.js";
import { LangContext, useT } from "../i18n.js";
import { fitPoints, showPopup, useBaseMap } from "./base-map.js";

/** Below this many points in total every reflex is its own pin. */
const CLUSTER_FROM = 1000;

// Clustering is a per-source option, so switching it needs no new layers.
// Pins may overlap: collision would hide reflexes that share a location.
function setClustering(map, cluster) {
    for (const group of CLUSTER_GROUPS) {
        map.getSource(group.source)?.setClusterOptions({ cluster });
        map.setLayoutProperty(group.unclustered, "icon-allow-overlap", true);
    }
}

/**
 * @param {{ points: Array<{ lat: number, lon: number, color?: string, row: object }>,
 *   popup: (row: object) => any, legend?: Array<object> | null, class?: string }} props
 */
export function PointMap({ points, popup, legend = null, class: className = "" }) {
    const lang = useContext(LangContext);
    const container = useRef(null);
    const popups = useRef(new Set());
    const current = useRef({ points, popup, lang });
    current.current = { points, popup, lang };

    const ready = useBaseMap(container, {
        prepare: loadPinImages,
        setup(map, maplibregl, pins, isActive) {
            map.on("load", () =>
                addClusterLayers(map, pins, {
                    isActive,
                    onPointClick: (index) => {
                        const point = current.current.points[index];
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
                setClustering(map, points.length >= CLUSTER_FROM);
                setClusterData(map, points);
            });
            fitPoints(map, maplibregl, points);
        });
        return () => {
            stale = true;
        };
    }, [points]);

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
 * Points for rows with valid coordinates, coloured by `column` when given.
 * Rows with impossible coordinates (data entry errors) are left out.
 */
export function toPoints(rows, column = null, { neutral = [] } = {}) {
    const points = rows
        .filter(validCoordinates)
        .map((row) => ({ lat: row.latitude, lon: row.longitude, row, color: undefined }));
    if (!column) return { points, legend: null };
    const { legend, colorOf } = categorize(points, column, { neutral });
    points.forEach((point) => (point.color = colorOf(categoryOf(point, column))));
    return { points, legend };
}
