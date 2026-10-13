// @ts-check
// Small force-directed graph in SVG, without d3: the layout is computed once
// (a few hundred iterations of repulsion + spring forces) and then rendered.
// Enough for the ≤ 30 senses of one etymon.
import { h } from "preact";
import { useMemo } from "preact/hooks";

const W = 760, H = 520;

/**
 * nodes: [{ id, label, size }]; edges: [{ source, target, weight }] (shown);
 * layoutEdges: edges used for the layout (default: edges);
 * selected: node id or "a|b" edge key; onNode(id), onEdge(edge).
 */
export function ForceGraph({ nodes, edges, layoutEdges = edges, selected, onNode, onEdge }) {
    // Layout from all edges, so hiding edges (θ) does not move the nodes.
    const pos = useMemo(() => layout(nodes, layoutEdges), [nodes, layoutEdges]);
    const maxW = Math.max(1, ...edges.map((e) => e.weight));
    const maxSize = Math.max(1, ...nodes.map((n) => n.size));
    return h("svg", { viewBox: `0 0 ${W} ${H}`, class: "evolex-graph", role: "img", "aria-label": "Sense graph" },
        edges.map((e) => {
            const a = pos.get(e.source), b = pos.get(e.target);
            const key = `${e.source}|${e.target}`;
            return h("line", {
                key, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                class: `evolex-edge${selected === key ? " is-selected" : ""}${e.weight > 1 ? " is-shared" : ""}`,
                "stroke-width": 1 + 5 * Math.log1p(e.weight) / Math.log1p(maxW),
                onClick: () => onEdge?.(e),
            }, h("title", null, `${e.source} — ${e.target}: ${e.weight} root(s)`));
        }),
        nodes.map((n) => {
            const p = pos.get(n.id);
            const r = 6 + 16 * Math.sqrt(n.size / maxSize);
            return h("g", {
                key: n.id, class: `evolex-node${selected === n.id ? " is-selected" : ""}`,
                transform: `translate(${p.x},${p.y})`, onClick: () => onNode?.(n.id),
            },
                h("circle", { r }),
                h("text", { y: r + 13, "text-anchor": "middle" }, n.label),
                h("title", null, `${n.label}: ${n.size} reflex(es)`));
        }));
}

function layout(nodes, edges) {
    // Fruchterman–Reingold in a unit square, then scaled to fit the view.
    const n = Math.max(1, nodes.length);
    const k = Math.sqrt(1 / n);
    const pts = nodes.map((node, i) => {
        const a = (2 * Math.PI * i) / n;
        return { id: node.id, x: 0.5 + 0.35 * Math.cos(a), y: 0.5 + 0.35 * Math.sin(a), dx: 0, dy: 0 };
    });
    const byId = new Map(pts.map((p) => [p.id, p]));
    const steps = 400;
    for (let step = 0; step < steps; step++) {
        const t = 0.1 * (1 - step / steps) + 0.002;
        for (const p of pts) { p.dx = 0; p.dy = 0; }
        for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
                const a = pts[i], b = pts[j];
                const dx = a.x - b.x, dy = a.y - b.y;
                const d = Math.max(1e-4, Math.hypot(dx, dy));
                const f = (k * k) / d;
                a.dx += (dx / d) * f; a.dy += (dy / d) * f;
                b.dx -= (dx / d) * f; b.dy -= (dy / d) * f;
            }
        }
        for (const e of edges) {
            const a = byId.get(e.source), b = byId.get(e.target);
            const dx = a.x - b.x, dy = a.y - b.y;
            const d = Math.max(1e-4, Math.hypot(dx, dy));
            // Edges seen in one root only pull weakly; recurrent pairs pull harder.
            const f = ((d * d) / k) * (e.weight > 1 ? 0.6 + Math.log(e.weight) : 0.15);
            a.dx -= (dx / d) * f; a.dy -= (dy / d) * f;
            b.dx += (dx / d) * f; b.dy += (dy / d) * f;
        }
        for (const p of pts) {
            p.dx += (0.5 - p.x) * 0.3 * k; p.dy += (0.5 - p.y) * 0.3 * k;
            const d = Math.max(1e-4, Math.hypot(p.dx, p.dy));
            p.x += (p.dx / d) * Math.min(d, t);
            p.y += (p.dy / d) * Math.min(d, t);
        }
    }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = Math.min((W - 140) / Math.max(1e-6, x1 - x0), (H - 80) / Math.max(1e-6, y1 - y0));
    for (const p of pts) {
        p.x = W / 2 + (p.x - (x0 + x1) / 2) * scale;
        p.y = H / 2 - 8 + (p.y - (y0 + y1) / 2) * scale;
    }
    return byId;
}
