// @ts-check
/**
 * Meaning search: a gloss term with its mode (literal now, semantic later),
 * language (English or French gloss) and level (the reflex's own gloss or
 * the gloss of its BLR reconstruction).
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useT } from "../i18n.js";

const COMMIT_MS = 300;

/**
 * @param {{ value: { text: string, lang: string, level: string, mode: string },
 *   onChange: (next: object, options?: { replace?: boolean }) => void }} props
 */
export function MeaningSearch({ value, onChange }) {
    const t = useT();
    const [text, setText] = useState(value.text);
    const committed = useRef(value.text);
    const timer = useRef(0);

    // Follow outside changes (clear all, back button) but not our own commits.
    useEffect(() => {
        if (value.text !== committed.current) {
            committed.current = value.text;
            setText(value.text);
        }
    }, [value.text]);
    useEffect(() => () => clearTimeout(timer.current), []);

    const commit = (next) => {
        clearTimeout(timer.current);
        committed.current = next;
        onChange({ ...value, text: next }, { replace: true });
    };
    const type = (next) => {
        setText(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(next), COMMIT_MS);
    };
    const select = (key, options) =>
        h("select", {
            "aria-label": `${t("meaning")}: ${key}`,
            value: value[key],
            onChange: (event) => onChange({ ...value, [key]: event.currentTarget.value }),
        }, options.map(([option, label, disabled]) => h("option", { value: option, disabled }, label)));

    return h("section", { class: "panel meaning", "aria-labelledby": "meaning-title" },
        h("div", { class: "panel-head" }, h("h2", { id: "meaning-title" }, t("meaning"))),
        h("div", { class: "meaning-row" },
            h("input", {
                type: "search",
                class: "meaning-input",
                placeholder: t("meaningPlaceholder"),
                "aria-label": t("meaning"),
                value: text,
                onInput: (event) => type(event.currentTarget.value),
                onKeyDown: (event) => event.key === "Enter" && commit(text),
            }),
            select("mode", [["literal", t("literal")], ["semantic", t("semantic"), true]]),
            select("lang", [["en", t("english")], ["fr", t("french")]]),
            select("level", [["blr", t("levelBlr")], ["reflex", t("levelReflex")]]),
        ),
        h("p", { class: "hint" }, t("meaningHint")[value.level][value.lang]),
    );
}
