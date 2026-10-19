// @ts-check
import { useEffect, useState } from "preact/hooks";

/**
 * Run an async query whenever `key` changes. The previous data stays
 * visible while the next query runs, and a stale answer never overwrites
 * a newer one. `key` is compared as a string, so callers can pass JSON.
 *
 * @template T
 * @param {() => Promise<T> | null} load - null skips the query
 * @param {string} key
 * @returns {{ data: T | null, error: any, loading: boolean }}
 */
export function useQuery(load, key) {
    const [state, setState] = useState({ data: null, error: null, loading: true });
    useEffect(() => {
        let stale = false;
        const promise = load();
        if (!promise) {
            setState({ data: null, error: null, loading: false });
            return;
        }
        setState((previous) => ({ ...previous, loading: true }));
        promise.then(
            (data) => !stale && setState({ data, error: null, loading: false }),
            (error) => {
                if (stale) return;
                console.error("[bantulex] query failed:", error);
                setState({ data: null, error, loading: false });
            },
        );
        return () => {
            stale = true;
        };
    }, [key]);
    return state;
}
