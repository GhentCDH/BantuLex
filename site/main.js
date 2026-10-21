// @ts-check
// Composition root: opens the database with the Pihka engine and mounts the
// BantuLex UI. Nothing of Pihka's default UI is loaded.
import { h, render } from "preact";
import { DataSource } from "./core/engine/datasource.js";
import { openDataset } from "./core/engine/index.js";
import * as filters from "./engine/filters.js";
import { App } from "./ui/app.js";
import { Status } from "./ui/components/status.js";

const MB = 1024 * 1024;

/**
 * The download datasource, but materialized perspective tables already in the
 * file are dropped from the in-memory copy, so the engine rebuilds them.
 * The admin does not update such a table (for example one written by Pihka's
 * prepareSampleDatabase), so reusing it would show stale data.
 * @param {string[]} tables
 */
function freshPerspectives(tables) {
    return {
        register(api) {
            api.registerDataSource("download", (url) => {
                const ds = new DataSource(url);
                ds.ready = ds.ready.then(async () => {
                    const stale = await ds.exec(
                        `SELECT name FROM sqlite_schema WHERE type = 'table' AND name COLLATE NOCASE IN (${tables.map(() => "?").join(", ")})`,
                        { bind: tables },
                    );
                    for (const { name } of stale) {
                        console.warn(`[bantulex] "${name}" is a stale copy in the database file; rebuilding it.`);
                        await ds.exec(`DROP TABLE "${String(name).replaceAll('"', '""')}"`);
                    }
                });
                return ds;
            });
        },
    };
}

async function main() {
    const element = /** @type {HTMLElement} */ (document.getElementById("app"));
    // The static placeholder is not Preact's, so render() would keep it.
    element.replaceChildren();
    const status = (message, error = null) => render(h(Status, { message, error }), element);
    status("Loading…");
    try {
        const response = await fetch(new URL("./config.json", import.meta.url));
        if (!response.ok) throw new Error(`config.json: HTTP ${response.status}`);
        const config = await response.json();
        const databaseUrl = new URL(config.database, import.meta.url);

        const session = await openDataset({
            databaseUrl: databaseUrl.href,
            config: {
                datasource: config.datasource,
                enrichment: config.enrichment,
                // materialize, facets and default_sort let the engine build reflex_search with indexes.
                perspectives: config.perspectives.map(({ id, table, query, materialize, facets, default_sort }) => ({
                    id,
                    table,
                    query,
                    materialize,
                    facets,
                    default_sort,
                })),
            },
            plugins: [
                filters,
                freshPerspectives(config.perspectives.filter((p) => p.materialize).map((p) => p.table)),
            ],
            onProgress: ({ phase, bytes }) =>
                status(
                    phase === "loading" && bytes
                        ? `Downloading database (${(bytes / MB).toFixed(0)} MB)…`
                        : phase === "indexing"
                          ? "Preparing…"
                          : "Opening database…",
                ),
        });
        render(h(App, { store: session.store, config }), element);
        window.addEventListener("pagehide", (event) => {
            if (!event.persisted) session.close();
        });
    } catch (error) {
        console.error("[bantulex] startup failed:", error);
        status(null, error);
    }
}

main();
