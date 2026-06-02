
from sqlmodel import Session, select

from .model import Coordinate, Reflex


def load_default_coords(
    session: Session,
) -> dict[int, tuple[float | None, float | None]]:
    """Load coordinates with description='default', keyed by location_id."""
    result: dict[int, tuple[float | None, float | None]] = {}
    for coord in session.exec(
        select(Coordinate).where(Coordinate.description == "default")
    ).all():
        if coord.location_id and coord.location_id not in result:
            result[coord.location_id] = (coord.latitude, coord.longitude)
    return result


def load_location_by_variety(entries: list[Reflex]) -> dict[int, int | None]:
    """Build a variety_id → location_id mapping from a list of Reflex objects."""
    result: dict[int, int | None] = {}
    for e in entries:
        if e.variety_id and e.variety_id not in result:
            result[e.variety_id] = e.location_id
    return result
