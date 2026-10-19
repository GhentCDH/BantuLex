// @ts-check
/**
 * Hash routing, so the site works on any static host: `#/path?query`.
 * All view state lives in the query, which keeps every result shareable.
 */
import { useEffect, useState } from "preact/hooks";

function current() {
    const [path, query = ""] = window.location.hash.replace(/^#/, "").split("?");
    return { path: path || "/", params: new URLSearchParams(query) };
}

export function href(path, params = null) {
    const query = params ? params.toString() : "";
    return `#${path}${query ? `?${query}` : ""}`;
}

/** Go to `path` with `params`. `replace` keeps the history entry (for typing). */
export function navigate(path, params = null, { replace = false } = {}) {
    const target = href(path, params);
    if (replace) {
        history.replaceState(history.state, "", target);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else {
        window.location.hash = target;
    }
}

/** The current route; rerenders on every hash change. */
export function useRoute() {
    const [route, setRoute] = useState(current);
    useEffect(() => {
        const update = () => setRoute(current());
        window.addEventListener("hashchange", update);
        return () => window.removeEventListener("hashchange", update);
    }, []);
    return route;
}

/** Match `/blr/:index` style patterns. */
export function match(pattern, path) {
    const names = [];
    const regex = new RegExp(
        "^" + pattern.replace(/:(\w+)/g, (_, name) => (names.push(name), "([^/]+)")) + "/?$",
    );
    const found = path.match(regex);
    return found && Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(found[i + 1])]));
}
