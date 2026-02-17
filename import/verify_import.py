from sqlmodel import Session, select, func
from bantulex_import.db import engine
from bantulex_import.model import Entry, Variety, Location, Source, Fieldwork

def verify():
    with Session(engine) as session:
        print(f"Varieties: {session.exec(select(func.count(Variety.id))).one()}")
        print(f"Locations: {session.exec(select(func.count(Location.id))).one()}")
        print(f"Sources: {session.exec(select(func.count(Source.id))).one()}")
        print(f"Fieldworks: {session.exec(select(func.count(Fieldwork.id))).one()}")
        print(f"Entries: {session.exec(select(func.count(Entry.id))).one()}")
        
        entry = session.exec(select(Entry).limit(1)).first()
        if entry:
            print(f"Sample Entry: {entry.term} (ID: {entry.id})")
            print(f"  Variety: {entry.variety.name_english if entry.variety else 'None'}")
            print(f"  Location: {entry.location.place if entry.location else 'None'}")

if __name__ == "__main__":
    verify()
