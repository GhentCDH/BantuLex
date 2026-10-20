// @ts-check
/**
 * Reflex results as a table (paginated, sortable, a filter per column), as a
 * map of pins or as a map of words (all matching reflexes, coloured by BLR
 * index or Guthrie zone). BLR results only have the table.
 */
import { h } from "preact";
import { useMemo } from "preact/hooks";
import { useApp } from "../context.js";
import { useT } from "../i18n.js";
import { href } from "../route.js";
import { useQuery } from "../use-query.js";
import { PAGE_SIZE, RESULT_KINDS, toFilters } from "../search-state.js";
import { ColumnFilter } from "./column-filter.js";
import { useMapTheme } from "./base-map.js";
import { PointMap, toPoints } from "./point-map.js";
import { WordMap } from "./word-map.js";

const VIEWS = ["table", "map", "words"];
const REFLEXES = RESULT_KINDS.reflex.table;

// Both maps read every matching row; keep the last set so that switching
// between them does not query again.
let allRows = { key: "", rows: /** @type {Promise<any[]> | null} */ (null) };
function loadAllRows(store, filters, key) {
    if (allRows.key !== key || !allRows.rows) {
        const rows = store.queryTable(REFLEXES, { filters, pageSize: null }).then((r) => r.rows);
        rows.catch(() => allRows.rows === rows && (allRows = { key: "", rows: null }));
        allRows = { key, rows };
    }
    return allRows.rows;
}

/**
 * @param {{ state: any, update: (changes: object, options?: object) => void,
 *   baseFilters?: object, hiddenColumns?: string[], onClear?: (() => void) | null,
 *   onShow?: ((show: string) => void) | null }} props
 */
export function Results({ state, update, baseFilters = {}, hiddenColumns = [], onClear = null, onShow = null }) {
    const t = useT();
    const kind = RESULT_KINDS[state.show];
    const filters = { ...toFilters(state), ...baseFilters };
    const columns = kind.columns.filter((column) => !hiddenColumns.includes(column.name));
    // BLRs have no location, so they are only listed.
    const shown = state.show === "blr" ? "table" : state.view;
    const view = shown === "table"
        ? h(TableResults, { state, update, filters, columns, kind })
        : h(MapResults, { filters, colorBy: state.colorBy, wordsOf: shown === "words" ? state.wordsOf : null, showZones: state.zones });
    const select = (key, label, options) =>
        h("label", { class: "inline-field" },
            label,
            h("select", {
                value: state[key],
                onChange: (event) => update({ [key]: event.currentTarget.value }, { replace: true }),
            }, options.map(([value, text]) => h("option", { value }, text))));

    return h("section", { class: "results" },
        h("div", { class: "results-toolbar" },
            onShow && h("div", { class: "segmented", role: "group", "aria-label": t("show") },
                ["reflex", "blr"].map((name) =>
                    h("button", {
                        type: "button",
                        "aria-pressed": state.show === name,
                        onClick: () => state.show !== name && onShow(name),
                    }, t(name === "blr" ? "showBlrs" : "showReflexes")))),
            h(ResultCount, { table: kind.table, filters, label: state.show === "blr" ? "blrResults" : "results" }),
            onClear && h("button", { type: "button", class: "link-button", onClick: onClear }, t("clearAll")),
            h("span", { class: "spacer" }),
            shown === "words" && select("wordsOf", t("wordsOf"), [["term", t("wordTerm")], ["blr", t("wordBlr")]]),
            shown !== "table" && select("colorBy", t("colorBy"), [["blr", t("colorBlr")], ["zone", t("colorZone")]]),
            shown !== "table" && h("label", { class: "inline-field" },
                h("input", {
                    type: "checkbox",
                    checked: state.zones,
                    onChange: (event) => update({ zones: event.currentTarget.checked }, { replace: true }),
                }),
                t("guthrieZones")),
            state.show === "reflex" && h("div", { class: "segmented", role: "group" },
                VIEWS.map((name) =>
                    h("button", {
                        type: "button",
                        "aria-pressed": state.view === name,
                        onClick: () => update({ view: name }),
                    }, t(name))))),
        view,
    );
}

function ResultCount({ table, filters, label }) {
    const t = useT();
    const { store } = useApp();
    const key = JSON.stringify([table, filters]);
    const { data } = useQuery(
        () => store.queryTable(table, { filters, page: 0, pageSize: 1 }).then((r) => r.totalRows),
        key,
    );
    return h("strong", { class: "result-count", "aria-live": "polite" }, data == null ? "…" : t(label, data));
}

