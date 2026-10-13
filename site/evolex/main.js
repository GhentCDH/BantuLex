// @ts-check
// BantuLex EvoLex: an EvoLex/EvoSem-style etymological dictionary on Pihka's
// data engine. Served at app/evolex/ next to the Pihka data browser.
import { h, render } from "preact";
import { useEffect } from "preact/hooks";
import { useRoute } from "./components/router.js";
import { Layout } from "./components/ui.js";
import { Home } from "./pages/home.js";
import { Etyma } from "./pages/etyma.js";
import { Entry } from "./pages/entry.js";
import { Etymograph } from "./pages/etymograph.js";
import { Sources } from "./pages/sources.js";

const PAGES = { home: Home, etyma: Etyma, entry: Entry, etymograph: Etymograph, sources: Sources };
const TITLES = { home: "About", etyma: "Etyma", entry: "Entry", etymograph: "Etymograph", sources: "Sources" };

function App() {
    const route = useRoute();
    const Page = PAGES[route.page] ?? Home;
    useEffect(() => {
        document.title = `BantuLex EvoLex · ${TITLES[route.page] ?? "About"}${route.id ? " " + route.id : ""}`;
        scrollTo(0, 0);
    }, [route.page, route.id]);
    return h(Layout, { page: route.page }, h(Page, { key: `${route.page}/${route.id}`, id: route.id, params: route.params }));
}

const root = /** @type {HTMLElement} */ (document.getElementById("app"));
root.textContent = ""; // drop the static "Loading" placeholder
render(h(App, null), root);
