// @ts-check
/**
 * Sound structure (klankstructuur) of a BLR reconstruction: the sound
 * positions in word order (C₁ V₁₁ V₁₂ C₂ V₂₁ V₂₂ C₃ V₃ C₄ V₄ CS), with each
 * tone under its vowel. An empty cell matches anything; ∅ requires the
 * position to be empty.
 *
 * Keyboard: a focused cell shows its values as a completion menu. Typing
 * filters it and selects a unique match, then moves to the next cell of the
 * row (`ng` is typed out); ↑/↓ and Enter pick from the menu, `0` or `-`
 * selects ∅, Backspace/Delete clear, and ←/→ move between cells.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useT } from "../i18n.js";

const SEGMENTS = ["c1", "v11", "v12", "c2", "v21", "v22", "c3", "v3", "c4", "v4", "cs"];
const TONES = { v11: "t11", v12: "t12", v21: "t21", v22: "t22", v3: "t3", v4: "t4" };
export const STRUCTURE_FIELDS = [...SEGMENTS, ...Object.values(TONES)];
const ROWS = [SEGMENTS, Object.values(TONES)];
const EMPTY = "∅";
const TYPEAHEAD_MS = 700;

const SUBSCRIPTS = { 1: "₁", 2: "₂", 3: "₃", 4: "₄" };
/** "v11" → "V₁₁", "cs" → "CS". */
export const segmentLabel = (field) => field.replace(/\d/g, (d) => SUBSCRIPTS[d]).toUpperCase();

/**
 * Editable grid.
 * @param {{ options: Record<string, Array<{value: string, count?: number}>>,
 *   selected: Record<string, string[]>, onChange: (field: string, values: string[]) => void }} props
 */
export function SoundStructure({ options, selected, onChange }) {
    const t = useT();
    // Completion state lives in a ref so fast key presses never read a stale
    // render; rerender() only refreshes the open menu.
    const completion = useRef({ field: null, text: "", active: 0, timer: 0 });
    const [, rerender] = useState(0);
    const update = (changes) => {
        Object.assign(completion.current, changes);
        rerender((n) => n + 1);
    };
    const all = (field) => options[field] ?? [];
    const candidates = (field) => {
        const { field: current, text } = completion.current;
        return current === field && text ? all(field).filter((o) => String(o.value).startsWith(text)) : all(field);
    };
    const context = { all, candidates, onChange, update, state: completion.current };
    const cell = (field) =>
        h(SegmentCell, {
            field,
            selected: selected[field] ?? [],
            options: candidates(field),
            typed: completion.current.field === field ? completion.current.text : "",
            active: completion.current.field === field ? completion.current.active : -1,
            onChange: (next) => onChange(field, next),
            onKeyDown: (event) => handleKey(event, field, context),
            onFocus: (event) => {
                // Keyboard focus opens the menu; a mouse click toggles it itself.
                if (!event.currentTarget.matches(":focus-visible")) return;
                clearTimeout(completion.current.timer);
                update({ field, text: "", active: 0 });
                showPopover(field);
            },
        });
    const active = STRUCTURE_FIELDS.some((field) => selected[field]?.length);

    return h("section", { class: "panel structure", "aria-labelledby": "structure-title" },
        h("div", { class: "panel-head" },
            h("h2", { id: "structure-title" }, t("soundStructure")),
            active && h("button", {
                type: "button",
                class: "link-button",
                onClick: () => STRUCTURE_FIELDS.forEach((field) => selected[field]?.length && onChange(field, [])),
            }, t("clear"))),
        h("div", { class: "structure-grid" },
            SEGMENTS.map((field) => h("span", { key: `h-${field}`, class: "structure-head" }, segmentLabel(field))),
            SEGMENTS.map((field) => h("span", { key: field, class: "structure-slot" }, cell(field))),
            SEGMENTS.map((field) => h("span", { key: `t-${field}`, class: "structure-slot structure-tone" }, TONES[field] ? cell(TONES[field]) : null)),
        ),
        h("p", { class: "hint" }, t("soundStructureHint")),
    );
}

