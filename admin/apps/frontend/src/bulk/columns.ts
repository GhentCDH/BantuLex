/** Reflex fields of a bulk import. Shared links (variety, location, …) are set once per import. */
export interface BulkColumn {
  key: string;
  label: string;
  width: number;
  required?: boolean;
  aliases?: string[];
  /** Explanation for the template comment and the column list. */
  help: string;
  example: string;
}

export const COLUMNS: BulkColumn[] = [
  { key: 'term', label: 'Term', width: 180, required: true, aliases: ['form', 'word', 'reflex'],
    help: 'The word as written in the source.', example: 'mbúla' },
  { key: 'translation', label: 'Translation', width: 220, aliases: ['gloss', 'traduction'],
    help: 'Gloss as given in the source, in its language (often French).', example: 'pluie' },
  { key: 'meaning', label: 'Meaning (English)', width: 180, aliases: ['meaning', 'english'],
    help: 'English meaning. Used to compare meanings across languages.', example: 'rain' },
  { key: 'part_of_speech', label: 'Part of speech', width: 110, aliases: ['pos', 'part of speech'],
    help: 'Word class, e.g. n., v., adj.', example: 'n.' },
  { key: 'term_morph_analysis', label: 'Morphology', width: 160, aliases: ['morph', 'term with morphological analysis'],
    help: 'The term split into prefix and stem.', example: 'm-búla' },
  { key: 'semantic_field', label: 'Semantic field', width: 130,
    help: 'Domain of meaning, e.g. plants, animals, body.', example: 'nature' },
  { key: 'scientific_name', label: 'Scientific name', width: 150,
    help: 'Latin name of a plant or animal.', example: 'Musa sp.' },
  { key: 'pages', label: 'Pages', width: 80, aliases: ['page', 'page number'],
    help: 'Page(s) in the source where the word is found.', example: '123' },
  { key: 'notes', label: 'Notes', width: 200, aliases: ['note', 'opmerking'],
    help: 'Any remark about this word.', example: 'loanword according to author' },
  { key: 'blr_index', label: 'BLR index', width: 100, aliases: ['blr'],
    help: 'Number of the Proto-Bantu reconstruction (BLR), e.g. 368. "9094 ipv 3604" uses 9094. Other text is kept as a note and not linked.',
    example: '368' },
];
export const DEFAULT_COLUMNS = ['term', 'translation'];

export type BulkRow = Record<string, string>;
export const emptyRow = (): BulkRow => Object.fromEntries(COLUMNS.map(c => [c.key, '']));
export const isEmptyRow = (row: BulkRow) => COLUMNS.every(c => !row[c.key]?.trim());

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, ' ').replace(/\s*\(required\)$/, '');
/** Column key for a header cell ("Term", "part_of_speech", "Gloss", "Term (required)", …), or null. */
export function columnForHeader(cell: string): string | null {
  const n = norm(cell);
  const hit = COLUMNS.find(c => norm(c.key) === n || norm(c.label) === n || c.aliases?.some(a => norm(a) === n));
  return hit?.key ?? null;
}
