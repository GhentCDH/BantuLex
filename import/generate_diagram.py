from src.bantulex_import.model import *
from src.bantulex_import.db import engine
from sqlalchemy_data_model_visualizer import generate_data_model_diagram, add_web_font_and_interactivity
import os

models = [Entry, Variety, Location, Source, Fieldwork, SourceEntries, Coordinate, Place, Region, Country]
output_file_name = '../data/bantulex_model'
try:
    generate_data_model_diagram(models, output_file_name)
    os.remove(output_file_name)
except FileNotFoundError:
    print("Ignored xdg-open error")