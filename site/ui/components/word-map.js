// @ts-check
/**
 * Word map: the words of the reflexes (terms or BLR forms) written at their
 * locations, without overlap (see word-layout.js). Labels are HTML, not map
 * symbols: the basemap glyphs cover Latin-1 only and MapLibre does not place
 * combining tone marks, so the browser has to set the text.
 *
 * While the map moves, the labels follow their dots; when it stops, they
 * are placed again for the new view.
 */
import { h } from "preact";
import { useContext, useEffect, useMemo, useRef } from "preact/hooks";
import { LangContext, useT } from "../i18n.js";
import { href } from "../route.js";
import { fitPoints, showPopup, useBaseMap } from "./base-map.js";
import { Legend } from "./point-map.js";
import { DOT, aggregateWords, placeWords } from "./word-layout.js";

/** Font sizes from rare to frequent words, on a log scale of the count. */
const SIZES = [15, 17, 20, 24];
const LIST_LIMIT = 60;

const WORD_OF = {
    term: (row) => row.term || null,
    blr: (row) => (row.blr_word ? `*${row.blr_word}` : null),
};

/**
 * @param {{ points: Array<{ lat: number, lon: number, color?: string, row: any }>,
 *   mode: "term" | "blr", legend?: Array<object> | null }} props
 */
export function WordMap({ points, mode, legend = null }) {
    const lang = useContext(LangContext);
    const container = useRef(null);
    const words = useMemo(() => aggregateWords(points, WORD_OF[mode]), [points, mode]);
    const current = useRef({ words, mode, lang });
    current.current = { words, mode, lang };
    const layer = useRef(null);
    const popups = useRef(new Set());

    const ready = useBaseMap(container, {
        setup(map, maplibregl) {
            const openGroup = (group) => {
                const { mode: shown, lang: language } = current.current;
                const { lon, lat } = group.anchor;
                [...popups.current].forEach((popup) => popup.remove());
                showPopup(map, maplibregl, [lon, lat], h(GroupWords, { group, mode: shown }), language, popups.current, 10);
            };
            const words = createWordLayer(map, openGroup);
            layer.current = words;
            const relayout = () => words.relayout(current.current.words);
            map.on("move", words.follow);
            map.on("moveend", relayout);
            map.on("resize", relayout);
            // The words let mouse events through to the map, so that wheel
            // zoom and dragging work on them too; clicks are matched here.
            map.on("click", (event) => {
                const hit = words.at(event.point);
                if (hit) openGroup(hit.group);
            });
            map.on("mousemove", (event) => words.hover(words.at(event.point)));
            map.on("mouseout", () => words.hover(null));
            return () => {
                [...popups.current].forEach((popup) => popup.remove());
                words.remove();
            };
        },
    });

    useEffect(() => {
        let stale = false;
        ready.current?.then((result) => {
            if (stale || !result) return;
            [...popups.current].forEach((popup) => popup.remove());
            fitPoints(result.map, result.maplibregl, words.locations);
            layer.current?.relayout(words);
        });
        return () => {
            stale = true;
        };
    }, [words]);

    return h("div", { class: "map-host" },
        h("div", { class: "map-canvas", ref: container }),
        legend && words.locations.length > 0 && h(Legend, { legend }));
}

