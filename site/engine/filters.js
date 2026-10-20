// @ts-check
/**
 * BantuLex filter types for the Pihka engine. They query `reflex_search`
 * or `blr_reconstruction` and keep all SQL out of the UI, which only builds
 * JSON descriptors:
 *
 *   { type: "values", selected: ["A", null] }            column is one of, null = empty
 *   { type: "contains", text: "kú" }                     column contains text
 *   { type: "gloss", text: "sheep", lang: "en", level: "reflex", target: "blr" }
 *   { type: "blr-structure", segments: { c1: ["b"], v12: ["∅"] }, target: "reflex" }
 *
 * For "values" and "contains" the filter key is the column; the others
 * ignore their key. `target` is the table that is queried: "reflex" (the
 * default) for `reflex_search`, "blr" for `blr_reconstruction`. A gloss of
 * the other level matches through the BLR index.
 */

const quote = (name) => `"${name.replace(/"/g, '""')}"`;
const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Sound positions of `blr_reconstruction`, the only columns a structure filter may name. */
export const SEGMENT_FIELDS = Object.freeze([
    "c1", "v11", "v12", "c2", "v21", "v22", "c3", "v3", "c4", "v4", "cs",
    "t11", "t12", "t21", "t22", "t3", "t4",
]);

// Gloss columns per level and language.
const GLOSS_COLUMNS = {
    reflex: { en: "meaning", fr: "translation" },
    blr: { en: "english", fr: "french" },
};

// Characters that separate words in a gloss ("sheep, ewe", "l'eau", "(male) goat").
const SEPARATORS = [",", ";", ":", ".", "(", ")", "[", "]", "/", "!", "?", '"', "'", "’", "-"];

/**
 * SQL that is true when `column` contains `text` as a whole word or phrase.
 * A substring LIKE runs first, so the slower separator normalisation only
 * sees candidate rows. LIKE ignores ASCII case only.
 */
function wholeWord(column, text) {
    const words = escapeLike(text.trim().replace(/\s+/g, " "));
    const normalised = SEPARATORS.reduce(
        (sql, separator) => `replace(${sql}, '${separator.replace(/'/g, "''")}', ' ')`,
        `' ' || ${column} || ' '`,
    );
    return {
        sql: `(${column} LIKE ? ESCAPE '\\' AND ${normalised} LIKE ? ESCAPE '\\')`,
        params: [`%${words}%`, `% ${words} %`],
    };
}

const blrIndexIn = (subquery) => `"blr_index" IN (SELECT CAST("blr_index" AS TEXT) FROM ${subquery})`;
const hasReflexIn = (subquery) => `CAST("blr_index" AS TEXT) IN (SELECT "blr_index" FROM ${subquery})`;

export function register(api) {
    api.registerFilterType("values", {
        buildSql(key, filter) {
            const selected = Array.isArray(filter.selected) ? filter.selected : [];
            if (!selected.length) return null;
            const values = selected.filter((value) => value != null && value !== "");
            const conditions = [];
            if (values.length) conditions.push(`${quote(key)} IN (${values.map(() => "?").join(", ")})`);
            if (values.length < selected.length) conditions.push(`NULLIF(${quote(key)}, '') IS NULL`);
            return { conditions: [`(${conditions.join(" OR ")})`], params: values };
        },
    });

    api.registerFilterType("contains", {
        buildSql(key, filter) {
            const text = String(filter.text ?? "").trim();
            if (!text) return null;
            return { conditions: [`${quote(key)} LIKE ? ESCAPE '\\'`], params: [`%${escapeLike(text)}%`] };
        },
    });

    api.registerFilterType("gloss", {
        buildSql(_key, filter) {
            const text = String(filter.text ?? "").trim();
            const column = GLOSS_COLUMNS[filter.level]?.[filter.lang];
            if (!text || !column) return null;
            const { sql, params } = wholeWord(quote(column), text);
            const target = filter.target === "blr" ? "blr" : "reflex";
            if (filter.level === target) return { conditions: [sql], params };
            return target === "reflex"
                ? { conditions: [blrIndexIn(`"reconstruction" WHERE ${sql}`)], params }
                : { conditions: [hasReflexIn(`"reflex_search" WHERE ${sql}`)], params };
        },
    });

    api.registerFilterType("blr-structure", {
        buildSql(_key, filter) {
            const entries = Object.entries(filter.segments ?? {}).filter(
                ([field, values]) => SEGMENT_FIELDS.includes(field) && Array.isArray(values) && values.length,
            );
            if (!entries.length) return null;
            const where = entries.map(([field, values]) => `${quote(field)} IN (${values.map(() => "?").join(", ")})`);
            const params = entries.flatMap(([, values]) => values.map(String));
            return filter.target === "blr"
                ? { conditions: where, params }
                : { conditions: [blrIndexIn(`"blr_reconstruction" WHERE ${where.join(" AND ")}`)], params };
        },
    });
}
