// @ts-check
/**
 * The basemap shared by the pin map and the word map: Pihka's self-hosted
 * PMTiles style, created once per component and kept across data changes.
 * Colours come from `mapTheme` in config.json (Pihka's point_map theme).
 */
import { h, render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { loadMaplibre } from "../../extensions/point_map/js/maplibre-shim.js";
import { ensurePmtilesProtocol } from "../../extensions/point_map/js/pmtiles-protocol.js";
import { buildStyle } from "../../extensions/point_map/js/map-layers.js";
import { resolveTheme } from "../../extensions/point_map/js/theme.js";
import { useApp } from "../context.js";
import { LangContext } from "../i18n.js";

const CENTRE_OF_BANTU_AREA = [22, -4];
const ZONES_URL = new URL("../../assets/guthrie-zones.geojson", import.meta.url).href;
const ZONE_LAYERS = ["zones-fill", "zones-line", "zones-label"];

/** The map colours; the same object on every render. */
export const useMapTheme = () => resolveTheme(useApp().config.mapTheme);

/**
 * Create the map in `container` once. `prepare()` may load assets first;
 * `setup(map, maplibregl, prepared, isActive)` adds sources and handlers and
 * may return a cleanup function. `zones` shows the Guthrie zones under the
 * data, filled with a colour per zone letter where given; null hides them.
 * Returns a ref to a promise of `{ map, maplibregl }`, or of null when the
 * map failed.
 *
 * @param {{ current: HTMLElement | null }} container
 * @param {{ prepare?: () => Promise<any>,
 *   setup?: (map: any, maplibregl: any, prepared: any, isActive: () => boolean) => (() => void) | void,
 *   zones?: Record<string, string> | null }} hooks
 */
export function useBaseMap(container, { prepare, setup, zones = null } = {}) {
    const theme = useMapTheme();
    const ready = useRef(/** @type {Promise<any> | null} */ (null));
    const currentZones = useRef(zones);
    currentZones.current = zones;
    useEffect(() => {
        let active = true;
        let map = null;
        let resize = null;
        let cleanup = null;
        ready.current = (async () => {
            const maplibregl = await loadMaplibre();
            await ensurePmtilesProtocol();
            const prepared = await prepare?.();
            if (!active) return null;
            map = new maplibregl.Map({
                container: container.current,
                style: buildStyle(theme),
                center: CENTRE_OF_BANTU_AREA,
                zoom: 3,
                attributionControl: { compact: true },
            });
            map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
            resize = new ResizeObserver(() => map?.resize());
            resize.observe(container.current);
            map.on("load", () => addZoneLayers(map, theme, () => currentZones.current, () => active));
            cleanup = setup?.(map, maplibregl, prepared, () => active);
            return { map, maplibregl };
        })().catch((error) => {
            console.error("[bantulex] map failed:", error);
            return null;
        });
        return () => {
            active = false;
            resize?.disconnect();
            cleanup?.();
            map?.remove();
        };
    }, []);
    useEffect(() => {
        ready.current?.then((result) => result && showZones(result.map, theme, zones));
    }, [JSON.stringify(zones)]);
    return ready;
}

let zoneData = /** @type {Promise<{ areas: any, labels: any }> | null} */ (null);
function loadZones() {
    zoneData ??= fetch(ZONES_URL)
        .then((response) => {
            if (!response.ok) throw new Error(`${response.status} ${ZONES_URL}`);
            return response.json();
        })
        .then((areas) => ({ areas, labels: { type: "FeatureCollection", features: areas.features.map(labelPoint) } }));
    zoneData.catch(() => (zoneData = null));
    return zoneData;
}

/**
 * The zone letter at the centroid of the zone's largest polygon. Labels on
 * the polygons themselves would repeat on every island and tile edge.
 */
function labelPoint(feature) {
    const { type, coordinates } = feature.geometry;
    const polygons = type === "Polygon" ? [coordinates] : coordinates;
    const { point } = polygons
        .map(([outer]) => ringCentroid(outer))
        .reduce((largest, ring) => (ring.area > largest.area ? ring : largest));
    return { type: "Feature", properties: { zone: feature.properties.zone }, geometry: { type: "Point", coordinates: point } };
}

/** Area and centroid of a closed ring (shoelace formula). */
function ringCentroid(ring) {
    const { a, x, y } = ring.slice(1).reduce((sum, [x1, y1], i) => {
        const [x0, y0] = ring[i];
        const cross = x0 * y1 - x1 * y0;
        return { a: sum.a + cross, x: sum.x + (x0 + x1) * cross, y: sum.y + (y0 + y1) * cross };
    }, { a: 0, x: 0, y: 0 });
    return { area: Math.abs(a / 2), point: [x / (3 * a), y / (3 * a)] };
}

async function addZoneLayers(map, theme, zones, isActive) {
    let data;
    try {
        data = await loadZones();
    } catch (error) {
        console.error("[bantulex] Guthrie zones failed:", error);
        return;
    }
    if (!isActive() || map.getSource("zones")) return;
    const color = theme.basemap.boundaries;
    const layout = { visibility: "none" };
    map.addSource("zones", { type: "geojson", data: data.areas });
    map.addSource("zone-labels", { type: "geojson", data: data.labels });
    map.addLayer({ id: "zones-fill", type: "fill", source: "zones", layout });
    map.addLayer({ id: "zones-line", type: "line", source: "zones", layout, paint: { "line-color": color, "line-opacity": 0.45, "line-width": 1.2 } });
    map.addLayer({
        id: "zones-label",
        type: "symbol",
        source: "zone-labels",
        layout: { ...layout, "text-field": ["get", "zone"], "text-font": ["Noto Sans Regular"], "text-size": 22 },
        paint: { "text-color": color, "text-opacity": 0.55, "text-halo-color": theme.basemap.earth, "text-halo-width": 1.5 },
    });
    // The data layers (pins) are added while the zones load; keep the zones under them.
    const firstData = map.getStyle().layers.find((layer) => !layer.id.startsWith("zones-") && layer.source && layer.source !== "protomaps");
    if (firstData) ZONE_LAYERS.forEach((id) => map.moveLayer(id, firstData.id));
    showZones(map, theme, zones());
}

/** Show or hide the zone layers; zones without a colour get a faint neutral fill. */
function showZones(map, theme, zones) {
    if (!map.getLayer("zones-fill")) return;
    ZONE_LAYERS.forEach((id) => map.setLayoutProperty(id, "visibility", zones ? "visible" : "none"));
    const coloured = Object.entries(zones ?? {});
    const neutral = theme.basemap.boundaries;
    // A match expression needs at least one zone.
    map.setPaintProperty("zones-fill", "fill-color",
        coloured.length ? ["match", ["get", "zone"], ...coloured.flat(), neutral] : neutral);
    map.setPaintProperty("zones-fill", "fill-opacity",
        coloured.length ? ["match", ["get", "zone"], coloured.map(([zone]) => zone), 0.18, 0.06] : 0.06);
}

/** Fit the view to `points` ({lat, lon}); one point gets a close-up. */
export function fitPoints(map, maplibregl, points) {
    if (points.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        points.forEach((p) => bounds.extend([p.lon, p.lat]));
        map.fitBounds(bounds, { padding: 48, maxZoom: 8, duration: 0 });
    } else if (points.length === 1) {
        map.jumpTo({ center: [points[0].lon, points[0].lat], zoom: 7 });
    }
}

/**
 * Open a popup with a Preact `vnode` at `[lon, lat]` and add it to `open`
 * (a Set) until it closes; the vnode is unmounted on close.
 */
export function showPopup(map, maplibregl, lngLat, vnode, lang, open, offset = 25) {
    const node = document.createElement("div");
    render(h(LangContext.Provider, { value: lang }, vnode), node);
    const popup = new maplibregl.Popup({ offset, maxWidth: "22rem" }).setLngLat(lngLat).setDOMContent(node).addTo(map);
    open.add(popup);
    popup.on("close", () => {
        render(null, node);
        open.delete(popup);
    });
    return popup;
}
