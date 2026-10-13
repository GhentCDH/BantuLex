// @ts-check
// One shared Pihka dataset for the whole EvoLex app: SQLite in a worker,
// read over HTTP range requests (no backend). Pages use `table()` and
// `facets()` (Pihka's DataStore) for faceted lists and `sql()` for the rest.
import { openDataset } from "../../../core/engine/index.js";
import { buildWhereClause } from "../../../core/engine/filter-sql.js";
import { createFilterRegistry } from "../../../core/engine/filter-registry.js";
import { HttpDataSource } from "../../../extensions/http-vfs/http-vfs-component.js";

const DB_URL = new URL("../../database/bantulex.sqlite", import.meta.url).href;
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** FTS5 query with every term quoted: punctuation and short words never break MATCH. */
const literal = (query) =>
    query.trim().split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");

/** Filter types on top of Pihka's built-ins (multi, range, m2m). */
export const FILTER_TYPES = {
    // { type: "fts", column, index, query }: rows whose column is a rowid hit in an FTS5 index.
    fts: {
        buildSql(_key, f) {
            const q = literal(f.query || "");
            // Trigram indexes need at least 3 characters per query.
            if (q.replace(/"/g, "").length < 3) return null;
            return {
                conditions: [`${quote(f.column)} IN (SELECT rowid FROM ${quote(f.index)} WHERE ${quote(f.index)} MATCH ?)`],
                params: [q],
            };
        },
    },
    // { type: "contains", columns, query }: case-insensitive substring in any of the columns.
    contains: {
        buildSql(_key, f) {
            const q = (f.query || "").trim();
            if (!q) return null;
            const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
            return {
                conditions: [`(${f.columns.map((c) => `${quote(c)} LIKE ? ESCAPE '\\'`).join(" OR ")})`],
                params: f.columns.map(() => like),
            };
        },
    },
    // { type: "zone", selected }: etyma attested in one of the Guthrie zones.
    zone: {
        buildSql(_key, f) {
            if (!f.selected?.length) return null;
            return {
                conditions: [`"id" IN (SELECT etyma_id FROM evolex_etyma_zone WHERE zone IN (${f.selected.map(() => "?").join(", ")}))`],
                params: f.selected,
            };
        },
    },
};

/** @type {any} */
let ds = null;
const plugin = {
    register(api) {
        api.registerDataSource("http-vfs", (url, options) => (ds = new HttpDataSource(url, options)));
        for (const [type, def] of Object.entries(FILTER_TYPES)) api.registerFilterType(type, def);
    },
};

// The same filter types, for WHERE clauses of hand-written queries (maps, zone counts).
const registry = createFilterRegistry();
for (const [type, def] of Object.entries(FILTER_TYPES)) registry.register(type, def);
registry.seal();

export const dataset = openDataset({
    databaseUrl: DB_URL,
    // FTS indexes are prebuilt by `just site-db`; the "fts" filter uses them directly.
    config: { datasource: { type: "http-vfs", options: { cacheSize: 16384 } }, enrichment: { fts: false } },
    plugins: [plugin],
});

/** Raw SQL → array of row objects. */
export async function sql(query, bind = []) {
    await dataset;
    return ds.exec(query, { bind, rowMode: "object" });
}

/** WHERE clause (with leading "WHERE", or "") for a filter object, for use in sql(). */
export function where(filters, exclude = null) {
    return buildWhereClause(filters, { exclude, registry });
}

/** Pihka DataStore.queryTable: { rows, totalRows, page, totalPages, ... }. */
export async function table(name, options) {
    return (await dataset).store.queryTable(name, options);
}

/** Pihka DataStore.getFacetMeta for "values" facets: { field: { options: [{value, display, count}] } }. */
export async function facets(name, fields, filters) {
    return (await dataset).store.getFacetMeta(
        name,
        fields.map((field) => ({ field, type: "values" })),
        filters,
    );
}
