// @ts-check
import { h } from "preact";

/** Full-page loading or startup error message, shown before the app mounts. */
export function Status({ message, error }) {
    return h("div", { class: "boot" },
        h("p", { class: "boot-brand" }, "BantuLex"),
        error
            ? h("div", { class: "notice notice-error", role: "alert" },
                  h("strong", null, "The database could not be opened."),
                  h("p", null, String(error?.message ?? error)))
            : h("p", { class: "boot-message", role: "status" }, h("span", { class: "spinner" }), message),
    );
}
