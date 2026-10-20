// @ts-check
/**
 * Search state <-> URL query <-> engine filters.
 *
 *   q, qlang (en|fr), qlevel (reflex|blr), qmode (literal|semantic)  meaning
 *   s.<segment>  repeated, e.g. s.c1=m&s.c1=b                         sound structure
 *   v.<column>   repeated, "" is the empty value                      column value filter
 *   t.<column>                                                       column text filter
 *   sort (column, "-column" descending), page (1-based), view (table|map|words), color (blr|zone)
 *   words (term|blr)                                                  text of the word map
 *   zones (1)                                                         Guthrie zones on the maps
 *   show (reflex|blr)                                                 what the results are
 *
 * Column filters and sort belong to the columns of the `show` mode.
 */
import { SEGMENT_FIELDS } from "../engine/filters.js";

export const PAGE_SIZE = 50;

/**
 * The result modes. Columns: `filter` picks the column filter, a value list
 * with counts or a "contains" text box (none when absent). `link` makes the
 * cell a link to a detail page.
 */
export const RESULT_KINDS = {
    reflex: {
        table: "reflex_search",
        defaultSort: { column: "term", direction: "ASC" },
        columns: [
            { name: "term", filter: "text", link: "reflex" },
            { name: "meaning", filter: "text" },
            { name: "translation", filter: "text" },
            { name: "blr_index", filter: "values", link: "blr" },
            { name: "blr_word", filter: "text" },
            { name: "variety", filter: "values" },
            { name: "guthrie", filter: "values" },
            { name: "zone", filter: "values" },
            { name: "semantic_field", filter: "values" },
            { name: "part_of_speech", filter: "values" },
            { name: "ipa", filter: "text" },
        ],
    },
    blr: {
        table: "blr_reconstruction",
        defaultSort: { column: "blr_index", direction: "ASC" },
        columns: [
            { name: "blr_index", filter: "text", link: "blr" },
            { name: "word", filter: "text" },
            { name: "word_tone", filter: "text" },
            { name: "english", filter: "text" },
            { name: "french", filter: "text" },
            { name: "noun_class", filter: "values" },
            { name: "distribution", filter: "text" },
            { name: "reliability", filter: "values" },
            { name: "reflexes" },
        ],
    },
};

const pick = (value, allowed) => (allowed.includes(value) ? value : allowed[0]);

/** Search state from the URL query; `show` forces the result mode. */
export function readState(params, show = pick(params.get("show"), ["reflex", "blr"])) {
    const columns = new Set(RESULT_KINDS[show].columns.map((column) => column.name));
    const segments = {};
    const values = {};
    const texts = {};
    for (const key of new Set(params.keys())) {
        const [prefix, name] = key.split(/\.(.+)/);
        if (prefix === "s" && SEGMENT_FIELDS.includes(name)) segments[name] = params.getAll(key);
        else if (prefix === "v" && columns.has(name)) values[name] = params.getAll(key).map((v) => (v === "" ? null : v));
        else if (prefix === "t" && columns.has(name) && params.get(key)) texts[name] = params.get(key);
    }
    const sort = params.get("sort") ?? "";
    const sortColumn = sort.replace(/^-/, "");
    return {
        show,
        gloss: {
            text: params.get("q") ?? "",
            lang: pick(params.get("qlang"), ["en", "fr"]),
            level: pick(params.get("qlevel"), ["reflex", "blr"]),
            mode: pick(params.get("qmode"), ["literal", "semantic"]),
        },
        segments,
        values,
        texts,
        sort: columns.has(sortColumn) ? { column: sortColumn, direction: sort.startsWith("-") ? "DESC" : "ASC" } : null,
        page: Math.max(0, (parseInt(params.get("page") ?? "1", 10) || 1) - 1),
        view: pick(params.get("view"), ["table", "map", "words"]),
        colorBy: pick(params.get("color"), ["blr", "zone"]),
        wordsOf: pick(params.get("words"), ["term", "blr"]),
        zones: params.get("zones") === "1",
    };
}

export function writeState(state) {
    const params = new URLSearchParams();
    const { gloss } = state;
    if (gloss.text) params.set("q", gloss.text);
    if (gloss.lang !== "en") params.set("qlang", gloss.lang);
    if (gloss.level !== "reflex") params.set("qlevel", gloss.level);
    if (gloss.mode !== "literal") params.set("qmode", gloss.mode);
    for (const [field, values] of Object.entries(state.segments)) values.forEach((v) => params.append(`s.${field}`, v));
    for (const [column, values] of Object.entries(state.values)) values.forEach((v) => params.append(`v.${column}`, v ?? ""));
    for (const [column, text] of Object.entries(state.texts)) if (text) params.set(`t.${column}`, text);
    if (state.sort) params.set("sort", `${state.sort.direction === "DESC" ? "-" : ""}${state.sort.column}`);
    if (state.page > 0) params.set("page", String(state.page + 1));
    if (state.view !== "table") params.set("view", state.view);
    if (state.colorBy !== "blr") params.set("color", state.colorBy);
    if (state.wordsOf !== "term") params.set("words", state.wordsOf);
    if (state.zones) params.set("zones", "1");
    if (state.show !== "reflex") params.set("show", state.show);
    return params;
}

/** Switch the result mode; column filters and sort do not carry over. */
export const showResults = (state, show) => ({ ...state, show, values: {}, texts: {}, sort: null, page: 0 });

/**
 * Engine filters for the state. `gloss` and `structure` are custom keys;
 * column filters use the column name as key, so facet counts of a column
 * can leave out its own filter.
 */
export function toFilters(state) {
    const filters = {};
    const { gloss, show: target } = state;
    if (gloss.mode === "literal" && gloss.text.trim())
        filters.gloss = { type: "gloss", text: gloss.text, lang: gloss.lang, level: gloss.level, target };
    if (Object.values(state.segments).some((values) => values.length))
        filters.structure = { type: "blr-structure", segments: state.segments, target };
    for (const [column, selected] of Object.entries(state.values))
        if (selected.length) filters[column] = { type: "values", selected };
    for (const [column, text] of Object.entries(state.texts)) filters[column] = { type: "contains", text };
    return filters;
}

export const hasFilters = (state) => Object.keys(toFilters(state)).length > 0;

export function clearFilters(state) {
    return { ...state, gloss: { ...state.gloss, text: "" }, segments: {}, values: {}, texts: {}, page: 0 };
}
