// @ts-check
// Etymograph (EvoSem etymograph.html): the senses that the reflexes of one
// BLR root express, as a graph. An edge links two senses of this root; its
// weight is the number of BLR roots in BantuLex whose reflexes show the same
// pair (this root included). Heavy edges are recurrent polysemies or shifts.
// Senses come from the free-text English `meaning` of reflexes, normalised by
// `just site-db` (evolex_sense, evolex_sense_pair): an approximation until
// reflexes are mapped to concepts.
import { h } from "preact";
import { useMemo, useState } from "preact/hooks";
import { sql } from "../data/db.js";
import { href, navigate } from "../components/router.js";
import { ForceGraph } from "../components/force-graph.js";
import { Status, fmt, useData } from "../components/ui.js";

const MAX_NODES = 30;

export function Etymograph({ id: blr, params }) {
    const theta = Number(params.theta ?? 1);
    const [selected, setSelected] = useState(/** @type {string|null} */ (null));

    const graph = useData(async () => {
        const [root] = await sql("SELECT id, blr_index, word, word_tone, english FROM evolex_etyma WHERE blr_index = ?", [Number(blr)]);
        if (!root) return null;
        const senses = await sql(
            "SELECT sense, reflexes, varieties FROM evolex_sense WHERE reconstruction_id = ? ORDER BY reflexes DESC, sense LIMIT ?",
            [root.id, MAX_NODES]);
        const names = senses.map((s) => s.sense);
        const marks = names.map(() => "?").join(", ");
        const shared = names.length < 2 ? [] : await sql(
            `SELECT sense_a, sense_b, weight FROM evolex_sense_pair WHERE sense_a IN (${marks}) AND sense_b IN (${marks})`,
            [...names, ...names]);
        const weights = new Map(shared.map((p) => [`${p.sense_a}|${p.sense_b}`, p.weight]));
        const edges = [];
        const sorted = [...names].sort();
        for (let i = 0; i < sorted.length; i++)
            for (let j = i + 1; j < sorted.length; j++)
                edges.push({ source: sorted[i], target: sorted[j], weight: weights.get(`${sorted[i]}|${sorted[j]}`) ?? 1 });
        return { root, senses, edges };
    }, [blr]);

    return h(Status, { state: graph },
        graph.data === null ? h("article", null, `No reconstruction with BLR index ${blr}.`)
            : graph.data && h(Body, { ...graph.data, theta, selected, setSelected }));
}

function Body({ root, senses, edges, theta, selected, setSelected }) {
    const maxWeight = Math.max(1, ...edges.map((e) => e.weight));
    const visible = edges.filter((e) => e.weight >= theta);
    const nodes = useMemo(() => senses.map((s) => ({ id: s.sense, label: s.sense, size: s.reflexes })), [senses]);
    const setTheta = (value) => navigate("etymograph", root.blr_index, { theta: value === 1 ? "" : value }, { replace: true });

    return h("div", null,
        h("nav", { "aria-label": "breadcrumb" }, h("ul", null,
            h("li", null, h("a", { href: href("etyma") }, "Etyma")),
            h("li", null, h("a", { href: href("entry", root.blr_index) }, `BLR ${root.blr_index}`)),
            h("li", null, "Etymograph"))),
        h("hgroup", null,
            h("h1", null, "Etymograph ", h("span", { class: "evolex-form" }, "*", root.word_tone || root.word)),
            h("p", null, `‘${root.english}’ · ${senses.length} senses in the reflexes`)),
        senses.length < 2
            ? h("article", null, "Too few distinct reflex meanings for a graph.")
            : h("div", { class: "evolex-graph-layout" },
                h("div", null,
                    h("label", null,
                        `Minimum shared roots θ = ${theta} `,
                        h("small", { class: "evolex-muted" }, `(${visible.length} of ${edges.length} edges)`),
                        h("input", {
                            type: "range", min: 1, max: maxWeight, value: Math.min(theta, maxWeight),
                            onInput: (e) => setTheta(Number(e.currentTarget.value)),
                        })),
                    h(ForceGraph, {
                        nodes, edges: visible, layoutEdges: edges, selected,
                        onNode: (id) => setSelected(id),
                        onEdge: (e) => setSelected(`${e.source}|${e.target}`),
                    }),
                    h("small", { class: "evolex-muted" },
                        "Node size: number of reflexes with that sense. Edge width: number of BLR roots whose reflexes show both senses. Click a node or an edge.")),
                h("aside", null,
                    !selected ? h("p", { class: "evolex-muted" }, "Select a sense or a link.")
                        : selected.includes("|") ? h(EdgeDetail, { pair: selected.split("|"), root })
                            : h(NodeDetail, { sense: selected, root }))));
}

function NodeDetail({ sense, root }) {
    const rows = useData(() => sql(
        `SELECT term, variety, guthrie, meaning FROM evolex_reflex
         WHERE reconstruction_id = ? AND lower(meaning) LIKE ? ORDER BY variety LIMIT 60`,
        [root.id, `%${sense}%`]), [sense, root.id]);
    return h("div", null,
        h("h3", null, `‘${sense}’`),
        h(Status, { state: rows }, rows.data && h("ul", { class: "evolex-compact" },
            rows.data.map((r, i) => h("li", { key: i },
                h("span", { class: "evolex-form" }, r.term), " ",
                h("small", { class: "evolex-muted" }, `${r.variety} (${r.guthrie ?? "?"}) — ${r.meaning}`))))));
}

function EdgeDetail({ pair: [a, b], root }) {
    const rows = useData(() => sql(
        `SELECT e.blr_index, e.word, e.english, e.reflexes FROM evolex_sense x
         JOIN evolex_sense y ON y.reconstruction_id = x.reconstruction_id AND y.sense = ?
         JOIN evolex_etyma e ON e.id = x.reconstruction_id
         WHERE x.sense = ? ORDER BY e.reflexes DESC`, [b, a]), [a, b]);
    return h("div", null,
        h("h3", null, `‘${a}’ — ‘${b}’`),
        h(Status, { state: rows }, rows.data && h("div", null,
            h("p", null, `${fmt(rows.data.length)} BLR root(s) with both senses:`),
            h("ul", { class: "evolex-compact" }, rows.data.map((r) => h("li", { key: r.blr_index },
                r.blr_index === root.blr_index
                    ? h("strong", null, h("span", { class: "evolex-form" }, "*", r.word), ` ‘${r.english}’ (this root)`)
                    : h("span", null,
                        h("a", { href: href("etymograph", r.blr_index) }, h("span", { class: "evolex-form" }, "*", r.word)),
                        ` ‘${r.english}’ `, h("a", { href: href("entry", r.blr_index), class: "evolex-muted" }, "entry"))))))));
}
