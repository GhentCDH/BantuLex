from fastapi import FastAPI, Depends, Query
from fastapi.responses import HTMLResponse
from sqlmodel import Session, select, col
from sqlalchemy import func
from typing import Optional
import folium
from folium.plugins import MarkerCluster

from .database import get_session
from .models import (
    Coordinate, Location, Place, Region, Country,
    Variety, Entry, SourceEntries, Source,
)

app = FastAPI(title="Bantulex Map")


def build_map(
    session: Session,
    branch: Optional[str] = None,
    country_name: Optional[str] = None,
    variety_id: Optional[int] = None,
    substrate_only: bool = False,
    semantic_field: Optional[str] = None,
) -> str:

    # Subquery: aantal entries per location+variety combinatie
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

    stmt = (
        select(
            Coordinate.latitude,
            Coordinate.longitude,
            Coordinate.description,
            Place.name.label("place_name"),      # clan verwijderd uit model
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
        )
        .join(Location, Coordinate.location_id == Location.id)
        .outerjoin(Place, Location.place_id == Place.id)
        .outerjoin(Region, Location.region_id == Region.id)
        .outerjoin(Country, Location.country_id == Country.id)
        .join(entry_count_sq, entry_count_sq.c.location_id == Location.id)
        .join(Variety, entry_count_sq.c.variety_id == Variety.id)
        .where(Coordinate.latitude.isnot(None))
        .where(Coordinate.longitude.isnot(None))
        # Gebruik enkel de primaire (BK/BL) coördinaten voor de kaart
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
        stmt = stmt.where(col(entry_count_sq.c.semantic_fields).contains(semantic_field))

    rows = session.exec(stmt).all()

    m = folium.Map(location=[3.0, 23.0], zoom_start=4, tiles="CartoDB positron")
    cluster = MarkerCluster().add_to(m)

    for row in rows:

        def truncate(val, n=5):
            if not val:
                return ""
            items = val.split('\n')
            result = ", ".join(items[:n])
            return result + f" (+{len(items) - n} meer)" if len(items) > n else result

        popup_html = f"""
<b>{row.name_english or row.name_bantu or '—'}</b>
<br><small>{row.name_french or ''}</small>
<hr>
<b>Branch:</b> <code>{row.branch or '—'}</code><br>
<b>Guthrie:</b> <code>{row.guthrie_index or '—'}</code><br>
<b>Bastin:</b> <code>{row.bastin_index or '—'}</code><br>
<b>Plaats:</b> {row.place_name or '—'}, {row.region_name or '—'}, {row.country_name or '—'}<br>
<b>Entries:</b> {row.entry_count}<br>
<hr>
<table>
  <tr><td><b>Termen</b></td><td>{truncate(row.terms)}</td></tr>
  <tr><td><b>Vertalingen</b></td><td>{truncate(row.translations)}</td></tr>
  <tr><td><b>Betekenis</b></td><td>{truncate(row.meanings)}</td></tr>
  <tr><td><b>Sem. veld</b></td><td>{truncate(row.semantic_fields, 3)}</td></tr>
  <tr><td><b>Woordsoort</b></td><td>{truncate(row.pos, 3)}</td></tr>
</table>
"""
        folium.Marker(
            location=[row.latitude, row.longitude],
            popup=folium.Popup(popup_html, max_width=350),
            tooltip=row.name_english or row.name_bantu or "—",
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
