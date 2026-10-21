import type { BlrRequest, BlrUpdateRequest, FieldError, Structure } from './blr.schema.js';

// The shared PrismaClient of the default datasource (set from main.ts), as in bulk.service.
let client: any;
export function setPrismaClient(prisma: unknown) { client = prisma; }
const prisma = () => {
  if (!client) throw new Error('Reconstruction form: Prisma client not set');
  return client;
};

const TRANSACTION = { timeout: 60_000, maxWait: 10_000 };
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export class BlrValidationError extends Error {
  constructor(readonly errors: FieldError[]) { super(`${errors.length} problem(s) in the reconstruction`); }
}
export class BlrConflictError extends Error {
  constructor(readonly errors: FieldError[]) { super('The selected reflexes cannot be linked'); }
}
export class BlrNotFoundError extends Error {}

/** The structure tables and the slots each one owns. */
const STRUCTURES = [
  { idKey: 'consonant_structure_id', model: 'blrconsonantstructure', fields: ['c1', 'c2', 'c3', 'c4', 'cs'] },
  { idKey: 'vowel_structure_id', model: 'blrvowelstructure', fields: ['v11', 'v12', 'v21', 'v22', 'v3', 'v4'] },
  { idKey: 'tone_structure_id', model: 'blrtonestructure', fields: ['t11', 't12', 't21', 't22', 't3', 't4'] },
] as const;

/** Find the exact tuple, or create it; an all-empty structure stays NULL. */
async function structureId(tx: any, model: string, fields: readonly string[], structure: Structure) {
  const data = Object.fromEntries(fields.map(f => [f, (structure as Record<string, string | null>)[f] ?? null]));
  if (Object.values(data).every(v => v == null)) return null;
  const existing = await tx[model].findFirst({ where: data, select: { id: true } });
  if (existing) return existing.id;
  return (await tx[model].create({ data })).id;
}

export async function nextIndex(): Promise<{ blr_index: number }> {
  const max = await prisma().reconstruction.aggregate({ _max: { blr_index: true } });
  return { blr_index: (max._max.blr_index ?? 0) + 1 };
}

/** Distinct values per sound-structure slot, for the form's dropdowns. */
export async function structureOptions(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const { model, fields } of STRUCTURES) {
    for (const field of fields) {
      const rows = await prisma()[model].findMany({
        distinct: [field],
        where: { [field]: { not: null } },
        select: { [field]: true },
        orderBy: { [field]: 'asc' },
      });
      out[field] = rows
        .map((r: Record<string, unknown>) => r[field])
        .filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '');
    }
  }
  return out;
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

const REFLEX_SELECT = {
  id: true, term: true, translation: true, meaning: true,
  reconstruction_note: true, blr_entry_id: true, variety_id: true,
  variety: { select: { name_english: true, name_bantu: true, name_french: true, name_bastin: true, guthrie_index: true } },
} as const;

function toReflexRow(r: any): ReflexRow {
  const v = r.variety;
  const name = v ? (v.name_english ?? v.name_bantu ?? v.name_french ?? v.name_bastin ?? null) : null;
  const label = name ? `${name}${v.guthrie_index ? ` (${v.guthrie_index})` : ''}` : null;
  return {
    id: r.id, term: r.term, translation: r.translation, meaning: r.meaning,
    reconstruction_note: r.reconstruction_note, blr_entry_id: r.blr_entry_id, variety_id: r.variety_id, variety_label: label,
  };
}

/** Duplicate reflex ids and unknown contributor/reliability → BlrValidationError. */
async function checkReferences(tx: any, body: BlrUpdateRequest) {
  const errors: FieldError[] = [];
  const ids = [...new Set(body.reflex_ids)];
  if (ids.length !== body.reflex_ids.length)
    errors.push({ field: 'reflex_ids', message: 'The same reflex is selected more than once.' });
  if (body.reconstruction.contributor_id != null
    && !(await tx.blrcontributor.findUnique({ where: { id: body.reconstruction.contributor_id }, select: { id: true } })))
    errors.push({ field: 'contributor_id', message: 'The selected contributor does not exist.' });
  if (body.reconstruction.reliability_id != null
    && !(await tx.blrreliability.findUnique({ where: { id: body.reconstruction.reliability_id }, select: { id: true } })))
    errors.push({ field: 'reliability_id', message: 'The selected reliability does not exist.' });
  if (errors.length) throw new BlrValidationError(errors);
  return ids;
}

