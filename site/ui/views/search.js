// @ts-check
import { h } from "preact";
import { useMemo } from "preact/hooks";
import { useApp } from "../context.js";
import { navigate } from "../route.js";
import { useQuery } from "../use-query.js";
import { RESULTS_TABLE, clearFilters, hasFilters, readState, toFilters, writeState } from "../search-state.js";
import { MeaningSearch } from "../components/meaning-search.js";
import { STRUCTURE_FIELDS, SoundStructure } from "../components/sound-structure.js";
import { Results } from "../components/results.js";

const EMPTY = "∅";

/** Main search: meaning and sound structure filters above the reflex results. */
export function SearchView({ params }) {
    const state = readState(params);
    const update = (changes, options) => navigate("/", writeState({ ...state, ...changes }), options);

    return h("div", { class: "search-view" },
        h("div", { class: "query-panels" },
            h(MeaningSearch, {
                value: state.gloss,
                onChange: (gloss, options) => update({ gloss, page: 0 }, options),
            }),
            h(SoundStructure, {
                options: useStructureOptions(state),
                selected: state.segments,
                onChange: (field, values) => update({ segments: { ...state.segments, [field]: values }, page: 0 }),
            })),
        h(Results, {
            state,
            update,
            onClear: hasFilters(state) ? () => update(clearFilters(state)) : null,
        }),
    );
}

/**
 * Values per sound position with the number of reflexes that would match
 * when the value is chosen: under all other filters and the other selected
 * positions, as the result count shows it. Consonant and vowel positions
 * only offer the configured inventories; ∅ comes first.
 */
function useStructureOptions(state) {
    const { store, config } = useApp();
    const { consonants = null, vowels = null } = config.soundStructure ?? {};
    const { structure: _, ...otherFilters } = toFilters(state);
    const { data: structures } = useQuery(() => loadStructures(store), "structures");
    const { data: reflexesPerBlr } = useQuery(
        () =>
            store
                .queryFacetCounts(RESULTS_TABLE, "blr_index", { filters: otherFilters, excludeSelf: false })
                .then((rows) => new Map(rows.map((row) => [String(row.value), row.count]))),
        JSON.stringify(otherFilters),
    );
    const segments = state.segments;
    return useMemo(() => {
        if (!structures || !reflexesPerBlr) return {};
        const counts = countBySegment(structures, reflexesPerBlr, segments);
        return Object.fromEntries(
            STRUCTURE_FIELDS.map((field, i) => {
                const inventory = /^c\d/.test(field) ? consonants : /^v\d/.test(field) ? vowels : null;
                return [field, ordered(counts[i], inventory, segments[field] ?? [])];
            }),
        );
    }, [structures, reflexesPerBlr, JSON.stringify(segments)]);
}

// The sound structure of every reconstruction, loaded once per session.
let structureRows = null;
function loadStructures(store) {
    structureRows ??= store.queryTable("blr_reconstruction", { pageSize: null }).then(
        (result) => result.rows.map((row) => ({ index: String(row.blr_index), values: STRUCTURE_FIELDS.map((field) => row[field]) })),
        (error) => {
            structureRows = null;
            throw error;
        },
    );
    return structureRows;
}

/**
 * Reflex counts per position and value. A reconstruction that matches every
 * selected position counts for all its values; one that misses exactly one
 * position counts only for its value there, which is the match a user gets
 * by choosing that value instead.
 */
function countBySegment(structures, reflexesPerBlr, segments) {
    const selected = STRUCTURE_FIELDS.map((field) => (segments[field]?.length ? new Set(segments[field]) : null));
    const counts = STRUCTURE_FIELDS.map(() => new Map());
    const add = (i, value, n) => counts[i].set(value, (counts[i].get(value) ?? 0) + n);
    for (const { index, values } of structures) {
        const reflexes = reflexesPerBlr.get(index);
        if (!reflexes) continue;
        const misses = selected.flatMap((set, i) => (set && !set.has(values[i]) ? [i] : []));
        if (misses.length === 0) values.forEach((value, i) => add(i, value, reflexes));
        else if (misses.length === 1) add(misses[0], values[misses[0]], reflexes);
    }
    return counts;
}

function ordered(count, inventory, selected) {
    const values = inventory
        ? [EMPTY, ...inventory]
        : [EMPTY, ...[...count.keys()].filter((v) => v !== EMPTY && v != null).sort()];
    return values
        .filter((value) => count.has(value) || selected.includes(value))
        .map((value) => ({ value, count: count.get(value) ?? 0 }));
}
