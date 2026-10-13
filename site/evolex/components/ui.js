// @ts-check
// Shared EvoLex UI: layout, facet panel (Pihka's DropdownFacet), data table,
// and a small async-data hook. Pagination and the dropdown facets are Pihka
// components, so lists look and behave like the faceted search pages.
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { DropdownFacet } from "../../../core/ui/defaults/facet-sidebar.js";
import Pagination from "../../../core/ui/defaults/pagination.js";
import { href } from "./router.js";

export { Pagination };

/** Run an async loader whenever `deps` change; stale results are dropped. */
export function useData(load, deps) {
    const [state, setState] = useState({ data: null, error: null, loading: true });
    useEffect(() => {
        let alive = true;
        setState((s) => ({ ...s, loading: true }));
        load().then(
            (data) => alive && setState({ data, error: null, loading: false }),
            (error) => {
                console.error("[evolex]", error);
                if (alive) setState({ data: null, error, loading: false });
            },
        );
        return () => { alive = false; };
    }, deps);
    return state;
}

export function Status({ state, children }) {
    if (state.error) return h("article", { class: "evolex-error" }, "Could not load data: ", String(state.error.message ?? state.error));
    if (state.loading && !state.data) return h("p", { "aria-busy": "true" }, "Loading…");
    return children;
}

const NAV = [["home", "About"], ["etyma", "Etyma"], ["sources", "Sources"]];

export function Layout({ page, children }) {
    return h("div", { class: "evolex" },
        h("header", { class: "container evolex-header" },
            h("nav", null,
                h("ul", null, h("li", null,
                    h("a", { href: href("home"), class: "evolex-brand" },
                        h("strong", null, "BantuLex"), " ", h("span", null, "EvoLex")))),
                h("ul", null,
                    NAV.map(([id, label]) => h("li", { key: id },
                        h("a", { href: href(id), "aria-current": page === id ? "page" : undefined }, label))),
                    h("li", null, h("a", { href: "../../", title: "BantuLex data browser (Pihka)" }, "Data browser"))))),
        h("main", { class: "container" }, children),
        h("footer", { class: "container evolex-footer" },
            h("small", null,
                "BantuLex · Ghent Centre for Digital Humanities. Modelled on ",
                h("a", { href: "https://evolex.huma-num.fr/", target: "_blank", rel: "noopener" }, "EvoLex"), " and ",
                h("a", { href: "https://evosem.huma-num.fr/", target: "_blank", rel: "noopener" }, "EvoSem"),
                ". Runs entirely in your browser on the published SQLite database.")));
}

/**
 * Facet panel. defs: [{ field, label }]; meta from facets(); selected: { field: string[] };
 * onChange(field, string[]).
 */
export function FacetPanel({ defs, meta, selected, onChange, children }) {
    return h("aside", { class: "evolex-facets" },
        children,
        defs.map(({ field, label }) => {
            const options = (meta?.[field]?.options ?? [])
                .filter((o) => o.value != null && o.value !== "")
                .map((o) => ({ ...o, value: String(o.value), display: `${o.display} (${o.count})` }));
            return h("div", { key: field, class: "facet-divider" },
                h(DropdownFacet, {
                    label, options, selected: selected[field] ?? [],
                    onChange: (set) => onChange(field, [...set]),
                }));
        }));
}

/**
 * Sortable table. columns: [{ key, label, render?(row), sortable? }]; sort: { column, direction };
 * onSort(column).
 */
export function DataTable({ columns, rows, sort, onSort, rowKey = "id" }) {
    return h("div", { class: "overflow-auto" },
        h("table", { class: "striped evolex-table" },
            h("thead", null, h("tr", null, columns.map((c) => h("th", { key: c.key, scope: "col" },
                c.sortable === false || !onSort
                    ? c.label
                    : h("button", {
                        class: "evolex-sort", onClick: () => onSort(c.key),
                        "aria-sort": sort?.column === c.key ? (sort.direction === "DESC" ? "descending" : "ascending") : undefined,
                    }, c.label, sort?.column === c.key ? (sort.direction === "DESC" ? " ▼" : " ▲") : ""))))),
            h("tbody", null, rows.map((row) => h("tr", { key: row[rowKey] },
                columns.map((c) => h("td", { key: c.key }, c.render ? c.render(row) : row[c.key] ?? "")))))));
}

export const fmt = (n) => Number(n ?? 0).toLocaleString("en");

/** Next sort state when a column header is clicked. */
export function nextSort(sort, column, defaultDirection = "ASC") {
    if (sort?.column !== column) return { column, direction: defaultDirection };
    return { column, direction: sort.direction === "ASC" ? "DESC" : "ASC" };
}
