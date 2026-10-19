// @ts-check
/**
 * Filter popover for one result column, opened from its header. A "values"
 * column lists its values with counts under the other active filters; a
 * "text" column has a "contains" box. Counts load only when the popover
 * opens.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../context.js";
import { useT } from "../i18n.js";

const VISIBLE_VALUES = 200;
const COMMIT_MS = 400;

/**
 * @param {{ table: string, column: { name: string, filter: string }, filters: object,
 *   values: Array<string|null>, text: string,
 *   onValues: (values: Array<string|null>) => void, onText: (text: string) => void }} props
 */
export function ColumnFilter({ table, column, filters, values, text, onValues, onText }) {
    const t = useT();
    const id = `filter-${table}-${column.name}`;
    const active = column.filter === "values" ? values.length > 0 : !!text;
    const [open, setOpen] = useState(false);
    const label = `${t("filter")}: ${t.label(column.name)}`;

    return h("span", { class: "column-filter", style: `anchor-name: --${id}` },
        h("button", {
            type: "button",
            class: active ? "filter-button is-active" : "filter-button",
            popovertarget: id,
            title: label,
            "aria-label": label,
        }, h(FunnelIcon)),
        h("div", {
            id,
            popover: "auto",
            class: "popover filter-popover",
            style: `position-anchor: --${id}`,
            onToggle: (event) => setOpen(event.newState === "open"),
        },
            h("div", { class: "popover-head" },
                h("strong", null, t.label(column.name)),
                active && h("button", {
                    type: "button",
                    class: "link-button",
                    onClick: () => (column.filter === "values" ? onValues([]) : onText("")),
                }, t("clear"))),
            open && (column.filter === "values"
                ? h(ValueList, { table, column: column.name, filters, values, onValues })
                : h(TextFilter, { text, onText }))),
    );
}

function ValueList({ table, column, filters, values, onValues }) {
    const t = useT();
    const { store } = useApp();
    const [counts, setCounts] = useState(null);
    const [find, setFind] = useState("");
    const key = JSON.stringify(filters);

    useEffect(() => {
        let stale = false;
        store.queryFacetCounts(table, column, { filters, excludeSelf: true }).then((rows) => {
            if (stale) return;
            // "" and NULL are both shown as one "(empty)" value.
            const merged = new Map();
            for (const { value, count } of rows) {
                const v = value === "" ? null : value;
                merged.set(v, (merged.get(v) ?? 0) + count);
            }
            setCounts([...merged].map(([value, count]) => ({ value, count })));
        });
        return () => {
            stale = true;
        };
    }, [key]);

    const chosen = new Set(values);
    const toggle = (value) => onValues(chosen.has(value) ? values.filter((v) => v !== value) : [...values, value]);
    const display = (value) => (value == null ? t("empty") : String(value));
    const needle = find.trim().toLowerCase();
    // Selected values stay listed, also when the other filters exclude them.
    const options = counts
        ? [
              ...values.filter((v) => !counts.some((c) => c.value === v)).map((value) => ({ value, count: 0 })),
              ...counts,
          ].filter((option) => !needle || display(option.value).toLowerCase().includes(needle))
        : [];
    const shown = options.slice(0, VISIBLE_VALUES);

    return h("div", { class: "value-list" },
        h("input", {
            type: "search",
            placeholder: t("findValue"),
            "aria-label": t("findValue"),
            value: find,
            autofocus: true,
            onInput: (event) => setFind(event.currentTarget.value),
        }),
        !counts
            ? h("p", { class: "muted" }, h("span", { class: "spinner" }), t("loading"))
            : h("div", { class: "option-list" },
                  shown.map((option) =>
                      h("label", { key: String(option.value), class: chosen.has(option.value) ? "option is-selected" : "option" },
                          h("input", { type: "checkbox", checked: chosen.has(option.value), onChange: () => toggle(option.value) }),
                          h("span", { class: option.value == null ? "option-label muted" : "option-label" }, display(option.value)),
                          h("span", { class: "option-count" }, option.count.toLocaleString(t.lang)))),
                  options.length > shown.length && h("p", { class: "muted" }, t("moreValues", options.length - shown.length))),
    );
}

function TextFilter({ text, onText }) {
    const t = useT();
    const [draft, setDraft] = useState(text);
    const committed = useRef(text);
    const timer = useRef(0);
    // Follow outside changes (clear) but not our own commits.
    useEffect(() => {
        if (text !== committed.current) {
            committed.current = text;
            setDraft(text);
        }
    }, [text]);
    useEffect(() => () => clearTimeout(timer.current), []);
    const commit = (value) => {
        clearTimeout(timer.current);
        committed.current = value;
        onText(value);
    };
    return h("input", {
        type: "search",
        placeholder: t("contains"),
        "aria-label": t("contains"),
        value: draft,
        autofocus: true,
        onInput: (event) => {
            const value = event.currentTarget.value;
            setDraft(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(value), COMMIT_MS);
        },
        onKeyDown: (event) => event.key === "Enter" && commit(draft),
    });
}

const FunnelIcon = () =>
    h("svg", { viewBox: "0 0 16 16", width: 12, height: 12, "aria-hidden": "true" },
        h("path", { d: "M1.5 2h13l-5 6v5l-3 1.5V8z", fill: "currentColor" }));
