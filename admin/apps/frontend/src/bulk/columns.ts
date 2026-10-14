/** Reflex fields the bulk grid can fill. Shared links (variety, location, …) are set once per import. */
export interface BulkColumn { key: string; label: string; width: number; required?: boolean; aliases?: string[] }

export const COLUMNS: BulkColumn[] = [
  { key: 'term', label: 'Term', width: 180, required: true, aliases: ['form', 'word', 'reflex'] },
  { key: 'translation', label: 'Translation', width: 220, aliases: ['gloss', 'traduction'] },
  { key: 'meaning', label: 'Meaning (English)', width: 180, aliases: ['meaning', 'english'] },
  { key: 'part_of_speech', label: 'Part of speech', width: 110, aliases: ['pos', 'part of speech'] },
  { key: 'term_morph_analysis', label: 'Morphology', width: 160, aliases: ['morph', 'term with morphological analysis'] },
  { key: 'semantic_field', label: 'Semantic field', width: 130 },
  { key: 'scientific_name', label: 'Scientific name', width: 150 },
  { key: 'pages', label: 'Pages', width: 80, aliases: ['page', 'page number'] },
  { key: 'notes', label: 'Notes', width: 200, aliases: ['note', 'opmerking'] },
  { key: 'blr_index', label: 'BLR index', width: 100, aliases: ['blr'] },
];
export const DEFAULT_COLUMNS = ['term', 'translation'];

export type BulkRow = Record<string, string>;
export const emptyRow = (): BulkRow => Object.fromEntries(COLUMNS.map(c => [c.key, '']));
export const isEmptyRow = (row: BulkRow) => COLUMNS.every(c => !row[c.key]?.trim());

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, ' ');
/** Column key for a pasted header cell ("Term", "part_of_speech", "Gloss", …), or null. */
export function columnForHeader(cell: string): string | null {
  const n = norm(cell);
  const hit = COLUMNS.find(c => norm(c.key) === n || norm(c.label) === n || c.aliases?.some(a => norm(a) === n));
  return hit?.key ?? null;
}
