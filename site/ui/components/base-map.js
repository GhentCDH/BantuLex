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

/** The map colours; the same object on every render. */
export const useMapTheme = () => resolveTheme(useApp().config.mapTheme);

/**
 * Create the map in `container` once. `prepare()` may load assets first;
 * `setup(map, maplibregl, prepared, isActive)` adds sources and handlers and
 * may return a cleanup function. Returns a ref to a promise of
 * `{ map, maplibregl }`, or of null when the map failed.
 *
 * @param {{ current: HTMLElement | null }} container
 * @param {{ prepare?: () => Promise<any>,
 *   setup?: (map: any, maplibregl: any, prepared: any, isActive: () => boolean) => (() => void) | void }} hooks
 */
export function useBaseMap(container, { prepare, setup } = {}) {
    const theme = useMapTheme();
    const ready = useRef(/** @type {Promise<any> | null} */ (null));
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
    return ready;
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