/** Missing reflexes, or reflexes linked to a reconstruction other than `ownerId` → BlrConflictError. */
async function checkReflexes(tx: any, ids: number[], ownerId: number | null) {
  const reflexes = await tx.reflex.findMany({
    where: { id: { in: ids } },
    select: { id: true, blr_entry_id: true },
  });
  const found = new Set(reflexes.map((r: { id: number }) => r.id));
  const missing = ids.filter(id => !found.has(id));
  const linked = reflexes.filter((r: { blr_entry_id: number | null }) => r.blr_entry_id != null && r.blr_entry_id !== ownerId);
  if (missing.length || linked.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`not found: ${missing.map(id => `#${id}`).join(', ')}`);
    if (linked.length) parts.push(`already linked to ${ownerId ? 'another' : 'a'} reconstruction: ${linked.map((r: { id: number }) => `#${r.id}`).join(', ')}`);
    throw new BlrConflictError([{ field: 'reflex_ids', message: `Reflexes ${parts.join('; ')}.` }]);
  }
}

async function structureIds(tx: any, structure: Structure) {
  const out: Record<string, number | null> = {};
  for (const { idKey, model, fields } of STRUCTURES) out[idKey] = await structureId(tx, model, fields, structure);
  return out;
}

/** Link the given unlinked reflexes to a reconstruction; a count mismatch means the selection changed meanwhile. */
async function linkReflexes(tx: any, ids: number[], id: number) {
  if (!ids.length) return 0;
  const updated = await tx.reflex.updateMany({
    where: { id: { in: ids }, blr_entry_id: null },
    data: { blr_entry_id: id },
  });
  if (updated.count !== ids.length)
    throw new BlrConflictError([{ field: 'reflex_ids', message: 'The selection changed while saving; nothing was saved.' }]);
  return updated.count;
}

export async function createBlr(body: BlrRequest) {
  return prisma().$transaction(async (tx: any) => {
    const ids = await checkReferences(tx, body);
    await checkReflexes(tx, ids, null);
    const structures = await structureIds(tx, body.structure);

    const max = await tx.reconstruction.aggregate({ _max: { blr_index: true } });
    const index = (max._max.blr_index ?? 0) + 1;
    const reconstruction = await tx.reconstruction.create({
      data: {
        ...body.reconstruction,
        date_of_entry: body.reconstruction.date_of_entry ?? now(),
        blr_index: index,
        ...structures,
      },
    });
    const linked = await linkReflexes(tx, ids, reconstruction.id);
    return { id: reconstruction.id, blr_index: index, linked, unlinked: 0 };
  }, TRANSACTION);
}

/**
 * Update a reconstruction and set its linked reflexes to exactly `reflex_ids`:
 * reflexes left out are unlinked, new ones linked. Shared structure rows are
 * never changed; a changed structure points to a matching or new tuple.
 */
export async function updateBlr(id: number, body: BlrUpdateRequest) {
  return prisma().$transaction(async (tx: any) => {
    const current = await tx.reconstruction.findUnique({ where: { id }, select: { id: true, blr_index: true, date_of_entry: true } });
    if (!current) throw new BlrNotFoundError(`Reconstruction ${id} does not exist.`);
    const ids = await checkReferences(tx, body);
    await checkReflexes(tx, ids, id);
    const structures = await structureIds(tx, body.structure);

    await tx.reconstruction.update({
      where: { id },
      data: {
        ...body.reconstruction,
        date_of_entry: body.reconstruction.date_of_entry ?? current.date_of_entry,
        ...structures,
      },
    });

    const unlinked = await tx.reflex.updateMany({
      where: { blr_entry_id: id, id: { notIn: ids } },
      data: { blr_entry_id: null },
    });
    const owned = await tx.reflex.findMany({ where: { blr_entry_id: id }, select: { id: true } });
    const ownedIds = new Set(owned.map((r: { id: number }) => r.id));
    const linked = await linkReflexes(tx, ids.filter(r => !ownedIds.has(r)), id);
    return { id, blr_index: current.blr_index, linked, unlinked: unlinked.count };
  }, TRANSACTION);
}

/** A reconstruction with its sound structure (17 slots) and its linked reflexes. */
export async function getBlr(id: number) {
  const r = await prisma().reconstruction.findUnique({
    where: { id },
    include: {
      blrconsonantstructure: true,
      blrvowelstructure: true,
      blrtonestructure: true,
      reflex: { select: REFLEX_SELECT, orderBy: { id: 'asc' } },
    },
  });
  if (!r) throw new BlrNotFoundError(`Reconstruction ${id} does not exist.`);
  const structure: Record<string, string | null> = {};
  const rows: Record<string, any> = { blrconsonantstructure: r.blrconsonantstructure, blrvowelstructure: r.blrvowelstructure, blrtonestructure: r.blrtonestructure };
  for (const { model, fields } of STRUCTURES) for (const f of fields) structure[f] = rows[model]?.[f] ?? null;
  return {
    reconstruction: {
      id: r.id, blr_index: r.blr_index,
      word: r.word, word_tone: r.word_tone, english: r.english, french: r.french,
      noun_class: r.noun_class, distribution: r.distribution, proto_kk: r.proto_kk,
      date_of_entry: r.date_of_entry, note: r.note,
      contributor_id: r.contributor_id, reliability_id: r.reliability_id,
    },
    structure,
    reflexes: r.reflex.map(toReflexRow),
  };
}

/** The reconstruction with this BLR index. */
export async function findByIndex(blrIndex: number): Promise<{ id: number }> {
  const r = await prisma().reconstruction.findFirst({ where: { blr_index: blrIndex }, select: { id: true } });
  if (!r) throw new BlrNotFoundError(`There is no reconstruction with BLR index ${blrIndex}.`);
  return r;
}

export interface BlrNeighbour { id: number; blr_index: number }

/** The reconstructions with the closest lower and higher BLR index; null at either end. */
export async function neighbours(blrIndex: number): Promise<{ previous: BlrNeighbour | null; next: BlrNeighbour | null }> {
  const select = { id: true, blr_index: true };
  const [previous, next] = await Promise.all([
    prisma().reconstruction.findFirst({ where: { blr_index: { lt: blrIndex } }, orderBy: { blr_index: 'desc' }, select }),
    prisma().reconstruction.findFirst({ where: { blr_index: { gt: blrIndex } }, orderBy: { blr_index: 'asc' }, select }),
  ]);
  return { previous: previous ?? null, next: next ?? null };
}
