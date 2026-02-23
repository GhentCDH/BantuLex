from fastapi import FastAPI, Depends, Query
from fastapi.responses import HTMLResponse
from sqlmodel import Session, select, col
from sqlalchemy import func
from typing import Optional
import folium
from folium.plugins import MarkerCluster

from .database import get_session
from .models import Coordinate, Location, Place, Region, Country, Variety, Entry, SourceEntries, Source

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
            func.group_concat(Entry.term, " · ").label("terms"),
            func.group_concat(Entry.translation, " · ").label("translations"),
            func.group_concat(Entry.meaning, " · ").label("meanings"),
            func.group_concat(Entry.semantic_field, " · ").label("semantic_fields"),
            func.group_concat(Entry.part_of_speech, " · ").label("pos"),
        )
        .group_by(Entry.location_id, Entry.variety_id)
        .subquery()
    )

    stmt = (
        select(
            Coordinate.latitude,
            Coordinate.longitude,
            Coordinate.description,
            Location.clan,
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
        )
        .join(Location, Coordinate.location_id == Location.id)
        .outerjoin(Place, Location.place_id == Place.id)
        .outerjoin(Region, Location.region_id == Region.id)
        .outerjoin(Country, Location.country_id == Country.id)
        .join(entry_count_sq, (entry_count_sq.c.location_id == Location.id))
        .join(Variety, entry_count_sq.c.variety_id == Variety.id)
        .where(Coordinate.latitude.isnot(None))
        .where(Coordinate.longitude.isnot(None))
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
        # Trunceer lange lijsten voor leesbaarheid
        def truncate(val, n=5):
            if not val:
                return "—"
            items = val.split(" · ")
            result = " · ".join(items[:n])
            return result + f" <i>(+{len(items)-n})</i>" if len(items) > n else result

        popup_html = f"""
        <div style="font-family:sans-serif; font-size:13px; min-width:280px; max-width:320px">
            <h4 style="margin:0 0 4px 0">{row.name_english or row.name_bantu or '?'}</h4>
            <i style="color:#666">{row.name_bantu or ''}{' / ' + row.name_french if row.name_french else ''}</i>
            <hr style="margin:6px 0">

            <b>📍 Locatie</b><br>
            {row.place_name or '—'}, {row.region_name or '—'}, {row.country_name or '—'}<br>
            {('Clan: ' + row.clan) if row.clan else ''}

            <hr style="margin:6px 0">
            <b>🔤 Variëteit</b><br>
            Branch: <code>{row.branch or '—'}</code><br>
            Guthrie: <code>{row.guthrie_index or '—'}</code>
            &nbsp; Bastin: <code>{row.bastin_index or '—'}</code><br>
            Substrate suspect: {'<span style="color:red">✓</span>' if row.substrate_suspect else '✗'}

            <hr style="margin:6px 0">
            <b>📚 Entries ({row.entry_count})</b><br>
            <table style="width:100%; font-size:12px; border-collapse:collapse">
                <tr><td style="color:#888; width:90px">Termen</td>
                    <td>{truncate(row.terms)}</td></tr>
                <tr><td style="color:#888">Vertalingen</td>
                    <td>{truncate(row.translations)}</td></tr>
                <tr><td style="color:#888">Betekenis</td>
                    <td>{truncate(row.meanings)}</td></tr>
                <tr><td style="color:#888">Sem. veld</td>
                    <td>{truncate(row.semantic_fields, 3)}</td></tr>
                <tr><td style="color:#888">Woordsoort</td>
                    <td>{truncate(row.pos, 3)}</td></tr>
            </table>
        </div>
        """

        color = "red" if row.substrate_suspect else "blue"
        # Grootte marker op basis van aantal entries
        radius = min(5 + (row.entry_count or 1) * 0.5, 20)

        folium.CircleMarker(
            location=[row.latitude, row.longitude],
            radius=radius,
            popup=folium.Popup(popup_html, max_width=340),
            tooltip=f"{row.name_english or row.name_bantu or '?'} ({row.entry_count} entries)",
            color=color,
            fill=True,
            fill_opacity=0.7,
        ).add_to(cluster)

    return m.get_root().render()


@app.get("/", response_class=HTMLResponse)
def map_view(
    session: Session = Depends(get_session),
    branch: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    variety_id: Optional[int] = Query(None),
    substrate_only: bool = Query(False),
    semantic_field: Optional[str] = Query(None),
):
    return build_map(session, branch, country, variety_id, substrate_only, semantic_field)


@app.get("/api/filters")
def get_filter_options(session: Session = Depends(get_session)):
    branches = session.exec(
        select(Variety.branch).where(Variety.branch.isnot(None)).distinct()
    ).all()
    countries = session.exec(
        select(Country.name).where(Country.name.isnot(None)).distinct()
    ).all()
    semantic_fields = session.exec(
        select(Entry.semantic_field).where(Entry.semantic_field.isnot(None)).distinct()
    ).all()
    return {
        "branches": sorted(b for b in branches if b),
        "countries": sorted(c for c in countries if c),
        "semantic_fields": sorted(s for s in semantic_fields if s),
    }
