// @ts-check
/**
 * Clustered point map on the self-hosted basemap of Pihka's point_map
 * extension, without its registry-bound views. The map is created once and
 * survives point changes; only the cluster sources get new data.
 */
import { h, render } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";
import { loadMaplibre } from "../../extensions/point_map/js/maplibre-shim.js";
import { ensurePmtilesProtocol } from "../../extensions/point_map/js/pmtiles-protocol.js";
import {
    CLUSTER_GROUPS,
    addClusterLayers,
    buildStyle,
    loadPinImages,
    setClusterData,
    whenClusterSource,
} from "../../extensions/point_map/js/map-layers.js";
import { categorize, categoryOf } from "../../extensions/point_map/js/categories.js";
import { LangContext, useT } from "../i18n.js";

const CENTRE_OF_BANTU_AREA = [22, -4];
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
    const mapRef = useRef(/** @type {Promise<any> | null} */ (null));
    const popups = useRef(new Set());
    const current = useRef({ points, popup, lang });
    current.current = { points, popup, lang };

    useEffect(() => {
        let active = true;
        let map = null;
        let resize = null;
        mapRef.current = (async () => {
            const maplibregl = await loadMaplibre();
            await ensurePmtilesProtocol();
            const pins = await loadPinImages();
            if (!active) return null;
            map = new maplibregl.Map({
                container: container.current,
                style: buildStyle(),
                center: CENTRE_OF_BANTU_AREA,
                zoom: 3,
                attributionControl: { compact: true },
            });
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
            map.on("load", () =>
                addClusterLayers(map, pins, {
                    isActive: () => active,
                    onPointClick: (index) => {
                        const point = current.current.points[index];
                        if (!point) return;
                        const node = document.createElement("div");
                        render(h(LangContext.Provider, { value: current.current.lang }, current.current.popup(point.row)), node);
                        const instance = new maplibregl.Popup({ offset: 25, maxWidth: "22rem" })
                            .setLngLat([point.lon, point.lat])
                            .setDOMContent(node)
                            .addTo(map);
                        popups.current.add(instance);
                        instance.on("close", () => {
                            render(null, node);
                            popups.current.delete(instance);
                        });
                    },
                }),
            );
            resize = new ResizeObserver(() => map?.resize());
            resize.observe(container.current);
            return { map, maplibregl };
        })().catch((error) => {
            console.error("[bantulex] map failed:", error);
            return null;
        });
        return () => {
            active = false;
            resize?.disconnect();
            [...popups.current].forEach((instance) => instance.remove());
            map?.remove();
        };
    }, []);

    useEffect(() => {
        let stale = false;
        mapRef.current?.then((ready) => {
            if (stale || !ready) return;
            const { map, maplibregl } = ready;
            // Open popups may belong to rows the new filters removed.
            [...popups.current].forEach((instance) => instance.remove());
            whenClusterSource(map, () => {
                if (stale) return;
                setClustering(map, points.length >= CLUSTER_FROM);
                setClusterData(map, points);
            });
            if (points.length > 1) {
                const bounds = new maplibregl.LngLatBounds();
                points.forEach((p) => bounds.extend([p.lon, p.lat]));
                map.fitBounds(bounds, { padding: 48, maxZoom: 8, duration: 0 });
            } else if (points.length === 1) {
                map.jumpTo({ center: [points[0].lon, points[0].lat], zoom: 7 });
            }
        });
        return () => {
            stale = true;
        };
    }, [points]);

    return h("div", { class: `map-host ${className}` },
        h("div", { class: "map-canvas", ref: container }),
        legend && points.length > 0 && h(Legend, { legend }));
}

function Legend({ legend }) {
    const t = useT();
    return h("div", { class: "map-legend" },
        h("ul", null,
            legend.map((item) =>
                h("li", { key: item.value ?? "\u0000other" },
                    h("span", { class: "swatch", style: `background:${item.color}` }),
                    h("span", { class: "legend-label" }, item.value ?? t("other", item.types)),
                    h("span", { class: "legend-count" }, item.count.toLocaleString(t.lang))))));
}

const validCoordinates = (row) =>
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
