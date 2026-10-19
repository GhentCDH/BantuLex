// @ts-check
/**
 * Reflex results as a table (paginated, sortable, a filter per column) or
 * as a map (all matching reflexes, coloured by BLR index or Guthrie zone).
 */
import { h } from "preact";
import { useMemo } from "preact/hooks";
import { useApp } from "../context.js";
import { useT } from "../i18n.js";
import { href } from "../route.js";
import { useQuery } from "../use-query.js";
import { PAGE_SIZE, RESULT_COLUMNS, RESULTS_TABLE, toFilters } from "../search-state.js";
import { ColumnFilter } from "./column-filter.js";
import { PointMap, toPoints } from "./point-map.js";

const DEFAULT_SORT = { column: "term", direction: "ASC" };

/**
 * @param {{ state: any, update: (changes: object, options?: object) => void,
 *   baseFilters?: object, hiddenColumns?: string[], onClear?: (() => void) | null }} props
 */
export function Results({ state, update, baseFilters = {}, hiddenColumns = [], onClear = null }) {
    const t = useT();
    const filters = { ...toFilters(state), ...baseFilters };
    const columns = RESULT_COLUMNS.filter((column) => !hiddenColumns.includes(column.name));
    const view = state.view === "map"
        ? h(MapResults, { filters, colorBy: state.colorBy })
        : h(TableResults, { state, update, filters, columns });

    return h("section", { class: "results" },
        h("div", { class: "results-toolbar" },
            h(ResultCount, { filters }),
            onClear && h("button", { type: "button", class: "link-button", onClick: onClear }, t("clearAll")),
            h("span", { class: "spacer" }),
            state.view === "map" && h("label", { class: "inline-field" },
                t("colorBy"),
                h("select", {
                    value: state.colorBy,
                    onChange: (event) => update({ colorBy: event.currentTarget.value }, { replace: true }),
                },
                    h("option", { value: "blr" }, t("colorBlr")),
                    h("option", { value: "zone" }, t("colorZone")))),
            h("div", { class: "segmented", role: "group" },
                ["table", "map"].map((name) =>
                    h("button", {
                        type: "button",
                        "aria-pressed": state.view === name,
                        onClick: () => update({ view: name }),
                    }, t(name))))),
        view,
    );
}

function ResultCount({ filters }) {
    const t = useT();
    const { store } = useApp();
    const key = JSON.stringify(filters);
    const { data } = useQuery(
        () => store.queryTable(RESULTS_TABLE, { filters, page: 0, pageSize: 1 }).then((r) => r.totalRows),
        key,
    );
    return h("strong", { class: "result-count", "aria-live": "polite" }, data == null ? "…" : t("results", data));
}

function TableResults({ state, update, filters, columns }) {
    const t = useT();
    const { store } = useApp();
    const sort = state.sort ?? DEFAULT_SORT;
    const key = JSON.stringify([filters, sort, state.page]);
    const { data, error, loading } = useQuery(
        () => store.queryTable(RESULTS_TABLE, { filters, sort, page: state.page, pageSize: PAGE_SIZE }),
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
                                    h(ColumnFilter, {
                                        table: RESULTS_TABLE,
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
        data && rows.length === 0 && h("p", { class: "empty-state" }, t("noResults")),
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

function MapResults({ filters, colorBy }) {
    const t = useT();
    const { store } = useApp();
    const key = JSON.stringify(filters);
    const { data, error, loading } = useQuery(
        () => store.queryTable(RESULTS_TABLE, { filters, pageSize: null }).then((r) => r.rows),
        key,
    );
    const column = colorBy === "zone" ? "zone" : "blr_label";
    const { points, legend } = useMemo(
        () => toPoints(data ?? [], column, { neutral: ["—"] }),
        [data, column],
    );
    if (error) return h("p", { class: "notice notice-error" }, t("error"));
    return h("div", { class: loading ? "map-block is-loading" : "map-block" },
        h(PointMap, { points, legend, popup: (row) => h(ReflexPopup, { row }) }),
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
