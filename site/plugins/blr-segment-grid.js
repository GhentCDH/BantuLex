// @ts-check
/**
 * BLR segment grid: one facet that lays out the sound positions of a
 * reconstruction in word order (C₁ V₁₁ V₁₂ C₂ V₂₁ V₂₂ C₃ V₃ C₄ V₄ CS), with
 * each tone under its vowel, in a row above the results. It replaces the
 * per-position dropdowns of any perspective whose configured facets include
 * these fields, and filters through the same multi-select URL params
 * (e.g. `c1=b,p&v11=a`).
 *
 * Keyboard: a focused cell shows its values as a completion menu. Typing
 * filters it and selects a unique match, then moves to the next cell of the
 * row (`ng` is typed out); ↑/↓ and Enter pick from the menu, `0` or `-`
 * selects ∅, Backspace/Delete clear, and ←/→ move between cells.
 *
 *   "uiPlugins": ["app/plugins/blr-segment-grid.js"]
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { localize } from "../../core/ui/index.js";

const SEGMENTS = ["c1", "v11", "v12", "c2", "v21", "v22", "c3", "v3", "c4", "v4", "cs"];
const TONES = { v11: "t11", v12: "t12", v21: "t21", v22: "t22", v3: "t3", v4: "t4" };
const FIELDS = [...SEGMENTS, ...Object.values(TONES)];
const ROWS = [SEGMENTS, Object.values(TONES)];
const EMPTY = "∅";
const TYPEAHEAD_MS = 700;

export function register(api) {
    api.stylesheet(new URL("./blr-segment-grid.css", import.meta.url).href);
    api.registerComponent({
        kind: "facet",
        id: "blr-segments",
        supplemental: true,
        placement: "top",
        availableFor: (_auto, facetMeta) => !!facetMeta?.c1 && !!facetMeta?.v11,
        replacesFacets: (facetMeta) => FIELDS.filter((field) => facetMeta?.[field]),
        component: SegmentGrid,
    });
}

function SegmentGrid({ facetMeta, filters, actions, lang }) {
    // Completion state lives in a ref so fast key presses never read a stale
    // render; rerender() only refreshes the open menu.
    const completion = useRef({ field: null, text: "", active: 0, timer: 0 });
    const [, rerender] = useState(0);
    const update = (changes) => {
        Object.assign(completion.current, changes);
        rerender((n) => n + 1);
    };
    const candidates = (field) => {
        const { field: current, text } = completion.current;
        const options = facetMeta[field].options ?? [];
        return current === field && text ? options.filter((o) => String(o.value).startsWith(text)) : options;
    };
    const cell = (field) =>
        facetMeta[field]
            ? h(SegmentCell, {
                  field,
                  meta: facetMeta[field],
                  lang,
                  selected: filters[field]?.selected ?? [],
                  options: candidates(field),
                  typed: completion.current.field === field ? completion.current.text : "",
                  active: completion.current.field === field ? completion.current.active : -1,
                  onChange: (next) => actions.onMultiChange(field, next),
                  onKeyDown: (event) => handleKey(event, field, facetMeta, actions, completion.current, update, candidates),
                  onFocus: (event) => {
                      // Keyboard focus opens the menu; a mouse click toggles it itself.
                      if (!event.currentTarget.matches(":focus-visible")) return;
                      clearTimeout(completion.current.timer);
                      update({ field, text: "", active: 0 });
                      showPopover(field);
                  },
              })
            : h("span", { class: "blr-cell-empty" });
    const active = FIELDS.some((field) => filters[field]?.selected?.length);

    return h("div", { class: "blr-segments" },
        h("div", { class: "blr-segments-header" },
            h("span", { class: "facet-label" }, lang === "nl" ? "Klankstructuur" : "Sound structure"),
            active && h("button", {
                type: "button",
                class: "blr-clear outline",
                onClick: () => FIELDS.forEach((field) => filters[field] && actions.onMultiChange(field, new Set())),
            }, lang === "nl" ? "Wis" : "Clear"),
        ),
        h("div", { class: "blr-grid" },
            SEGMENTS.map((field) => h("span", { key: `h-${field}`, class: "blr-head" }, label(facetMeta, field, lang))),
            SEGMENTS.map((field) => h("span", { key: field, class: "blr-slot" }, cell(field))),
            SEGMENTS.map((field) => h("span", { key: `t-${field}`, class: "blr-slot blr-tone" }, TONES[field] ? cell(TONES[field]) : null)),
        ),
    );
}

function handleKey(event, field, facetMeta, actions, state, update, candidates) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const grid = event.currentTarget.closest(".blr-grid");
    const row = ROWS.find((r) => r.includes(field)).filter((f) => facetMeta[f]);
    const focus = (step) => {
        const target = row[row.indexOf(field) + step];
        if (target) grid.querySelector(`[data-field="${target}"]`)?.focus();
    };
    const pick = (option) => {
        update({ text: "", active: 0 });
        hidePopover(field);
        actions.onMultiChange(field, new Set([option.value]));
        focus(1);
    };
    if (state.field !== field) Object.assign(state, { field, text: "", active: 0 });
    clearTimeout(state.timer);

    switch (event.key) {
        case "ArrowRight":
        case "ArrowLeft":
            event.preventDefault();
            hidePopover(field);
            focus(event.key === "ArrowRight" ? 1 : -1);
            return;
        case "ArrowDown":
        case "ArrowUp": {
            event.preventDefault();
            showPopover(field);
            const count = candidates(field).length;
            if (count) update({ active: (state.active + (event.key === "ArrowDown" ? 1 : -1) + count) % count });
            return;
        }
        case "Enter": {
            const option = isOpen(field) && candidates(field)[state.active];
            // Without a highlighted option, Enter toggles the menu as usual.
            if (!option) return;
            event.preventDefault();
            pick(option);
            return;
        }
        case "Escape":
            update({ text: "", active: 0 });
            return;
        case "Backspace":
        case "Delete":
            event.preventDefault();
            // Backspace first edits the typed text, then clears the cell.
            if (state.text && event.key === "Backspace") {
                update({ text: state.text.slice(0, -1), active: 0 });
                return;
            }
            update({ text: "", active: 0 });
            hidePopover(field);
            actions.onMultiChange(field, new Set());
            if (event.key === "Backspace") focus(-1);
            return;
    }

    // Space opens the menu like Enter; other single characters type values.
    if (event.key.length !== 1 || event.key === " ") return;
    event.preventDefault();
    showPopover(field);
    const options = facetMeta[field].options ?? [];
    const key = event.key === "0" || event.key === "-" ? EMPTY : event.key;
    const matching = (text) => options.filter((o) => String(o.value).startsWith(text));
    let text = state.text + key;
    if (!matching(text).length) text = key;
    if (!matching(text).length) return;
    update({ text, active: 0 });

    const matches = matching(text);
    const exact = matches.find((o) => String(o.value) === text);
    // Pick at once when nothing longer is possible; otherwise wait for more
    // keys (e.g. "ng" after "n"), and keep the filtered menu if none is exact.
    if (exact && matches.length === 1) pick(exact);
    else if (exact) state.timer = setTimeout(() => pick(exact), TYPEAHEAD_MS);
}

const popoverOf = (field) => document.getElementById(`blr-pop-${field}`);
const isOpen = (field) => !!popoverOf(field)?.matches(":popover-open");
const showPopover = (field) => !isOpen(field) && popoverOf(field)?.showPopover();
// Popovers close only on Escape or an outside click, not when focus moves.
const hidePopover = (field) => isOpen(field) && popoverOf(field).hidePopover();

function SegmentCell({ field, meta, lang, selected, options, typed, active, onChange, onKeyDown, onFocus }) {
    const id = `blr-pop-${field}`;
    const chosen = new Set(selected);
    const toggle = (value) => {
        const next = new Set(chosen);
        next.has(value) ? next.delete(value) : next.add(value);
        onChange(next);
    };
    const name = label({ [field]: meta }, field, lang);
    const list = useRef(null);
    useEffect(() => {
        list.current?.querySelector(".blr-option-active")?.scrollIntoView({ block: "nearest" });
    }, [active, typed]);

    return h("span", { class: "blr-cell", style: `anchor-name: --${id}` },
        h("button", {
            type: "button",
            class: chosen.size ? "blr-trigger blr-trigger-active" : "blr-trigger",
            popovertarget: id,
            "data-field": field,
            onKeyDown,
            onFocus,
            title: chosen.size ? `${name}: ${selected.join(", ")}` : name,
            "aria-label": chosen.size ? `${name}: ${selected.join(", ")}` : name,
        }, chosen.size ? selected.join("/") : "·"),
        h("div", { id, popover: "auto", class: "blr-popover", style: `position-anchor: --${id}` },
            h("div", { class: "blr-popover-header" },
                h("strong", null, name),
                typed && h("span", { class: "blr-typed" }, `${typed}…`),
                chosen.size > 0 && h("button", {
                    type: "button",
                    class: "blr-clear outline",
                    onClick: () => onChange(new Set()),
                }, lang === "nl" ? "Wis" : "Clear"),
            ),
            h("div", { class: "facet-options", ref: list },
                options.map((opt, index) =>
                    h("label", {
                        key: opt.value,
                        class: [
                            "facet-option",
                            chosen.has(opt.value) && "facet-option-selected",
                            index === active && "blr-option-active",
                        ].filter(Boolean).join(" "),
                    },
                        h("input", { type: "checkbox", checked: chosen.has(opt.value), onChange: () => toggle(opt.value) }),
                        h("span", { class: "facet-option-label" }, opt.display),
                        opt.count != null && h("span", { class: "facet-option-count" }, opt.count),
                    ),
                ),
            ),
        ),
    );
}

const label = (facetMeta, field, lang) => localize(facetMeta[field]?.label, lang, field.toUpperCase());
