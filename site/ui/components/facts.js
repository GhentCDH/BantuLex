// @ts-check
import { h } from "preact";
import { useT } from "../i18n.js";

/** Definition list of the non-empty `fields` of `row`; values may be vnodes. */
export function Facts({ row, fields }) {
    const t = useT();
    const present = fields.filter((field) => row?.[field] != null && row[field] !== "");
    if (!present.length) return h("p", { class: "muted" }, "—");
    return h("dl", { class: "facts" },
        present.map((field) => [
            h("dt", { key: `${field}-t` }, t.label(field)),
            h("dd", { key: `${field}-d` }, row[field]),
        ]));
}
