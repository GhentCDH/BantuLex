// @ts-check
import { h } from "preact";
import { useState } from "preact/hooks";
import { AppContext } from "./context.js";
import { LangContext, LANGUAGES, initialLang, useT } from "./i18n.js";
import { href, match, useRoute } from "./route.js";
import { SearchView } from "./views/search.js";
import { BlrView } from "./views/blr.js";
import { ReflexView } from "./views/reflex.js";

const LOGO = new URL("../core/assets/logo/ghentcdh_logo_blue_text_transparent_bg_square.svg", import.meta.url).href;

export function App({ store, config }) {
    const [lang, setLang] = useState(initialLang);
    const changeLang = (next) => {
        setLang(next);
        document.documentElement.lang = next;
        try {
            localStorage.setItem("bantulex-lang", next);
        } catch {}
    };
    return h(AppContext.Provider, { value: { store, config } },
        h(LangContext.Provider, { value: lang },
            h(Shell, { lang, changeLang })));
}

function Shell({ lang, changeLang }) {
    const t = useT();
    const { path, params } = useRoute();
    let blr, reflex;
    const page = (blr = match("/blr/:index", path))
        ? h(BlrView, { key: path, index: blr.index, params })
        : (reflex = match("/reflex/:id", path))
          ? h(ReflexView, { key: path, id: Number(reflex.id) })
          : h(SearchView, { params });
    // On large screens the search and BLR pages fill the screen and scroll
    // inside their results; the reflex page is a document.
    const fill = reflex ? "" : blr ? "fill-split" : "fill-search";

    return h("div", { class: `shell ${fill}` },
        h(Header, { lang, changeLang }),
        h("main", { class: "site-main" }, page),
        h("footer", { class: "site-footer" },
            h("p", null, t("aboutText")),
            h("a", { href: "https://www.ghentcdh.ugent.be", target: "_blank", rel: "noopener noreferrer" },
                h("img", { src: LOGO, alt: "Ghent Centre for Digital Humanities", width: 36, height: 36 }))),
    );
}

function Header({ lang, changeLang }) {
    const t = useT();
    return h("header", { class: "site-header" },
        h("a", { class: "brand", href: href("/") },
            h("span", { class: "brand-mark", "aria-hidden": "true" }, "BL"),
            h("span", null, "BantuLex")),
        h("nav", { class: "header-tools" },
            h("div", { class: "segmented", role: "group", "aria-label": "Language" },
                LANGUAGES.map((code) =>
                    h("button", {
                        type: "button",
                        "aria-pressed": code === lang,
                        onClick: () => changeLang(code),
                    }, code.toUpperCase()))),
            h("button", { type: "button", class: "icon-button", title: t("theme"), "aria-label": t("theme"), onClick: toggleTheme },
                h("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": "true" },
                    h("circle", { cx: 8, cy: 8, r: 6.5, fill: "none", stroke: "currentColor", "stroke-width": 1.5 }),
                    h("path", { d: "M8 1.5a6.5 6.5 0 0 1 0 13z", fill: "currentColor" })))));
}

function toggleTheme() {
    const root = document.documentElement;
    const dark = root.dataset.theme
        ? root.dataset.theme === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try {
        localStorage.setItem("bantulex-theme", root.dataset.theme);
    } catch {}
}
