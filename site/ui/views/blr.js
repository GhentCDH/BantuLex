// @ts-check
import { h } from "preact";
import { useApp } from "../context.js";
import { useT } from "../i18n.js";
import { href, navigate } from "../route.js";
import { useQuery } from "../use-query.js";
import { readState, writeState } from "../search-state.js";
import { Results } from "../components/results.js";
import { SoundStructureDisplay } from "../components/sound-structure.js";
import { Facts } from "../components/facts.js";

/** One BLR index: its reconstruction (when there is one) and all its reflexes. */
export function BlrView({ index, params }) {
    const t = useT();
    const { store } = useApp();
    const state = readState(params);
    const update = (changes, options) =>
        navigate(`/blr/${encodeURIComponent(index)}`, writeState({ ...state, ...changes }), options);
    // Reflexes can carry BLR indexes without a reconstruction (e.g. "banana_09").
    const numeric = /^\d+$/.test(index);
    const { data: blr, loading } = useQuery(
        () =>
            numeric
                ? store
                      .queryTable("blr_reconstruction", {
                          filters: { blr_index: { type: "multi", selected: [Number(index)] } },
                          pageSize: 1,
                      })
                      .then((result) => result.rows[0] ?? null)
                : null,
        index,
    );

    return h("article", { class: "detail" },
        h("a", { class: "back-link", href: href("/") }, `← ${t("back")}`),
        h("header", { class: "detail-head" },
            h("p", { class: "eyebrow" }, t("blrTitle", index)),
            h("h1", { class: "reconstruction" }, blr ? `*${blr.word_tone || blr.word}` : t("blrTitle", index)),
            blr && h("p", { class: "glosses" },
                blr.english && h("span", { lang: "en" }, `‘${blr.english}’`),
                blr.french && h("span", { lang: "fr", class: "muted" }, `‘${blr.french}’`))),
        !loading && !blr && h("p", { class: "notice" }, t("noReconstruction")),
        blr && h("div", { class: "detail-grid" },
            h("section", { class: "card" },
                h("h2", null, t("reconstruction")),
                h(Facts, {
                    row: blr,
                    fields: ["word", "word_tone", "noun_class", "distribution", "proto_kk", "reliability", "contributor", "note"],
                })),
            h("section", { class: "card" },
                h("h2", null, t("soundStructure")),
                h(SoundStructureDisplay, { row: blr }))),
        h("h2", { class: "section-title" }, t("reflexesOfBlr")),
        h(Results, {
            state,
            update,
            baseFilters: { blr_index: { type: "values", selected: [index] } },
            hiddenColumns: ["blr_index", "blr_word"],
        }),
    );
}
