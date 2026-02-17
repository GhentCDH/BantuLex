from sqlmodel import Session, select, func
from bantulex_import.db import engine
from bantulex_import.model import Entry, Variety, Location, Source, Fieldwork, SourceEntries, Coordinate

def verify():
    with Session(engine) as session:
        print(f"Varieties: {session.exec(select(func.count(Variety.id))).one()}")
        print(f"Locations: {session.exec(select(func.count(Location.id))).one()}")
        print(f"Sources: {session.exec(select(func.count(Source.id))).one()}")
        print(f"Fieldworks: {session.exec(select(func.count(Fieldwork.id))).one()}")
        print(f"Entries: {session.exec(select(func.count(Entry.id))).one()}")
        print(f"SourceEntries (Citations): {session.exec(select(func.count(SourceEntries.id))).one()}")
        print(f"Coordinates: {session.exec(select(func.count(Coordinate.id))).one()}")
        
        print("\nChecking Locations:")
        locations = session.exec(select(Location)).all()
        for loc in locations:
             print(f"Location ID {loc.id}: {loc.place}, {loc.region}")
             coords = loc.coordinates
             if coords:
                 print(f"  Coordinates: {len(coords)}")
                 for c in coords:
                     print(f"    - {c.description}: {c.latitude}, {c.longitude}")
             else:
                 print("  Coordinates: None")

        entry = session.exec(select(Entry).limit(1)).first()
        if entry:
            print(f"Sample Entry: {entry.term} (ID: {entry.id})")
            print(f"  Variety: {entry.variety.name_english if entry.variety else 'None'}")
            if entry.location:
                print(f"  Location: {entry.location.place}")
                for coord in entry.location.coordinates:
                    print(f"    - [{coord.description}] {coord.latitude}, {coord.longitude}")
            else:
                print("  Location: None")
            
            print(f"  Sources:")
            for es in entry.sources:
                print(f"    - [{es.role}] {es.source.author_year} - {es.source.title}")

if __name__ == "__main__":
    verify()
