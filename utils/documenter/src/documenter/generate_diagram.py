from sqlalchemy_data_model_visualizer import (
    generate_data_model_diagram,
)

from utilities.config import DATA_ROOT
from utilities.model import (
    BLRConsonantStructure,
    BLRContributor,
    BLRReliability,
    BLRToneStructure,
    BLRVowelStructure,
    CollectionYear,
    Coordinate,
    Country,
    DataCollector,
    Fieldwork,
    FieldworkDataCollector,
    Location,
    Place,
    Project,
    Reconstruction,
    Reflex,
    Region,
    Source,
    SourceEntries,
    Variety,
)


def main() -> None:
    models = [
        Reflex,
        Variety,
        Location,
        Coordinate,
        Place,
        Region,
        Country,
        Source,
        SourceEntries,
        Fieldwork,
        FieldworkDataCollector,
        Project,
        CollectionYear,
        DataCollector,
        Reconstruction,
        BLRContributor,
        BLRConsonantStructure,
        BLRToneStructure,
        BLRVowelStructure,
        BLRReliability,
    ]
    output_file_name = DATA_ROOT / "bantulex_model"
    try:
        generate_data_model_diagram(models, output_file_name)
    except FileNotFoundError:
        print("Ignored xdg-open error")