/** Read-only grid with the values of one reconstruction row. */
export function SoundStructureDisplay({ row }) {
    const t = useT();
    const value = (field) => {
        const v = row?.[field];
        return v == null || v === "" || v === EMPTY ? h("span", { class: "structure-none" }, EMPTY) : v;
    };
    return h("div", { class: "structure-grid structure-display", "aria-label": t("soundStructure") },
        SEGMENTS.map((field) => h("span", { key: `h-${field}`, class: "structure-head" }, segmentLabel(field))),
        SEGMENTS.map((field) => h("span", { key: field, class: "structure-value" }, value(field))),
        SEGMENTS.map((field) =>
            h("span", { key: `t-${field}`, class: "structure-value structure-tone" }, TONES[field] ? value(TONES[field]) : null)),
    );
}

function handleKey(event, field, { all, candidates, onChange, update, state }) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const grid = event.currentTarget.closest(".structure-grid");
    const row = ROWS.find((r) => r.includes(field));
    const focus = (step) => {
        const target = row[row.indexOf(field) + step];
        if (target) grid.querySelector(`[data-field="${target}"]`)?.focus();
    };
    const pick = (option) => {
        update({ text: "", active: 0 });
        hidePopover(field);
        onChange(field, [option.value]);
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
            onChange(field, []);
            if (event.key === "Backspace") focus(-1);
            return;
    }

    // Space opens the menu like Enter; other single characters type values.
    if (event.key.length !== 1 || event.key === " ") return;
    event.preventDefault();
    showPopover(field);
    const key = event.key === "0" || event.key === "-" ? EMPTY : event.key;
    const matching = (text) => all(field).filter((o) => String(o.value).startsWith(text));
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

const popoverOf = (field) => document.getElementById(`structure-pop-${field}`);
const isOpen = (field) => !!popoverOf(field)?.matches(":popover-open");
const showPopover = (field) => {
    try {
        if (!isOpen(field)) popoverOf(field)?.showPopover();
    } catch {
        // A click shows the popover itself and focuses the cell meanwhile.
    }
};
// Popovers close only on Escape or an outside click, not when focus moves.
const hidePopover = (field) => isOpen(field) && popoverOf(field).hidePopover();

function SegmentCell({ field, selected, options, typed, active, onChange, onKeyDown, onFocus }) {
    const t = useT();
    const id = `structure-pop-${field}`;
    const chosen = new Set(selected);
    const toggle = (value) => {
        const next = new Set(chosen);
        next.has(value) ? next.delete(value) : next.add(value);
        onChange([...next]);
    };
    const name = segmentLabel(field);
    const description = chosen.size ? `${name}: ${selected.join(", ")}` : name;
    const list = useRef(null);
    useEffect(() => {
        list.current?.querySelector(".option-active")?.scrollIntoView({ block: "nearest" });
    }, [active, typed]);

    return h("span", { class: "structure-cell", style: `anchor-name: --${id}` },
        h("button", {
            type: "button",
            class: chosen.size ? "structure-trigger is-set" : "structure-trigger",
            popovertarget: id,
            "data-field": field,
            onKeyDown,
            onFocus,
            title: description,
            "aria-label": description,
        }, chosen.size ? selected.join("/") : "·"),
        h("div", { id, popover: "auto", class: "popover structure-popover", style: `position-anchor: --${id}` },
            h("div", { class: "popover-head" },
                h("strong", null, name),
                typed && h("span", { class: "typed" }, `${typed}…`),
                chosen.size > 0 && h("button", { type: "button", class: "link-button", onClick: () => onChange([]) }, t("clear"))),
            h("div", { class: "option-list", ref: list },
                options.map((option, index) =>
                    h("label", {
                        key: option.value,
                        class: ["option", chosen.has(option.value) && "is-selected", index === active && "option-active"]
                            .filter(Boolean).join(" "),
                    },
                        h("input", { type: "checkbox", checked: chosen.has(option.value), onChange: () => toggle(option.value) }),
                        h("span", { class: "option-label" }, option.value),
                        option.count != null && h("span", { class: "option-count" }, option.count.toLocaleString(t.lang)))))),
    );
}
