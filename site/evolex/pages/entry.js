// @ts-check
// Lexical entry (EvoLex lex_entry.html): one BLR reconstruction with its
// reflexes on a map and in a faceted table. Filters apply to both.
import { h } from "preact";
import { facets, sql, table, where } from "../data/db.js";
import { href, list, navigate } from "../components/router.js";
import { BranchLegend, PointMap, branchColor } from "../components/map.js";
import { DataTable, FacetPanel, Pagination, Status, fmt, nextSort, useData } from "../components/ui.js";

const PAGE_SIZE = 50;
const FACETS = [
    { field: "branch", label: "Branch" },
    { field: "pos", label: "Part of speech" },
    { field: "semantic_field", label: "Semantic field" },
];
const SLOTS = [
    ["Consonants", ["c1", "c2", "c3", "c4", "cs"]],
    ["Vowels", ["v11", "v12", "v21", "v22", "v3", "v4"]],
    ["Tones", ["t11", "t12", "t21", "t22", "t3", "t4"]],
];

export function Entry({ id: blr, params }) {
    const head = useData(async () => {
        const [root] = await sql("SELECT * FROM evolex_etyma WHERE blr_index = ?", [Number(blr)]);
        if (!root) return null;
        const [slots] = await sql("SELECT * FROM blr_reconstruction WHERE id = ?", [root.id]);
        const senses = await sql(
            "SELECT sense, reflexes FROM evolex_sense WHERE reconstruction_id = ? ORDER BY reflexes DESC, sense LIMIT 12", [root.id]);
        return { root, slots, senses };
    }, [blr]);

    return h(Status, { state: head },
        head.data === null ? h("article", null, `No reconstruction with BLR index ${blr}.`)
            : head.data && h(EntryBody, { ...head.data, params }));
}

