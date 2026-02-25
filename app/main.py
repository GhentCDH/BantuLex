from fastapi import FastAPI, Depends, Query
from fastapi.responses import HTMLResponse
from sqlmodel import Session, select, col
from sqlalchemy import func
from typing import Optional
import folium
from folium.plugins import MarkerCluster
from .database import get_session
from .models import Coordinate, Location, Place, Region, Country, Variety, Entry

app = FastAPI(title="Bantulex Map")


def build_map(
    session: Session,
    branch: Optional[str] = None,
    country_name: Optional[str] = None,
    variety_id: Optional[int] = None,
    substrate_only: bool = False,
    semantic_field: Optional[str] = None,
) -> str:

    # Subquery 1: entries per (location, variety)
    entry_count_sq = (
        select(
            Entry.location_id,
            Entry.variety_id,
            func.count(Entry.id).label("entry_count"),
            func.group_concat(Entry.term, "\n").label("terms"),
            func.group_concat(Entry.translation, "\n").label("translations"),
            func.group_concat(Entry.meaning, "\n").label("meanings"),
            func.group_concat(Entry.semantic_field, "\n").label("semantic_fields"),
            func.group_concat(Entry.part_of_speech, "\n").label("pos"),
        )
        .group_by(Entry.location_id, Entry.variety_id)
        .subquery()
    )

    # Subquery 2: varieties die entries hebben op meer dan 1 locatie (data-inconsistentie)
    # SQLite ondersteunt geen GROUP_CONCAT(DISTINCT col, separator) — default komma gebruiken
    variety_loc_sq = (
        select(
            Entry.variety_id,
            func.count(func.distinct(Entry.location_id)).label("location_count"),
            func.group_concat(func.distinct(Entry.location_id)).label("extra_location_ids"),
        )
        .where(Entry.location_id.is_not(None))
        .group_by(Entry.variety_id)
        .subquery()
    )

    stmt = (
        select(
            Coordinate.latitude,
            Coordinate.longitude,
            Place.name.label("place_name"),
            Region.name.label("region_name"),
            Country.name.label("country_name"),
            Variety.id.label("variety_id"),
            Variety.name_english,
            Variety.name_bantu,
            Variety.name_french,
            Variety.branch,
            Variety.guthrie_index,
            Variety.bastin_index,
            Variety.substrate_suspect,
            entry_count_sq.c.entry_count,
            entry_count_sq.c.terms,
            entry_count_sq.c.translations,
            entry_count_sq.c.meanings,
            entry_count_sq.c.semantic_fields,
            entry_count_sq.c.pos,
            variety_loc_sq.c.location_count,
            variety_loc_sq.c.extra_location_ids,
        )
        .join(Location, Coordinate.location_id == Location.id)
        .outerjoin(Place, Location.place_id == Place.id)
        .outerjoin(Region, Location.region_id == Region.id)
        .outerjoin(Country, Location.country_id == Country.id)
        .join(entry_count_sq, entry_count_sq.c.location_id == Location.id)
        .join(Variety, entry_count_sq.c.variety_id == Variety.id)
        .outerjoin(variety_loc_sq, variety_loc_sq.c.variety_id == Variety.id)
        .where(Coordinate.latitude.is_not(None))
        .where(Coordinate.longitude.is_not(None))
        .where(Coordinate.description == "default")
    )

    if branch:
        stmt = stmt.where(col(Variety.branch) == branch)
    if country_name:
        stmt = stmt.where(col(Country.name) == country_name)
    if variety_id:
        stmt = stmt.where(col(Variety.id) == variety_id)
    if substrate_only:
        stmt = stmt.where(col(Variety.substrate_suspect) == True)
    if semantic_field:
        stmt = stmt.where(
            col(entry_count_sq.c.semantic_fields).contains(semantic_field)
        )

    rows = session.exec(stmt).all()

    m = folium.Map(location=[3.0, 23.0], zoom_start=4, tiles="CartoDB positron")
    cluster = MarkerCluster().add_to(m)

    def truncate(val, n=5):
        if not val:
            return ""
        items = val.split("\n")
        result = ", ".join(items[:n])
        return result + f" (+{len(items) - n} meer)" if len(items) > n else result

    for row in rows:
        loc_count = row.location_count or 1
        is_problem = loc_count > 1
        ids_str = row.extra_location_ids or ""

        problem_html = ""
        if is_problem:
            problem_html = (
                f'<hr><b style="color:red">⚠️ Variety gelinkt aan {loc_count} locaties</b>'
                f"<br><small>location_ids: <code>{ids_str}</code></small>"
            )

        popup_html = (
            f"<b>{row.name_english or row.name_bantu or ''}</b>"
            f"<br><small>{row.name_french or ''}</small>"
            f"<hr>"
            f"<b>Branch</b> <code>{row.branch or ''}</code><br>"
            f"<b>Guthrie</b> <code>{row.guthrie_index or ''}</code><br>"
            f"<b>Bastin</b> <code>{row.bastin_index or ''}</code><br>"
            f"<b>Plaats</b> {', '.join(filter(None, [row.place_name, row.region_name, row.country_name]))}<br>"
            f"<b>Entries</b> {row.entry_count}"
            f"{problem_html}"
            f"<hr>"
            f"<table>"
            f"<tr><td><b>Termen</b></td><td>{truncate(row.terms)}</td></tr>"
            f"<tr><td><b>Vertalingen</b></td><td>{truncate(row.translations)}</td></tr>"
            f"<tr><td><b>Betekenis</b></td><td>{truncate(row.meanings)}</td></tr>"
            f"<tr><td><b>Sem. veld</b></td><td>{truncate(row.semantic_fields, 3)}</td></tr>"
            f"<tr><td><b>Woordsoort</b></td><td>{truncate(row.pos, 3)}</td></tr>"
            f"</table>"
        )

        # Rood = variety op meerdere locaties (probleem), oranje = substraat, blauw = normaal
        icon_color = "red" if is_problem else ("orange" if row.substrate_suspect else "blue")
        tooltip = (
            f"{row.name_english or row.name_bantu or '?'}"
            f" ({row.entry_count}{'  ⚠️' if is_problem else ''})"
        )

        folium.Marker(
            location=[row.latitude, row.longitude],
            popup=folium.Popup(popup_html, max_width=400),
            tooltip=tooltip,
            icon=folium.Icon(color=icon_color, icon="info-sign"),
        ).add_to(cluster)

    return m._repr_html_()


@app.get("/map", response_class=HTMLResponse)
def get_map(
    session: Session = Depends(get_session),
    branch: Optional[str] = Query(default=None),
    country: Optional[str] = Query(default=None),
    variety_id: Optional[int] = Query(default=None),
    substrate_only: bool = Query(default=False),
    semantic_field: Optional[str] = Query(default=None),
):
    html = build_map(
        session,
        branch=branch,
        country_name=country,
        variety_id=variety_id,
        substrate_only=substrate_only,
        semantic_field=semantic_field,
    )
    return HTMLResponse(content=html)