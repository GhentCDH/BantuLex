// @ts-check
// Hash router: #/<page>/<id>?<params>. Kept separate from Pihka's router so
// the EvoLex pages have their own short URLs (e.g. #/entry/1490).
import { useEffect, useState } from "preact/hooks";

export function parseHash(hash = location.hash) {
    const [path, query = ""] = hash.replace(/^#/, "").split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    return { page: parts[0] || "home", id: parts[1] ?? null, params: Object.fromEntries(new URLSearchParams(query)) };
}

/** Build "#/page/id?key=value"; empty values are dropped. */
export function href(page, id = null, params = {}) {
    const query = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== "" && v != null && !(Array.isArray(v) && !v.length))
            .map(([k, v]) => [k, Array.isArray(v) ? v.join("|") : String(v)]),
    ).toString();
    return `#/${page === "home" ? "" : encodeURIComponent(page)}${id != null ? "/" + encodeURIComponent(id) : ""}${query ? "?" + query : ""}`;
}

export function navigate(page, id = null, params = {}, { replace = false } = {}) {
    const next = href(page, id, params);
    if (replace) history.replaceState(null, "", next);
    else location.hash = next;
    if (replace) dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Current route; re-renders on hash changes. */
export function useRoute() {
    const [route, setRoute] = useState(parseHash);
    useEffect(() => {
        const onChange = () => setRoute(parseHash());
        addEventListener("hashchange", onChange);
        return () => removeEventListener("hashchange", onChange);
    }, []);
    return route;
}

/** "a|b" URL parameter ↔ array. */
export const list = (value) => (value ? String(value).split("|").filter(Boolean) : []);
