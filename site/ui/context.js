// @ts-check
import { createContext } from "preact";
import { useContext } from "preact/hooks";

/** The engine's DataStore and the parsed config.json. */
export const AppContext = createContext(/** @type {{ store: any, config: any }} */ ({ store: null, config: {} }));
export const useApp = () => useContext(AppContext);
