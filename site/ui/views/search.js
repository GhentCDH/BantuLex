// @ts-check
import { h } from "preact";
import { useApp } from "../context.js";
import { navigate } from "../route.js";
import { useQuery } from "../use-query.js";
import { clearFilters, hasFilters, readState, writeState } from "../search-state.js";
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
                options: useStructureOptions(state.segments),
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
 * Values per sound position with the number of BLR reconstructions that
 * have them, given the other selected positions. Consonant and vowel
 * positions only offer the configured inventories; ∅ comes first.
 */
function useStructureOptions(segments) {
    const { store, config } = useApp();
    const { consonants = null, vowels = null } = config.soundStructure ?? {};
    const filters = Object.fromEntries(
        Object.entries(segments)
            .filter(([, values]) => values.length)
            .map(([field, selected]) => [field, { type: "multi", selected }]),
    );
    const { data } = useQuery(async () => {
        const entries = [];
        for (const field of STRUCTURE_FIELDS) {
            const counts = await store.queryFacetCounts("blr_reconstruction", field, { filters, excludeSelf: true });
            const inventory = /^c\d/.test(field) ? consonants : /^v\d/.test(field) ? vowels : null;
            entries.push([field, ordered(counts, inventory, segments[field] ?? [])]);
        }
        return Object.fromEntries(entries);
    }, JSON.stringify(filters));
    return data ?? {};
}

function ordered(counts, inventory, selected) {
    const count = new Map(counts.map((row) => [row.value, row.count]));
    const values = inventory
        ? [EMPTY, ...inventory]
        : [EMPTY, ...counts.map((row) => row.value).filter((v) => v !== EMPTY && v != null).sort()];
    return values
        .filter((value) => count.has(value) || selected.includes(value))
        .map((value) => ({ value, count: count.get(value) ?? 0 }));
}
