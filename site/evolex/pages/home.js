// @ts-check
// Dictionary home (EvoLex home_<Family>.html): what BantuLex EvoLex is, live
// statistics, a map of all varieties, the most widely attested roots, and
// the data that is still missing for full EvoLex/EvoSem parity.
import { h } from "preact";
import { sql } from "../data/db.js";
import { href, navigate } from "../components/router.js";
import { BranchLegend, PointMap, branchColor } from "../components/map.js";
import { Status, fmt, useData } from "../components/ui.js";

export function Home() {
    const stats = useData(async () => {
        const [counts] = await sql(`SELECT
            (SELECT COUNT(*) FROM evolex_etyma) AS roots,
            (SELECT COUNT(*) FROM evolex_etyma WHERE reflexes > 0) AS attested,
            (SELECT COUNT(*) FROM evolex_reflex) AS reflexes,
            (SELECT COUNT(*) FROM evolex_variety WHERE reflexes > 0) AS varieties,
            (SELECT COUNT(*) FROM evolex_variety WHERE latitude IS NOT NULL) AS mapped,
            (SELECT COUNT(*) FROM evolex_source WHERE reflexes > 0) AS sources`);
        const top = await sql(
            "SELECT blr_index, word, word_tone, english, reflexes, varieties FROM evolex_etyma ORDER BY reflexes DESC LIMIT 12");
        return { counts, top };
    }, []);
    const varieties = useData(async () => (await sql(
        "SELECT id, name, guthrie, branch, reflexes, latitude, longitude FROM evolex_variety WHERE latitude IS NOT NULL")).map((v) => ({
            lon: v.longitude, lat: v.latitude, color: branchColor(v.branch), radius: 4,
            popup: { title: `${v.name} (${v.guthrie ?? "?"})`, lines: [v.branch ?? "", `${fmt(v.reflexes)} reflexes`] },
        })), []);

    const random = async () => {
        const [{ n }] = await sql("SELECT COUNT(*) AS n FROM evolex_etyma WHERE reflexes >= 5");
        const [row] = await sql("SELECT blr_index FROM evolex_etyma WHERE reflexes >= 5 LIMIT 1 OFFSET ?", [Math.floor(Math.random() * n)]);
        navigate("entry", row.blr_index);
    };

    return h("div", null,
        h("section", { class: "evolex-hero" },
            h("hgroup", null,
                h("h1", null, "BantuLex EvoLex"),
                h("p", null, "An etymological dictionary of Bantu: Proto-Bantu roots (BLR) with their reflexes across the Bantu languages.")),
            h("p", null,
                "Each entry brings together a reconstruction from the Bantu Lexical Reconstructions (BLR) and the reflexes collected in BantuLex: ",
                "the forms, meanings and sources per language variety, on a map. The etymograph shows which meanings the reflexes of a root express, ",
                "and which of these meaning pairs recur across other roots."),
            h("div", { class: "evolex-actions" },
                h("a", { href: href("etyma", null, { has_reflexes: "yes" }), role: "button" }, "Open the dictionary"),
                h("button", { class: "secondary", onClick: random }, "Random entry"))),
        h(Status, { state: stats }, stats.data && h("div", { class: "evolex-stats" },
            stat(stats.data.counts.roots, "BLR reconstructions"),
            stat(stats.data.counts.attested, "with reflexes in BantuLex"),
            stat(stats.data.counts.reflexes, "linked reflexes"),
            stat(stats.data.counts.varieties, "language varieties"),
            stat(stats.data.counts.sources, "sources"))),
        h("section", null,
            h("h2", null, "Language varieties"),
            h(Status, { state: varieties }, varieties.data && h("div", null,
                h(PointMap, { points: varieties.data, height: "460px" }),
                h("small", { class: "evolex-muted" }, `${fmt(varieties.data.length)} varieties with coordinates, coloured by branch.`),
                h(BranchLegend, null)))),
        h(Status, { state: stats }, stats.data && h("section", null,
            h("h2", null, "Most widely attested roots"),
            h("div", { class: "evolex-cards" }, stats.data.top.map((r) => h("a", { key: r.blr_index, href: href("entry", r.blr_index), class: "evolex-card" },
                h("span", { class: "evolex-form" }, "*", r.word_tone || r.word), h("span", null, `‘${r.english}’`),
                h("small", { class: "evolex-muted" }, `${fmt(r.reflexes)} reflexes · ${fmt(r.varieties)} varieties`)))))),
        h(DataGaps, null));
}

const stat = (n, label) => h("article", { class: "evolex-stat" }, h("strong", null, fmt(n)), h("small", null, label));

/** What BantuLex lacks compared to EvoLex/EvoSem (see README.md). */
function DataGaps() {
    const gaps = [
        ["Concepts", "Reflex meanings are free text (`meaning`, `translation`). EvoSem maps every gloss to concepts (ES_Gloss); here senses are normalised strings, so the etymograph is an approximation."],
        ["Language identifiers", "No Glottocode or ISO 639-3 per variety: needed to link to Glottolog/EvoSem and to place languages consistently."],
        ["Classification tree", "Only the Guthrie code and a flat `branch`; `branch_detailed` is a path for West-Coastal Bantu only. No proto-language levels (e.g. Proto-Eastern Bantu) for intermediate reconstructions."],
        ["Morphology", "`term_morph_analysis` is free-form and filled for 39% of reflexes; no separate prefix / stem / suffix or noun-class prefix of the reflex."],
        ["Cognacy", "A reflex links to one BLR root; no certainty, partial cognacy or loan flag (loans are only mentioned in notes)."],
        ["Entry notes and illustrations", "Root-level notes are rare (3%) and there are no pictures (EvoLex Public_note, Picture_URL)."],
        ["Bibliography", "Sources have an author/year and title, but no formatted full reference, URL or PDF page."],
        ["Sound correspondences", "BLR gives the C/V/T structure of roots, but there are no correspondence sets per language."],
    ];
    return h("section", null,
        h("h2", null, "Not yet in the data"),
        h("p", { class: "evolex-muted" }, "Compared to EvoLex and EvoSem, these parts are missing from the BantuLex database:"),
        h("dl", { class: "evolex-gaps" }, gaps.flatMap(([t, d]) => [h("dt", { key: t }, t), h("dd", { key: t + "d" }, withCode(d))])),
        h("p", { class: "evolex-muted" }, "BantuLex adds what EvoLex does not have: the consonant/vowel/tone structure of roots, reliability, noun classes, fieldwork provenance and source roles."));
}

/** "a `b` c" → text with <code> for the backticked parts. */
const withCode = (text) => text.split("`").map((part, i) => (i % 2 ? h("code", { key: i }, part) : part));
