// @ts-check
// Index of etyma (EvoLex index_etyma.html): every BLR reconstruction, faceted
// and searchable. Filters live in the URL so results can be linked.
import { h } from "preact";
import { facets, sql, table, where } from "../data/db.js";
import { href, list, navigate } from "../components/router.js";
import { DataTable, FacetPanel, Pagination, Status, fmt, nextSort, useData } from "../components/ui.js";

const PAGE_SIZE = 50;
const FACETS = [
    { field: "has_reflexes", label: "Reflexes in BantuLex" },
    { field: "reliability", label: "Reliability" },
    { field: "noun_class", label: "Noun class" },
];
const MULTI = FACETS.map((f) => f.field);

export function filtersFrom(params) {
    const filters = {};
    if (params.q) filters.q = { type: "fts", column: "id", index: "evolex_etyma_fts", query: params.q };
    for (const field of MULTI) {
        const selected = list(params[field]);
        if (selected.length) filters[field] = { type: "multi", selected };
    }
    const zones = list(params.zone);
    if (zones.length) filters.zone = { type: "zone", selected: zones };
    return filters;
}

export function Etyma({ params }) {
    const page = Number(params.page || 0);
    const sort = { column: params.sort || "blr_index", direction: params.dir === "DESC" ? "DESC" : "ASC" };
    const filters = filtersFrom(params);
    const key = JSON.stringify([params]);
    const go = (changes) => navigate("etyma", null, { ...params, page: "", ...changes }, { replace: true });

    const result = useData(() => table("evolex_etyma", { filters, sort, page, pageSize: PAGE_SIZE }), [key]);
    const meta = useData(async () => {
        const [values, zones] = await Promise.all([facets("evolex_etyma", MULTI, filters), zoneCounts(filters)]);
        return { ...values, zone: { options: zones } };
    }, [JSON.stringify(filters)]);

    const selected = Object.fromEntries([...MULTI, "zone"].map((f) => [f, list(params[f])]));
    const columns = [
        { key: "blr_index", label: "BLR", render: (r) => h("a", { href: href("entry", r.blr_index) }, r.blr_index) },
        { key: "word", label: "Etymon", render: (r) => h("a", { href: href("entry", r.blr_index), class: "evolex-form" }, "*", r.word) },
        { key: "word_tone", label: "Tone", render: (r) => r.word_tone && h("span", { class: "evolex-form" }, "*", r.word_tone) },
        { key: "english", label: "English" },
        { key: "french", label: "French" },
        { key: "noun_class", label: "Class" },
        { key: "reflexes", label: "Reflexes", render: (r) => fmt(r.reflexes) },
        { key: "varieties", label: "Varieties", render: (r) => fmt(r.varieties) },
    ];

    return h("div", { class: "evolex-faceted" },
        h(FacetPanel, {
            defs: [...FACETS, { field: "zone", label: "Guthrie zone" }], meta: meta.data, selected,
            onChange: (field, values) => go({ [field]: values }),
        },
            h("input", {
                type: "search", placeholder: "Search etymon or gloss…", value: params.q || "",
                "aria-label": "Search etyma",
                onChange: (e) => go({ q: e.currentTarget.value.trim() }),
            }),
            h("small", { class: "evolex-muted" }, "Searches word, tone, English and French (min. 3 characters)."),
            Object.keys(filters).length > 0 && h("button", { class: "secondary outline evolex-clear", onClick: () => navigate("etyma", null, {}, { replace: true }) }, "Clear all")),
        h("section", null,
            h("hgroup", null,
                h("h1", null, "Index of etyma"),
                h("p", null, result.data ? `${fmt(result.data.totalRows)} Proto-Bantu reconstructions (BLR)` : "Proto-Bantu reconstructions (BLR)")),
            h(Status, { state: result },
                result.data && h("div", null,
                    h(DataTable, {
                        columns, rows: result.data.rows, sort,
                        onSort: (column) => {
                            const next = nextSort(sort, column, ["reflexes", "varieties"].includes(column) ? "DESC" : "ASC");
                            go({ sort: next.column, dir: next.direction });
                        },
                    }),
                    result.data.totalPages > 1 && h(Pagination, {
                        page: result.data.page, totalPages: result.data.totalPages,
                        onPageChange: (p) => go({ page: p || "" }),
                    })))));
}

/** Zone facet: counts per Guthrie zone for the other active filters. */
async function zoneCounts(filters) {
    const { whereClause, bindParams } = where(filters, "zone");
    const rows = await sql(
        `SELECT z.zone AS value, COUNT(*) AS count FROM evolex_etyma_zone z
         WHERE z.etyma_id IN (SELECT id FROM evolex_etyma ${whereClause})
         GROUP BY z.zone ORDER BY z.zone`, bindParams);
    return rows.map((r) => ({ ...r, display: r.value }));
}