function EntryBody({ root, slots, senses, params }) {
    const page = Number(params.page || 0);
    const sort = { column: params.sort || "branch", direction: params.dir === "DESC" ? "DESC" : "ASC" };
    const filters = { reconstruction_id: { type: "multi", selected: [root.id] } };
    for (const { field } of FACETS) {
        const selected = list(params[field]);
        if (selected.length) filters[field] = { type: "multi", selected };
    }
    if (params.q) filters.q = { type: "contains", columns: ["term", "variety", "meaning", "translation", "guthrie"], query: params.q };
    const fkey = JSON.stringify(filters);
    const go = (changes) => navigate("entry", root.blr_index, { ...params, page: "", ...changes }, { replace: true });

    const rows = useData(() => table("evolex_reflex", { filters, sort, page, pageSize: PAGE_SIZE }), [fkey, page, sort.column, sort.direction]);
    const meta = useData(() => facets("evolex_reflex", FACETS.map((f) => f.field), filters), [fkey]);
    const points = useData(() => mapPoints(filters), [fkey]);

    const columns = [
        { key: "branch", label: "Branch", render: (r) => h("span", null, h("span", { class: "evolex-dot", style: { background: branchColor(r.branch) } }), r.branch) },
        { key: "guthrie", label: "Guthrie" },
        { key: "variety", label: "Variety" },
        { key: "term", label: "Reflex", render: (r) => h("span", { class: "evolex-form" }, r.term) },
        { key: "morph", label: "Morphology", render: (r) => r.morph && h("span", { class: "evolex-form" }, r.morph) },
        { key: "pos", label: "PoS" },
        { key: "meaning", label: "Definition", render: (r) => h("span", null, r.meaning || r.translation,
            r.meaning && r.translation && r.translation !== r.meaning && h("small", { class: "evolex-muted" }, " (", r.translation, ")")) },
        { key: "source", label: "Source", render: (r) => r.source && h("a", { href: href("sources", null, { q: r.source }) }, r.source, r.pages ? ` (p. ${r.pages})` : "") },
    ];
    const struct = SLOTS.map(([label, keys]) => [label, keys.filter((k) => slots?.[k] && slots[k] !== "∅").map((k) => [k, slots[k]])]);

    return h("div", null,
        h("nav", { "aria-label": "breadcrumb" }, h("ul", null,
            h("li", null, h("a", { href: href("etyma") }, "Etyma")), h("li", null, `BLR ${root.blr_index}`))),
        h("article", { class: "evolex-entry-head" },
            h("header", null,
                h("hgroup", null,
                    h("h1", null, h("small", { class: "evolex-muted" }, "Proto-Bantu "), h("span", { class: "evolex-form" }, "*", root.word_tone || root.word)),
                    h("p", null, h("strong", null, `‘${root.english}’`), root.french && h("span", { class: "evolex-muted" }, ` · ${root.french}`))),
                h("a", { href: href("etymograph", root.blr_index), role: "button", class: "outline" }, "Etymograph ›")),
            h("dl", { class: "evolex-facts" },
                fact("BLR index", root.blr_index),
                fact("Without tone", root.word_tone ? h("span", { class: "evolex-form" }, "*", root.word) : null),
                fact("Noun class", root.noun_class),
                fact("Attested in zones", root.distribution),
                fact("Reliability", root.reliability),
                fact("Contributor", root.contributor),
                fact("Reflexes", `${fmt(root.reflexes)} in ${fmt(root.varieties)} varieties`)),
            struct.some(([, v]) => v.length) && h("div", { class: "evolex-slots" },
                struct.map(([label, values]) => values.length > 0 && h("span", { key: label },
                    h("small", { class: "evolex-muted" }, label, " "),
                    values.map(([k, v]) => h("code", { key: k, title: k.toUpperCase() }, v))))),
            senses.length > 0 && h("p", { class: "evolex-senses" },
                h("small", { class: "evolex-muted" }, "Senses in reflexes: "),
                senses.map((s) => h("span", { key: s.sense, class: "evolex-chip" }, s.sense, h("small", null, ` ${s.reflexes}`)))),
            root.note && h("footer", null, h("small", null, root.note))),
        h("div", { class: "evolex-faceted" },
            h(FacetPanel, {
                defs: FACETS, meta: meta.data,
                selected: Object.fromEntries(FACETS.map(({ field }) => [field, list(params[field])])),
                onChange: (field, values) => go({ [field]: values }),
            },
                h("input", {
                    type: "search", placeholder: "Filter reflexes…", value: params.q || "", "aria-label": "Filter reflexes",
                    onChange: (e) => go({ q: e.currentTarget.value.trim() }),
                })),
            h("section", null,
                h(Status, { state: points },
                    points.data && h("div", null,
                        h(PointMap, { points: points.data, height: "380px" }),
                        h("small", { class: "evolex-muted" }, `${fmt(points.data.length)} varieties with coordinates. `),
                        h(BranchLegend, { branches: [...new Set(points.data.map((p) => p.branch))].sort() }))),
                h(Status, { state: rows },
                    rows.data && h("div", null,
                        h("h2", null, `${fmt(rows.data.totalRows)} reflexes`),
                        h(DataTable, {
                            columns, rows: rows.data.rows, sort,
                            onSort: (column) => { const n = nextSort(sort, column); go({ sort: n.column, dir: n.direction }); },
                        }),
                        rows.data.totalPages > 1 && h(Pagination, {
                            page: rows.data.page, totalPages: rows.data.totalPages,
                            onPageChange: (p) => go({ page: p || "" }),
                        }))))));
}

const fact = (label, value) => value != null && value !== "" && [h("dt", { key: label + "t" }, label), h("dd", { key: label + "d" }, value)];

/** One point per variety (average of its reflex coordinates) for the current filters. */
async function mapPoints(filters) {
    const { whereClause, bindParams } = where(filters);
    const rows = await sql(
        `SELECT variety_id, variety, guthrie, branch, AVG(latitude) AS lat, AVG(longitude) AS lon,
                COUNT(*) AS n, group_concat(term, ' · ') AS terms
         FROM evolex_reflex ${whereClause}${whereClause ? " AND" : " WHERE"} latitude IS NOT NULL
         GROUP BY variety_id`, bindParams);
    return rows.map((r) => ({
        lon: r.lon, lat: r.lat, branch: r.branch, color: branchColor(r.branch), radius: 4 + Math.min(4, r.n),
        popup: { title: `${r.variety} (${r.guthrie ?? "?"})`, lines: [r.terms.length > 120 ? r.terms.slice(0, 120) + "…" : r.terms, r.branch ?? ""] },
    }));
}
