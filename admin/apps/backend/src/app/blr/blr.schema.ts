import { z } from 'zod';

/** Optional text: trimmed, empty → null. */
const text = z.string().max(10000).nullish().transform(v => (v == null || v.trim() === '' ? null : v.trim()));
/** One sound-structure slot. */
const slot = z.string().max(100).nullish().transform(v => (v == null || v.trim() === '' ? null : v.trim()));
const id = z.number().int().positive().nullish();

export const Structure = z.object({
  c1: slot, c2: slot, c3: slot, c4: slot, cs: slot,
  v11: slot, v12: slot, v21: slot, v22: slot, v3: slot, v4: slot,
  t11: slot, t12: slot, t21: slot, t22: slot, t3: slot, t4: slot,
});
export type Structure = z.infer<typeof Structure>;

export const ReconstructionInput = z.object({
  word: z.string().trim().min(1, 'Word is required').max(1000),
  word_tone: text,
  english: text,
  french: text,
  noun_class: text,
  distribution: text,
  proto_kk: text,
  date_of_entry: text,
  note: text,
  contributor_id: id,
  reliability_id: id,
});
export type ReconstructionInput = z.infer<typeof ReconstructionInput>;

const reflexIds = z.array(z.number().int().positive()).max(20000, 'At most 20000 reflexes can be linked at once');

/** A new reconstruction needs at least one reflex. */
export const BlrRequest = z.object({
  reconstruction: ReconstructionInput,
  structure: Structure,
  reflex_ids: reflexIds.min(1, 'Select at least one reflex'),
});
export type BlrRequest = z.infer<typeof BlrRequest>;

/** An update sends the complete set of linked reflexes; most existing reconstructions have none. */
export const BlrUpdateRequest = BlrRequest.extend({ reflex_ids: reflexIds });
export type BlrUpdateRequest = z.infer<typeof BlrUpdateRequest>;

/** One problem with the request, in the format the admin shows per field. */
export interface FieldError { field: string; message: string }
