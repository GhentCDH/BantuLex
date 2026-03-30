from utilities.model import *
from utilities.db import engine
from utilities.config import DATA_ROOT
from sqlalchemy_data_model_visualizer import generate_data_model_diagram, add_web_font_and_interactivity

def main() -> None:
    models = [
        Reflex, Variety,
        Location, Coordinate, Place, Region, Country,
        Source, SourceEntries,
        Fieldwork, FieldworkDataCollector,
        Project, CollectionYear, DataCollector,
        Reconstruction, BLRContributor, BLRConsonantStructure, BLRToneStructure, BLRVowelStructure, BLRReliability,
    ]
    output_file_name = DATA_ROOT / "bantulex_model"
    try:
        generate_data_model_diagram(models, output_file_name)
    except FileNotFoundError:
        print("Ignored xdg-open error")