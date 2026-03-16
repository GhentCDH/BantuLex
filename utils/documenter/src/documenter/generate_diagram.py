from utilities.model import *
from utilities.db import engine
from utilities.config import ROOT
from sqlalchemy_data_model_visualizer import generate_data_model_diagram, add_web_font_and_interactivity
import os

def main() -> None:
    models = [
        Entry, Variety,
        Location, Coordinate, Place, Region, Country,
        Source, SourceEntries,
        Fieldwork, FieldworkDataCollector,
        Project, CollectionYear, DataCollector,
        BLREntry, BLRContributor, BLRConsonantStructure, BLRToneStructure, BLRVowelStructure, BLRReliability,
    ]
    output_file_name = ROOT / "data" / "bantulex_model"
    try:
        generate_data_model_diagram(models, output_file_name)
        os.remove(output_file_name)
    except FileNotFoundError:
        print("Ignored xdg-open error")