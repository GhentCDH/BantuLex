import { z } from 'zod';

/** Optional text cell: trimmed, empty → null. */
const text = z.string().max(10000).nullish().transform(v => (v == null || v.trim() === '' ? null : v.trim()));
const id = z.number().int().positive();

export const MAX_ROWS = 20000;

export const BulkRow = z.object({
  term: z.string().max(1000).transform(v => v.trim()),
  translation: text,
  meaning: text,
  part_of_speech: text,
  term_morph_analysis: text,
  semantic_field: text,
  scientific_name: text,
  notes: text,
  pages: text,
  blr_index: text,
});
export type BulkRow = z.infer<typeof BulkRow>;

export const BulkRequest = z.object({
  // Name of the import; the admin sends the local date and time ("2027 10 12 - 13h 14").
  label: z.string().trim().max(200).nullish(),
  note: text,
  role: z.enum(['primary', 'cited']).default('primary'),
  source: z.union([
    z.object({ id }),
    z.object({ create: z.object({ author_year: z.string().trim().min(1, 'Author/year is required'), title: text, year_uncertain: z.boolean().default(false) }) }),
  ]),
  variety: z.union([
    z.object({ id }),
    z.object({ create: z.object({ name_english: z.string().trim().min(1, 'Variety name is required'), name_french: text, name_bantu: text, guthrie_index: text, branch: text }) }),
  ]).nullish(),
  location_id: id.nullish(),
  fieldwork_id: id.nullish(),
  rows: z.array(BulkRow).min(1, 'No rows to import').max(MAX_ROWS, `At most ${MAX_ROWS} rows per import`),
});
export type BulkRequest = z.infer<typeof BulkRequest>;

/** One problem with the request: row is 1-based (null for the shared links). */
export interface RowError { row: number | null; field: string; message: string }
