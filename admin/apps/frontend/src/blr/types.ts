export interface ReconstructionDraft {
  word: string;
  word_tone: string;
  english: string;
  french: string;
  noun_class: string;
  distribution: string;
  proto_kk: string;
  date_of_entry: string;
  note: string;
  contributor_id: number | null;
  reliability_id: number | null;
}

/** A reconstruction as GET /api/blr/:id returns it (text fields may be null). */
export interface StoredReconstruction extends Record<keyof ReconstructionDraft, any> {
  id: number;
  blr_index: number | null;
}

export interface BlrRecord {
  reconstruction: StoredReconstruction;
  structure: Record<string, string | null>;
  reflexes: ReflexRow[];
}

export interface SaveResult {
  id: number;
  blr_index: number | null;
  linked: number;
  unlinked: number;
}

export interface ReflexRow {
  id: number;
  term: string | null;
  translation: string | null;
  meaning: string | null;
  reconstruction_note: string | null;
  blr_entry_id: number | null;
  variety_id: number | null;
  variety_label: string | null;
}

export interface Option {
  value: number;
  label: string;
}

/** Sound-structure slots, in the viewer's order. */
export const SEGMENTS = ['c1', 'v11', 'v12', 'c2', 'v21', 'v22', 'c3', 'v3', 'c4', 'v4', 'cs'] as const;
export const TONES: Record<string, string> = {
  v11: 't11', v12: 't12', v21: 't21', v22: 't22', v3: 't3', v4: 't4',
};
export const STRUCTURE_FIELDS = [...SEGMENTS, ...Object.values(TONES)];

const SUBSCRIPTS: Record<string, string> = { 1: '₁', 2: '₂', 3: '₃', 4: '₄' };
/** "v11" → "V₁₁", "cs" → "CS". */
export const segmentLabel = (field: string) => field.replace(/\d/g, d => SUBSCRIPTS[d]).toUpperCase();

export const emptyStructure = (): Record<string, string | null> =>
  Object.fromEntries(STRUCTURE_FIELDS.map(f => [f, null]));

export const emptyReconstruction = (): ReconstructionDraft => ({
  word: '',
  word_tone: '',
  english: '',
  french: '',
  noun_class: '',
  distribution: '',
  proto_kk: '',
  date_of_entry: new Date().toISOString().slice(0, 19).replace('T', ' '),
  note: '',
  contributor_id: null,
  reliability_id: null,
});

/** The editable fields of a stored reconstruction; NULL text becomes ''. */
export function toDraft(stored: StoredReconstruction): ReconstructionDraft {
  const draft = emptyReconstruction();
  for (const key of Object.keys(draft) as (keyof ReconstructionDraft)[]) {
    const value = stored[key];
    (draft as any)[key] = key === 'contributor_id' || key === 'reliability_id' ? value ?? null : value ?? '';
  }
  return draft;
}

/** Guthrie zones used by BLR `distribution` (matches the existing data format). */
export const GUTHRIE_ZONES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R', 'S'];
