// @ts-check
// Sources (EvoLex sources.html): every source with its reflex and root counts.
import { h } from "preact";
import { table } from "../data/db.js";
import { navigate } from "../components/router.js";
import { DataTable, Pagination, Status, fmt, nextSort, useData } from "../components/ui.js";

const PAGE_SIZE = 50;

export function Sources({ params }) {
    const page = Number(params.page || 0);
    const sort = { column: params.sort || "reflexes", direction: params.dir === "ASC" ? "ASC" : "DESC" };
    const filters = params.q ? { q: { type: "contains", columns: ["author_year", "title"], query: params.q } } : {};
    const go = (changes) => navigate("sources", null, { ...params, page: "", ...changes }, { replace: true });
    const result = useData(() => table("evolex_source", { filters, sort, page, pageSize: PAGE_SIZE }), [JSON.stringify(params)]);

    const columns = [
        { key: "author_year", label: "Source" },
        { key: "title", label: "Title" },
        { key: "reflexes", label: "Reflexes", render: (r) => fmt(r.reflexes) },
        { key: "roots", label: "BLR roots", render: (r) => fmt(r.roots) },
    ];
    return h("section", null,
        h("hgroup", null, h("h1", null, "Sources"),
            h("p", null, result.data ? `${fmt(result.data.totalRows)} sources` : "Sources")),
        h("input", {
            type: "search", placeholder: "Search author, year or title…", value: params.q || "", "aria-label": "Search sources",
            onChange: (e) => go({ q: e.currentTarget.value.trim() }),
        }),
        h(Status, { state: result }, result.data && h("div", null,
            h(DataTable, {
                columns, rows: result.data.rows, sort,
                onSort: (column) => {
                    const n = nextSort(sort, column, ["reflexes", "roots"].includes(column) ? "DESC" : "ASC");
                    go({ sort: n.column, dir: n.direction });
                },
            }),
            result.data.totalPages > 1 && h(Pagination, {
                page: result.data.page, totalPages: result.data.totalPages, onPageChange: (p) => go({ page: p || "" }),
            }))));
}
