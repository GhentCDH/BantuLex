// @ts-check
import { h } from "preact";
import { useApp } from "../context.js";
import { useT } from "../i18n.js";
import { href } from "../route.js";
import { useQuery } from "../use-query.js";
import { Facts } from "../components/facts.js";
import { PointMap, toPoints } from "../components/point-map.js";
import { ReflexPopup } from "../components/results.js";
import { SoundStructureDisplay } from "../components/sound-structure.js";

const byIds = (column, ids) => ({ [column]: { type: "multi", selected: ids } });

/** Everything known about one reflex, gathered from the related tables. */
async function loadReflex(store, id) {
    const [{ row: summary }, { row: reflex }] = await Promise.all([
        store.queryRow("reflex_search", id),
        store.queryRow("reflex", id),
    ]);
    if (!summary || !reflex) return null;

    const name = (lookup, column, value) => lookup.fkResolved?.[column]?.displayMap?.[value] ?? null;
    const [variety, location, fieldwork, collectors, citations, blr] = await Promise.all([
        reflex.variety_id != null ? store.queryRow("variety", reflex.variety_id) : null,
        reflex.location_id != null ? store.queryRow("location", reflex.location_id) : null,
        reflex.fieldwork_id != null ? store.queryRow("fieldwork", reflex.fieldwork_id) : null,
        reflex.fieldwork_id != null
            ? store.queryTable("fieldworkdatacollector", { filters: byIds("fieldwork_id", [reflex.fieldwork_id]), pageSize: null })
            : null,
        store.queryTable("sourceentries", { filters: byIds("entry_id", [id]), pageSize: null }),
        /^\d+$/.test(summary.blr_index ?? "")
            ? store.queryTable("blr_reconstruction", { filters: byIds("blr_index", [Number(summary.blr_index)]), pageSize: 1 })
            : null,
    ]);
    const sourceIds = citations.rows.map((row) => row.source_id).filter((sourceId) => sourceId != null);
    // Pihka's foreign key names take the first text column, which for a
    // collection year is created_at instead of its value.
    const [sources, year] = await Promise.all([
        sourceIds.length ? store.queryTable("source", { filters: byIds("id", sourceIds), pageSize: null }) : { rows: [] },
        fieldwork?.row?.collection_year_id != null ? store.queryRow("collectionyear", fieldwork.row.collection_year_id) : null,
    ]);
    const sourceById = new Map(sources.rows.map((row) => [row.id, row]));

    return {
        summary,
        reflex,
        variety: variety?.row ?? null,
        location: location?.row
            ? {
                  place: name(location, "place_id", location.row.place_id),
                  region: name(location, "region_id", location.row.region_id),
                  country: name(location, "country_id", location.row.country_id),
                  coordinates: Number.isFinite(summary.latitude)
                      ? `${summary.latitude.toFixed(4)}, ${summary.longitude.toFixed(4)}`
                      : null,
              }
            : null,
        fieldwork: fieldwork?.row
            ? {
                  ...fieldwork.row,
                  project: name(fieldwork, "project_id", fieldwork.row.project_id),
                  collection_year: [year?.row?.value, year?.row?.status !== "known" && year?.row?.status && `(${year.row.status})`]
                      .filter(Boolean)
                      .join(" "),
                  data_collectors: collectors?.rows
                      .map((row) => name(collectors, "data_collector_id", row.data_collector_id))
                      .filter(Boolean)
                      .join(", "),
              }
            : null,
        // The export holds every citation twice; show each one once.
        sources: [...new Map(citations.rows.map((row) => [`${row.role}|${row.source_id}|${row.pages ?? ""}`, row])).values()]
            .map((row) => ({ ...row, source: sourceById.get(row.source_id) ?? null })),
        blr: blr?.rows[0] ?? null,
    };
}

export function ReflexView({ id }) {
    const t = useT();
    const { store } = useApp();
    const { data, loading, error } = useQuery(() => loadReflex(store, id), String(id));

    const back = h("a", { class: "back-link", href: href("/") }, `← ${t("back")}`);
    if (loading && !data) return h("article", { class: "detail" }, back, h("p", { class: "muted" }, h("span", { class: "spinner" }), t("loading")));
    if (error) return h("article", { class: "detail" }, back, h("p", { class: "notice notice-error" }, t("error")));
    if (!data) return h("article", { class: "detail" }, back, h("h1", null, t("notFound")), h("p", null, t("reflexNotFound")));

    const { summary, reflex, variety, location, fieldwork, sources, blr } = data;
    const { points } = toPoints([summary]);

    return h("article", { class: "detail" },
        back,
        h("header", { class: "detail-head" },
            h("p", { class: "eyebrow" }, [t("reflexTitle"), summary.variety, summary.guthrie].filter(Boolean).join(" · ")),
            h("h1", { class: "term" }, summary.term ?? "—"),
            summary.ipa && h("p", { class: "ipa" }, `[${summary.ipa}]`),
            h("p", { class: "glosses" },
                summary.meaning && h("span", null, `‘${summary.meaning}’`),
                summary.translation && summary.translation !== summary.meaning && h("span", { class: "muted" }, `‘${summary.translation}’`))),
        h("div", { class: "detail-grid" },
            h("section", { class: "card" },
                h("h2", null, t("reflexTitle")),
                h(Facts, {
                    row: reflex,
                    fields: ["term_morph_analysis", "part_of_speech", "semantic_field", "scientific_name", "notes"],
                })),
            h("section", { class: "card blr-card" },
                h("h2", null, t("reconstruction")),
                !summary.blr_index
                    ? h("p", { class: "muted" }, t("noBlr"))
                    : [
                          h("p", { class: "blr-line" },
                              h("a", { class: "blr-chip", href: href(`/blr/${encodeURIComponent(summary.blr_index)}`) }, `BLR ${summary.blr_index}`),
                              blr && h("span", { class: "reconstruction" }, ` *${blr.word_tone || blr.word}`),
                              blr?.english && h("span", null, ` ‘${blr.english}’`)),
                          blr ? h(SoundStructureDisplay, { row: blr }) : h("p", { class: "muted" }, t("noBlrRow")),
                          h("p", null, h("a", { href: href(`/blr/${encodeURIComponent(summary.blr_index)}`) }, `${t("openBlr")} →`)),
                      ]),
            h("section", { class: "card" },
                h("h2", null, t("variety")),
                h(Facts, {
                    row: variety,
                    fields: ["name_english", "name_french", "name_bantu", "name_bastin", "guthrie_index", "guthrie_plus", "bastin_index", "branch"],
                })),
            h("section", { class: "card" },
                h("h2", null, t("location")),
                h(Facts, { row: location, fields: ["place", "region", "country", "coordinates"] }),
                points.length > 0 && h(PointMap, { class: "map-small", points, popup: (row) => h(ReflexPopup, { row }) })),
            h("section", { class: "card" },
                h("h2", null, t("fieldwork")),
                h(Facts, {
                    row: fieldwork,
                    fields: ["project", "collection_year", "data_collectors", "consultants", "archive", "data_entered_by"],
                })),
            h("section", { class: "card" },
                h("h2", null, t("sources")),
                sources.length
                    ? h("ul", { class: "sources" },
                          sources.map((entry) =>
                              h("li", { key: entry.id },
                                  h("span", { class: "source-role" }, entry.role ?? ""),
                                  h("span", null,
                                      entry.source?.author_year && h("strong", null, entry.source.author_year),
                                      entry.source?.title ? ` ${entry.source.title}` : "",
                                      entry.pages ? `, p. ${entry.pages}` : ""))))
                    : h("p", { class: "muted" }, "—"))),
    );
}
