from sqlmodel import Session, select, func, col
from bantulex_import.db import engine
from bantulex_import.model import Entry, Coordinate

def check_quality():
    with Session(engine) as session:
        # Check for empty entries
        empty_entries = session.exec(select(func.count(Entry.id)).where(col(Entry.term).is_(None))).one()
        print(f"Entries with None term: {empty_entries}")
        
        empty_str_entries = session.exec(select(func.count(Entry.id)).where(Entry.term == "")).one()
        print(f"Entries with empty string term: {empty_str_entries}")

        # Check for duplicate coordinates
        # Group by location_id, latitude, longitude, description and count > 1
        statement = select(
            Coordinate.location_id, 
            Coordinate.latitude, 
            Coordinate.longitude, 
            Coordinate.description, 
            func.count(Coordinate.id)
        ).group_by(
            Coordinate.location_id, 
            Coordinate.latitude, 
            Coordinate.longitude, 
            Coordinate.description
        ).having(func.count(Coordinate.id) > 1)
        
        duplicates = session.exec(statement).all()
        print(f"Duplicate Coordinate groups found: {len(duplicates)}")
        for d in duplicates[:10]:
            print(f"  Duplicate: Location {d[0]}, Lat {d[1]}, Lon {d[2]}, Desc {d[3]} -> Count {d[4]}")

if __name__ == "__main__":
    check_quality()