function TableResults({ state, update, filters, columns, kind }) {
    const t = useT();
    const { store } = useApp();
    const sort = state.sort ?? kind.defaultSort;
    const key = JSON.stringify([kind.table, filters, sort, state.page]);
    const { data, error, loading } = useQuery(
        () => store.queryTable(kind.table, { filters, sort, page: state.page, pageSize: PAGE_SIZE }),
        key,
    );
    if (error) return h("p", { class: "notice notice-error" }, t("error"));

    const setSort = (column) =>
        update({
            sort: { column, direction: sort.column === column && sort.direction === "ASC" ? "DESC" : "ASC" },
            page: 0,
        });
    const setValues = (column, values) => update({ values: { ...state.values, [column]: values }, page: 0 });
    const setText = (column, text) => update({ texts: { ...state.texts, [column]: text }, page: 0 }, { replace: true });
    const rows = data?.rows ?? [];

    return h("div", { class: loading ? "table-block is-loading" : "table-block" },
        h("div", { class: "table-scroll" },
            h("table", { class: "results-table" },
                h("thead", null,
                    h("tr", null,
                        columns.map((column) => {
                            const sorted = sort.column === column.name ? sort.direction : null;
                            return h("th", {
                                key: column.name,
                                "aria-sort": sorted === "ASC" ? "ascending" : sorted === "DESC" ? "descending" : "none",
                            },
                                h("div", { class: "th" },
                                    h("button", {
                                        type: "button",
                                        class: "sort-button",
                                        title: `${t("sortBy")} ${t.label(column.name)}`,
                                        onClick: () => setSort(column.name),
                                    },
                                        t.label(column.name),
                                        h("span", { class: "sort-mark", "aria-hidden": "true" }, sorted === "ASC" ? "↑" : sorted === "DESC" ? "↓" : "")),
                                    column.filter && h(ColumnFilter, {
                                        table: kind.table,
                                        column,
                                        filters,
                                        values: state.values[column.name] ?? [],
                                        text: state.texts[column.name] ?? "",
                                        onValues: (values) => setValues(column.name, values),
                                        onText: (text) => setText(column.name, text),
                                    })));
                        }))),
                h("tbody", null,
                    rows.map((row) =>
                        h("tr", { key: row.id }, columns.map((column) => h("td", { key: column.name }, h(Cell, { column, row })))))))),
        data && rows.length === 0 && h("p", { class: "empty-state" }, t(state.show === "blr" ? "noBlrResults" : "noResults")),
        data && data.totalPages > 1 && h(Pager, {
            page: data.page,
            totalPages: data.totalPages,
            onPage: (page) => update({ page }),
        }),
    );
}

function Cell({ column, row }) {
    const value = row[column.name];
    if (value == null || value === "") return null;
    if (column.link === "reflex") return h("a", { href: href(`/reflex/${row.id}`) }, value);
    if (column.link === "blr")
        return h("a", { class: "blr-chip", href: href(`/blr/${encodeURIComponent(value)}`), title: row.blr_english ?? "" }, value);
    // Long glosses are clamped to a few lines; the full text is in the tooltip.
    const text = String(value);
    return text.length > 80 ? h("span", { class: "clamp", title: text }, text) : text;
}

function Pager({ page, totalPages, onPage }) {
    const t = useT();
    return h("nav", { class: "pager" },
        h("button", { type: "button", disabled: page === 0, onClick: () => onPage(page - 1) }, `← ${t("previous")}`),
        h("span", null, t("page", page + 1, totalPages)),
        h("button", { type: "button", disabled: page + 1 >= totalPages, onClick: () => onPage(page + 1) }, `${t("next")} →`));
}

/** Pins, or with `wordsOf` the words of the reflexes ("term" or "blr"). */
function MapResults({ filters, colorBy, wordsOf, showZones }) {
    const t = useT();
    const { store } = useApp();
    const key = JSON.stringify(filters);
    const { data, error, loading } = useQuery(() => loadAllRows(store, filters, key), key);
    const theme = useMapTheme();
    const column = colorBy === "zone" ? "zone" : "blr_label";
    const { points, legend } = useMemo(
        () => toPoints(data ?? [], column, { neutral: ["—"], theme }),
        [data, column, theme],
    );
    // Coloured by zone, each zone gets the colour of its pins.
    const zones = useMemo(() => {
        if (!showZones) return null;
        if (column !== "zone") return {};
        return Object.fromEntries(points.filter((point) => point.row.zone).map((point) => [point.row.zone, point.color]));
    }, [showZones, column, points]);
    if (error) return h("p", { class: "notice notice-error" }, t("error"));
    return h("div", { class: loading ? "map-block is-loading" : "map-block" },
        wordsOf
            ? h(WordMap, { points, legend, mode: wordsOf, zones })
            : h(PointMap, { points, legend, zones, popup: (row) => h(ReflexPopup, { row }) }),
        data && points.length === 0 && h("p", { class: "map-empty" }, t("noLocation")));
}

export function ReflexPopup({ row }) {
    const t = useT();
    return h("div", { class: "map-popup" },
        h("a", { class: "popup-term", href: href(`/reflex/${row.id}`) }, row.term ?? "—"),
        row.meaning && h("p", null, `‘${row.meaning}’`),
        h("p", { class: "muted" }, [row.variety, row.guthrie].filter(Boolean).join(" · ")),
        row.blr_index && h("p", null,
            h("a", { class: "blr-chip", href: href(`/blr/${encodeURIComponent(row.blr_index)}`) }, `${t("colorBlr")} ${row.blr_index}`),
            row.blr_english ? ` ${row.blr_english}` : ""));
}
