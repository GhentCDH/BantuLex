// @ts-check
/**
 * Word map layout, free of DOM and map: group reflexes into words per
 * location, then place them greedily in screen space.
 *
 * Locations whose dots would overlap at the current zoom form one group
 * with one dot, led by the location with the most reflexes; their words
 * are combined. Every (group, word) pair competes on its own count, so a
 * frequent second word at a busy place wins against a rare word at a quiet
 * one. A word goes next to its own dot or, when that is taken, in rings
 * further out (a small stack beside the dot); it never covers another word
 * or dot. Words that do not fit are counted in their group's "+n" badge.
 */

/** Distinct words per group that compete for space; more never fit around one dot. */
const WORDS_PER_GROUP = 40;

/** Box kept free around every visible location for its dot and "+n" badge. */
export const DOT = Object.freeze({ w: 30, h: 16 });

const RINGS = 4;
const GAP = 2;

/**
 * @param {Array<{ lat: number, lon: number, color?: string, row: any }>} points
 * @param {(row: any) => string | null} wordOf - the text to show, null to skip the row
 */
export function aggregateWords(points, wordOf) {
    const byKey = new Map();
    for (const point of points) {
        const word = wordOf(point.row);
        if (!word) continue;
        const key = `${point.lat},${point.lon}`;
        let location = byKey.get(key);
        if (!location) {
            location = { key, lat: point.lat, lon: point.lon, total: 0, varieties: new Set(), words: new Map() };
            byKey.set(key, location);
        }
        location.total++;
        if (point.row.variety) location.varieties.add(point.row.variety);
        let entry = location.words.get(word);
        if (!entry) {
            entry = { word, count: 0, row: point.row, colors: new Map() };
            location.words.set(word, entry);
        }
        entry.count++;
        entry.colors.set(point.color, (entry.colors.get(point.color) ?? 0) + 1);
    }

    const locations = [...byKey.values()]
        .map((location) => ({
            ...location,
            varieties: [...location.varieties].sort(),
            words: [...location.words.values()]
                .map(({ word, count, row, colors }) => ({ word, count, row, color: mostFrequent(colors) }))
                .sort(byCount),
        }))
        .sort((a, b) => b.total - a.total);
    const maxCount = locations.reduce((max, location) => Math.max(max, location.words[0]?.count ?? 0), 0);
    return { locations, maxCount };
}

const byCount = (a, b) => b.count - a.count || a.word.localeCompare(b.word);
const mostFrequent = (counts) => [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];

/**
 * The words of several locations combined, most frequent first. A word
 * keeps the colour and sample row of the location where it is most frequent.
 */
export function mergeWords(locations) {
    if (locations.length === 1) return locations[0].words;
    const merged = new Map();
    for (const { words } of locations) {
        for (const entry of words) {
            const known = merged.get(entry.word);
            if (!known) merged.set(entry.word, { ...entry, best: entry.count });
            else {
                known.count += entry.count;
                if (entry.count > known.best) Object.assign(known, { color: entry.color, row: entry.row, best: entry.count });
            }
        }
    }
    return [...merged.values()].sort(byCount);
}

/**
 * Place the words of `aggregateWords` for the current view.
 *
 * @param {ReturnType<typeof aggregateWords>} words
 * @param {{ project: (location: any) => { x: number, y: number }, width: number, height: number,
 *   measure: (text: string, size: number) => { w: number, h: number }, sizeOf: (count: number) => number }} view
 * @returns {{ labels: Array<{ item: any, size: number, dx: number, dy: number, w: number, h: number }>,
 *   dots: Array<{ group: any, hidden: number }> }}
 *   A group is `{ anchor, members, words }`; its dot is at the anchor
 *   location. Offsets are relative to the anchor on screen, so labels can
 *   follow the map while it moves and be placed again when it stops.
 */
export function placeWords({ locations }, { project, width, height, measure, sizeOf }) {
    const inView = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height;
    const groups = groupLocations(locations, project, width, height);
    const grid = new RectGrid();
    groups.forEach((group) => grid.add(dotRect(group)));

    const items = groups
        .flatMap((group) => group.words.slice(0, WORDS_PER_GROUP).map((word) => ({ ...word, group })))
        .sort(byCount);
    const placed = new Map(groups.map((group) => [group, 0]));
    const labels = [];
    for (const item of items) {
        const { group } = item;
        const size = sizeOf(item.count);
        const { w, h } = measure(item.word, size);
        const spot = candidates(w, h)
            .map(([dx, dy]) => ({ dx, dy, rect: { x: group.x + dx, y: group.y + dy, w, h } }))
            .find(({ rect }) => inView(rect) && !grid.hits(rect));
        if (!spot) continue;
        grid.add(spot.rect);
        labels.push({ item, size, dx: spot.dx, dy: spot.dy, w, h });
        placed.set(group, placed.get(group) + 1);
    }

    const dots = groups.map((group) => ({ group, hidden: group.words.length - placed.get(group) }));
    return { labels, dots };
}

const dotRect = ({ x, y }) => ({ x: x - DOT.w / 2, y: y - DOT.h / 2, w: DOT.w, h: DOT.h });

/**
 * Visible locations, busiest first, each joining the first group whose dot
 * its own dot would overlap, or starting a new group.
 */
function groupLocations(locations, project, width, height) {
    const grid = new RectGrid();
    const groups = [];
    for (const location of locations) {
        const { x, y } = project(location);
        if (x < 0 || y < 0 || x > width || y > height) continue;
        const owner = grid.find(dotRect({ x, y }))?.group;
        if (owner) owner.members.push(location);
        else {
            const group = { anchor: location, members: [location], x, y, words: [] };
            groups.push(group);
            grid.add({ ...dotRect(group), group });
        }
    }
    groups.forEach((group) => (group.words = mergeWords(group.members)));
    return groups;
}

/**
 * Offsets of a w × h label from its dot, nearest first: right, left, above
 * and below the dot, then stacked above and below those, ring by ring.
 */
function candidates(w, h) {
    const right = DOT.w / 2 + GAP;
    const left = -right - w;
    const middle = -h / 2;
    const above = -DOT.h / 2 - GAP - h;
    const below = DOT.h / 2 + GAP;
    const spots = [[right, middle], [left, middle], [-w / 2, above], [-w / 2, below]];
    for (let ring = 1; ring <= RINGS; ring++) {
        const step = ring * (h + GAP);
        spots.push(
            [right, middle + step], [right, middle - step],
            [left, middle + step], [left, middle - step],
            [-w / 2, below + step], [-w / 2, above - step],
        );
    }
    return spots;
}

/** Uniform grid of rectangles for fast overlap tests. */
class RectGrid {
    #cells = new Map();
    #size = 64;

    *#keys(r) {
        const size = this.#size;
        for (let i = Math.floor(r.x / size); i <= Math.floor((r.x + r.w) / size); i++)
            for (let j = Math.floor(r.y / size); j <= Math.floor((r.y + r.h) / size); j++) yield `${i},${j}`;
    }

    /** The first rectangle that overlaps `r`, or null. */
    find(r) {
        for (const key of this.#keys(r))
            for (const o of this.#cells.get(key) ?? [])
                if (r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h) return o;
        return null;
    }

    hits(r) {
        return this.find(r) !== null;
    }

    add(r) {
        for (const key of this.#keys(r)) {
            const cell = this.#cells.get(key);
            if (cell) cell.push(r);
            else this.#cells.set(key, [r]);
        }
    }
}