/** The HTML layer over the map with the dots and words. */
function createWordLayer(map, openGroup) {
    const root = document.createElement("div");
    root.className = "word-layer";
    map.getContainer().append(root);
    const measure = textMeasure(root);
    /** @type {Array<{ element: HTMLElement, group: any, dx: number, dy: number, w: number, h: number }>} */
    let placed = [];
    let hovered = null;
    const anchorOf = (group) => map.project([group.anchor.lon, group.anchor.lat]);

    const follow = () => {
        for (const { element, group, dx, dy } of placed) {
            const { x, y } = anchorOf(group);
            element.style.transform = `translate(${x + dx}px, ${y + dy}px)`;
        }
    };

    /** The word or dot at a point in map pixels; words are on top of dots. */
    const at = (point) =>
        placed.findLast(({ group, dx, dy, w, h }) => {
            const { x, y } = anchorOf(group);
            return point.x >= x + dx && point.x <= x + dx + w && point.y >= y + dy && point.y <= y + dy + h;
        }) ?? null;

    const hover = (entry) => {
        if (entry === hovered) return;
        hovered?.element.classList.remove("is-hover");
        entry?.element.classList.add("is-hover");
        hovered = entry;
        const canvas = map.getCanvas();
        canvas.style.cursor = entry ? "pointer" : "";
        canvas.title = entry?.element.title ?? "";
    };

    const relayout = (words) => {
        const { clientWidth: width, clientHeight: height } = map.getContainer();
        const sizeOf = sizes(words.maxCount);
        const { labels, dots } = placeWords(words, {
            project: (location) => map.project([location.lon, location.lat]),
            width,
            height,
            measure,
            sizeOf,
        });
        placed = [];
        hover(null);

        for (const { group, hidden } of dots) {
            const element = button("word-dot", () => openGroup(group));
            element.style.width = `${DOT.w}px`;
            element.style.height = `${DOT.h}px`;
            const { varieties, total } = summary(group);
            element.title = `${varieties.slice(0, 4).join(", ")}${varieties.length > 4 ? " …" : ""} · ${total}`;
            if (hidden) element.append(Object.assign(document.createElement("span"), { className: "word-more", textContent: `+${compact(hidden)}` }));
            placed.push({ element, group, dx: -DOT.w / 2, dy: -DOT.h / 2, w: DOT.w, h: DOT.h });
        }
        for (const { item, size, dx, dy, w, h: height } of labels) {
            const element = button("word-label", () => openGroup(item.group));
            element.textContent = item.word;
            element.title = `${item.word} · ${item.count}`;
            Object.assign(element.style, { width: `${w}px`, height: `${height}px`, fontSize: `${size}px` });
            if (item.color) element.style.setProperty("--word-color", item.color);
            placed.push({ element, group: item.group, dx, dy, w, h: height });
        }
        root.replaceChildren(...placed.map((entry) => entry.element));
        follow();
    };

    return { relayout, follow, at, hover, remove: () => root.remove() };
}

function button(className, onClick) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.addEventListener("click", onClick);
    return element;
}

/** Label box sizes, measured with the label font on a canvas. */
function textMeasure(root) {
    const context = document.createElement("canvas").getContext("2d");
    const family = getComputedStyle(root).fontFamily;
    const cache = new Map();
    return (text, size) => {
        const key = `${size}|${text}`;
        if (!cache.has(key)) {
            // Weight 600 as in .word-label.
            context.font = `600 ${size}px ${family}`;
            // 2px each side for the halo; the line box is 1.15 × the font size.
            cache.set(key, { w: Math.ceil(context.measureText(text).width) + 4, h: Math.ceil(size * 1.15) });
        }
        return cache.get(key);
    };
}

function sizes(maxCount) {
    const scale = maxCount > 1 ? Math.log(maxCount) : 1;
    return (count) => SIZES[Math.min(SIZES.length - 1, Math.floor((Math.log(count) / scale) * SIZES.length))];
}

const compact = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Varieties and reflex count of all locations in a group. */
const summary = (group) => ({
    varieties: [...new Set(group.members.flatMap((location) => location.varieties))].sort(),
    total: group.members.reduce((sum, location) => sum + location.total, 0),
});

/** Popup with all words of a group of locations. */
function GroupWords({ group, mode }) {
    const t = useT();
    const { varieties, total } = summary(group);
    const shown = group.words.slice(0, LIST_LIMIT);
    const link = (entry) =>
        mode === "blr" ? href(`/blr/${encodeURIComponent(entry.row.blr_index)}`) : href(`/reflex/${entry.row.id}`);
    return h("div", { class: "map-popup word-popup" },
        h("p", { class: "muted" }, varieties.slice(0, 4).join(", ") + (varieties.length > 4 ? " …" : "")),
        h("p", null, h("strong", null, t("results", total))),
        h("ul", null,
            shown.map((entry) =>
                h("li", { key: entry.word },
                    h("span", { class: "swatch", style: `background:${entry.color}` }),
                    h("a", { href: link(entry) }, entry.word),
                    h("span", { class: "legend-count" }, entry.count.toLocaleString(t.lang))))),
        group.words.length > shown.length && h("p", { class: "muted" }, t("moreWords", group.words.length - shown.length)));
}
