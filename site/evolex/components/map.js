// @ts-check
// Point map on Pihka's MapLibre + PMTiles setup: the same vendored MapLibre,
// the local world.pmtiles basemap (zoom ≤ 4, no external tile services) and
// local glyphs. Points are one GeoJSON circle layer, so hundreds of varieties
// stay fast (no DOM markers).
import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { loadMaplibre } from "../../../extensions/point_map/js/maplibre-shim.js";
import { ensurePmtilesProtocol } from "../../../extensions/point_map/js/pmtiles-protocol.js";
import { buildStyle } from "../../../extensions/point_map/js/map-view.js";

// The basemap stops at zoom 4; a few levels of overzoom are still readable.
const MAX_ZOOM = 7;

/** Colour per Bantu branch (variety.branch), shared by maps and legends. */
export const BRANCH_COLORS = {
    "West-Coastal Bantu": "#c0392b",
    "Eastern Bantu": "#2471a3",
    "Central-Western Bantu": "#7d3c98",
    "North-Western Bantu": "#1e8449",
    "South-Western Bantu": "#b9770e",
};
export const OTHER_COLOR = "#6c7a89";
export const branchColor = (branch) => BRANCH_COLORS[branch] ?? OTHER_COLOR;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * points: [{ lon, lat, color, radius?, popup: { title, lines: string[] }, href? }]
 * Clicking a point opens a popup; `href` adds a link in it.
 */
export function PointMap({ points, height = "420px", center = [22, -4], zoom = 3.3 }) {
    const el = useRef(null);
    const map = useRef(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const maplibregl = await loadMaplibre();
            await ensurePmtilesProtocol();
            if (cancelled || !el.current) return;
            const m = new maplibregl.Map({
                container: el.current, style: buildStyle(), center, zoom,
                maxZoom: MAX_ZOOM, attributionControl: { compact: true },
            });
            m.addControl(new maplibregl.NavigationControl({ showCompass: false }));
            m.on("load", () => {
                m.addSource("pts", { type: "geojson", data: toGeoJSON([]) });
                m.addLayer({
                    id: "pts", type: "circle", source: "pts",
                    paint: {
                        "circle-color": ["get", "color"],
                        "circle-radius": ["get", "radius"],
                        "circle-opacity": 0.85,
                        "circle-stroke-color": "#fff",
                        "circle-stroke-width": 1,
                    },
                });
                m.on("click", "pts", (e) => {
                    const p = e.features[0].properties;
                    new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
                        .setLngLat(e.lngLat).setHTML(p.html).addTo(m);
                });
                m.on("mouseenter", "pts", () => (m.getCanvas().style.cursor = "pointer"));
                m.on("mouseleave", "pts", () => (m.getCanvas().style.cursor = ""));
                map.current = m;
                update(m, points);
            });
        })().catch((error) => console.error("[evolex] map failed:", error));
        return () => {
            cancelled = true;
            map.current?.remove();
            map.current = null;
        };
    }, []);

    useEffect(() => {
        if (map.current) update(map.current, points);
    }, [points]);

    return h("div", { ref: el, class: "evolex-map", style: { height } });
}

function update(m, points) {
    m.getSource("pts")?.setData(toGeoJSON(points));
    if (!points.length) return;
    const lons = points.map((p) => p.lon), lats = points.map((p) => p.lat);
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: 40, maxZoom: 5, duration: 0 });
}

function toGeoJSON(points) {
    return {
        type: "FeatureCollection",
        features: points.map((p) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            properties: {
                color: p.color ?? OTHER_COLOR,
                radius: p.radius ?? 5,
                html: `<strong>${esc(p.popup.title)}</strong>`
                    + p.popup.lines.map((l) => `<br>${esc(l)}`).join("")
                    + (p.href ? `<br><a href="${esc(p.href)}">Open ›</a>` : ""),
            },
        })),
    };
}

/** Legend of the branches present in `points` (or all). */
export function BranchLegend({ branches = Object.keys(BRANCH_COLORS) }) {
    return h("ul", { class: "evolex-legend" },
        branches.map((b) => h("li", { key: b },
            h("span", { class: "evolex-dot", style: { background: branchColor(b) } }), b || "Unknown")));
}
