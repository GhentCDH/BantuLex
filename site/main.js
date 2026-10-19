// @ts-check
// Composition root: opens the database with the Pihka engine and mounts the
// BantuLex UI. Nothing of Pihka's default UI is loaded.
import { h, render } from "preact";
import { openDataset } from "./core/engine/index.js";
import * as filters from "./engine/filters.js";
import { App } from "./ui/app.js";
import { Status } from "./ui/components/status.js";

const MB = 1024 * 1024;

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
        if (config.databaseVersion) databaseUrl.searchParams.set("v", String(config.databaseVersion));

        const session = await openDataset({
            databaseUrl: databaseUrl.href,
            config: {
                datasource: config.datasource,
                enrichment: config.enrichment,
                perspectives: config.perspectives.map(({ id, table, query }) => ({ id, table, query })),
            },
            plugins: [filters],
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
